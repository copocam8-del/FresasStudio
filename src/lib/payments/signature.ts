import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de los avisos (webhooks) de Mercado Pago.
 *
 * Encabezado `x-signature: ts=<segundos>,v1=<hex>`. El HMAC-SHA256 (con la clave
 * secreta de webhooks de la aplicación) se calcula sobre el "manifiesto"
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * omitiendo las partes que no vienen. Es el mismo algoritmo que el validador oficial
 * (mercadopago/sdk-nodejs, utils/webhook).
 *
 * La firma es un FILTRO, no la fuente de verdad: aunque sea válida, el pago se
 * consulta siempre a la API de Mercado Pago antes de hacer nada.
 *
 * No se rechaza por antigüedad del `ts`: los reintentos de Mercado Pago pueden llegar
 * horas después y repetir un aviso no tiene efecto (todo es idempotente).
 */

export type SignatureInput = {
  xSignature: string | null | undefined;
  xRequestId: string | null | undefined;
  /** data.id que vino en la URL del aviso (?data.id=…). */
  dataId: string | null | undefined;
  secret: string;
};

function clean(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function parseSignatureHeader(header: string): { ts?: string; v1?: string } {
  const out: { ts?: string; v1?: string } = {};
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key === "ts" && value) out.ts = value;
    if (key === "v1" && value) out.v1 = value;
  }
  return out;
}

export function buildManifest(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const parts: string[] = [];
  // Mercado Pago indica pasar a minúsculas los ids alfanuméricos.
  if (dataId) parts.push(`id:${/[a-z]/i.test(dataId) ? dataId.toLowerCase() : dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return parts.join(";") + ";";
}

export function signManifest(manifest: string, secret: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

export function verifyWebhookSignature(input: SignatureInput): boolean {
  const header = clean(input.xSignature);
  if (!header || !input.secret) return false;
  const { ts, v1 } = parseSignatureHeader(header);
  if (!ts || !/^\d+$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const expected = signManifest(buildManifest(clean(input.dataId), clean(input.xRequestId), ts), input.secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
