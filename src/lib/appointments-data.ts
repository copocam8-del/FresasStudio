import "server-only";
import type { StaffContext } from "@/lib/auth";
import { addDays } from "@/lib/booking-format";
import { localToInstant } from "@/lib/booking-format";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Turnos del panel. La RLS decide qué ve cada persona: con agenda.read_all, todos;
 * una profesional con agenda.read_own, solo los suyos.
 */
export type Appointment = {
  id: string;
  code: string;
  client_profile_id: string;
  professional_id: string;
  service_name: string;
  professional_name: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  buffer_minutes: number;
  price_minor: number;
  price_is_from: boolean;
  currency: string;
  deposit_percent: number;
  deposit_minor: number;
  policy_version: number;
  cancellation_window_hours: number;
  status: "pending_payment" | "confirmed" | "cancelled" | "expired";
  deposit_status: "pending" | "paid" | "paid_offline";
  hold_expires_at: string | null;
  source: "online" | "staff";
  forced_outside_hours: boolean;
  client_note: string | null;
  created_at: string;
};

export type AppointmentEvent = {
  id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_user_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type ClientLite = { id: string; full_name: string; phone: string | null; email: string | null; user_id: string | null };

/** Estado "real": una reserva esperando pago cuyo plazo pasó ya no ocupa (aunque nadie la haya limpiado). */
export function effectiveStatus(a: Pick<Appointment, "status" | "hold_expires_at">, now = Date.now()): Appointment["status"] {
  return a.status === "pending_payment" && a.hold_expires_at && new Date(a.hold_expires_at).getTime() <= now ? "expired" : a.status;
}

export async function loadDay(ctx: StaffContext, ymd: string) {
  const from = localToInstant(ymd, "00:00", ctx.studio.timezone);
  const to = localToInstant(addDays(ymd, 1), "00:00", ctx.studio.timezone);
  if (!from || !to) return { appointments: [] as Appointment[], clients: new Map<string, ClientLite>() };
  const supabase = await serverSupabase();
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at");
  if (error) throw new Error(`No se pudieron cargar los turnos: ${error.message}`);
  const appointments = (data ?? []) as Appointment[];
  return { appointments, clients: await loadClients(ctx, appointments.map((a) => a.client_profile_id)) };
}

/** Fichas de las clientas (solo si la persona tiene clients.read; si no, no se ven). */
export async function loadClients(ctx: StaffContext, ids: string[]): Promise<Map<string, ClientLite>> {
  const map = new Map<string, ClientLite>();
  if (ids.length === 0) return map;
  const supabase = await serverSupabase();
  const { data } = await supabase
    .from("client_profiles")
    .select("id, full_name, phone, email, user_id")
    .eq("tenant_id", ctx.tenantId)
    .in("id", [...new Set(ids)]);
  for (const c of (data ?? []) as ClientLite[]) map.set(c.id, c);
  return map;
}

export async function loadAppointment(ctx: StaffContext, id: string) {
  const supabase = await serverSupabase();
  const [{ data: a }, { data: events }] = await Promise.all([
    supabase.from("appointments").select("*").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle(),
    supabase.from("appointment_events").select("id, event_type, from_status, to_status, actor_user_id, detail, created_at")
      .eq("tenant_id", ctx.tenantId).eq("appointment_id", id).order("id"),
  ]);
  if (!a) return null;
  const appointment = a as Appointment;
  const clients = await loadClients(ctx, [appointment.client_profile_id]);
  return { appointment, events: (events ?? []) as AppointmentEvent[], client: clients.get(appointment.client_profile_id) ?? null };
}
