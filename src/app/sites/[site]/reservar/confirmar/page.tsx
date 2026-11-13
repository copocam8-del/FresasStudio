import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BookingShell } from "@/components/site/booking-shell";
import { buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getBookingContext, myCredit, myPhone, previewBooking } from "@/lib/booking-data";
import { confirmUrl, formatDateTimeLong, parseInstant, parseProChoice, stepUrl, timezoneLabel } from "@/lib/booking-format";
import { formatMoney } from "@/lib/money";
import { getPublicCatalog, getStudio } from "@/lib/studio";
import { formatDuration } from "@/lib/time";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirmar reserva", robots: { index: false } };

// Paso 4: resumen, política y confirmación. Todo lo que se muestra lo calcula la base.
export default async function BookConfirm({ params, searchParams }: PageProps<"/sites/[site]/reservar/confirmar">) {
  const { site } = await params;
  const sp = await searchParams;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const service = z.uuid().safeParse(sp.s);
  const pro = parseProChoice(sp.p);
  const startsAt = parseInstant(sp.t);
  if (!service.success || !pro || !startsAt) redirect("/reservar");

  // B1: para apartar un horario hay que identificarse (vuelve exactamente acá).
  const here = confirmUrl(service.data, pro, startsAt.toISOString());
  if (!(await getUser())) redirect(`/ingresar?next=${encodeURIComponent(here)}`);

  const [ctx, catalog] = await Promise.all([getBookingContext(studio.slug), getPublicCatalog(studio.slug)]);
  if (!ctx?.online_booking_enabled) redirect("/reservar");
  const svc = catalog?.services.find((s) => s.id === service.data);
  if (!svc) notFound();

  const preview = await previewBooking(studio.slug, svc.id, pro === "any" ? null : pro, startsAt.toISOString());
  const back = stepUrl(svc.id, { pro });

  if (!preview) {
    return (
      <BookingShell studio={studio} step={4} title="Ese horario ya no está libre" back={back}>
        <p className="text-foreground">Alguien lo reservó recién o ya no se puede tomar online. Elegí otro horario.</p>
        <Link href={back} className={buttonVariants({ className: "h-11" })}>Elegir otro horario</Link>
      </BookingShell>
    );
  }

  const balance = preview.price_minor - preview.deposit_minor;
  // Saldo a favor (C9): se usa solo en la seña. Es lo que la base va a aplicar al reservar
  // (lo recalcula ella con la ficha bloqueada); acá solo se muestra.
  const credit = (await myCredit(studio.slug)).reduce((sum, l) => sum + l.remaining_minor, 0);
  const creditUsed = Math.min(credit, preview.deposit_minor);
  const toPay = preview.deposit_minor - creditUsed;
  const hold = ctx.booking_hold_minutes >= 60 && ctx.booking_hold_minutes % 60 === 0
    ? `${ctx.booking_hold_minutes / 60} ${ctx.booking_hold_minutes === 60 ? "hora" : "horas"}`
    : `${ctx.booking_hold_minutes} minutos`;

  return (
    <BookingShell studio={studio} step={4} title="Revisá y confirmá" back={back}>
      <section aria-label="Resumen" className="flex flex-col gap-3 glass rounded-[1.1rem] p-5 text-card-foreground">
        <div className="flex flex-col">
          <span className="text-lg font-semibold">{svc.name}</span>
          <span>con {preview.professional_name}</span>
        </div>
        <p>
          {formatDateTimeLong(startsAt, ctx.timezone)} ({timezoneLabel(ctx.timezone)}) · {formatDuration(preview.duration_minutes)}
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3">
          <dt>Precio total{preview.price_is_from ? " (desde)" : ""}</dt>
          <dd className="text-right font-medium">{formatMoney(preview.price_minor, preview.currency)}</dd>
          {creditUsed > 0 ? (
            <>
              <dt>Seña</dt>
              <dd className="text-right">{formatMoney(preview.deposit_minor, preview.currency)}</dd>
              <dt>Usás de tu saldo a favor</dt>
              <dd className="text-right">− {formatMoney(creditUsed, preview.currency)}</dd>
              <dt className="font-semibold">{toPay > 0 ? "A pagar ahora" : "Tu saldo cubre la seña"}</dt>
              <dd className="text-right font-semibold">{formatMoney(toPay, preview.currency)}</dd>
            </>
          ) : (
            <>
              <dt className="font-semibold">Seña a pagar ahora</dt>
              <dd className="text-right font-semibold">{formatMoney(preview.deposit_minor, preview.currency)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Resto, en el estudio</dt>
          <dd className="text-right text-muted-foreground">
            {preview.price_is_from ? "desde " : ""}{formatMoney(balance, preview.currency)}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="politica" className="flex flex-col gap-2 glass rounded-[1.1rem] p-5 text-card-foreground">
        <h2 id="politica" className="font-semibold">Política del estudio</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Tu horario queda guardado {hold} para pagar la seña. Si no se paga, se libera solo.</li>
          <li>Con la seña pagada, el turno queda confirmado.{creditUsed > 0 && toPay === 0 ? " Como tu saldo la cubre, queda confirmado al instante." : ""}</li>
          <li>Si cancelás o reprogramás con {ctx.cancellation_window_hours} horas o más de anticipación, la seña se conserva.</li>
          <li>Con menos de {ctx.cancellation_window_hours} horas, la seña se pierde. Si no venís al turno, también.</li>
          <li>Si cancelás a tiempo, la seña queda como saldo a favor en el estudio y vence a los {ctx.credit_expiry_days} días.</li>
        </ul>
        {ctx.policy_text && <p className="whitespace-pre-line text-sm text-muted-foreground">{ctx.policy_text}</p>}
      </section>

      <ConfirmForm
        serviceId={svc.id}
        pro={pro}
        startsAt={startsAt.toISOString()}
        policyVersion={ctx.policy_version}
        phone={await myPhone(studio.slug)}
        depositLabel={formatMoney(toPay, preview.currency)}
        coveredByCredit={creditUsed > 0 && toPay === 0}
      />
    </BookingShell>
  );
}
