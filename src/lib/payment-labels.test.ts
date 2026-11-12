import { describe, expect, it } from "vitest";
import { csvLine, minorToDecimal, needsAttention, paymentMethodLabel, paymentTotals } from "./payment-labels";

describe("conciliación", () => {
  const rows = [
    { status: "approved", outcome: "applied", amount_minor: 750000, fee_minor: 47175, net_minor: 702825, refunded_minor: 0 },
    { status: "refunded", outcome: "refunded", amount_minor: 650000, fee_minor: 40885, net_minor: 609115, refunded_minor: 650000 },
    { status: "rejected", outcome: "ignored", amount_minor: 750000, fee_minor: null, net_minor: null, refunded_minor: 0 },
  ];

  it("totales: lo que entró, comisión, devuelto y neto (los rechazados no cuentan)", () => {
    expect(paymentTotals(rows)).toEqual({
      received: 1400000, fees: 88060, refunded: 650000, net: 702825 + 609115 - 650000, count: 2,
    });
  });

  it("pagos a resolver", () => {
    expect(needsAttention({ status: "approved", outcome: "refund_failed" })).toBe(true);
    expect(needsAttention({ status: "approved", outcome: "needs_review" })).toBe(true);
    expect(needsAttention({ status: "charged_back", outcome: "applied" })).toBe(true);
    expect(needsAttention({ status: "approved", outcome: "applied" })).toBe(false);
    expect(needsAttention({ status: "refunded", outcome: "refunded" })).toBe(false);
  });

  it("medio de pago legible", () => {
    expect(paymentMethodLabel("visa", "credit_card")).toBe("Visa · crédito");
    expect(paymentMethodLabel("account_money", "account_money")).toBe("Dinero en cuenta");
    expect(paymentMethodLabel(null, null)).toBe("—");
  });

  it("CSV: separador ;, comillas y sin fórmulas de Excel", () => {
    expect(csvLine(["a", 1, null, "x;y", 'di "hola"'])).toBe('a;1;;"x;y";"di ""hola"""');
    expect(csvLine(["=HYPERLINK(1)", "-3", "+54 11"])).toBe("'=HYPERLINK(1);-3;'+54 11");
    expect(minorToDecimal(750050)).toBe("7500,50");
    expect(minorToDecimal(-5)).toBe("-0,05");
    expect(minorToDecimal(null)).toBe("");
  });
});
