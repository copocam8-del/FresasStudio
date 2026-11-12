import "server-only";
import { can, type StaffContext } from "@/lib/auth";
import { effectiveStatus, loadClients, type Appointment, type ClientLite } from "@/lib/appointments-data";
import { addDays, localToInstant, ymdIn } from "@/lib/booking-format";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Datos del inicio del panel. SOLO datos reales de la base (docs/diseno-plan.md D5):
 * nada de porcentajes ni curvas inventadas. La RLS decide qué ve cada persona (una
 * profesional, solo sus turnos; la caja, solo con cash.read).
 */
export type Dashboard = {
  todayYmd: string;
  today: Appointment[];
  upcoming: Appointment[];
  clients: Map<string, ClientLite>;
  stats: { today: number; pending: number; next7: number; collectedMonth: number | null; currency: string };
};

export async function loadDashboard(ctx: StaffContext): Promise<Dashboard> {
  const tz = ctx.studio.timezone;
  const now = Date.now();
  const todayYmd = ymdIn(new Date(now), tz);
  const dayStart = localToInstant(todayYmd, "00:00", tz)!;
  const tomorrow = localToInstant(addDays(todayYmd, 1), "00:00", tz)!;
  const in7 = localToInstant(addDays(todayYmd, 8), "00:00", tz)!;

  const supabase = await serverSupabase();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .in("status", ["pending_payment", "confirmed"])
    .gte("starts_at", dayStart)
    .order("starts_at")
    .limit(500);
  if (error) throw new Error(`No se pudieron cargar los turnos: ${error.message}`);
  // Una reserva esperando pago con el plazo vencido ya no cuenta.
  const active = ((data ?? []) as Appointment[]).filter((a) => effectiveStatus(a, now) !== "expired");

  const today = active.filter((a) => a.starts_at < tomorrow);
  const upcoming = active.filter((a) => a.starts_at >= tomorrow).slice(0, 5);
  const next7 = active.filter((a) => a.status === "confirmed" && a.starts_at >= tomorrow && a.starts_at < in7).length;
  const pending = active.filter((a) => a.status === "pending_payment").length;

  let collectedMonth: number | null = null;
  let currency = active[0]?.currency ?? "ARS";
  if (can(ctx, "cash.read")) {
    const monthStart = localToInstant(`${todayYmd.slice(0, 8)}01`, "00:00", tz)!;
    const { data: pays } = await supabase
      .from("payments")
      .select("amount_minor, refunded_minor, currency, outcome")
      .eq("tenant_id", ctx.tenantId)
      .in("outcome", ["applied", "late_confirmed"])
      .gte("approved_at", monthStart);
    const rows = (pays ?? []) as Array<{ amount_minor: number; refunded_minor: number; currency: string }>;
    collectedMonth = rows.reduce((s, p) => s + Number(p.amount_minor) - Number(p.refunded_minor), 0);
    if (rows[0]) currency = rows[0].currency;
  }

  const clients = await loadClients(ctx, [...today, ...upcoming].map((a) => a.client_profile_id));
  return { todayYmd, today, upcoming, clients, stats: { today: today.length, pending, next7, collectedMonth, currency } };
}

/** "jueves, 12 de noviembre" en la zona del estudio. */
export function todayLabel(timezone: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date());
}
