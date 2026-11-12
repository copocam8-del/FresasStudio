"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, currentStaff } from "@/lib/auth";
import { userFacingDbError } from "@/lib/db-errors";
import { paymentsConfig } from "@/lib/payments/config";
import { encryptSecret, pkceChallenge, randomToken, sha256Hex, verifierAad } from "@/lib/payments/crypto";
import { authorizationUrl } from "@/lib/payments/mp-api";
import { serverSupabase } from "@/lib/supabase/server";

export type PaymentsActionState = { error?: string; ok?: string } | undefined;

/**
 * "Conectar Mercado Pago" (solo payments.manage, P5). Crea el state (se guarda solo
 * su hash, atado a esta usuaria y este estudio, 10 minutos) y el verificador PKCE
 * cifrado, y manda a la dueña a autorizar en Mercado Pago.
 *
 * El state empieza con el slug del estudio: Mercado Pago vuelve a UNA sola URL
 * (dominio raíz) y así sabemos a qué subdominio reenviar. No es un dato sensible.
 */
export async function connectMpAction(): Promise<PaymentsActionState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "payments.manage")) return { error: "Solo la dueña puede conectar Mercado Pago." };
  const cfg = paymentsConfig();
  if (!cfg) return { error: "Mercado Pago todavía no está disponible. Avisanos y lo activamos." };

  const state = `${ctx.studio.slug}.${randomToken(32)}`;
  const stateHash = sha256Hex(state);
  const verifier = randomToken(48);
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("begin_mp_connection", {
    p_tenant: ctx.tenantId,
    p_state_hash: stateHash,
    p_code_verifier_enc: encryptSecret(verifier, verifierAad(ctx.tenantId, stateHash), cfg.keys),
  });
  if (error) return { error: userFacingDbError(error) };
  redirect(authorizationUrl(cfg.mp, state, pkceChallenge(verifier)));
}

/** "Desconectar" (P6): borra los tokens y apaga las reservas online. */
export async function disconnectMpAction(): Promise<PaymentsActionState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "payments.manage")) return { error: "Solo la dueña puede desconectar Mercado Pago." };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("disconnect_mp", { p_tenant: ctx.tenantId });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath("/", "layout");
  return { ok: "Desconectamos Mercado Pago y apagamos las reservas online." };
}
