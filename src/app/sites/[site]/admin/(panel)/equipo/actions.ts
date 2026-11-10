"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { currentOrigin } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import { emailSchema, firstError } from "@/lib/validation";

export type InviteState = { error?: string; link?: string; email?: string } | undefined;

const inviteSchema = z.object({
  email: emailSchema,
  role_id: z.uuid({ error: "Elegí un rol." }),
});

/**
 * Crea una invitación y devuelve el link UNA sola vez (en la base queda solo el hash
 * del token). La base vuelve a validar permisos, rol del estudio y anti-escalada.
 */
export async function createInvitationAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "team.manage")) return { error: "No tenés permiso para invitar personas." };

  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role_id: formData.get("role_id") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = await serverSupabase();
  const { data: token, error } = await supabase.rpc("create_invitation", {
    p_tenant: ctx.tenantId,
    p_email: parsed.data.email,
    p_role: parsed.data.role_id,
  });
  if (error) return { error: dbMessage(error) };

  revalidatePath("/admin/equipo");
  const origin = await currentOrigin();
  return { link: `${origin}/admin/invitacion?token=${token as string}`, email: parsed.data.email };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "team.manage")) return;
  const id = z.uuid().safeParse(formData.get("invitation_id"));
  if (!id.success) return;

  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: id.data });
  if (error) console.error("revoke_invitation", error.code, error.message);
  revalidatePath("/admin/equipo");
}

/** Mensajes escritos por nosotros en la base; cualquier otro error, genérico. */
function dbMessage(error: { code?: string; message: string }): string {
  if (error.code && ["42501", "P0002", "22023", "23505", "23514"].includes(error.code)) return error.message;
  console.error("Error de base no esperado", error.code, error.message);
  return "Algo salió mal. Probá de nuevo en unos minutos.";
}
