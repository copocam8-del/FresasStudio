"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { userFacingDbError } from "@/lib/db-errors";
import { serverSupabase } from "@/lib/supabase/server";
import { hhmmToMinutes } from "@/lib/time";

// savedAt: para que el formulario se vacíe después de guardar.
export type BlockState = { error?: string; ok?: string; savedAt?: number } | undefined;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí las fechas.");

const blockSchema = z.object({
  kind: z.enum(["vacation", "holiday", "day_off", "block"], { error: "Elegí el tipo de bloqueo." }),
  professional_id: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
  all_day: z
    .string()
    .nullish()
    .transform((v) => v === "on"),
  from_date: date,
  to_date: date,
  from_time: z.string().optional(),
  to_time: z.string().optional(),
  note: z
    .string()
    .trim()
    .max(200, "La nota es demasiado larga.")
    .optional()
    .transform((v) => v || null),
});

/** Crea un bloqueo con fechas/horas LOCALES del estudio (la base las convierte). */
export async function createBlockAction(_prev: BlockState, formData: FormData): Promise<BlockState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "agenda.manage")) return { error: "No tenés permiso para cargar bloqueos." };

  const parsed = blockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const b = parsed.data;

  let from = `${b.from_date} 00:00`;
  let to = `${b.to_date} 00:00`;
  if (!b.all_day) {
    const f = hhmmToMinutes(b.from_time);
    const t = hhmmToMinutes(b.to_time);
    if (f === null || t === null) return { error: "Indicá las horas (en pasos de 5 minutos)." };
    from = `${b.from_date} ${b.from_time}`;
    to = `${b.to_date} ${b.to_time}`;
  }

  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("create_schedule_block", {
    p_tenant: ctx.tenantId,
    p_professional: b.professional_id,
    p_kind: b.kind,
    p_from_local: from,
    p_to_local: to,
    p_all_day: b.all_day,
    p_note: b.note,
  });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath("/", "layout");
  return { ok: "Bloqueo guardado.", savedAt: Date.now() };
}

export async function deleteBlockAction(formData: FormData): Promise<void> {
  const ctx = await currentStaff();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!ctx || !can(ctx, "agenda.manage") || !id.success) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.from("schedule_blocks").delete().eq("id", id.data).eq("tenant_id", ctx.tenantId);
  if (error) console.error("deleteBlock", userFacingDbError(error));
  revalidatePath("/", "layout");
}
