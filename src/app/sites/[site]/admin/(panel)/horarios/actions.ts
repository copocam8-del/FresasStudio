"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { userFacingDbError } from "@/lib/db-errors";
import { serverSupabase } from "@/lib/supabase/server";
import { checkDayRanges } from "@/lib/time";

export type HoursState = { error?: string; ok?: string } | undefined;

const rangesSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(1).max(7),
      start: z.number().int().min(0).max(1435).multipleOf(5),
      end: z.number().int().min(5).max(1440).multipleOf(5),
    }),
  )
  .max(70);

/**
 * Guarda TODA la semana de un horario (estudio o profesional) con set_working_hours:
 * todo o nada. Lista vacía en una profesional = "igual al horario del estudio" (N4).
 */
export async function saveHoursAction(_prev: HoursState, formData: FormData): Promise<HoursState> {
  const ctx = await currentStaff();
  const rawPro = formData.get("professional_id");
  const professional = rawPro ? z.uuid().safeParse(rawPro) : null;
  if (professional && !professional.success) return { error: "Profesional inválida." };
  const needed = professional ? "agenda.manage" : "settings.manage";
  if (!ctx || !can(ctx, needed)) return { error: "No tenés permiso para cambiar este horario." };

  let ranges: z.infer<typeof rangesSchema>;
  try {
    const parsed = rangesSchema.safeParse(JSON.parse(String(formData.get("ranges") ?? "[]")));
    if (!parsed.success) return { error: "Hay franjas inválidas. Revisá las horas (en pasos de 5 minutos)." };
    ranges = parsed.data;
  } catch {
    return { error: "Hay franjas inválidas." };
  }
  if (formData.get("mode") === "studio") ranges = [];

  for (let d = 1; d <= 7; d++) {
    const issues = checkDayRanges(ranges.filter((r) => r.weekday === d));
    if (issues.length) return { error: issues[0] };
  }

  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("set_working_hours", {
    p_tenant: ctx.tenantId,
    p_professional: professional?.data ?? null,
    p_ranges: ranges,
  });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath("/", "layout");
  return { ok: "Guardamos el horario." };
}
