import { AA_LARGE_OR_UI, AA_TEXT, contrast, isHexColor, parseHex } from "@/lib/color";

/**
 * Marca de cada estudio (tenant_settings.brand). Las MISMAS reglas están en la base
 * (app.validate_brand, migración 1100): acá dan mensajes claros en el formulario;
 * allá impiden saltearlas llamando a la API directo.
 *
 *   primary     botones y elementos principales
 *   accent      detalles decorativos (reemplaza al dorado de Cleo; nunca texto chico)
 *   background  fondo del sitio y del panel
 *   logo_path   archivo en Storage (bucket "brand"), dentro de la carpeta del estudio
 *   enabled     marca propia activada. Sin esto, el estudio se ve con la marca Cleo
 *               (logo y colores de Cleo); con esto, su nombre, logo y colores.
 */
export type Brand = {
  enabled?: boolean;
  primary?: string;
  accent?: string;
  background?: string;
  logo_path?: string;
};

/** Colores del tema por defecto en hex (de globals.css; ver theme.test.ts). */
export const THEME = {
  background: "#0e0b0c",
  foreground: "#f7efe8",
  mutedForeground: "#cfc2b9",
  destructive: "#f2948c",
  primary: "#d7baaa",
  gold: "#d9c0b1",
} as const;

/** Texto sobre el color principal: blanco o negro, el que contraste más. */
const ON_PRIMARY = ["#ffffff", "#000000"] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** "<tenant_id>/logo-<uuid>.<ext>" (igual que en la base). */
export const LOGO_PATH_RE = new RegExp(`^(${UUID})/logo-${UUID}\\.(png|jpg|webp)$`);

/** Lee la marca guardada quedándose solo con valores bien formados. */
export function parseBrand(raw: unknown): Brand {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Brand = {};
  for (const key of ["primary", "accent", "background"] as const) {
    const v = r[key];
    if (typeof v === "string" && isHexColor(v)) out[key] = v.toLowerCase();
  }
  if (typeof r.logo_path === "string" && LOGO_PATH_RE.test(r.logo_path)) out.logo_path = r.logo_path;
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  return out;
}

export function primaryForeground(primary: string): string {
  const p = parseHex(primary);
  const [a, b] = ON_PRIMARY.map((c) => contrast(parseHex(c), p));
  return a >= b ? ON_PRIMARY[0] : ON_PRIMARY[1];
}

export type BrandIssue = { field: "primary" | "accent" | "background"; message: string };

/** Problemas de contraste de una marca (lista vacía = válida). */
export function checkBrand(brand: Brand): BrandIssue[] {
  const issues: BrandIssue[] = [];
  const bg = parseHex(brand.background ?? THEME.background);

  if (brand.background) {
    const worst = Math.min(
      contrast(parseHex(THEME.foreground), bg),
      contrast(parseHex(THEME.mutedForeground), bg),
      contrast(parseHex(THEME.destructive), bg),
    );
    if (worst < AA_TEXT) {
      issues.push({
        field: "background",
        message: "El fondo es demasiado claro o intenso para leer el texto. Elegí un tono más oscuro.",
      });
    }
  }

  if (brand.primary) {
    const p = parseHex(brand.primary);
    const best = Math.max(...ON_PRIMARY.map((c) => contrast(parseHex(c), p)));
    if (best < AA_TEXT) {
      issues.push({
        field: "primary",
        message: "Con ese color principal no se lee bien el texto de los botones. Probá un tono más oscuro o más claro.",
      });
    } else if (contrast(p, bg) < AA_LARGE_OR_UI) {
      issues.push({
        field: "primary",
        message: "Los botones casi no se distinguen del fondo. Elegí un color principal con más diferencia.",
      });
    }
  }

  if (brand.accent && contrast(parseHex(brand.accent), bg) < AA_LARGE_OR_UI) {
    issues.push({
      field: "accent",
      message: "El color de acento casi no se ve sobre el fondo. Elegí uno con más diferencia.",
    });
  }

  return issues;
}

/**
 * Variables CSS para aplicar la marca. Si la marca guardada no pasa los controles
 * (por ejemplo, datos viejos), se usan los colores de Cleo en lugar de arriesgar
 * texto ilegible.
 */
export function brandCssVars(raw: unknown): Record<string, string> {
  const brand = parseBrand(raw);
  // Sin la marca propia activada, el estudio se ve con los colores de Cleo.
  if (!brand.enabled || checkBrand(brand).length > 0) return {};
  const vars: Record<string, string> = {};
  if (brand.primary) {
    const fg = primaryForeground(brand.primary);
    vars["--primary"] = brand.primary;
    vars["--primary-foreground"] = fg;
    vars["--sidebar-primary"] = brand.primary;
    vars["--sidebar-primary-foreground"] = fg;
    vars["--chart-1"] = brand.primary;
  }
  if (brand.accent) {
    vars["--gold"] = brand.accent;
    vars["--chart-2"] = brand.accent;
  }
  if (brand.background) vars["--background"] = brand.background;
  return vars;
}

/** Tipo real de una imagen según sus primeros bytes (no confiar en la extensión). */
export function detectImageType(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MIME: Record<"png" | "jpg" | "webp", string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** URL pública del logo (bucket público "brand"). */
export function logoUrl(supabaseUrl: string, raw: unknown): string | null {
  // Ojo: es el archivo guardado; si se muestra o no lo decide usesOwnBrand().
  const path = parseBrand(raw).logo_path;
  return path ? `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/brand/${path}` : null;
}

/** ¿El estudio activó su marca propia? (si no, se ve "Cleo"). */
export function usesOwnBrand(raw: unknown): boolean {
  return parseBrand(raw).enabled === true;
}
