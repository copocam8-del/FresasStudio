"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { localToInstant } from "@/lib/booking-format";
import { userFacingDbError } from "@/lib/db-errors";
import { serverSupabase } from "@/lib/supabase/server";
import { fullNameSchema, phoneSchema } from "@/lib/validation";

export type TurnoState = { error?: string } | undefined;

const uuid = z.uuid();

/**
 * Turno manual (WhatsApp). Siempre con seña (B11): cobrada (transferencia o efectivo,
 * requiere cash.manage) → confirmado; si no, esperando pago con vencimiento. La base
 * vuelve a validar permisos, horario y superposición.
 */
export async function createManualBookingAction(_prev: TurnoState, formData: FormData): Promise<TurnoState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "agenda.manage")) return { error: "No tenés permiso para cargar turnos." };

  const service = uuid.safeParse(formData.get("service"));
  const pro = uuid.safeParse(formData.get("professional"));
  if (!service.success) return { error: "Elegí el servicio." };
  if (!pro.success) return { error: "Elegí la profesional." };

  const startsAt = localToInstant(String(formData.get("date") ?? ""), String(formData.get("time") ?? ""), ctx.studio.timezone);
  if (!startsAt) return { error: "Elegí el día y la hora." };

  const payment = String(formData.get("payment") ?? "pending");
  if (!["pending", "transfer", "cash"].includes(payment)) return { error: "Elegí cómo queda la seña." };
  if (payment !== "pending" && !can(ctx, "cash.manage")) return { error: "No tenés permiso para registrar cobros." };

  let clientId: string | null = null;
  let newName: string | null = null;
  let newPhone: string | null = null;
  if (formData.get("client_mode") === "existing") {
    const c = uuid.safeParse(formData.get("client_id"));
    if (!c.success) return { error: "Elegí la clienta." };
    clientId = c.data;
  } else {
    const n = fullNameSchema.safeParse(formData.get("new_name"));
    if (!n.success) return { error: "Ingresá el nombre de la clienta." };
    const p = phoneSchema.safeParse(formData.get("new_phone"));
    if (!p.success) return { error: "Ingresá un teléfono válido de la clienta." };
    newName = n.data;
    newPhone = p.data;
  }
  const note = String(formData.get("note") ?? "").trim();
  if (note.length > 300) return { error: "La nota puede tener hasta 300 caracteres." };

  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("create_manual_booking", {
    p_tenant: ctx.tenantId,
    p_client_profile: clientId,
    p_new_client_name: newName,
    p_new_client_phone: newPhone,
    p_service: service.data,
    p_professional: pro.data,
    p_starts_at: startsAt,
    p_force_outside_hours: formData.get("force") === "on",
    p_paid_offline_method: payment === "pending" ? null : payment,
    p_note: note || null,
  });
  if (error) return { error: userFacingDbError(error) };
  const id = (data as { appointment_id: string }[])[0]?.appointment_id;
  revalidatePath("/admin/turnos");
  redirect(`/admin/turnos/${id}`);
}

export async function markPaidOfflineAction(formData: FormData): Promise<void> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  const method = formData.get("method");
  if (!ctx || !can(ctx, "cash.manage") || !id.success || (method !== "transfer" && method !== "cash")) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("mark_deposit_paid_offline", { p_appointment: id.data, p_method: method });
  if (error) console.error("mark_deposit_paid_offline", userFacingDbError(error));
  revalidatePath(`/admin/turnos/${id.data}`);
}

export async function cancelUnpaidAction(formData: FormData): Promise<void> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  if (!ctx || !can(ctx, "agenda.manage") || !id.success) return;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("cancel_unpaid_booking", { p_appointment: id.data, p_reason: reason || null });
  if (error) console.error("cancel_unpaid_booking", userFacingDbError(error));
  revalidatePath(`/admin/turnos/${id.data}`);
}

// ---------------------------------------------------------------------------
// Sprint 6: asistencia, faltas, cancelaciones y reprogramaciones. El estudio sale de
// la sesión (currentStaff); la base vuelve a validar permisos y decide la seña.
// ---------------------------------------------------------------------------

const stepSchema = z.enum(["checked_in", "started", "finished"]);

function refresh(id: string) {
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/turnos");
  revalidatePath(`/admin/turnos/${id}`);
}

/** Llegó / empezó / terminó (agenda.manage, o la profesional en sus turnos). */
export async function markAttendanceAction(_prev: TurnoState, formData: FormData): Promise<TurnoState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  const step = stepSchema.safeParse(formData.get("step"));
  if (!ctx || !id.success || !step.success) return { error: "No se pudo marcar el turno." };
  if (!can(ctx, "agenda.manage") && !can(ctx, "agenda.mark_own")) return { error: "No tenés permiso para marcar turnos." };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("mark_attendance", { p_appointment: id.data, p_step: step.data });
  if (error) return { error: userFacingDbError(error) };
  refresh(id.data);
  return undefined;
}

