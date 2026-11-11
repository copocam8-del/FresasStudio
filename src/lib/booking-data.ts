import "server-only";
import { cache } from "react";
import { publicSupabase } from "@/lib/supabase/public";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Lecturas del flujo de reserva. Toda la disponibilidad y los montos salen de la base
 * (funciones públicas por slug); acá solo se tipan.
 */

export type BookingContext = {
  online_booking_enabled: boolean;
  timezone: string;
  currency: string;
  deposit_percent: number;
  cancellation_window_hours: number;
  booking_hold_minutes: number;
  booking_min_notice_minutes: number;
  booking_horizon_days: number;
  slot_interval_minutes: number;
  policy_version: number;
  policy_text: string | null;
};

export type ServiceOption = {
  professional_id: string;
  display_name: string;
  photo_path: string | null;
  duration_minutes: number;
  price_minor: number;
  deposit_minor: number;
};

export type Preview = {
  professional_id: string;
  professional_name: string;
  duration_minutes: number;
  ends_at: string;
  price_minor: number;
  price_is_from: boolean;
  deposit_minor: number;
  currency: string;
};

export type MyBooking = {
  code: string;
  service_name: string;
  professional_name: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: "pending_payment" | "confirmed" | "cancelled" | "expired";
  deposit_status: "pending" | "paid" | "paid_offline";
  price_minor: number;
  price_is_from: boolean;
  deposit_minor: number;
  currency: string;
  hold_expires_at: string | null;
  cancellation_window_hours: number;
  policy_version: number;
  client_note: string | null;
};

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export const getBookingContext = cache(async (slug: string): Promise<BookingContext | null> =>
  check(await publicSupabase().rpc("get_booking_context", { p_slug: slug }), "No se pudo cargar la configuración de reservas"));

export async function getServiceOptions(slug: string, serviceId: string): Promise<ServiceOption[]> {
  return check(await publicSupabase().rpc("get_service_options", { p_slug: slug, p_service: serviceId }), "No se pudieron cargar las profesionales") ?? [];
}

export async function getAvailableDays(slug: string, serviceId: string, pro: string | null, from: string, days: number) {
  const data = check(
    await publicSupabase().rpc("get_available_days", { p_slug: slug, p_service: serviceId, p_professional: pro, p_from: from, p_days: days }),
    "No se pudieron cargar los días",
  );
  return (data ?? []) as { day: string; slots: number }[];
}

export async function getAvailableSlots(slug: string, serviceId: string, pro: string | null, day: string): Promise<string[]> {
  const data = check(
    await publicSupabase().rpc("get_available_slots", { p_slug: slug, p_service: serviceId, p_professional: pro, p_day: day }),
    "No se pudieron cargar los horarios",
  );
  return ((data ?? []) as { starts_at: string }[]).map((r) => r.starts_at);
}

export async function previewBooking(slug: string, serviceId: string, pro: string | null, startsAt: string): Promise<Preview | null> {
  const data = check(
    await publicSupabase().rpc("preview_booking", { p_slug: slug, p_service: serviceId, p_professional: pro, p_starts_at: startsAt }),
    "No se pudo armar el resumen",
  );
  return ((data ?? []) as Preview[])[0] ?? null;
}

export async function myBookings(slug: string): Promise<MyBooking[]> {
  const supabase = await serverSupabase();
  return (check(await supabase.rpc("my_bookings", { p_slug: slug }), "No se pudieron cargar tus turnos") ?? []) as MyBooking[];
}

export async function myPhone(slug: string): Promise<string> {
  const supabase = await serverSupabase();
  const { data } = await supabase.rpc("my_client_profile", { p_slug: slug });
  return ((data ?? []) as { phone: string | null }[])[0]?.phone ?? "";
}

/** Separa los turnos en próximos (más cercano primero) y anteriores (más reciente primero). */
export function splitBookings(bookings: MyBooking[], now = Date.now()) {
  const upcoming = bookings.filter((b) => new Date(b.starts_at).getTime() >= now).reverse();
  const past = bookings.filter((b) => new Date(b.starts_at).getTime() < now);
  return { upcoming, past };
}
