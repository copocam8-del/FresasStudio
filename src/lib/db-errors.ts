/**
 * Traduce errores de la base a mensajes para la persona. Solo se muestran los
 * mensajes que escribimos nosotros (raise exception con códigos conocidos) o los de
 * restricciones mapeadas; cualquier otro error se reemplaza por uno genérico.
 */
const OUR_CODES = ["42501", "P0002", "22023", "23505", "23514", "23P01"];

const CONSTRAINTS: Record<string, string> = {
  service_categories_tenant_name: "Ya existe una categoría con ese nombre.",
  service_categories_name: "El nombre de la categoría tiene que tener entre 2 y 60 caracteres.",
  services_name: "El nombre del servicio tiene que tener entre 2 y 80 caracteres.",
  services_duration: "La duración tiene que ser de 5 minutos a 10 horas, en pasos de 5.",
  services_buffer: "El tiempo extra tiene que ser de 0 a 4 horas, en pasos de 5 minutos.",
  services_price: "El precio no es válido.",
  services_deposit: "La seña tiene que ser de 1 a 100%: toda reserva lleva seña.",
  settings_deposit_range: "La seña tiene que ser de 1 a 100%: toda reserva lleva seña.",
  settings_hold_range: "El tiempo para pagar tiene que ser de 5 minutos a 24 horas.",
  settings_min_notice_range: "La anticipación mínima tiene que ser de 0 a 7 días.",
  settings_horizon_range: "Se puede reservar de 1 a 365 días adelante.",
  professionals_name: "El nombre tiene que tener entre 2 y 60 caracteres.",
  professionals_one_per_membership: "Esa cuenta ya está vinculada a otra profesional.",
  professional_services_unique: "Esa profesional ya hace ese servicio.",
  professional_services_duration: "La duración propia tiene que ser de 5 minutos a 10 horas, en pasos de 5.",
  working_hours_no_overlap: "Esa franja se superpone con otra del mismo día.",
  working_hours_range: "La franja no es válida: el inicio tiene que ser antes del fin, en pasos de 5 minutos.",
  schedule_blocks_period: "El bloqueo no es válido: tiene que terminar después de empezar y durar como máximo un año.",
  appointments_one_pending_online: "Ya tenés una reserva esperando pago. Pagala o liberala antes de reservar otra.",
  appointments_no_overlap: "Ese horario se acaba de ocupar. Elegí otro.",
};

export function userFacingDbError(error: { code?: string; message: string; details?: string | null }): string {
  const text = `${error.message} ${error.details ?? ""}`;
  for (const [name, msg] of Object.entries(CONSTRAINTS)) {
    if (text.includes(name)) return msg;
  }
  if (error.code === "42501" && /row-level security|permission denied/i.test(error.message)) {
    return "No tenés permiso para hacer esto.";
  }
  if (error.code && OUR_CODES.includes(error.code) && !/violates|constraint|relation|column/i.test(error.message)) {
    return error.message;
  }
  console.error("Error de base no esperado", error.code, error.message);
  return "Algo salió mal. Probá de nuevo en unos minutos.";
}
