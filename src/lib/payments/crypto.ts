import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado de secretos de pagos (tokens de Mercado Pago, verificador PKCE) con
 * AES-256-GCM, en el servidor de Next, ANTES de llegar a la base: si se filtra un
 * backup de la base, los tokens no sirven sin la clave (que vive solo en Render).
 *
 * Formato: "v{versión}.{iv base64url}.{texto cifrado + tag base64url}".
 * El "dato asociado" (aad) ata el texto cifrado a su dueño (estudio + cuenta): un
 * token cifrado copiado a otra fila o a otro estudio no se puede descifrar.
 *
 * Módulo puro (sin "server-only") para poder testearlo; solo lo importan módulos
 * server-only (config.ts, flujos de pagos).
 */

export type EncryptionKeys = {
  /** Versión de la clave actual (con la que se cifra). */
  currentVersion: number;
  /** Claves por versión: la actual y, durante una rotación, las anteriores. */
  keys: Record<number, Buffer>;
};

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) throw new Error("La clave de cifrado de pagos tiene que tener 32 bytes en base64");
  return key;
}

export function encryptSecret(plaintext: string, aad: string, keys: EncryptionKeys): string {
  const key = keys.keys[keys.currentVersion];
  if (!key) throw new Error("Falta la clave de cifrado actual");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v${keys.currentVersion}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(payload: string, aad: string, keys: EncryptionKeys): string {
  const m = /^v(\d{1,4})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(payload);
  if (!m) throw new Error("Secreto cifrado con formato inválido");
  const key = keys.keys[Number(m[1])];
  if (!key) throw new Error("No está la clave de cifrado de esa versión");
  const iv = Buffer.from(m[2], "base64url");
  const body = Buffer.from(m[3], "base64url");
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) throw new Error("Secreto cifrado con formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  // Si el texto, el tag o el aad no coinciden, final() lanza: nunca devuelve basura.
  return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** Versión de clave con la que se cifró (para saber si conviene re-cifrar). */
export function secretKeyVersion(payload: string): number | null {
  const m = /^v(\d{1,4})\./.exec(payload);
  return m ? Number(m[1]) : null;
}

/** Valor aleatorio para state/PKCE, en base64url (sin relleno). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 en hex (lo que se guarda del state: nunca el valor). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** code_challenge de PKCE (S256) para un code_verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** "Dato asociado" de los tokens de una cuenta. */
export const tokenAad = (tenantId: string, kind: "access" | "refresh") => `cleo:mp:${kind}:${tenantId}`;
/** "Dato asociado" del verificador PKCE de una conexión en curso. */
export const verifierAad = (tenantId: string, stateHash: string) => `cleo:mp:pkce:${tenantId}:${stateHash}`;
