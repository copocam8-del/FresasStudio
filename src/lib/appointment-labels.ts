/** Textos de estados de reservas y señas (panel). */
export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Esperando pago",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Vencido",
  rescheduled: "Reprogramado",
  completed: "Atendida",
  no_show: "Faltó",
};

export const DEPOSIT_LABEL: Record<string, string> = {
  pending: "seña pendiente",
  paid: "seña pagada online",
  paid_offline: "seña cobrada en el estudio",
  credit: "seña cubierta con saldo a favor",
  transferred: "seña de un turno reprogramado",
};

/** Qué pasó con la seña al cerrar el turno. */
export const OUTCOME_LABEL: Record<string, string> = {
  applied: "cuenta como pago del turno",
  credited: "pasó al saldo a favor",
  forfeited: "se perdió",
  refunded: "se devolvió",
  transferred: "pasó al turno nuevo",
};
