import "server-only";
import { requirePaymentsConfig } from "@/lib/payments/config";
import { decryptSecret, encryptSecret, secretKeyVersion, tokenAad } from "@/lib/payments/crypto";
import { MpError, refreshTokens } from "@/lib/payments/mp-api";
import { serviceSupabase } from "@/lib/payments/service-client";

/**
 * Tokens de Mercado Pago de cada estudio: se descifran solo acá, en el servidor, y
 * nunca salen hacia el navegador ni a los logs.
 */

type Credentials = {
  tenant_id: string;
  mp_user_id: number;
  live_mode: boolean;
  status: string;
  access_token_enc: string;
  refresh_token_enc: string;
  key_version: number;
  expires_at: string;
};

/** Se renueva si al token le queda menos que esto (la tarea diaria usa 30 días). */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

export class AccountUnavailableError extends Error {
  constructor(readonly reason: "not_connected" | "revoked" | "busy") {
    super(`Cuenta de Mercado Pago no disponible (${reason})`);
    this.name = "AccountUnavailableError";
  }
}

async function readCredentials(accountId: string): Promise<Credentials> {
  const { data, error } = await serviceSupabase().rpc("svc_mp_credentials", { p_account: accountId });
  if (error) throw new Error(`svc_mp_credentials: ${error.code}`);
  const row = (data as Credentials[])[0];
  if (!row) throw new AccountUnavailableError("not_connected");
  return row;
}

/** Cifra un par de tokens para un estudio (versión de clave actual). */
export function encryptTokens(tenantId: string, access: string, refresh: string) {
  const { keys } = requirePaymentsConfig();
  return {
    access_enc: encryptSecret(access, tokenAad(tenantId, "access"), keys),
    refresh_enc: encryptSecret(refresh, tokenAad(tenantId, "refresh"), keys),
    key_version: keys.currentVersion,
  };
}

/**
 * Renueva los tokens de una cuenta. Una sola renovación a la vez (bloqueo en la base):
 * si otro proceso ya está renovando, devuelve false y no toca nada.
 * Si Mercado Pago dice que el acceso fue revocado → "Hay que volver a conectar" (P7).
 */
export async function refreshAccount(accountId: string): Promise<boolean> {
  const cfg = requirePaymentsConfig();
  const db = serviceSupabase();
  const { data: locked, error: lockError } = await db.rpc("svc_mp_begin_refresh", { p_account: accountId });
  if (lockError) throw new Error(`svc_mp_begin_refresh: ${lockError.code}`);
  if (!locked) return false;

  let creds: Credentials;
  try {
    creds = await readCredentials(accountId);
  } catch (e) {
    await db.rpc("svc_mp_refresh_failed", { p_account: accountId, p_revoked: false, p_error: "not_connected" });
    throw e;
  }
  try {
    const refresh = decryptSecret(creds.refresh_token_enc, tokenAad(creds.tenant_id, "refresh"), cfg.keys);
    const t = await refreshTokens(cfg.mp, refresh);
    const enc = encryptTokens(creds.tenant_id, t.access_token, t.refresh_token);
    const { error } = await db.rpc("svc_mp_store_refresh", {
      p_account: accountId,
      p_access_enc: enc.access_enc,
      p_refresh_enc: enc.refresh_enc,
      p_key_version: enc.key_version,
      p_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    });
    if (error) throw new Error(`svc_mp_store_refresh: ${error.code}`);
    return true;
  } catch (e) {
    const revoked = e instanceof MpError && e.revoked;
    const code = e instanceof MpError ? e.code : "refresh_failed";
    await db.rpc("svc_mp_refresh_failed", { p_account: accountId, p_revoked: revoked, p_error: code });
    if (revoked) throw new AccountUnavailableError("revoked");
    throw e;
  }
}

async function accessToken(accountId: string): Promise<{ token: string; creds: Credentials }> {
  const cfg = requirePaymentsConfig();
  let creds = await readCredentials(accountId);
  const stale = new Date(creds.expires_at).getTime() - Date.now() < RENEW_BEFORE_MS;
  const oldKey = secretKeyVersion(creds.access_token_enc) !== cfg.keys.currentVersion;
  if (stale || oldKey) {
    // Vencido o cifrado con una clave anterior: renovar (re-cifra con la actual).
    const done = await refreshAccount(accountId).catch((e) => {
      if (e instanceof AccountUnavailableError) throw e;
      return false; // error temporal: se usa el token actual mientras siga vigente
    });
    if (done) creds = await readCredentials(accountId);
  }
  return { token: decryptSecret(creds.access_token_enc, tokenAad(creds.tenant_id, "access"), cfg.keys), creds };
}

/**
 * Ejecuta una llamada a Mercado Pago con el token del estudio. Si responde 401,
 * renueva una vez y reintenta; si el acceso fue revocado, marca la cuenta (P7).
 */
export async function withAccount<T>(accountId: string, fn: (token: string, creds: Credentials) => Promise<T>): Promise<T> {
  const { token, creds } = await accessToken(accountId);
  try {
    return await fn(token, creds);
  } catch (e) {
    if (!(e instanceof MpError) || e.status !== 401) throw e;
    const done = await refreshAccount(accountId);
    if (!done) throw new AccountUnavailableError("busy");
    const again = await accessToken(accountId);
    return fn(again.token, again.creds);
  }
}