/** Faltó (solo agenda.manage): la seña se pierde según la política aceptada. */
export async function markNoShowAction(_prev: TurnoState, formData: FormData): Promise<TurnoState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  if (!ctx || !id.success) return { error: "No se pudo marcar la falta." };
  if (!can(ctx, "agenda.manage")) return { error: "No tenés permiso para marcar faltas." };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("mark_no_show", { p_appointment: id.data });
  if (error) return { error: userFacingDbError(error) };
  refresh(id.data);
  return undefined;
}

export async function correctNoShowAction(_prev: TurnoState, formData: FormData): Promise<TurnoState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  const reason = z.string().trim().min(3, "Escribí el motivo (al menos 3 letras).").max(200).safeParse(formData.get("reason"));
  if (!ctx || !id.success) return { error: "No se pudo corregir." };
  if (!can(ctx, "agenda.manage")) return { error: "No tenés permiso para corregir faltas." };
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? "Escribí el motivo." };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("correct_no_show", { p_appointment: id.data, p_reason: reason.data });
  if (error) return { error: userFacingDbError(error) };
  refresh(id.data);
  return undefined;
}

const cancelSchema = z.object({
  id: z.uuid(),
  by: z.enum(["client", "studio"], { message: "Elegí quién cancela." }),
  reason: z.string().trim().max(200, "El motivo puede tener hasta 200 caracteres."),
  refund_mode: z.enum(["credit", "refund"]).optional(),
  refund_method: z.enum(["transfer", "cash"]).optional(),
  expected: z.enum(["credited", "forfeited", "refunded"]),
});

/**
 * Cancelar un turno confirmado. Si cancela la clienta (avisó por WhatsApp) aplica la
 * regla de 24 h; si cancela el estudio, nunca pierde (saldo o devolución). La pantalla
 * manda la consecuencia que mostró; si cambió, la base no hace nada.
 */
export async function cancelBookingAction(_prev: TurnoState, formData: FormData): Promise<TurnoState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "agenda.manage")) return { error: "No tenés permiso para cancelar turnos." };
  const by = formData.get("by");
  const parsed = cancelSchema.safeParse({
    id: formData.get("id"),
    by,
    reason: formData.get("reason") ?? "",
    refund_mode: by === "studio" ? formData.get("refund_mode") ?? undefined : undefined,
    refund_method: formData.get("refund_method") || undefined,
    expected: by === "studio" ? (formData.get("refund_mode") === "refund" ? "refunded" : "credited") : formData.get("expected_client"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const p = parsed.data;
  if (p.by === "studio" && p.reason.length < 3) return { error: "Escribí el motivo: la clienta lo va a ver." };
  if (p.refund_mode === "refund" && !can(ctx, "cash.manage")) return { error: "Para devolver el dinero hace falta permiso de caja." };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("cancel_booking", {
    p_appointment: p.id, p_by: p.by, p_reason: p.reason || null, p_refund_mode: p.refund_mode ?? null,
    p_refund_method: p.refund_method ?? null, p_expected: p.expected,
  });
  if (error) return { error: userFacingDbError(error) };
  refresh(p.id);
  redirect(`/admin/turnos/${p.id}`);
}

const rescheduleSchema = z.object({
  id: z.uuid(),
  professional: z.uuid({ message: "Elegí la profesional." }),
  expected: z.enum(["transferred", "forfeited"]),
  payment: z.enum(["pending", "transfer", "cash"]),
});

/** Reprogramar desde el panel (sin límite de veces, reglas del turno manual). */
export async function rescheduleBookingAction(_prev: TurnoState, formData: FormData): Promise<TurnoState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "agenda.manage")) return { error: "No tenés permiso para reprogramar turnos." };
  const parsed = rescheduleSchema.safeParse({
    id: formData.get("id"),
    professional: formData.get("professional"),
    expected: formData.get("expected"),
    payment: formData.get("payment") ?? "pending",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const p = parsed.data;
  const startsAt = localToInstant(String(formData.get("date") ?? ""), String(formData.get("time") ?? ""), ctx.studio.timezone);
  if (!startsAt) return { error: "Elegí el día y la hora." };
  if (p.payment !== "pending" && !can(ctx, "cash.manage")) return { error: "No tenés permiso para registrar cobros." };
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("reschedule_booking", {
    p_appointment: p.id, p_professional: p.professional, p_starts_at: startsAt,
    p_force_outside_hours: formData.get("force") === "on",
    p_paid_offline_method: p.expected === "forfeited" && p.payment !== "pending" ? p.payment : null,
    p_expected: p.expected,
  });
  if (error) return { error: userFacingDbError(error) };
  const newId = (data as { appointment_id: string }[])[0]?.appointment_id;
  refresh(p.id);
  redirect(`/admin/turnos/${newId ?? p.id}`);
}
