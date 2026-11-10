import "server-only";
import type { StaffContext } from "@/lib/auth";
import { parseTstzRange } from "@/lib/range";
import { serverSupabase } from "@/lib/supabase/server";

export type HoursRow = { weekday: number; start: number; end: number };
export type Block = {
  id: string;
  professional_id: string | null;
  kind: "vacation" | "holiday" | "day_off" | "block";
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  note: string | null;
};

/** Franjas de un horario (estudio si professionalId es null). */
export async function loadHours(ctx: StaffContext, professionalId: string | null): Promise<HoursRow[]> {
  const supabase = await serverSupabase();
  let q = supabase.from("working_hours").select("weekday, start_minute, end_minute").eq("tenant_id", ctx.tenantId);
  q = professionalId ? q.eq("professional_id", professionalId) : q.is("professional_id", null);
  const { data, error } = await q.order("weekday").order("start_minute");
  if (error) throw new Error(`No se pudo cargar el horario: ${error.message}`);
  return (data ?? []).map((r) => ({ weekday: r.weekday, start: r.start_minute, end: r.end_minute }));
}

/** Bloqueos que todavía no terminaron (opcionalmente de una profesional, incluidos los del estudio). */
export async function loadUpcomingBlocks(ctx: StaffContext, professionalId?: string): Promise<Block[]> {
  const supabase = await serverSupabase();
  let q = supabase.from("schedule_blocks").select("id, professional_id, kind, period, all_day, note").eq("tenant_id", ctx.tenantId);
  if (professionalId) {
    // Se interpola en el filtro: tiene que ser un uuid, sí o sí.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(professionalId)) return [];
    q = q.or(`professional_id.eq.${professionalId},professional_id.is.null`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`No se pudieron cargar los bloqueos: ${error.message}`);
  const now = Date.now();
  return (data ?? [])
    .map((b): Block => ({
      id: b.id,
      professional_id: b.professional_id,
      kind: b.kind,
      all_day: b.all_day,
      note: b.note,
      ...parseTstzRange(b.period as string),
    }))
    .filter((b) => new Date(b.ends_at).getTime() > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Hoy en la zona del estudio, como YYYY-MM-DD (para los campos de fecha). */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
