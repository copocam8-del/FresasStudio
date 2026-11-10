/**
 * Duraciones y horarios. Las franjas se guardan como minutos del día (540 = 09:00) y
 * los días como ISO (1 = lunes … 7 = domingo), igual que la base.
 */

export const WEEKDAYS = [
  { iso: 1, name: "Lunes", short: "Lun" },
  { iso: 2, name: "Martes", short: "Mar" },
  { iso: 3, name: "Miércoles", short: "Mié" },
  { iso: 4, name: "Jueves", short: "Jue" },
  { iso: 5, name: "Viernes", short: "Vie" },
  { iso: 6, name: "Sábado", short: "Sáb" },
  { iso: 7, name: "Domingo", short: "Dom" },
] as const;

/** Duraciones rápidas para los formularios. */
export const QUICK_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

/** 30 → "30 min", 60 → "1 h", 90 → "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 540 → "09:00", 1440 → "24:00". */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "9:00" / "09:00" → 540. Solo múltiplos de 5, de 00:00 a 24:00. null si no es válido. */
export function hhmmToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  const total = h * 60 + min;
  return total % 5 === 0 ? total : null;
}

export type Range = { start: number; end: number };

/** Problemas de un conjunto de franjas de un mismo día (lista vacía = válidas). */
export function checkDayRanges(ranges: Range[]): string[] {
  const issues: string[] = [];
  for (const r of ranges) {
    if (r.start >= r.end) issues.push(`La franja ${minutesToHHMM(r.start)}–${minutesToHHMM(r.end)} termina antes de empezar.`);
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      issues.push(
        `Las franjas ${minutesToHHMM(sorted[i - 1].start)}–${minutesToHHMM(sorted[i - 1].end)} y ` +
          `${minutesToHHMM(sorted[i].start)}–${minutesToHHMM(sorted[i].end)} se superponen.`,
      );
    }
  }
  return issues;
}
