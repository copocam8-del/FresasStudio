import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingShell } from "@/components/site/booking-shell";
import { TermsForm } from "@/components/site/terms-form";
import { buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getBookingContext, myBookingTerms, myBookings } from "@/lib/booking-data";
import { formatDateTimeLong, timezoneLabel } from "@/lib/booking-format";
import { cancelConsequence, cancelExpected, formatDeadline } from "@/lib/booking-terms";
import { getStudio } from "@/lib/studio";
import { cancelMyBookingAction } from "../../../reservar/actions";

export const metadata: Metadata = { title: "Cancelar turno", robots: { index: false } };

// La consecuencia (conserva o pierde la seña) la calcula la base; acá se muestra tal cual
// y se manda de vuelta: si cambió mientras la clienta miraba, la base no hace nada.
export default async function CancelBooking({ params }: PageProps<"/sites/[site]/reserva/[code]/cancelar">) {
  const { site, code } = await params;
  const studio = await getStudio(site);
  if (!studio || !/^[2-9A-HJKMNP-Z]{6}$/i.test(code)) notFound();
  if (!(await getUser())) redirect(`/ingresar?next=${encodeURIComponent(`/reserva/${code}/cancelar`)}`);

  const [ctx, bookings, terms] = await Promise.all([
    getBookingContext(studio.slug), myBookings(studio.slug), myBookingTerms(studio.slug, code),
  ]);
  const b = bookings.find((x) => x.code === code.toUpperCase());
  if (!b || !ctx || !terms) notFound();
  if (!terms.can_cancel) redirect(`/reserva/${b.code}`);
  const tz = ctx.timezone;

  return (
    <BookingShell studio={studio} step={4} title="¿Cancelar el turno?" back={`/reserva/${b.code}`}>
      <section aria-label="Turno" className="glass flex flex-col gap-1 rounded-[1.1rem] p-5 text-card-foreground">
        <span className="text-lg font-semibold">{b.service_name}</span>
        <span>con {b.professional_name}</span>
        <span>{formatDateTimeLong(b.starts_at, tz)} ({timezoneLabel(tz)})</span>
      </section>

      <section
        aria-labelledby="consecuencia"
        className={`glass flex flex-col gap-2 rounded-[1.1rem] p-5 text-card-foreground ${terms.keeps_deposit ? "" : "!border-[#8d4d49]"}`}
      >
        <h2 id="consecuencia" className="font-semibold">{terms.keeps_deposit ? "Conservás la seña" : "Perdés la seña"}</h2>
        <p>{cancelConsequence(terms)}</p>
        {terms.keeps_deposit && (
          <p className="text-sm text-muted-foreground">
            El plazo para conservarla es hasta el {formatDeadline(terms.deadline, tz)}. El saldo a favor se usa solo en tu
            próxima reserva en {studio.name} y tiene vencimiento.
          </p>
        )}
      </section>

      <TermsForm
        action={cancelMyBookingAction}
        fields={{ code: b.code, expected: cancelExpected(terms) }}
        submitLabel={terms.keeps_deposit ? "Cancelar y pasar la seña a mi saldo" : "Cancelar igual y perder la seña"}
        pendingText="Cancelando…"
        variant={terms.keeps_deposit ? "default" : "destructive"}
      />
      {terms.can_reschedule_online && (
        <Link href={`/reserva/${b.code}/cambiar`} className={buttonVariants({ variant: "outline", className: "h-11" })}>
          Mejor cambiar el día
        </Link>
      )}
      <Link href={`/reserva/${b.code}`} className={buttonVariants({ variant: "ghost", className: "h-11" })}>No, volver</Link>
    </BookingShell>
  );
}
