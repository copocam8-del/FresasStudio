"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/form/form";
import { currentOrigin, currentStudio } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import {
  emailSchema,
  firstError,
  fullNameSchema,
  invitationTokenSchema,
  loginSchema,
  newPasswordSchema,
  passwordSchema,
  safeNext,
} from "@/lib/validation";

/**
 * Acciones de acceso del panel del estudio ({slug}.cleo.com.ar/admin).
 * El estudio sale SIEMPRE del host de la request, nunca del formulario.
 */

const GENERIC_LOGIN_ERROR = "Email o contraseña incorrectos.";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const studio = await currentStudio();
  if (!studio) return { error: "Este estudio no está disponible." };

  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const next = safeNext(formData.get("next"), "/admin");
  // Quien entra para aceptar una invitación todavía no es parte del equipo.
  const joining = next.startsWith("/admin/invitacion");

  const supabase = await serverSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Todavía no confirmaste tu email. Revisá tu casilla (y la carpeta de spam)." };
    }
    return { error: GENERIC_LOGIN_ERROR };
  }

  if (!joining) {
    const { data: studios, error: rpcError } = await supabase.rpc("my_studios");
    const isMember = !rpcError && (studios as Array<{ slug: string }>).some((s) => s.slug === studio.slug);
    if (!isMember) {
      // Mismo mensaje que una contraseña incorrecta: no revela en qué estudios trabaja.
      await supabase.auth.signOut({ scope: "local" });
      return { error: GENERIC_LOGIN_ERROR };
    }
  }

  redirect(next);
}

export async function recoverAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const studio = await currentStudio();
  if (!studio) return { error: "Este estudio no está disponible." };

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: firstError(parsed.error) };

  const origin = await currentOrigin();
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${origin}/admin/auth/confirm?next=${encodeURIComponent("/admin/restablecer")}`,
  });
  if (error) console.error("resetPasswordForEmail", error.code, error.message);

  // Siempre la misma respuesta: no revela si el email tiene cuenta.
  return {
    ok: "Si ese email tiene una cuenta, te enviamos un link para crear una contraseña nueva. Abrilo en este mismo navegador.",
  };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = await serverSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "El link venció. Pedí uno nuevo desde «Olvidé mi contraseña»." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "La contraseña nueva tiene que ser distinta de la anterior." };
    if (error.code === "weak_password") return { error: "Esa contraseña es demasiado débil. Probá con otra más larga." };
    return { error: "No pudimos cambiar la contraseña. Probá de nuevo." };
  }
  redirect("/admin");
}

export async function signUpForInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = invitationTokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { error: firstError(token.error) };

  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { error: firstError(email.error) };
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { error: firstError(password.error) };
  const fullName = fullNameSchema.safeParse(formData.get("full_name"));
  if (!fullName.success) return { error: firstError(fullName.error) };

  const origin = await currentOrigin();
  const back = `/admin/invitacion?token=${token.data}`;
  const supabase = await serverSupabase();
  const { error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      emailRedirectTo: `${origin}/admin/auth/confirm?next=${encodeURIComponent(back)}`,
      data: { full_name: fullName.data },
    },
  });
  if (error) {
    if (error.code === "weak_password") return { error: "Esa contraseña es demasiado débil. Probá con otra más larga." };
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Se enviaron demasiados emails en poco tiempo. Esperá unos minutos y probá de nuevo." };
    }
    console.error("signUp", error.code, error.message);
    return { error: "No pudimos crear la cuenta. Probá de nuevo." };
  }

  // Si el email ya tenía cuenta, Supabase responde igual (no revela que existe).
  return {
    ok: "Te enviamos un email para confirmar tu cuenta. Abrí el link en este mismo navegador y vas a volver acá para aceptar la invitación.",
  };
}

export async function acceptInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = invitationTokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { error: firstError(token.error) };

  const studio = await currentStudio();
  if (!studio) return { error: "Este estudio no está disponible." };

  const supabase = await serverSupabase();
  // La invitación tiene que ser de ESTE estudio (el del host).
  const { data: preview } = await supabase.rpc("get_invitation_preview", { p_token: token.data });
  const row = Array.isArray(preview) ? preview[0] : null;
  if (!row || row.studio_slug !== studio.slug) return { error: "Esta invitación no es de este estudio." };

  const { error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) return { error: userFacingDbError(error) };
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  const supabase = await serverSupabase();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/admin/login");
}

/**
 * Los errores que levantan nuestras funciones de la base tienen mensajes pensados para
 * la usuaria (códigos 42501, P0002, 22023, 23505, 23514). Cualquier otro error podría
 * exponer detalles internos: se muestra uno genérico.
 */
function userFacingDbError(error: { code?: string; message: string }): string {
  const ours = ["42501", "P0002", "22023", "23505", "23514"];
  if (error.code && ours.includes(error.code)) return error.message;
  console.error("Error de base no esperado", error.code, error.message);
  return "Algo salió mal. Probá de nuevo en unos minutos.";
}
