import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Countdown } from "@/components/site/countdown";
import { PayDepositButton, PaymentWatcher } from "@/components/site/payment";
import { BookingShell } from "@/components/site/booking-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getBookingContext, myBookings } from "@/lib/booking-data";
import { formatDateTimeLong, formatTime, timezoneLabel } from "@/lib/booking-format";
import { formatMoney } from "@/lib/money";
import { paymentsConfig } from "@/lib/payments/config";
import { getStudio } from "@/lib/studio";
import { serverSupabase } from "@/lib/supabase/server";
import { formatDuration } from "@/lib/time";
import { payDepositAction, releaseBookingAction, simulatePaymentAction } from "../../reservar/actions";

export const metadata: Metadata = { title: "Tu reserva", robots: { index: false } };

const STATUS: Record<string, string> = {
  pending_payment: "Esperando el pago de la seña",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  expired: "Venció sin pago",
};

type MyPayment = {
  status: string;
  outcome: string | null;
  refund_status: string | null;
  refund_reason: string | null;
  amount_minor: number;
  currency: string;
};

const REFUND_WHY: Record<string, string> = {
  late_slot_taken: "Tu pago llegó cuando la reserva ya había vencido y otra persona tomó el horario.",
  late_released: "Tu pago llegó después de que se liberó la reserva.",
  late_past: "Tu pago llegó cuando el horario del turno ya había pasado.",
  duplicate: "La seña ya estaba pagada y recibimos un pago de más.",
};

export default async function BookingPage({ params, searchParams }: PageProps<"/sites/[site]/reserva/[code]">) {
  const { site, code } = await params;
  const q = await searchParams;
  const studio = await getStudio(site);
  if (!studio) notFound();
  if (!/^[2-9A-HJKMNP-Z]{6}$/i.test(code)) notFound();
  if (!(await getUser())) redirect(`/ingresar?next=${encodeURIComponent(`/reserva/${code}`)}`);

  const [ctx, bookings] = await Promise.all([getBookingContext(studio.slug), myBookings(studio.slug)]);
  const b = bookings.find((x) => x.code === code.toUpperCase());
  if (!b || !ctx) notFound();

  const tz = ctx.timezone;
  const pending = b.status === "pending_payment";
  const devPayments = process.env.NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS === "true";
  const onlinePayments = Boolean(paymentsConfig());
  // Volver de Mercado Pago no confirma nada: solo muestra "verificando" mientras la base
  // no reciba el pago verificado. Lo que diga la URL se usa solo para elegir el mensaje.
  const returned = q.pago === "volvio";
  const rejectedOnReturn = returned && (q.status === "rejected" || q.collection_status === "rejected");

  const supabase = await serverSupabase();
  const { data: payData } = await supabase.rpc("get_my_booking_payment", { p_slug: studio.slug, p_code: b.code });
  const payment = ((payData ?? []) as MyPayment[])[0];
  const refund = payment && payment.refund_status ? payment : null;

  return (
    <BookingShell studio={studio} step={4} title={pending ? "¡Te guardamos el horario!" : `Reserva ${STATUS[b.status].toLowerCase()}`}>
      <section aria-label="Tu reserva" className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground">
        <p className="text-sm text-muted-foreground">
          Código <span className="font-mono text-base font-semibold text-card-foreground">{b.code}</span>
        </p>
        <div className="flex flex-col">
          <span className="text-lg font-semibold">{b.service_name}</span>
          <span>con {b.professional_name}</span>
        </div>
        <p>
          {formatDateTimeLong(b.starts_at, tz)} ({timezoneLabel(tz)}) · {formatDuration(b.duration_minutes)}
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3">
          <dt>Estado</dt>
          <dd className="text-right font-medium">{STATUS[b.status]}</dd>
          <dt>Precio total{b.price_is_from ? " (desde)" : ""}</dt>
          <dd className="text-right">{formatMoney(b.price_minor, b.currency)}</dd>
          <dt>Seña</dt>
          <dd className="text-right">
            {formatMoney(b.deposit_minor, b.currency)}
            {b.deposit_status !== "pending" ? " · pagada" : ""}
          </dd>
        </dl>
      </section>

      {pending && b.hold_expires_at && (
        <section aria-labelledby="pago" className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card p-5 text-card-foreground">
          <h2 id="pago" className="font-semibold">Pagá la seña para confirmar</h2>
          <p className="text-sm">
            Tenés hasta las {formatTime(b.hold_expires_at, tz)} (quedan <Countdown until={b.hold_expires_at} />). Si no se paga,
            el horario se libera solo.
          </p>
          {returned && !rejectedOnReturn && <PaymentWatcher />}
          {rejectedOnReturn && (
            <p role="alert" className="text-sm font-medium text-destructive">
              El pago no se aprobó. Podés intentar de nuevo con otra tarjeta o medio de pago.
            </p>
          )}
          {onlinePayments ? (
            <PayDepositButton
              code={b.code}
              action={payDepositAction}
              label={`${returned && !rejectedOnReturn ? "Volver a Mercado Pago" : "Pagar seña"} ${formatMoney(b.deposit_minor, b.currency)} con Mercado Pago`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              El pago online no está disponible en este momento. El estudio te va a contactar para coordinar la seña.
            </p>
          )}
          {devPayments && (
            <form action={simulatePaymentAction}>
              <input type="hidden" name="code" value={b.code} />
              <Button type="submit" className="h-11 w-full">
                Simular pago aprobado (solo desarrollo)
              </Button>
            </form>
          )}
          <form action={releaseBookingAction}>
            <input type="hidden" name="code" value={b.code} />
            <Button type="submit" variant="outline" className="h-11 w-full">
              No voy a ir: liberar el horario
            </Button>
          </form>
        </section>
      )}

      {refund && (
        <section aria-label="Devolución" className="flex flex-col gap-1 rounded-xl border bg-card p-5 text-sm text-card-foreground">
          <p className="font-semibold">
            {refund.refund_status === "done"
              ? `Te devolvimos ${formatMoney(refund.amount_minor, refund.currency)}`
              : `Estamos devolviéndote ${formatMoney(refund.amount_minor, refund.currency)}`}
          </p>
          <p>{REFUND_WHY[refund.refund_reason ?? ""] ?? "Recibimos un pago que no se pudo aplicar a esta reserva."}</p>
          <p className="text-muted-foreground">
            La devolución vuelve al mismo medio de pago. Según tu banco o tarjeta, puede tardar unos días en verse.
          </p>
        </section>
      )}

      {b.status === "confirmed" && (
        <p className="text-sm text-muted-foreground">
          Si necesitás cancelar o reprogramar, hacelo con {b.cancellation_window_hours} horas o más de anticipación para conservar la seña.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/mi-ficha" className={buttonVariants({ variant: "outline", className: "h-11 flex-1" })}>Mis turnos</Link>
        {(b.status === "expired" || b.status === "cancelled") && (
          <Link href="/reservar" className={buttonVariants({ className: "h-11 flex-1" })}>Reservar otro horario</Link>
        )}
      </div>
    </BookingShell>
  );
}
