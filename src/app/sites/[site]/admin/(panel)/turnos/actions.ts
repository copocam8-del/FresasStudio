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
