"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { userFacingDbError } from "@/lib/db-errors";
import { serverSupabase } from "@/lib/supabase/server";

export type SettingsState = { error?: string; ok?: string } | undefined;

const int = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).int(msg).min(min, msg).max(max, msg);

const schema = z.object({
  online_booking_enabled: z.string().nullish().transform((v) => v === "on"),
  booking_min_notice_minutes: int(0, 10080, "La anticipación mínima tiene que ser de 0 a 7 días."),
  booking_horizon_days: int(1, 365, "Se puede reservar de 1 a 365 días adelante."),
  slot_interval_minutes: z.coerce.number().refine((v) => [5, 10, 15, 20, 30, 60].includes(v), "Intervalo inválido."),
  booking_hold_minutes: int(5, 1440, "El tiempo para pagar tiene que ser de 5 minutos a 24 horas."),
  deposit_percent: int(1, 100, "La seña tiene que ser de 1 a 100%: toda reserva lleva seña."),
  cancellation_window_hours: int(0, 720, "La ventana de cancelación tiene que ser de 0 a 720 horas."),
  credit_expiry_days: int(30, 365, "El saldo a favor tiene que vencer entre 30 y 365 días."),
});

/** Reglas de reservas del estudio (settings.manage). La base vuelve a validar todo. */
export async function saveBookingSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "settings.manage")) return { error: "No tenés permiso para cambiar estas reglas." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };

  const supabase = await serverSupabase();
  const { error } = await supabase.from("tenant_settings").update(parsed.data).eq("tenant_id", ctx.tenantId);
  if (error) return { error: userFacingDbError(error) };
  revalidatePath("/", "layout");
  return { ok: "Guardamos las reglas de reservas. Las reservas ya hechas conservan lo que se acordó." };
}
