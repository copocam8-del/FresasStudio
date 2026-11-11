import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decryptSecret, encryptSecret, pkceChallenge, randomToken, secretKeyVersion, sha256Hex, tokenAad,
  type EncryptionKeys,
} from "./crypto";
import {
  authorizationUrl, createPreference, getPayment, MpError, normalizePayment, refreshTokens, toMinor,
  type MpConfig,
} from "./mp-api";
import { buildDepositPreference, statementDescriptor } from "./preference";
import { buildManifest, signManifest, verifyWebhookSignature } from "./signature";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const keysV1: EncryptionKeys = { currentVersion: 1, keys: { 1: k1 } };
const keysV2: EncryptionKeys = { currentVersion: 2, keys: { 1: k1, 2: k2 } };

describe("cifrado de tokens", () => {
  const aad = tokenAad("10000000-0000-4000-a000-000000000001", "access");

  it("ida y vuelta, y cada cifrado es distinto", () => {
    const a = encryptSecret("APP_USR-secreto", aad, keysV1);
    const b = encryptSecret("APP_USR-secreto", aad, keysV1);
    expect(a).not.toBe(b);
    expect(a).not.toContain("secreto");
    expect(decryptSecret(a, aad, keysV1)).toBe("APP_USR-secreto");
  });

  it("rechaza texto alterado", () => {
    const enc = encryptSecret("APP_USR-secreto", aad, keysV1);
    const [v, iv, body] = enc.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret(`${v}.${iv}.${flipped.toString("base64url")}`, aad, keysV1)).toThrow();
  });

  it("un token cifrado para un estudio no se descifra como de otro", () => {
    const enc = encryptSecret("APP_USR-secreto", aad, keysV1);
    expect(() => decryptSecret(enc, tokenAad("10000000-0000-4000-a000-000000000002", "access"), keysV1)).toThrow();
    expect(() => decryptSecret(enc, tokenAad("10000000-0000-4000-a000-000000000001", "refresh"), keysV1)).toThrow();
  });

  it("rotación: con la clave nueva se siguen leyendo los de la anterior", () => {
    const old = encryptSecret("viejo", aad, keysV1);
    const fresh = encryptSecret("nuevo", aad, keysV2);
    expect(secretKeyVersion(old)).toBe(1);
    expect(secretKeyVersion(fresh)).toBe(2);
    expect(decryptSecret(old, aad, keysV2)).toBe("viejo");
    expect(() => decryptSecret(fresh, aad, keysV1)).toThrow(/versión/);
  });

  it("rechaza formatos inválidos", () => {
    for (const bad of ["", "hola", "v1.abc", "v1..", "x1.aaaa.bbbb"]) {
      expect(() => decryptSecret(bad, aad, keysV1)).toThrow();
    }
  });

  it("PKCE S256 y valores aleatorios", () => {
    // Ejemplo del RFC 7636, apéndice B
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("firma de los webhooks", () => {
  const secret = "clave-secreta-de-webhooks-123";
  const ts = "1742505638";
  const manifest = buildManifest("123456", "bb56a2f1-6aae-46ac-982e-9dcd3581d08e", ts);
  const header = `ts=${ts},v1=${signManifest(manifest, secret)}`;

  it("arma el manifiesto como el validador oficial", () => {
    expect(manifest).toBe("id:123456;request-id:bb56a2f1-6aae-46ac-982e-9dcd3581d08e;ts:1742505638;");
    expect(buildManifest(undefined, undefined, "1")).toBe("ts:1;");
    expect(buildManifest("ABC12", "r", "1")).toBe("id:abc12;request-id:r;ts:1;");
  });

  it("válida", () => {
    expect(verifyWebhookSignature({ xSignature: header, xRequestId: "bb56a2f1-6aae-46ac-982e-9dcd3581d08e", dataId: "123456", secret })).toBe(true);
    // espacios y orden distinto en el encabezado
    expect(verifyWebhookSignature({ xSignature: ` v1=${header.split("v1=")[1]} , ts=${ts}`, xRequestId: "bb56a2f1-6aae-46ac-982e-9dcd3581d08e", dataId: "123456", secret })).toBe(true);
  });

  it("alterada, de otro pago, con otra clave o sin encabezado", () => {
    const base = { xSignature: header, xRequestId: "bb56a2f1-6aae-46ac-982e-9dcd3581d08e", dataId: "123456", secret };
    expect(verifyWebhookSignature({ ...base, dataId: "999999" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, xRequestId: "otro" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secret: "otra-clave-secreta-xxxxx" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, xSignature: null })).toBe(false);
    expect(verifyWebhookSignature({ ...base, xSignature: "ts=abc,v1=00" })).toBe(false);
    expect(verifyWebhookSignature({ ...base, xSignature: `ts=${ts}` })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secret: "" })).toBe(false);
  });
});

describe("preferencia de la seña", () => {
  const base = {
    intentId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    amountMinor: 627_800,
    currency: "ARS",
    serviceName: "Kapping",
    studioName: "Fresas Studio",
    expiresAt: "2026-11-20T15:00:00.000Z",
    returnUrl: "https://fresas.cleo.com.ar/reserva/K7M3QX?pago=1",
  };

  it("monto en pesos desde centavos, vencimiento, sin efectivo, 1 cuota, binario", () => {
    const p = buildDepositPreference(base);
    expect(p.items[0].unit_price).toBe(6278);
    expect(p.items[0].currency_id).toBe("ARS");
    expect(p.external_reference).toBe(base.intentId);
    expect(p.expires).toBe(true);
    expect(p.expiration_date_to).toBe(base.expiresAt);
    expect(p.binary_mode).toBe(true);
    expect(p.payment_methods.installments).toBe(1);
    expect(p.payment_methods.excluded_payment_types).toEqual([{ id: "ticket" }, { id: "atm" }]);
    expect(p.back_urls.success).toBe(base.returnUrl);
    expect(p).not.toHaveProperty("marketplace_fee");
  });

  it("marca blanca: en ningún lado dice Cleo salvo la URL del estudio", () => {
    const p = buildDepositPreference(base);
    expect(JSON.stringify({ ...p, back_urls: null }).toLowerCase()).not.toContain("cleo");
    expect(p.statement_descriptor).toBe("FRESAS STUDIO");
  });

  it("resumen de tarjeta: sin acentos ni símbolos, hasta 22 caracteres", () => {
    expect(statementDescriptor("Uñas & Pestañas de Ñuñoa Estética")).toBe("UNAS PESTANAS DE NUNOA");
    expect(statementDescriptor("¡¡¡")).toBe("ESTUDIO");
  });

  it("rechaza montos inválidos u otra moneda", () => {
    expect(() => buildDepositPreference({ ...base, amountMinor: 0 })).toThrow();
    expect(() => buildDepositPreference({ ...base, amountMinor: 1.5 })).toThrow();
    expect(() => buildDepositPreference({ ...base, currency: "USD" })).toThrow();
  });
});

describe("cliente de Mercado Pago", () => {
  function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
    return (async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }
  const cfg = (f: typeof fetch): MpConfig => ({
    apiBase: "https://api.test", authBase: "https://auth.test", clientId: "123456",
    clientSecret: "secreto-de-la-app", redirectUri: "https://cleo.com.ar/api/pagos/mp/vuelta", fetchImpl: f,
  });

  it("URL de autorización con state y PKCE", () => {
    const u = new URL(authorizationUrl(cfg(fakeFetch(200, {})), "estado", "desafio"));
    expect(u.origin + u.pathname).toBe("https://auth.test/authorization");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: "123456", response_type: "code", platform_id: "mp", state: "estado",
      redirect_uri: "https://cleo.com.ar/api/pagos/mp/vuelta", code_challenge: "desafio", code_challenge_method: "S256",
    });
  });

  it("renovar: manda el refresh token y lee la respuesta", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const t = await refreshTokens(cfg(fakeFetch(200, {
      access_token: "APP_USR-nuevo-access", refresh_token: "TG-nuevo-refresh", expires_in: 15552000,
      user_id: 99, scope: "offline_access read write", live_mode: false,
    }, seen)), "TG-viejo-refresh");
    expect(t.user_id).toBe(99);
    expect(JSON.parse(String(seen.init?.body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "TG-viejo-refresh" });
  });

  it("los errores no incluyen tokens ni el cuerpo de Mercado Pago", async () => {
    const err = await refreshTokens(cfg(fakeFetch(400, { error: "invalid_grant", message: "TG-viejo-refresh is invalid" })), "TG-viejo-refresh")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MpError);
    expect((err as MpError).revoked).toBe(true);
    expect(String((err as MpError).message)).not.toContain("TG-");
  });

  it("401 = acceso revocado; red caída = error temporal", async () => {
    const e401 = await getPayment(cfg(fakeFetch(401, { message: "unauthorized" })), "APP_USR-x", "123").then(() => null, (e: MpError) => e) as MpError;
    expect(e401.revoked).toBe(true);
    const failing = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const eNet = await getPayment(cfg(failing), "APP_USR-x", "123").then(() => null, (e: MpError) => e) as MpError;
    expect(eNet.code).toBe("network");
    expect(eNet.revoked).toBe(false);
  });

  it("no consulta ids de pago raros (evita armar otra URL)", () => {
    expect(() => getPayment(cfg(fakeFetch(200, {})), "t", "../users/me")).toThrow(MpError);
  });

  it("crear preferencia manda token, clave de idempotencia y valida la respuesta", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const p = await createPreference(cfg(fakeFetch(201, { id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" }, seen)), "APP_USR-tok", { a: 1 }, "idem-1");
    expect(p.id).toBe("pref-1");
    const h = seen.init?.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer APP_USR-tok");
    expect(h["X-Idempotency-Key"]).toBe("idem-1");
    await expect(createPreference(cfg(fakeFetch(201, { id: "x" })), "t", {}, "i")).rejects.toThrow(MpError);
  });

  it("normaliza un pago a centavos (comisión, neto, devuelto)", () => {
    const n = normalizePayment({
      id: "123", status: "approved", status_detail: "accredited", transaction_amount: 6278,
      transaction_amount_refunded: 0, currency_id: "ARS", external_reference: "abc", collector_id: 99,
      live_mode: false, date_approved: "2026-11-11T10:00:00.000-03:00", payment_method_id: "visa",
      payment_type_id: "credit_card", installments: 1, fee_details: [{ amount: 410.35 }, { amount: 0.1 }],
      transaction_details: { net_received_amount: 5867.55 },
    });
    expect(n).toMatchObject({ amount_minor: 627800, fee_minor: 41045, net_minor: 586755, refunded_minor: 0, collector_id: 99 });
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });
});

describe("secretos de pagos fuera del navegador", () => {
  const SECRETS = ["MP_CLIENT_SECRET", "MP_WEBHOOK_SECRET", "PAYMENTS_ENCRYPTION_KEY", "SUPABASE_SECRET_KEY", "CRON_SECRET", "MP_CLIENT_ID"];
  const src = join(__dirname, "../..");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts")) files.push(p);
    }
  })(src);

  it("ningún secreto se declara con NEXT_PUBLIC_", () => {
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n") + readFileSync(join(src, "../.env.example"), "utf8");
    for (const s of SECRETS) expect(all).not.toContain(`NEXT_PUBLIC_${s}`);
  });

  it("los módulos de \"use client\" no importan nada de pagos del servidor", () => {
    for (const f of files) {
      const code = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/.test(code)) continue;
      expect(code, f).not.toMatch(/@\/lib\/payments\/(config|service-client|flows|crypto|mp-api)/);
      for (const s of SECRETS) expect(code, f).not.toContain(s);
    }
  });

  it("config y service-client son server-only", () => {
    for (const f of ["config.ts", "service-client.ts"]) {
      expect(readFileSync(join(__dirname, f), "utf8")).toMatch(/^import "server-only";/);
    }
  });
});
