import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { currentOrigin } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation";

/**
 * Destino de los links de email del equipo (recuperar contraseña, confirmar cuenta).
 * Acepta los dos formatos de Supabase:
 *   ?code=…                      (PKCE: el link se abre en el mismo navegador)
 *   ?token_hash=…&type=recovery  (plantillas de email personalizadas)
 * Abre la sesión y redirige a `next` (solo rutas de este sitio).
 */
const OTP_TYPES: EmailOtpType[] = ["signup", "recovery", "invite", "magiclink", "email_change", "email"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = await currentOrigin();
  const next = safeNext(params.get("next"), "/admin");
  const fail = NextResponse.redirect(`${origin}/admin/login?error=link`);

  const supabase = await serverSupabase();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail;
  } else {
    return fail;
  }

  return NextResponse.redirect(`${origin}${next}`);
}
