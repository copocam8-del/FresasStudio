import { describe, expect, it } from "vitest";
import {
  type BookingTerms,
  cancelConsequence,
  cancelExpected,
  closedExplanation,
  creditUsableUntil,
  daysUntil,
  deadlineNotice,
  formatDeadline,
  rescheduleConsequence,
  rescheduleExpected,
} from "./booking-terms";

const BA = "America/Argentina/Buenos_Aires";
const nbsp = (s: string) => s.replace(/ /g, " ");

const terms = (keeps: boolean, over: Partial<BookingTerms> = {}): BookingTerms => ({
  status: "confirmed",
  starts_at: "2027-03-10T13:00:00Z",
  deadline: "2027-03-09T13:00:00Z",
  keeps_deposit: keeps,
  deposit_minor: 750000,
  amount_minor: 750000,
  currency: "ARS",
  cancellation_window_hours: 24,
  can_cancel: true,
  can_reschedule_online: true,
  reschedule_count: 0,
  service_id: "s",
  professional_id: "p",
  ...over,
});

describe("plazo de la seña", () => {
  it("se muestra en la hora del estudio", () => {
    expect(formatDeadline("2027-03-09T13:00:00Z", BA)).toBe("martes 9 de marzo a las 10:00");
  });
  it("el cartel dice hasta cuándo se conserva", () => {
    expect(deadlineNotice(terms(true), BA)).toBe(
      "Podés cancelar o cambiar el día sin perder la seña hasta el martes 9 de marzo a las 10:00.");
  });
  it("pasado el plazo, avisa cuánto se pierde", () => {
    expect(nbsp(deadlineNotice(terms(false), BA))).toBe(
      "Ya pasó el plazo de 24 horas: si cancelás o cambiás el día, perdés la seña de $ 7.500.");
  });
});

describe("consecuencias", () => {
  it("cancelar a tiempo: saldo a favor", () => {
    expect(cancelExpected(terms(true))).toBe("credited");
    expect(nbsp(cancelConsequence(terms(true)))).toBe("Tu seña de $ 7.500 queda como saldo a favor para tu próximo turno en el estudio.");
  });
  it("cancelar tarde: se pierde", () => {
    expect(cancelExpected(terms(false))).toBe("forfeited");
    expect(nbsp(cancelConsequence(terms(false), "staff"))).toBe("Faltan menos de 24 horas: su seña de $ 7.500 se pierde.");
  });
  it("cambiar a tiempo: la seña pasa entera", () => {
    expect(rescheduleExpected(terms(true))).toBe("transferred");
    expect(rescheduleConsequence(terms(true))).toBe("Tu seña pasa entera al turno nuevo. El precio no cambia.");
  });
  it("cambiar tarde: seña nueva", () => {
    expect(rescheduleExpected(terms(false))).toBe("forfeited");
    expect(nbsp(rescheduleConsequence(terms(false)))).toBe(
      "Faltan menos de 24 horas: se pierde la seña de $ 7.500 y el turno nuevo pide una seña nueva de $ 7.500.");
  });
});

describe("turnos cerrados", () => {
  const base = { deposit_outcome_minor: 750000, currency: "ARS", cancel_reason: null };
  it("si cancela el estudio, nunca pierde", () => {
    expect(nbsp(closedExplanation({ ...base, status: "cancelled", cancelled_by: "studio", deposit_outcome: "credited", cancel_reason: "Se enfermó la profesional" })!))
      .toBe("El estudio canceló tu turno. Motivo: Se enfermó la profesional. Sumamos $ 7.500 a tu saldo a favor.");
    expect(nbsp(closedExplanation({ ...base, status: "cancelled", cancelled_by: "studio", deposit_outcome: "refunded" })!))
      .toBe("El estudio canceló tu turno. Te devolvemos $ 7.500.");
  });
  it("faltas y reprogramaciones", () => {
    expect(nbsp(closedExplanation({ ...base, status: "no_show", cancelled_by: null, deposit_outcome: "forfeited" })!))
      .toBe("No asististe al turno: la seña de $ 7.500 se perdió.");
    expect(closedExplanation({ ...base, status: "rescheduled", cancelled_by: null, deposit_outcome: "transferred" }))
      .toBe("Cambiaste el día: la seña pasó entera al turno nuevo.");
  });
  it("un turno abierto no tiene explicación", () => {
    expect(closedExplanation({ ...base, status: "confirmed", cancelled_by: null, deposit_outcome: null })).toBeNull();
  });
});

describe("vencimiento del saldo", () => {
  it("vence al empezar el día: se muestra el día anterior como último día", () => {
    // Vence el 11/2 a las 00:00 de Buenos Aires (03:00 UTC): se puede usar todo el 10/2.
    expect(creditUsableUntil("2027-02-11T03:00:00Z", BA)).toBe("10 de febrero de 2027");
  });
  it("cuenta los días que faltan", () => {
    expect(daysUntil("2027-02-11T03:00:00Z", new Date("2027-02-01T03:00:00Z"))).toBe(9);
    expect(daysUntil("2027-02-11T03:00:00Z", new Date("2027-02-10T15:00:00Z"))).toBe(0);
  });
});
