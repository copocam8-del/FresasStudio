import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BookingShell } from "@/components/site/booking-shell";
import { TermsForm } from "@/components/site/terms-form";
import { buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getBookingContext, getServiceOptions, myBookingTerms, myBookings } from "@/lib/booking-data";
import { formatDateTimeLong, parseInstant, timezoneLabel } from "@/lib/booking-format";
import { rescheduleConsequence, rescheduleExpected } from "@/lib/booking-terms";
import { getStudio } from "@/lib/studio";
import { rescheduleMyBookingAction } from "../../../../reservar/actions";

export const metadata: Metadata = { title: "Confirmar el cambio", robots: { index: false } };

// Resumen "Antes / Ahora" y la consecuencia exacta. La base vuelve a calcular todo.
export default async function ConfirmChange({ params, searchParams }: PageProps<"/sites/[site]/reserva/[code]/cambiar/confirmar">) {
  const { site, code } = await params;
  const sp = await searchParams;
  const studio = await getStudio(site);
  if (!studio || !/^[2-9A-HJKMNP-Z]{6}$/i.test(code)) notFound();
  const back = `/reserva/${code.toUpperCase()}/cambiar`;
  const pro = z.uuid().safeParse(sp.p);
  const startsAt = parseInstant(sp.t);
  if (!pro.success || !startsAt) redirect(back);
  if (!(await getUser())) redirect(`/ingresar?next=${encodeURIComponent(back)}`);

  const [ctx, bookings, terms] = await Promise.all([
    getBookingContext(studio.slug), myBookings(studio.slug), myBookingTerms(studio.slug, code),
  ]);
  const b = bookings.find((x) => x.code === code.toUpperCase());
  if (!b || !ctx || !terms) notFound();
  if (!terms.can_reschedule_online) redirect(`/reserva/${b.code}`);
  const option = (await getServiceOptions(studio.slug, terms.service_id)).find((o) => o.professional_id === pro.data);
  if (!option) redirect(back);
  const tz = ctx.timezone;

  return (
    <BookingShell studio={studio} step={4} title="Confirmá el cambio" back={back}>
      <section aria-label="Antes y ahora" className="glass flex flex-col gap-3 rounded-[1.1rem] p-5 text-card-foreground">
        <span className="text-lg font-semibold">{b.service_name}</span>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Antes</dt>
          <dd><s className="text-muted-foreground">{formatDateTimeLong(b.starts_at, tz)} · {b.professional_name}</s></dd>
          <dt className="font-semibold">Ahora</dt>
          <dd className="font-semibold">{formatDateTimeLong(startsAt, tz)} · {option.display_name}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">Hora del estudio ({timezoneLabel(tz)}).</p>
      </section>

      <section
        aria-labelledby="consecuencia"
        className={`glass flex flex-col gap-2 rounded-[1.1rem] p-5 text-card-foreground ${terms.keeps_deposit ? "" : "!border-[#8d4d49]"}`}
      >
        <h2 id="consecuencia" className="font-semibold">{terms.keeps_deposit ? "Conservás la seña" : "Perdés la seña"}</h2>
        <p>{rescheduleConsequence(terms)}</p>
        {!terms.keeps_deposit && (
          <p className="text-sm text-muted-foreground">
            Si tenés saldo a favor, se usa para la seña nueva. Lo que falte se paga con Mercado Pago y el turno nuevo
            se confirma con el pago.
          </p>
        )}
        <p className="text-sm text-muted-foreground">Desde la web el turno se puede cambiar una sola vez.</p>
      </section>

      <TermsForm
        action={rescheduleMyBookingAction}
        fields={{ code: b.code, pro: option.professional_id, starts_at: startsAt.toISOString(), expected: rescheduleExpected(terms) }}
        submitLabel={terms.keeps_deposit ? "Cambiar el turno" : "Cambiar y pagar una seña nueva"}
        pendingText="Cambiando…"
        variant={terms.keeps_deposit ? "default" : "destructive"}
      />
      <Link href={`/reserva/${b.code}`} className={buttonVariants({ variant: "ghost", className: "h-11" })}>No, dejarlo como está</Link>
    </BookingShell>
  );
}
