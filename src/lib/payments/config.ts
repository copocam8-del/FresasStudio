import "server-only";
import { z } from "zod";
import { parseKey, type EncryptionKeys } from "@/lib/payments/crypto";
import type { MpConfig } from "@/lib/payments/mp-api";

/**
 * Configuración de pagos del SERVIDOR. Ninguna de estas variables lleva prefijo
 * NEXT_PUBLIC_ ni se lee en código del navegador (test: no-secrets-in-client).
 * En producción se cargan en el Web Service de Render.
 *
 * Si falta alguna, Mercado Pago queda "no disponible" (la app sigue funcionando y el
 * panel lo explica), en lugar de romper el arranque.
 */
const schema = z.object({
  MP_CLIENT_ID: z.string().regex(/^\d{4,30}$/, "MP_CLIENT_ID inválido"),
  MP_CLIENT_SECRET: z.string().min(16),
  // HTTPS (Mercado Pago lo exige); http solo hacia la propia máquina (e2e simulado).
  MP_OAUTH_REDIRECT_URI: z.url().refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" || (u.protocol === "http:" && /(^|\.)localhost$|^127\.0\.0\.1$/.test(u.hostname));
  }, "MP_OAUTH_REDIRECT_URI tiene que ser https"),
  MP_WEBHOOK_SECRET: z.string().min(16),
  PAYMENTS_ENCRYPTION_KEY: z.string().min(40),
  PAYMENTS_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(9999).default(1),
  PAYMENTS_ENCRYPTION_KEY_PREVIOUS: z.string().min(40).optional(),
  SUPABASE_SECRET_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(32),
  MP_API_BASE_URL: z.url().optional(),
  MP_AUTH_BASE_URL: z.url().optional(),
});

export type PaymentsConfig = {
  mp: MpConfig;
  webhookSecret: string;
  keys: EncryptionKeys;
  supabaseSecretKey: string;
  cronSecret: string;
  /** true si la API apunta al Mercado Pago simulado (solo desarrollo/e2e). */
  simulated: boolean;
};

/**
 * MP_API_BASE_URL / MP_AUTH_BASE_URL solo se aceptan si apuntan a la propia máquina
 * (Mercado Pago simulado de los e2e). Cualquier otro valor se ignora: en producción
 * no se puede redirigir la API a un tercero con una variable.
 */
function loopbackOnly(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const u = new URL(url);
  return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? url.replace(/\/$/, "") : undefined;
}

let cached: PaymentsConfig | null | undefined;

export function paymentsConfig(): PaymentsConfig | null {
  if (cached !== undefined) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    console.warn(`Mercado Pago no disponible: faltan o son inválidas ${missing} (ver .env.example).`);
    cached = null;
    return cached;
  }
  const e = parsed.data;
  const version = e.PAYMENTS_ENCRYPTION_KEY_VERSION;
  const keys: EncryptionKeys = { currentVersion: version, keys: { [version]: parseKey(e.PAYMENTS_ENCRYPTION_KEY) } };
  if (e.PAYMENTS_ENCRYPTION_KEY_PREVIOUS && version > 1) {
    keys.keys[version - 1] = parseKey(e.PAYMENTS_ENCRYPTION_KEY_PREVIOUS);
  }
  const apiBase = loopbackOnly(e.MP_API_BASE_URL);
  const authBase = loopbackOnly(e.MP_AUTH_BASE_URL);
  cached = {
    mp: {
      apiBase: apiBase ?? "https://api.mercadopago.com",
      authBase: authBase ?? "https://auth.mercadopago.com",
      clientId: e.MP_CLIENT_ID,
      clientSecret: e.MP_CLIENT_SECRET,
      redirectUri: e.MP_OAUTH_REDIRECT_URI,
    },
    webhookSecret: e.MP_WEBHOOK_SECRET,
    keys,
    supabaseSecretKey: e.SUPABASE_SECRET_KEY,
    cronSecret: e.CRON_SECRET,
    simulated: Boolean(apiBase),
  };
  return cached;
}

export function requirePaymentsConfig(): PaymentsConfig {
  const cfg = paymentsConfig();
  if (!cfg) throw new Error("Mercado Pago no está configurado en este servidor");
  return cfg;
}
