import "server-only";
import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";
import { classifyHost, normalizeHost } from "@/lib/host";
import { getStudio, type PublicStudio } from "@/lib/studio";

/**
 * Datos de la request actual, siempre derivados del host (nunca de campos de un
 * formulario, que se pueden editar desde el navegador).
 */

/** Origen público (protocolo + host + puerto) para armar links de emails y redirects. */
export async function currentOrigin(): Promise<string> {
  const h = await headers();
  const rawHost = h.get("host") ?? "";
  if (!normalizeHost(rawHost)) throw new Error("Host inválido");
  const isLocal = /(^|\.)localhost(:\d+)?$/.test(rawHost);
  const forwarded = h.get("x-forwarded-proto");
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : isLocal ? "http" : "https";
  return `${proto}://${rawHost.toLowerCase()}`;
}

/** Estudio del host actual (subdominio o dominio propio), o null. */
export async function currentStudio(): Promise<PublicStudio | null> {
  const h = await headers();
  const kind = classifyHost(h.get("host"), publicEnv().NEXT_PUBLIC_ROOT_DOMAIN);
  if (kind.kind === "site") return getStudio(kind.slug);
  if (kind.kind === "custom") return getStudio(kind.domain);
  return null;
}

/** ¿La request actual es de Cleo Admin (admin.<raíz>)? */
export async function isPlatformHost(): Promise<boolean> {
  const h = await headers();
  return classifyHost(h.get("host"), publicEnv().NEXT_PUBLIC_ROOT_DOMAIN).kind === "platform";
}
