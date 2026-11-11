/**
 * Fechas y horas de las reservas, SIEMPRE en la hora del estudio (B14), nunca en la
 * del dispositivo de la clienta. Funciones puras (sirven en servidor y cliente).
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-16" válido (también como fecha real). */
export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona del estudio. */
export function ymdIn(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(instant));
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "14:00" en la hora del estudio. */
export function formatTime(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(instant));
}

/** Etiqueta corta de un día (YYYY-MM-DD): "lun 16 nov". */
export function formatDayShort(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(d)
    .replace(/\./g, "")
    .replace(",", "");
}

/** "lunes 16 de noviembre, 14:00" en la hora del estudio. */
export function formatDateTimeLong(instant: Date | string, timezone: string): string {
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" })
    .format(new Date(instant));
  return `${day.replace(",", "")}, ${formatTime(instant, timezone)}`;
}

/** Nombre corto de la zona para aclararla ("hora de Buenos Aires"). */
export function timezoneLabel(timezone: string): string {
  const city = timezone.split("/").pop() ?? timezone;
  return `hora de ${city.replace(/_/g, " ")}`;
}

/** Instante ISO válido (para el parámetro del horario elegido). */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "any" = cualquiera disponible; si no, un uuid de profesional. */
export type ProChoice = "any" | string;

export function parseProChoice(value: unknown): ProChoice | null {
  if (value === "any") return "any";
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) return value;
  return null;
}

/** URLs de los pasos del flujo de reserva (cada paso es una URL: funciona "atrás"). */
export function stepUrl(serviceId: string, opts: { pro?: ProChoice; day?: string } = {}): string {
  const q = new URLSearchParams();
  if (opts.pro) q.set("p", opts.pro);
  if (opts.day) q.set("dia", opts.day);
  const qs = q.toString();
  return `/reservar/${serviceId}${qs ? `?${qs}` : ""}`;
}

export function confirmUrl(serviceId: string, pro: ProChoice, startsAt: string): string {
  const q = new URLSearchParams({ s: serviceId, p: pro, t: startsAt });
  return `/reservar/confirmar?${q.toString()}`;
}
