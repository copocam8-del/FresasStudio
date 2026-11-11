import { z } from "zod";

/**
 * Cliente HTTP mínimo de Mercado Pago (sin SDK, para controlar qué se manda y qué
 * se loguea). Nunca incluye tokens en los errores ni en los logs.
 *
 * Módulo puro (sin "server-only") para testearlo con un fetch simulado; solo lo
 * usan módulos server-only.
 */

export type MpConfig = {
  apiBase: string;   // https://api.mercadopago.com (o el simulado en desarrollo)
  authBase: string;  // https://auth.mercadopago.com
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Error de Mercado Pago sin datos sensibles: estado HTTP y un código corto. */
export class MpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Mercado Pago respondió ${status} (${code})`);
    this.name = "MpError";
  }
  /** El acceso de la cuenta ya no sirve (revocado o vencido). */
  get revoked(): boolean {
    return this.status === 401 || this.code === "invalid_grant" || this.code === "invalid_token";
  }
}

async function call<T>(cfg: MpConfig, path: string, init: {
  method: "GET" | "POST";
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  base?: string;
}, schema: z.ZodType<T>): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await (cfg.fetchImpl ?? fetch)(`${init.base ?? cfg.apiBase}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
      cache: "no-store",
    });
  } catch {
    throw new MpError(0, "network");
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = (json && typeof json === "object" && ("error" in json || "code" in json))
      ? String((json as Record<string, unknown>).error ?? (json as Record<string, unknown>).code).slice(0, 60)
      : "http_error";
    throw new MpError(res.status, code);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new MpError(res.status, "unexpected_response");
  return parsed.data;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function authorizationUrl(cfg: MpConfig, state: string, codeChallenge: string): string {
  const url = new URL("/authorization", cfg.authBase);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(10),
  refresh_token: z.string().min(10),
  expires_in: z.number().int().positive(),
  user_id: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  scope: z.string().optional().default(""),
  live_mode: z.boolean().optional(),
});
export type MpTokens = z.infer<typeof tokenSchema>;

export function exchangeCode(cfg: MpConfig, code: string, codeVerifier: string): Promise<MpTokens> {
  return call(cfg, "/oauth/token", {
    method: "POST",
    body: {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: codeVerifier,
    },
  }, tokenSchema);
}

export function refreshTokens(cfg: MpConfig, refreshToken: string): Promise<MpTokens> {
  return call(cfg, "/oauth/token", {
    method: "POST",
    body: {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  }, tokenSchema);
}

const meSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  nickname: z.string().nullish(),
  site_id: z.string(),
});
export type MpUser = z.infer<typeof meSchema>;

export function getMe(cfg: MpConfig, token: string): Promise<MpUser> {
  return call(cfg, "/users/me", { method: "GET", token }, meSchema);
}

// ---------------------------------------------------------------------------
// Checkout Pro
// ---------------------------------------------------------------------------

const preferenceSchema = z.object({ id: z.string(), init_point: z.url() });
export type MpPreference = z.infer<typeof preferenceSchema>;

export function createPreference(cfg: MpConfig, token: string, body: unknown, idempotencyKey: string): Promise<MpPreference> {
  return call(cfg, "/checkout/preferences", { method: "POST", token, body, idempotencyKey }, preferenceSchema);
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

const money = z.number().finite().nonnegative();

const paymentSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((v) => String(v)),
  status: z.string(),
  status_detail: z.string().nullish(),
  transaction_amount: money,
  transaction_amount_refunded: money.nullish(),
  currency_id: z.string(),
  external_reference: z.string().nullish(),
  collector_id: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null ? null : Number(v))),
  live_mode: z.boolean(),
  date_approved: z.string().nullish(),
  payment_method_id: z.string().nullish(),
  payment_type_id: z.string().nullish(),
  installments: z.number().int().nullish(),
  fee_details: z.array(z.object({ amount: money })).nullish(),
  transaction_details: z.object({ net_received_amount: money.nullish() }).partial().nullish(),
});
export type MpPayment = z.infer<typeof paymentSchema>;

export function getPayment(cfg: MpConfig, token: string, paymentId: string): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(paymentId)) throw new MpError(400, "invalid_payment_id");
  return call(cfg, `/v1/payments/${paymentId}`, { method: "GET", token }, paymentSchema);
}

const searchSchema = z.object({ results: z.array(paymentSchema) });

export async function searchPaymentsByReference(cfg: MpConfig, token: string, externalReference: string): Promise<MpPayment[]> {
  const q = new URLSearchParams({ external_reference: externalReference, sort: "date_created", criteria: "desc", limit: "20" });
  const r = await call(cfg, `/v1/payments/search?${q}`, { method: "GET", token }, searchSchema);
  return r.results;
}

const refundSchema = z.object({ id: z.union([z.number(), z.string()]).transform((v) => String(v)) });

/** Devolución total (cuerpo vacío). La clave de idempotencia evita devolver dos veces. */
export function refundPayment(cfg: MpConfig, token: string, paymentId: string, idempotencyKey: string): Promise<{ id: string }> {
  if (!/^\d{1,20}$/.test(paymentId)) throw new MpError(400, "invalid_payment_id");
  return call(cfg, `/v1/payments/${paymentId}/refunds`, { method: "POST", token, body: {}, idempotencyKey }, refundSchema);
}

// ---------------------------------------------------------------------------
// Montos: Mercado Pago usa pesos con decimales; nosotros, centavos enteros.
// ---------------------------------------------------------------------------

export function toMinor(amount: number): number {
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new MpError(0, "invalid_amount");
  return minor;
}

/** Datos de un pago ya verificado, en el formato que espera la base. */
export function normalizePayment(p: MpPayment) {
  const fee = (p.fee_details ?? []).reduce((s, f) => s + toMinor(f.amount), 0);
  const net = p.transaction_details?.net_received_amount;
  return {
    provider_payment_id: p.id,
    status: p.status.slice(0, 40),
    status_detail: p.status_detail?.slice(0, 80) ?? null,
    amount_minor: toMinor(p.transaction_amount),
    refunded_minor: toMinor(p.transaction_amount_refunded ?? 0),
    currency: p.currency_id.slice(0, 3),
    external_reference: p.external_reference ?? null,
    collector_id: p.collector_id,
    live_mode: p.live_mode,
    approved_at: p.date_approved ?? null,
    payment_method: p.payment_method_id?.slice(0, 40) ?? null,
    payment_type: p.payment_type_id?.slice(0, 40) ?? null,
    installments: p.installments ?? null,
    fee_minor: fee,
    net_minor: net == null ? null : toMinor(net),
  };
}
export type NormalizedPayment = ReturnType<typeof normalizePayment>;
