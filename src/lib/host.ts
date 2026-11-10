/**
 * Clasificación del host de cada request (función pura, sin acceso a la base).
 *
 *   cleo.com.ar · www.cleo.com.ar · *.vercel.app  → sitio de Cleo
 *   admin.cleo.com.ar                             → Cleo Admin (plataforma)
 *   {slug}.cleo.com.ar                            → sitio del estudio (y su panel en /admin)
 *   cualquier otro dominio válido                 → posible dominio propio de un estudio
 *
 * En local el dominio raíz es "localhost" (NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000):
 * fresas.localhost:3000, admin.localhost:3000, etc.
 *
 * Esto solo decide A DÓNDE va la request. Que el estudio exista, esté activo o que
 * la persona tenga permisos se verifica siempre en el servidor.
 */

export type HostKind =
  | { kind: "root" }
  | { kind: "platform" }
  | { kind: "site"; slug: string }
  | { kind: "custom"; domain: string }
  | { kind: "invalid" };

/** Igual que la restricción de public.tenants.slug, más el rechazo de "xn--". */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^[a-z]{2,63}$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Subdominio de la plataforma para Cleo Admin. */
export const PLATFORM_SUBDOMAIN = "admin";

/**
 * Minúsculas, sin puerto ni punto final. Devuelve null si no es un nombre de host
 * válido (IPs, IPv6, caracteres raros, etiquetas vacías o demasiado largas).
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[")) return null; // IPv6
  host = host.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  if (IPV4_RE.test(host)) return null;
  const labels = host.split(".");
  if (!labels.every((l) => LABEL_RE.test(l))) return null;
  return host;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.startsWith("xn--");
}

export function classifyHost(rawHost: string | null | undefined, rawRoot: string): HostKind {
  const host = normalizeHost(rawHost);
  const root = normalizeHost(rawRoot);
  if (!host || !root) return { kind: "invalid" };

  if (host === root || host === `www.${root}`) return { kind: "root" };
  if (host.endsWith(".vercel.app")) return { kind: "root" };
  if (host === `${PLATFORM_SUBDOMAIN}.${root}`) return { kind: "platform" };

  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    // Un solo nivel: a.b.cleo.com.ar no es un estudio.
    if (sub.includes(".") || !isValidSlug(sub)) return { kind: "invalid" };
    return { kind: "site", slug: sub };
  }

  // Dominio propio: al menos "dominio.tld" con un TLD alfabético.
  const labels = host.split(".");
  if (labels.length >= 2 && TLD_RE.test(labels[labels.length - 1])) {
    return { kind: "custom", domain: host };
  }
  return { kind: "invalid" };
}

/** Prefijos internos de rutas: solo se llega a ellos por rewrite del proxy. */
export const INTERNAL_PREFIXES = ["/sites", "/platform"] as const;

export function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Ruta interna a la que se reescribe la request, o null si debe dar 404.
 * Los sitios de estudios (subdominio o dominio propio) van a /sites/{host}/...
 */
export function rewritePath(kind: HostKind, pathname: string): string | null {
  if (isInternalPath(pathname)) return null;
  const path = pathname === "/" ? "" : pathname;
  switch (kind.kind) {
    case "root":
      return pathname;
    case "platform":
      return `/platform${path}`;
    case "site":
      return `/sites/${kind.slug}${path}`;
    case "custom":
      return `/sites/${kind.domain}${path}`;
    case "invalid":
      return null;
  }
}

/**
 * Del segmento [site] de /sites/[site] a qué estudio buscar. Un slug (sin puntos)
 * viene de un subdominio; un dominio (con puntos) es un dominio propio.
 */
export function siteKeyFromParam(param: string):
  | { by: "slug"; slug: string }
  | { by: "domain"; domain: string }
  | null {
  const value = decodeURIComponent(param).toLowerCase();
  if (!value.includes(".")) return isValidSlug(value) ? { by: "slug", slug: value } : null;
  const domain = normalizeHost(value);
  return domain ? { by: "domain", domain } : null;
}
