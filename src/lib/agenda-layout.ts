/**
 * Agenda del panel (Épica 08): cuentas puras para armar la grilla y decidir qué
 * acciones rápidas se ofrecen. La base vuelve a validar todo al ejecutar.
 */

/** Minutos desde la medianoche local del estudio. */
export function minutesOfDay(instant: string | Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * Ventana de la grilla del día: desde la primera hora en que alguien atiende (o hay un
 * turno) hasta la última, redondeada a horas enteras. Sin datos: 9 a 19.
 */
export function dayWindow(ranges: { start: number; end: number }[]): { start: number; end: number } {
  if (ranges.length === 0) return { start: 9 * 60, end: 19 * 60 };
  const start = Math.min(...ranges.map((r) => r.start));
  const end = Math.max(...ranges.map((r) => r.end));
  const s = Math.max(0, Math.floor(start / 60) * 60);
  const e = Math.min(24 * 60, Math.max(s + 60, Math.ceil(end / 60) * 60));
  return { start: s, end: e };
}

/** Posición y alto (en minutos dentro de la ventana) de un bloque; se recorta a la ventana. */
export function blockBox(start: number, end: number, win: { start: number; end: number }) {
  const top = Math.max(start, win.start) - win.start;
  const bottom = Math.min(Math.max(end, start + 15), win.end) - win.start;
  return { top, height: Math.max(bottom - top, 15) };
}

export type QuickAction = "checked_in" | "started" | "finished" | "no_show";

export type AgendaItem = {
  status: string;
  starts_at: string;
  checked_in_at: string | null;
  started_at: string | null;
  can_mark: boolean;
};

/**
 * Acciones rápidas según el momento (C12, C14): llegó → empezó → terminó desde 2 h antes;
 * faltó desde la hora del turno, si no llegó y quien mira puede marcar faltas.
 */
export function quickActions(a: AgendaItem, canNoShow: boolean, now: Date = new Date()): QuickAction[] {
  if (a.status !== "confirmed" || !a.can_mark) return [];
  const start = new Date(a.starts_at).getTime();
  const t = now.getTime();
  if (t < start - 2 * 3600_000) return [];
  const out: QuickAction[] = [];
  if (!a.checked_in_at) out.push("checked_in");
  else if (!a.started_at) out.push("started");
  out.push("finished");
  if (canNoShow && !a.checked_in_at && t >= start) out.push("no_show");
  return out;
}

export const QUICK_LABEL: Record<QuickAction, string> = {
  checked_in: "Llegó",
  started: "Empezó",
  finished: "Terminó",
  no_show: "Faltó",
};

/** Estado del turno para el equipo, contando asistencia. */
export function staffStatus(a: { status: string; checked_in_at: string | null; started_at: string | null; unclosed?: boolean }): string {
  if (a.status === "confirmed") {
    if (a.unclosed) return "Sin cerrar";
    if (a.started_at) return "En curso";
    if (a.checked_in_at) return "Llegó";
  }
  return STAFF_STATUS[a.status] ?? a.status;
}

export const STAFF_STATUS: Record<string, string> = {
  pending_payment: "Esperando pago",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Vencido",
  rescheduled: "Reprogramado",
  completed: "Atendida",
  no_show: "Faltó",
};

/** Tono de pastilla (los cuatro tonos del tema, ya controlados por theme.test.ts). */
export function staffTone(a: { status: string; checked_in_at: string | null; unclosed?: boolean }): "ok" | "pending" | "cancel" | "neutral" {
  if (a.status === "confirmed") return a.unclosed ? "neutral" : a.checked_in_at ? "pending" : "ok";
  if (a.status === "completed") return "ok";
  if (a.status === "pending_payment") return "pending";
  if (a.status === "cancelled" || a.status === "expired" || a.status === "no_show") return "cancel";
  return "neutral";
}

/** Link de WhatsApp a una clienta (teléfonos argentinos sin código de país → 549…). */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!phone.trim().startsWith("+") && !digits.startsWith("54")) {
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10) digits = `549${digits}`;
  }
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
