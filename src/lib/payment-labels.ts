/**
 * Textos de pagos para el panel y cálculos de la conciliación. Funciones puras: los
 * importes vienen de la base (centavos enteros) y acá solo se suman para mostrar.
 */

export const OUTCOME_LABEL: Record<string, string> = {
  applied: "Confirmó la reserva",
  late_confirmed: "Llegó tarde y confirmó la reserva",
  refund_pending: "Devolución en curso",
  refunded: "Devuelto",
  refund_failed: "No se pudo devolver",
  needs_review: "Monto distinto: revisar",
  ignored: "Sin efecto",
};

export const STATUS_LABEL: Record<string, string> = {
  approved: "Aprobado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  pending: "Pendiente",
  in_process: "En revisión",
  authorized: "Autorizado",
  refunded: "Devuelto",
  charged_back: "Contracargo",
  in_mediation: "En mediación",
};

export const REFUND_REASON_LABEL: Record<string, string> = {
  duplicate: "la seña ya estaba pagada",
  late_slot_taken: "llegó tarde y el horario ya estaba tomado",
  late_released: "la reserva se había liberado",
  late_past: "el turno ya había pasado",
};

const BRANDS: Record<string, string> = {
  visa: "Visa", master: "Mastercard", amex: "American Express", debvisa: "Visa débito", debmaster: "Mastercard débito",
  naranja: "Naranja", cabal: "Cabal", maestro: "Maestro", account_money: "Dinero en cuenta",
};
const TYPES: Record<string, string> = {
  credit_card: "crédito", debit_card: "débito", prepaid_card: "prepaga", account_money: "dinero en cuenta",
};

/** "Visa · crédito", "Dinero en cuenta"… */
export function paymentMethodLabel(method: string | null, type: string | null): string {
  if (!method && !type) return "—";
  if (method === "account_money" || type === "account_money") return "Dinero en cuenta";
  const brand = method ? (BRANDS[method] ?? method) : "";
  const kind = type ? (TYPES[type] ?? type) : "";
  return [brand, kind].filter(Boolean).join(" · ");
}

export type PaymentRow = {
  status: string;
  outcome: string | null;
  amount_minor: number;
  fee_minor: number | null;
  net_minor: number | null;
  refunded_minor: number;
};

/** Pagos que alguien del estudio tiene que mirar ("Pagos a resolver"). */
export function needsAttention(p: Pick<PaymentRow, "status" | "outcome">): boolean {
  return p.outcome === "refund_failed" || p.outcome === "needs_review" || p.status === "charged_back" || p.status === "in_mediation";
}

const RECEIVED = new Set(["approved", "refunded", "charged_back", "in_mediation"]);

/** Totales del período: lo que entró, la comisión de Mercado Pago, lo devuelto y el neto. */
export function paymentTotals(rows: PaymentRow[]) {
  let received = 0, fees = 0, refunded = 0, net = 0;
  for (const r of rows) {
    if (!RECEIVED.has(r.status)) continue;
    received += Number(r.amount_minor);
    fees += Number(r.fee_minor ?? 0);
    refunded += Number(r.refunded_minor);
    net += Number(r.net_minor ?? Number(r.amount_minor) - Number(r.fee_minor ?? 0));
  }
  return { received, fees, refunded, net: net - refunded, count: rows.filter((r) => RECEIVED.has(r.status)).length };
}

/** Una línea de CSV (separador ";" para que Excel en español lo abra bien). */
export function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map((v) => {
    const s = v == null ? "" : String(v);
    // Evita que Excel interprete fórmulas (=, +, -, @) en textos.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }).join(";");
}

/** Centavos → "1234,56" (para planillas). */
export function minorToDecimal(minor: number | null): string {
  if (minor == null) return "";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
