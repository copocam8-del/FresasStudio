/** Tipos de bloqueo (iguales al enum public.schedule_block_kind). Sirve en servidor y cliente. */
export const BLOCK_KINDS = [
  { value: "holiday", label: "Feriado" },
  { value: "vacation", label: "Vacaciones" },
  { value: "day_off", label: "Día libre" },
  { value: "block", label: "Horario bloqueado" },
] as const;
