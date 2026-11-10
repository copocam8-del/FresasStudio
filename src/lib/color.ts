/**
 * Color y contraste (WCAG 2.x).
 *
 * Se usa en dos lugares:
 *  - Tests del tema por defecto de Cleo (globals.css, colores en oklch()).
 *  - Validación en el servidor de los colores de marca de cada estudio (hex).
 *
 * Sin dependencias y sin acceso al DOM: funciona en el servidor y en tests.
 */

/** Color sRGB con canales en [0, 1] y alfa en [0, 1]. */
export type Rgb = { r: number; g: number; b: number; alpha: number };

const HEX_RE = /^#([0-9a-f]{6})$/i;
const OKLCH_RE =
  /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

export function parseHex(value: string): Rgb {
  const m = HEX_RE.exec(value.trim());
  if (!m) throw new Error(`Color hexadecimal inválido: ${value}`);
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, alpha: 1 };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Convierte `oklch(L C H)` u `oklch(L C H / A%)` a sRGB (gamma), recortando al gamut. */
export function parseOklch(value: string): Rgb & { inGamut: boolean } {
  const m = OKLCH_RE.exec(value.trim());
  if (!m) throw new Error(`Color oklch inválido: ${value}`);
  const L = Number(m[1]);
  const C = Number(m[2]);
  const H = (Number(m[3]) * Math.PI) / 180;
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);

  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const inGamut = lin.every((x) => x >= -0.001 && x <= 1.001);
  const [r, g, bb] = lin.map((x) => encode(clamp01(x)));
  return { r, g, b: bb, alpha, inGamut };
}

/** Acepta hex (#rrggbb) u oklch(). */
export function parseColor(value: string): Rgb {
  return value.trim().startsWith("#") ? parseHex(value) : parseOklch(value);
}

/** Compone un color con alfa sobre un fondo opaco (en espacio sRGB, como el navegador). */
export function over(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.alpha;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    alpha: 1,
  };
}

/** Luminancia relativa WCAG. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** Relación de contraste WCAG entre dos colores (si `fg` tiene alfa, se compone sobre `bg`). */
export function contrast(fg: Rgb, bg: Rgb): number {
  const f = fg.alpha < 1 ? over(fg, bg) : fg;
  const l1 = luminance(f);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Mínimos WCAG AA. */
export const AA_TEXT = 4.5;
export const AA_LARGE_OR_UI = 3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
