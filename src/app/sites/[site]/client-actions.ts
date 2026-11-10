"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/form/form";
import { currentOrigin, currentStudio } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import { firstError, fullNameSchema, phoneSchema, safeNext } from "@/lib/validation";

/**
 * Acciones de las clientas en el sitio del estudio. El estudio sale del host.
 */

export async function googleSignInAction(formData: FormData): Promise<void> {
  const studio = await currentStudio();
  if (!studio) redirect("/");

  const next = safeNext(formData.get("next"), "/mi-ficha");
  const origin = await currentOrigin();
  const supabase = await serverSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    console.error("signInWithOAuth", error?.code, error?.message);
    redirect("/ingresar?error=google");
  }
  redirect(data.url);
}

export async function updateMyProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const studio = await currentStudio();
  if (!studio) return { error: "Este estudio no está disponible." };

  const name = fullNameSchema.safeParse(formData.get("full_name"));
  if (!name.success) return { error: firstError(name.error) };
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = rawPhone ? phoneSchema.safeParse(rawPhone) : null;
  if (phone && !phone.success) return { error: firstError(phone.error) };

  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("update_my_client_profile", {
    p_slug: studio.slug,
    p_full_name: name.data,
    p_phone: phone?.data ?? "",
  });
  if (error) {
    const ours = ["42501", "P0002", "22023"];
    if (error.code && ours.includes(error.code)) return { error: error.message };
    console.error("update_my_client_profile", error.code, error.message);
    return { error: "No pudimos guardar los cambios. Probá de nuevo." };
  }
  return { ok: "Listo, guardamos tus datos." };
}

export async function createMyProfileAction(): Promise<void> {
  const studio = await currentStudio();
  if (!studio) redirect("/");
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("ensure_client_profile", { p_slug: studio.slug });
  if (error) console.error("ensure_client_profile", error.code, error.message);
  redirect("/mi-ficha");
}

export async function clientSignOutAction(): Promise<void> {
  const supabase = await serverSupabase();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
