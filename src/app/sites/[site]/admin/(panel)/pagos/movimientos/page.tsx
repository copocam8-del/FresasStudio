import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/panel/panel-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { can, requirePermission } from "@/lib/auth";
import { formatDateTimeLong } from "@/lib/booking-format";
import { formatMoney } from "@/lib/money";
import {
  needsAttention, OUTCOME_LABEL, paymentMethodLabel, paymentTotals, REFUND_REASON_LABEL, STATUS_LABEL,
} from "@/lib/payment-labels";
import { loadPayments, paymentPeriod, type PaymentListRow } from "@/lib/payments-data";
import { retryRefundAction } from "../actions";

export const metadata: Metadata = { title: "Pagos recibidos" };

const input = "h-11 w-full rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base text-foreground";

export default async function PaymentsListPage({ params, searchParams }: PageProps<"/sites/[site]/admin/pagos/movimientos">) {
  const { site } = await params;
  const q = await searchParams;
  const ctx = await requirePermission(site, "cash.read", "/admin/pagos/movimientos");
  const tz = ctx.studio.timezone;
  const period = paymentPeriod(q, tz);
  const rows = await loadPayments(ctx, period.from, period.to);
  const totals = paymentTotals(rows);
  const attention = rows.filter(needsAttention);
  const currency = rows[0]?.currency ?? "ARS";
  const canRetry = can(ctx, "cash.manage");
  const csv = `/admin/pagos/movimientos/csv?desde=${period.desde}&hasta=${period.hasta}`;

  return (
    <>
      <PageHeader title="Pagos recibidos" description="Señas cobradas con Mercado Pago, para cruzar con el resumen de tu cuenta." />

      <form className="grid grid-cols-2 items-end gap-3 glass rounded-[1.1rem] p-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-col gap-1">
          <Label htmlFor="desde">Desde</Label>
          <input id="desde" name="desde" type="date" defaultValue={period.desde} className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="hasta">Hasta</Label>
          <input id="hasta" name="hasta" type="date" defaultValue={period.hasta} className={input} />
        </div>
        <Button type="submit" variant="outline" className="col-span-2 h-11 sm:col-span-1">Ver</Button>
      </form>

      <section aria-label="Totales del período" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Total label={`Cobrado (${totals.count})`} value={formatMoney(totals.received, currency)} />
        <Total label="Comisión Mercado Pago" value={formatMoney(totals.fees, currency)} />
        <Total label="Devuelto" value={formatMoney(totals.refunded, currency)} />
        <Total label="Neto estimado" value={formatMoney(totals.net, currency)} strong />
      </section>
      <p className="-mt-3 text-xs text-muted-foreground">
        El neto es lo que informa Mercado Pago menos las devoluciones. La fecha es la del pago, en la hora del estudio.
      </p>

      {attention.length > 0 && (
        <section aria-labelledby="resolver" className="flex flex-col gap-3 glass rounded-[1.1rem] !border-[#8d4d49] p-4">
          <h2 id="resolver" className="font-semibold text-destructive">Pagos a resolver ({attention.length})</h2>
          <ul className="flex flex-col divide-y">
            {attention.map((p) => (
              <li key={p.payment_id} className="flex flex-col gap-2 py-3 text-sm">
                <PaymentSummary p={p} tz={tz} />
                <p className="text-muted-foreground">{attentionText(p)}</p>
                {p.outcome === "refund_failed" && canRetry && (
                  <form action={retryRefundAction}>
                    <input type="hidden" name="payment_id" value={p.payment_id} />
                    <Button type="submit" variant="outline" className="h-11">Reintentar devolución</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="lista" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lista" className="font-semibold text-foreground">Todos los pagos</h2>
          {rows.length > 0 && (
            <a href={csv} className={buttonVariants({ variant: "outline", className: "h-11" })}>Descargar CSV</a>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="glass rounded-[1.1rem] p-4 text-sm text-muted-foreground">No hay pagos en este período.</p>
        ) : (
          <ul className="flex flex-col divide-y glass rounded-[1.1rem]">
            {rows.map((p) => (
              <li key={p.payment_id} className="flex flex-col gap-1 p-3 text-sm">
                <PaymentSummary p={p} tz={tz} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-1 glass rounded-[1.1rem] p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={strong ? "text-lg font-semibold text-card-foreground" : "font-medium text-card-foreground"}>{value}</span>
    </div>
  );
}

function PaymentSummary({ p, tz }: { p: PaymentListRow; tz: string }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-card-foreground">{formatMoney(p.amount_minor, p.currency)} · {p.client_name}</span>
        <span className="text-muted-foreground">{formatDateTimeLong(p.approved_at ?? p.created_at, tz)}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge tone={needsAttention(p) ? "warn" : "muted"}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
        {p.outcome && <Badge tone={needsAttention(p) ? "warn" : "muted"}>{OUTCOME_LABEL[p.outcome] ?? p.outcome}</Badge>}
        {!p.live_mode && <Badge tone="warn">prueba</Badge>}
      </div>
      <span className="text-muted-foreground">
        {p.service_name} ·{" "}
        <Link href={`/admin/turnos/${p.appointment_id}`} className="underline underline-offset-4">turno {p.appointment_code}</Link>
        {" · "}{paymentMethodLabel(p.payment_method, p.payment_type)}
        {p.fee_minor != null && ` · comisión ${formatMoney(p.fee_minor, p.currency)}`}
        {p.refunded_minor > 0 && ` · devuelto ${formatMoney(p.refunded_minor, p.currency)}`}
        {` · operación ${p.provider_payment_id}`}
      </span>
    </>
  );
}

function attentionText(p: PaymentListRow): string {
  if (p.outcome === "refund_failed") {
    const why = p.refund_reason ? REFUND_REASON_LABEL[p.refund_reason] : null;
    return `Había que devolverlo${why ? ` (${why})` : ""}, pero Mercado Pago no lo permitió${p.refund_error === "insufficient_funds" ? ": la cuenta no tiene saldo suficiente" : ""}. Podés reintentar o devolverlo desde Mercado Pago.`;
  }
  if (p.outcome === "needs_review") return "El monto pagado no coincide con la seña. No se confirmó la reserva: revisalo en Mercado Pago.";
  if (p.status === "charged_back" || p.status === "in_mediation") return "La clienta desconoció el pago con su tarjeta (contracargo). Revisalo en Mercado Pago.";
  return "";
}
