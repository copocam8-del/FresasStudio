/**
 * Dinero en unidades mínimas enteras (centavos). Nunca float para guardar.
 * Formato argentino: "." separa miles y "," decimales ("12.500" o "12.500,50").
 */

/** Tope razonable para un precio: 100 millones (en centavos). Igual que la base. */
export const MAX_PRICE_MINOR = 10_000_000_000;

export type ParsedMoney = { ok: true; minor: number } | { ok: false; error: string };

export function parseMoneyToMinor(raw: unknown): ParsedMoney {
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: "Ingresá un precio." };
  const input = String(raw).replace(/\$/g, "").replace(/\s/g, "");
  if (!input) return { ok: false, error: "Ingresá un precio." };

  // Enteros con miles opcionales ("12500" o "12.500") y hasta 2 decimales con coma.
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(input);
  if (!m) {
    return { ok: false, error: "Escribí el precio como 12.500 o 12.500,50." };
  }
  const pesos = Number(m[1].replace(/\./g, ""));
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  const minor = pesos * 100 + cents;
  if (!Number.isSafeInteger(minor) || minor > MAX_PRICE_MINOR) {
    return { ok: false, error: "El precio es demasiado alto." };
  }
  return { ok: true, minor };
}

/** "$ 12.500" (sin decimales si son ,00), en la moneda del estudio. */
export function formatMoney(minor: number, currency = "ARS"): string {
  const hasCents = minor % 100 !== 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(minor / 100);
}

export function formatPrice(minor: number, isFrom: boolean, currency = "ARS"): string {
  return `${isFrom ? "desde " : ""}${formatMoney(minor, currency)}`;
}

/** Para el campo de un formulario: 1250000 → "12.500", 1250050 → "12.500,50". */
export function minorToInput(minor: number): string {
  const pesos = Math.trunc(minor / 100).toLocaleString("es-AR", { useGrouping: true });
  const cents = minor % 100;
  return cents ? `${pesos},${String(cents).padStart(2, "0")}` : pesos;
}
