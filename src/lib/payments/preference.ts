/**
 * Arma el cuerpo de la preferencia de Checkout Pro para la seña de una reserva.
 * Módulo puro (testeable). El monto viene SIEMPRE de la base (deposit_minor).
 *
 * Decisiones del plan (docs/sprint-5-plan.md):
 *   P1 sin comisión de Cleo (no hay marketplace_fee)
 *   P2 solo medios instantáneos y modo binario (sin efectivo: Rapipago, Pago Fácil…)
 *   P3 una sola cuota
 *   P10 en el resumen de la tarjeta, el nombre del estudio (nunca "Cleo")
 */

export type DepositCheckout = {
  intentId: string;        // external_reference
  amountMinor: number;     // seña en centavos (siempre pesos enteros, B8)
  currency: string;        // ARS
  serviceName: string;
  studioName: string;
  expiresAt: string;       // ISO: vence junto con la reserva
  returnUrl: string;       // https://{slug}.cleo.com.ar/reserva/{código}
};

/** Mercado Pago admite hasta 22 caracteres; solo letras, números y espacios. */
export function statementDescriptor(studioName: string): string {
  const plain = studioName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return (plain || "ESTUDIO").slice(0, 22).trim();
}

export function buildDepositPreference(c: DepositCheckout) {
  if (!Number.isSafeInteger(c.amountMinor) || c.amountMinor <= 0) throw new Error("Monto de seña inválido");
  if (c.currency !== "ARS") throw new Error("Solo se cobra en pesos (ARS)");
  const title = `Seña · ${c.serviceName}`.slice(0, 120);
  return {
    items: [{
      id: c.intentId,
      title,
      quantity: 1,
      currency_id: c.currency,
      unit_price: c.amountMinor / 100,
    }],
    external_reference: c.intentId,
    statement_descriptor: statementDescriptor(c.studioName),
    binary_mode: true,
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
      installments: 1,
    },
    expires: true,
    expiration_date_from: new Date(Date.now() - 60_000).toISOString(),
    expiration_date_to: c.expiresAt,
    back_urls: { success: c.returnUrl, failure: c.returnUrl, pending: c.returnUrl },
    auto_return: "approved",
  };
}
