import { NextResponse, type NextRequest } from "next/server";
import { can, currentStaff } from "@/lib/auth";
import { encryptTokens } from "@/lib/payments/accounts";
import { paymentsConfig } from "@/lib/payments/config";
import { decryptSecret, sha256Hex, verifierAad } from "@/lib/payments/crypto";
import { exchangeCode, getMe, MpError } from "@/lib/payments/mp-api";
import { currentOrigin } from "@/lib/request";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Vuelta de Mercado Pago en el SUBDOMINIO del estudio (llega reenviada desde
 * /api/pagos/mp/vuelta del dominio raíz). Acá está la sesión de la dueña:
 *   1. vuelve a verificar sesión y payments.manage,
 *   2. reclama el state (de esta usuaria, de este estudio, sin usar, sin vencer),
 *   3. cambia el código por los tokens (PKCE), lee la cuenta y la guarda cifrada.
 * Nunca muestra tokens ni mensajes de Mercado Pago: solo códigos nuestros.
 */
export async function GET(request: NextRequest) {
  const origin = await currentOrigin();
  const back = (q: string) => NextResponse.redirect(`${origin}/admin/pagos?${q}`, { status: 303 });

  const ctx = await currentStaff();
  if (!ctx) return NextResponse.redirect(`${origin}/admin/login?next=${encodeURIComponent("/admin/pagos")}`, { status: 303 });
  if (!can(ctx, "payments.manage")) return back("error=permiso");

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state) return back("error=cancelado");
  if (!state.startsWith(`${ctx.studio.slug}.`) || state.length > 200 || code.length > 500) return back("error=vencido");

  const cfg = paymentsConfig();
  if (!cfg) return back("error=no_configurado");

  const supabase = await serverSupabase();
  const stateHash = sha256Hex(state);
  const { data: verifierEnc, error: claimError } = await supabase.rpc("claim_mp_connection", {
    p_tenant: ctx.tenantId,
    p_state_hash: stateHash,
  });
  if (claimError || typeof verifierEnc !== "string") return back("error=vencido");

  try {
    const verifier = decryptSecret(verifierEnc, verifierAad(ctx.tenantId, stateHash), cfg.keys);
    const tokens = await exchangeCode(cfg.mp, code, verifier);
    const me = await getMe(cfg.mp, tokens.access_token);
    if (me.id !== tokens.user_id) return back("error=mercadopago");
    if (me.site_id !== "MLA") return back("error=pais");
    // Sin offline_access no se puede renovar cada 180 días (solo si Mercado Pago informa el alcance).
    if (tokens.scope && !tokens.scope.split(/[\s,]+/).includes("offline_access")) return back("error=sin_renovacion");

    const enc = encryptTokens(ctx.tenantId, tokens.access_token, tokens.refresh_token);
    const { error } = await supabase.rpc("save_mp_connection", {
      p_tenant: ctx.tenantId,
      p_state_hash: stateHash,
      p_mp_user_id: me.id,
      p_nickname: me.nickname ?? null,
      p_site_id: me.site_id,
      // Las cuentas de prueba de Mercado Pago vienen marcadas como test_user.
      p_live_mode: !(me.tags ?? []).includes("test_user"),
      p_access_enc: enc.access_enc,
      p_refresh_enc: enc.refresh_enc,
      p_key_version: enc.key_version,
      p_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    });
    if (error) {
      if (error.message.includes("otro estudio")) return back("error=otra_cuenta");
      if (error.message.includes("Argentina")) return back("error=pais");
      if (error.message.includes("venció")) return back("error=vencido");
      console.error("save_mp_connection", error.code);
      return back("error=error");
    }
  } catch (e) {
    console.error("Conexión de Mercado Pago", e instanceof MpError ? e.message : "error");
    return back("error=mercadopago");
  }
  return back("ok=conectado");
}
