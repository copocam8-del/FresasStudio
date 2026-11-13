/**
 * Textos de las consecuencias de cancelar, cambiar o cerrar un turno (Sprint 6).
 * La base DECIDE (app.deposit_terms); acá solo se arma lo que se muestra. Funciones
 * puras: sirven en servidor y cliente, y se prueban con Vitest.
 */
import { formatTime } from "./booking-format";
import { formatMoney } from "./money";

/** Lo que devuelve get_my_booking_terms / get_booking_terms. */
export type BookingTerms = {
  status: string;
  starts_at: string;
  deadline: string;
  keeps_deposit: boolean;
  deposit_minor: number;
  amount_minor: number;
  currency: string;
  cancellation_window_hours: number;
  can_cancel: boolean;
  can_reschedule_online: boolean;
  reschedule_count: number;
  service_id: string;
  professional_id: string;
};

export type CancelExpected = "credited" | "forfeited";
export type RescheduleExpected = "transferred" | "forfeited";

/** "miércoles 13 de noviembre a las 10:00" (hora del estudio). */
export function formatDeadline(instant: string | Date, timezone: string): string {
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" })
    .format(new Date(instant))
    .replace(",", "");
  return `${day} a las ${formatTime(instant, timezone)}`;
}

/** Lo que la pantalla le manda a la base como "la consecuencia que vi". */
export function cancelExpected(terms: Pick<BookingTerms, "keeps_deposit">): CancelExpected {
  return terms.keeps_deposit ? "credited" : "forfeited";
}

export function rescheduleExpected(terms: Pick<BookingTerms, "keeps_deposit">): RescheduleExpected {
  return terms.keeps_deposit ? "transferred" : "forfeited";
}

/** Cartel del plazo en el detalle de la reserva (clienta). */
export function deadlineNotice(terms: BookingTerms, timezone: string): string {
  const amount = formatMoney(terms.amount_minor, terms.currency);
  if (terms.keeps_deposit) {
    return `Podés cancelar o cambiar el día sin perder la seña hasta el ${formatDeadline(terms.deadline, timezone)}.`;
  }
  return `Ya pasó el plazo de ${terms.cancellation_window_hours} horas: si cancelás o cambiás el día, perdés la seña de ${amount}.`;
}

/** Qué pasa si cancela (clienta, o el estudio cargando la cancelación de la clienta). */
export function cancelConsequence(terms: BookingTerms, who: "client" | "staff" = "client"): string {
  const amount = formatMoney(terms.amount_minor, terms.currency);
  const sub = who === "client" ? "Tu" : "Su";
  if (terms.keeps_deposit) {
    return terms.amount_minor > 0
      ? `${sub} seña de ${amount} queda como saldo a favor para ${who === "client" ? "tu" : "su"} próximo turno en el estudio.`
      : "No hay seña para acreditar (ya se devolvió).";
  }
  return `Faltan menos de ${terms.cancellation_window_hours} horas: ${sub.toLowerCase()} seña de ${amount} se pierde.`;
}

/** Qué pasa si cambia el día. */
export function rescheduleConsequence(terms: BookingTerms, who: "client" | "staff" = "client"): string {
  const deposit = formatMoney(terms.deposit_minor, terms.currency);
  if (terms.keeps_deposit) {
    return `${who === "client" ? "Tu" : "La"} seña pasa entera al turno nuevo. El precio no cambia.`;
  }
  return `Faltan menos de ${terms.cancellation_window_hours} horas: se pierde la seña de ${formatMoney(terms.amount_minor, terms.currency)} y el turno nuevo pide una seña nueva de ${deposit}.`;
}

/** Estados de un turno para la clienta. */
export const CLIENT_STATUS: Record<string, string> = {
  pending_payment: "Esperando el pago de la seña",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Venció sin pago",
  rescheduled: "Cambiado de día",
  completed: "Atendido",
  no_show: "No asististe",
};

export type ClosedBooking = {
  status: string;
  deposit_outcome: string | null;
  deposit_outcome_minor: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  currency: string;
};

/** Explicación de un turno cerrado, en palabras simples (clienta). */
export function closedExplanation(b: ClosedBooking): string | null {
  const amount = formatMoney(b.deposit_outcome_minor ?? 0, b.currency);
  if (b.status === "cancelled" && b.cancelled_by === "studio") {
    const why = b.cancel_reason ? ` Motivo: ${b.cancel_reason}.` : "";
    if (b.deposit_outcome === "refunded") return `El estudio canceló tu turno.${why} Te devolvemos ${amount}.`;
    return `El estudio canceló tu turno.${why} Sumamos ${amount} a tu saldo a favor.`;
  }
  if (b.status === "cancelled" && b.cancelled_by === "client") {
    if (b.deposit_outcome === "credited") {
      return (b.deposit_outcome_minor ?? 0) > 0
        ? `Cancelaste con tiempo: sumamos ${amount} a tu saldo a favor.`
        : "Cancelaste con tiempo.";
    }
    if (b.deposit_outcome === "forfeited") return `Cancelaste con menos anticipación de la necesaria: la seña de ${amount} se perdió.`;
  }
  if (b.status === "rescheduled") {
    return b.deposit_outcome === "transferred"
      ? "Cambiaste el día: la seña pasó entera al turno nuevo."
      : `Cambiaste el día con menos anticipación de la necesaria: la seña de ${amount} se perdió.`;
  }
  if (b.status === "no_show") {
    return b.deposit_outcome === "credited"
      ? `No asististe. El estudio sumó ${amount} a tu saldo a favor.`
      : `No asististe al turno: la seña de ${amount} se perdió.`;
  }
  return null;
}

/** Último instante en que se puede usar un saldo: vence al empezar ese día; se muestra el día anterior. */
export function creditUsableUntil(expiresAt: string | Date, timezone: string): string {
  const last = new Date(new Date(expiresAt).getTime() - 1);
  return new Intl.DateTimeFormat("es-AR", { timeZone: timezone, day: "numeric", month: "long", year: "numeric" }).format(last);
}

/** Días que faltan para que venza un saldo (0 = vence hoy). */
export function daysUntil(expiresAt: string | Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - 1 - now.getTime()) / 86_400_000));
}

export const CREDIT_KIND: Record<string, string> = {
  cancellation_credit: "Cancelaste con tiempo",
  studio_cancellation_credit: "El estudio canceló un turno",
  manual_credit: "Carga del estudio",
  no_show_credit: "Seña de un turno al que no asististe",
  used_in_booking: "Usado en una reserva",
  returned_from_booking: "Vuelve: la reserva no se pagó",
  manual_debit: "Ajuste del estudio",
  expired: "Venció",
};
