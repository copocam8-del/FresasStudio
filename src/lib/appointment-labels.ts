/** Textos de estados de reservas y señas (panel). */
export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Esperando pago",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Vencido",
};

export const DEPOSIT_LABEL: Record<string, string> = {
  pending: "seña pendiente",
  paid: "seña pagada online",
  paid_offline: "seña cobrada en el estudio",
};
