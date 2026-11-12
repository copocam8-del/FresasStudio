import "server-only";
import { can, type StaffContext } from "@/lib/auth";
import { effectiveStatus, loadClients, type Appointment, type ClientLite } from "@/lib/appointments-data";
import { addDays, localToInstant, ymdIn } from "@/lib/booking-format";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Datos del inicio del panel. SOLO datos reales de la base (docs/diseno-plan.md D5):
 * los números, las curvas, el calendario y la actividad salen de las reservas, su
 * historial y los pagos. La RLS decide qué ve cada persona.
 */
export type ActivityItem = { id: number; type: string; at: string; appointmentId: string; service: string; client: string | null };
export type RecentPayment = { id: string; at: string; amountMinor: number; currency: string; outcome: string | null; status: string; code: string; client: string | null };

export type Dashboard = {
  todayYmd: string;
  today: Appointment[];
  upcoming: Appointment[];
  clients: Map<string, ClientLite>;
  stats: { today: number; pending: number; next7: number; collectedMonth: number | null; currency: string };
  series: { last14: number[]; next7: number[]; collectedMonth: number[] };
  month: { ym: string; counts: Record<string, number>; prev: string; next: string };
  activity: ActivityItem[];
  payments: RecentPayment[];
};

const isYm = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const shiftYm = (ym: string, d: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export async function loadDashboard(ctx: StaffContext, monthParam?: unknown): Promise<Dashboard> {
  const tz = ctx.studio.timezone;
  const now = Date.now();
  const todayYmd = ymdIn(new Date(now), tz);
  const ym = isYm(monthParam) ? monthParam : todayYmd.slice(0, 7);
  const monthFirst = `${ym}-01`;
  const monthEndYmd = addDays(monthFirst, daysInMonth(ym));

  const past14 = addDays(todayYmd, -13);
  const fromYmd = [past14, monthFirst].sort()[0];
  const toYmd = [addDays(todayYmd, 8), monthEndYmd].sort()[1];
  const from = localToInstant(fromYmd, "00:00", tz)!;
  const to = localToInstant(toYmd, "00:00", tz)!;
  const tomorrow = localToInstant(addDays(todayYmd, 1), "00:00", tz)!;
  const in7 = localToInstant(addDays(todayYmd, 8), "00:00", tz)!;

  const supabase = await serverSupabase();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .in("status", ["pending_payment", "confirmed"])
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at")
    .limit(2000);
  if (error) throw new Error(`No se pudieron cargar los turnos: ${error.message}`);
  // Una reserva esperando pago con el plazo vencido ya no cuenta.
  const all = ((data ?? []) as Appointment[]).filter((a) => effectiveStatus(a, now) !== "expired");
  const dayOf = (a: Appointment) => ymdIn(a.starts_at, tz);
  const dayStart = localToInstant(todayYmd, "00:00", tz)!;

  const active = all.filter((a) => a.starts_at >= dayStart);
  const today = active.filter((a) => a.starts_at < tomorrow);
  const upcoming = active.filter((a) => a.starts_at >= tomorrow).slice(0, 5);
  const next7 = active.filter((a) => a.status === "confirmed" && a.starts_at >= tomorrow && a.starts_at < in7);
  const pending = active.filter((a) => a.status === "pending_payment").length;

  const countByDay = (list: Appointment[]) => {
    const m: Record<string, number> = {};
    for (const a of list) m[dayOf(a)] = (m[dayOf(a)] ?? 0) + 1;
    return m;
  };
  const byDay = countByDay(all);
  const confirmedByDay = countByDay(next7);
  const last14 = Array.from({ length: 14 }, (_, i) => byDay[addDays(past14, i)] ?? 0);
  const next7Series = Array.from({ length: 7 }, (_, i) => confirmedByDay[addDays(todayYmd, i + 1)] ?? 0);
  const monthCounts: Record<string, number> = {};
  for (const [d, n] of Object.entries(byDay)) if (d.startsWith(ym)) monthCounts[d] = n;

  let collectedMonth: number | null = null;
  let collectedSeries: number[] = [];
  let currency = all[0]?.currency ?? "ARS";
  let payments: RecentPayment[] = [];
  if (can(ctx, "cash.read")) {
    const thisMonth = todayYmd.slice(0, 7);
    const monthStart = localToInstant(`${thisMonth}-01`, "00:00", tz)!;
    const [{ data: pays }, { data: recent }] = await Promise.all([
      supabase.from("payments").select("amount_minor, refunded_minor, currency, approved_at")
        .eq("tenant_id", ctx.tenantId).in("outcome", ["applied", "late_confirmed"]).gte("approved_at", monthStart),
      supabase.from("payments").select("id, created_at, approved_at, amount_minor, currency, outcome, status, appointment_id")
        .eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(4),
    ]);
    const rows = (pays ?? []) as Array<{ amount_minor: number; refunded_minor: number; currency: string; approved_at: string }>;
    collectedMonth = rows.reduce((s, p) => s + Number(p.amount_minor) - Number(p.refunded_minor), 0);
    if (rows[0]) currency = rows[0].currency;
    // Cobrado acumulado del mes, día por día hasta hoy.
    const perDay: Record<string, number> = {};
    for (const p of rows) {
      const d = ymdIn(p.approved_at, tz);
      perDay[d] = (perDay[d] ?? 0) + Number(p.amount_minor) - Number(p.refunded_minor);
    }
    const days = Number(todayYmd.slice(8, 10));
    let acc = 0;
    collectedSeries = Array.from({ length: days }, (_, i) => (acc += perDay[`${thisMonth}-${String(i + 1).padStart(2, "0")}`] ?? 0));

    const rp = (recent ?? []) as Array<{ id: string; created_at: string; approved_at: string | null; amount_minor: number; currency: string; outcome: string | null; status: string; appointment_id: string }>;
    if (rp.length) {
      const { data: appts } = await supabase.from("appointments").select("id, code, client_profile_id").in("id", rp.map((p) => p.appointment_id));
      const am = new Map((appts ?? []).map((a) => [a.id as string, a as { id: string; code: string; client_profile_id: string }]));
      const cl = await loadClients(ctx, [...am.values()].map((a) => a.client_profile_id));
      payments = rp.map((p) => ({
        id: p.id, at: p.approved_at ?? p.created_at, amountMinor: Number(p.amount_minor), currency: p.currency,
        outcome: p.outcome, status: p.status, code: am.get(p.appointment_id)?.code ?? "",
        client: cl.get(am.get(p.appointment_id)?.client_profile_id ?? "")?.full_name ?? null,
      }));
    }
  }

  // Actividad reciente: el historial de las reservas (solo las que la persona puede ver).
  const { data: evs } = await supabase
    .from("appointment_events")
    .select("id, event_type, created_at, appointment_id")
    .eq("tenant_id", ctx.tenantId)
    .order("id", { ascending: false })
    .limit(5);
  const evRows = (evs ?? []) as Array<{ id: number; event_type: string; created_at: string; appointment_id: string }>;
  let activity: ActivityItem[] = [];
  if (evRows.length) {
    const { data: appts } = await supabase.from("appointments").select("id, service_name, client_profile_id")
      .in("id", [...new Set(evRows.map((e) => e.appointment_id))]);
    const am = new Map((appts ?? []).map((a) => [a.id as string, a as { id: string; service_name: string; client_profile_id: string }]));
    const cl = await loadClients(ctx, [...am.values()].map((a) => a.client_profile_id));
    activity = evRows.map((e) => ({
      id: e.id, type: e.event_type, at: e.created_at, appointmentId: e.appointment_id,
      service: am.get(e.appointment_id)?.service_name ?? "",
      client: cl.get(am.get(e.appointment_id)?.client_profile_id ?? "")?.full_name ?? null,
    }));
  }

  const clients = await loadClients(ctx, [...today, ...upcoming].map((a) => a.client_profile_id));
  return {
    todayYmd, today, upcoming, clients,
    stats: { today: today.length, pending, next7: next7.length, collectedMonth, currency },
    series: { last14, next7: next7Series, collectedMonth: collectedSeries },
    month: { ym, counts: monthCounts, prev: shiftYm(ym, -1), next: shiftYm(ym, 1) },
    activity,
    payments,
  };
}

/** "Jue, 12 de noviembre de 2026" en la zona del estudio. */
export function todayLabel(timezone: string): string {
  const s = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "short", day: "numeric", month: "long", year: "numeric" })
    .format(new Date()).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Hace 5 min", "Hace 2 h", "Hace 3 días". */
export function timeAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "Recién";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.round(h / 24);
  return `Hace ${d} ${d === 1 ? "día" : "días"}`;
}
