"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/form/form";
import { isPlatformHost } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import { firstError, loginSchema } from "@/lib/validation";

const GENERIC_LOGIN_ERROR = "Email o contraseña incorrectos.";

/** Login de Cleo Admin (admin.<raíz>). Solo deja la sesión abierta a superadministradoras. */
export async function platformLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await isPlatformHost())) return { error: GENERIC_LOGIN_ERROR };

  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = await serverSupabase();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: GENERIC_LOGIN_ERROR };

  const { data: admin } = await supabase.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!admin) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: GENERIC_LOGIN_ERROR };
  }
  redirect("/");
}

export async function platformSignOutAction(): Promise<void> {
  const supabase = await serverSupabase();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
