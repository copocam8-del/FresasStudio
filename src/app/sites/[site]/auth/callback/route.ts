import { NextResponse, type NextRequest } from "next/server";
import { currentOrigin, currentStudio } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation";

/**
 * Vuelta del login con Google en el sitio de un estudio. Abre la sesión (PKCE: el
 * verificador quedó en una cookie de ESTE host) y crea o vincula la ficha de la
 * clienta en este estudio.
 */
export async function GET(request: NextRequest) {
  const origin = await currentOrigin();
  const studio = await currentStudio();
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/mi-ficha");
  if (!studio || !code) return NextResponse.redirect(`${origin}/ingresar?error=google`);

  const supabase = await serverSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/ingresar?error=google`);

  const { error: profileError } = await supabase.rpc("ensure_client_profile", { p_slug: studio.slug });
  if (profileError) console.error("ensure_client_profile", profileError.code, profileError.message);

  return NextResponse.redirect(`${origin}${next}`);
}
