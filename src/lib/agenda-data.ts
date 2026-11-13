import "server-only";
import type { StaffContext } from "@/lib/auth";
import { addDays, localToInstant } from "@/lib/booking-format";
import type { BookingTerms } from "@/lib/booking-terms";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Agenda del panel (Épica 08). Todo sale de la base: turnos visibles según permisos
 * (agenda_range), horarios de cada profesional con descansos y bloqueos aplicados
 * (agenda_hours) y avisos (agenda_alerts).
 */
export type AgendaAppointment = {
  id: string;
  code: string;
  starts_at: string;
  ends_at: string;
  occupied_until: string;
  status: string;
  deposit_status: string;
  source: "online" | "staff";
  professional_id: string;
  professional_name: string;
  service_name: string;
  client_profile_id: string;
  client_name: string;
  client_phone: string | null;
  checked_in_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  hold_expires_at: string | null;
  is_frequent: boolean;
  no_shows_180: number;
  has_allergies: boolean;
  unclosed: boolean;
  can_mark: boolean;
};

export type AgendaHours = {
  professional_id: string;
  professional_name: string;
  sort_order: number;
  starts_at: string;
  ends_at: string;
};

export type AgendaPro = { id: string; name: string; order: number };

export async function loadAgenda(ctx: StaffContext, fromYmd: string, days: number) {
  const tz = ctx.studio.timezone;
  const from = localToInstant(fromYmd, "00:00", tz);
  const to = localToInstant(addDays(fromYmd, days), "00:00", tz);
  if (!from || !to) throw new Error("Fecha inválida");
  const supabase = await serverSupabase();
  const [appts, hours] = await Promise.all([
    supabase.rpc("agenda_range", { p_tenant: ctx.tenantId, p_from: from, p_to: to }),
    supabase.rpc("agenda_hours", { p_tenant: ctx.tenantId, p_from: from, p_to: to }),
  ]);
  if (appts.error) throw new Error(`No se pudo cargar la agenda: ${appts.error.message}`);
  if (hours.error) throw new Error(`No se pudieron cargar los horarios: ${hours.error.message}`);
  const appointments = (appts.data ?? []) as AgendaAppointment[];
  const workHours = (hours.data ?? []) as AgendaHours[];

  // Profesionales: las que atienden en el rango y las que tienen turnos (aunque hoy no atiendan).
  const pros = new Map<string, AgendaPro>();
  for (const h of workHours) pros.set(h.professional_id, { id: h.professional_id, name: h.professional_name, order: h.sort_order });
  for (const a of appointments) {
    if (!pros.has(a.professional_id)) pros.set(a.professional_id, { id: a.professional_id, name: a.professional_name, order: 9999 });
  }
  const professionals = [...pros.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
  return { appointments, hours: workHours, professionals };
}

export async function agendaAlerts(ctx: StaffContext): Promise<{ unclosed: number; no_shows_month: number }> {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("agenda_alerts", { p_tenant: ctx.tenantId });
  if (error) return { unclosed: 0, no_shows_month: 0 };
  const row = ((data ?? []) as { unclosed: number; no_shows_month: number }[])[0];
  return { unclosed: Number(row?.unclosed ?? 0), no_shows_month: Number(row?.no_shows_month ?? 0) };
}

/** Plazo y consecuencias de un turno (lo decide la base). */
export async function bookingTerms(id: string): Promise<BookingTerms | null> {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("get_booking_terms", { p_appointment: id });
  if (error) return null;
  return ((data ?? []) as BookingTerms[])[0] ?? null;
}
