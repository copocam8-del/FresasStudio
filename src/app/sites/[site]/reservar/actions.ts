"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { parseInstant, parseProChoice } from "@/lib/booking-format";
import { userFacingDbError } from "@/lib/db-errors";
import { currentStudio } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import { phoneSchema } from "@/lib/validation";

export type BookingState = { error?: string } | undefined;

const codeSchema = z.string().regex(/^[2-9A-HJKMNP-Z]{6}$/i);

/**
 * Crea la reserva (esperando pago). La base recalcula TODO: disponibilidad, quién
 * atiende, precio, seña, vencimiento y política; acá solo se valida la forma.
 */
export async function createBookingAction(_prev: BookingState, formData: FormData): Promise<BookingState> {
  const studio = await currentStudio();
  if (!studio) return { error: "Este estudio no está disponible." };

  const service = z.uuid().safeParse(formData.get("service"));
  const pro = parseProChoice(formData.get("pro"));
  const startsAt = parseInstant(formData.get("starts_at"));
  const policy = z.coerce.number().int().positive().safeParse(formData.get("policy_version"));
  if (!service.success || !pro || !startsAt || !policy.success) return { error: "La reserva no es válida. Volvé a elegir el horario." };
  if (formData.get("accept_policy") !== "on") return { error: "Para reservar tenés que aceptar la política del estudio." };
  const phone = phoneSchema.safeParse(formData.get("phone"));
  if (!phone.success) return { error: "Ingresá un teléfono válido para que el estudio pueda avisarte." };
  const note = String(formData.get("note") ?? "").trim();
  if (note.length > 300) return { error: "La nota puede tener hasta 300 caracteres." };

  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("create_online_booking", {
    p_slug: studio.slug,
    p_service: service.data,
    p_professional: pro === "any" ? null : pro,
    p_starts_at: startsAt.toISOString(),
    p_accepted_policy_version: policy.data,
    p_phone: phone.data,
    p_client_note: note || null,
  });
  if (error) return { error: userFacingDbError(error) };
  const code = (data as { code: string }[])[0]?.code;
  if (!code) return { error: "No pudimos crear la reserva. Probá de nuevo." };
  redirect(`/reserva/${code}`);
}

export async function releaseBookingAction(formData: FormData): Promise<void> {
  const studio = await currentStudio();
  const code = codeSchema.safeParse(formData.get("code"));
  if (!studio || !code.success) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("release_my_pending_booking", { p_slug: studio.slug, p_code: code.data });
  if (error) console.error("release_my_pending_booking", userFacingDbError(error));
  redirect(`/reserva/${code.data.toUpperCase()}`);
}

/**
 * SOLO DESARROLLO: simula el aviso de pago aprobado de Mercado Pago. Doble llave:
 * la variable de entorno tiene que estar prendida Y la función tiene que existir en la
 * base (solo la crea el seed de desarrollo; en producción no existe).
 */
export async function simulatePaymentAction(formData: FormData): Promise<void> {
  if (process.env.NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS !== "true") return;
  const studio = await currentStudio();
  const code = codeSchema.safeParse(formData.get("code"));
  if (!studio || !code.success) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("dev_simulate_deposit_payment", { p_slug: studio.slug, p_code: code.data });
  if (error) console.error("dev_simulate_deposit_payment", error.message);
  redirect(`/reserva/${code.data.toUpperCase()}`);
}
