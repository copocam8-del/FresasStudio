import "server-only";
import type { StaffContext } from "@/lib/auth";
import { addDays, isYmd, localToInstant, ymdIn } from "@/lib/booking-format";
import { needsAttention } from "@/lib/payment-labels";
import { serverSupabase } from "@/lib/supabase/server";

export type PaymentListRow = {
  payment_id: string;
  created_at: string;
  approved_at: string | null;
  provider_payment_id: string;
  appointment_id: string;
  appointment_code: string;
  starts_at: string;
  client_name: string;
  service_name: string;
  amount_minor: number;
  fee_minor: number | null;
  net_minor: number | null;
  refunded_minor: number;
  currency: string;
  payment_method: string | null;
  payment_type: string | null;
  status: string;
  outcome: string | null;
  refund_status: string | null;
  refund_reason: string | null;
  refund_error: string | null;
  live_mode: boolean;
};

/** Período en días del estudio (por defecto, los últimos 30). Hasta un año. */
export function paymentPeriod(q: Record<string, string | string[] | undefined>, timezone: string) {
  const today = ymdIn(new Date(), timezone);
  let hasta = typeof q.hasta === "string" && isYmd(q.hasta) ? q.hasta : today;
  let desde = typeof q.desde === "string" && isYmd(q.desde) ? q.desde : addDays(hasta, -29);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (desde < addDays(hasta, -365)) desde = addDays(hasta, -365);
  return {
    desde,
    hasta,
    from: localToInstant(desde, "00:00", timezone)!,
    to: localToInstant(addDays(hasta, 1), "00:00", timezone)!,
  };
}

/** Pagos del período (cash.read, lo valida la base). */
export async function loadPayments(ctx: StaffContext, from: string, to: string): Promise<PaymentListRow[]> {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("list_payments", { p_tenant: ctx.tenantId, p_from: from, p_to: to });
  if (error) throw new Error(`No se pudieron leer los pagos: ${error.code}`);
  return data as PaymentListRow[];
}

/** Pagos a resolver de los últimos 90 días (para el aviso del inicio) y desde cuándo mirar. */
export async function paymentsToResolve(ctx: StaffContext): Promise<{ count: number; desde: string }> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const supabase = await serverSupabase();
  const { data } = await supabase.from("payments").select("status, outcome")
    .eq("tenant_id", ctx.tenantId).gte("created_at", since.toISOString());
  const count = ((data ?? []) as Array<{ status: string; outcome: string | null }>).filter(needsAttention).length;
  return { count, desde: ymdIn(since, ctx.studio.timezone) };
}
