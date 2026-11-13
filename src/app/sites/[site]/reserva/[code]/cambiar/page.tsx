import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingShell } from "@/components/site/booking-shell";
import { TimezoneNote } from "@/components/site/timezone-note";
import { getUser } from "@/lib/auth";
import { getAvailableDays, getAvailableSlots, getBookingContext, getServiceOptions, myBookingTerms, myBookings } from "@/lib/booking-data";
import { addDays, formatDayShort, formatTime, isYmd, timezoneLabel, ymdIn } from "@/lib/booking-format";
import { rescheduleConsequence } from "@/lib/booking-terms";
import { getStudio } from "@/lib/studio";
import { formatDuration } from "@/lib/time";

export const metadata: Metadata = { title: "Cambiar día u horario", robots: { index: false } };

const DAYS_PER_PAGE = 14;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Mismo servicio y mismo precio (C3): se elige profesional (por defecto la misma), día y
// horario. Los horarios salen de la base, igual que al reservar.
export default async function ChangeBooking({ params, searchParams }: PageProps<"/sites/[site]/reserva/[code]/cambiar">) {
  const { site, code } = await params;
  const sp = await searchParams;
  const studio = await getStudio(site);
  if (!studio || !/^[2-9A-HJKMNP-Z]{6}$/i.test(code)) notFound();
  if (!(await getUser())) redirect(`/ingresar?next=${encodeURIComponent(`/reserva/${code}/cambiar`)}`);

  const [ctx, bookings, terms] = await Promise.all([
    getBookingContext(studio.slug), myBookings(studio.slug), myBookingTerms(studio.slug, code),
  ]);
  const b = bookings.find((x) => x.code === code.toUpperCase());
  if (!b || !ctx || !terms) notFound();
  if (!terms.can_reschedule_online || !ctx.online_booking_enabled) redirect(`/reserva/${b.code}`);

  const options = await getServiceOptions(studio.slug, terms.service_id);
  const proParam = typeof sp.p === "string" && UUID.test(sp.p) ? sp.p : terms.professional_id;
  const chosen = options.find((o) => o.professional_id === proParam) ?? options[0];
  const base = `/reserva/${b.code}/cambiar`;
  if (!chosen) {
    return (
      <BookingShell studio={studio} step={3} title="Cambiar día u horario" back={`/reserva/${b.code}`}>
        <p className="text-foreground">Este servicio ya no se puede reservar online. Escribile al estudio para cambiar el turno.</p>
      </BookingShell>
    );
  }

  const tz = ctx.timezone;
  const today = ymdIn(new Date(), tz);
  const from = isYmd(sp.desde) && sp.desde >= today ? sp.desde : today;
  const days = await getAvailableDays(studio.slug, terms.service_id, chosen.professional_id, from, DAYS_PER_PAGE);
  const selected = isYmd(sp.dia) ? sp.dia : days.find((d) => d.slots > 0)?.day;
  const slots = selected ? await getAvailableSlots(studio.slug, terms.service_id, chosen.professional_id, selected) : [];
  const nextFrom = addDays(from, DAYS_PER_PAGE);
  const horizonEnd = addDays(today, ctx.booking_horizon_days);
  const url = (extra: Record<string, string>) =>
    `${base}?${new URLSearchParams({ p: chosen.professional_id, ...extra }).toString()}`;

  return (
    <BookingShell studio={studio} step={3} title="Cambiar día u horario" back={`/reserva/${b.code}`}>
      <p className="text-muted-foreground">{b.service_name} · {formatDuration(chosen.duration_minutes)}</p>
      <p
        className={`rounded-2xl border p-3.5 text-sm ${terms.keeps_deposit
          ? "border-border bg-[#1d1716]/85 text-foreground"
          : "border-[#8d4d49] bg-status-cancel/70 text-status-cancel-foreground"}`}
      >
        {rescheduleConsequence(terms)}
      </p>

      {options.length > 1 && (
        <nav aria-label="Profesional" className="flex flex-wrap gap-2">
          {options.map((o) => {
            const active = o.professional_id === chosen.professional_id;
            return (
              <Link
                key={o.professional_id}
                href={`${base}?${new URLSearchParams({ p: o.professional_id }).toString()}`}
                aria-current={active ? "true" : undefined}
                className={`flex min-h-11 items-center rounded-full border px-4 text-sm ${active
                  ? "champagne border-transparent font-semibold"
                  : "border-[#4a3f3c] bg-[#1a1516]/85 text-foreground hover:bg-[#241d1c]"}`}
              >
                {o.display_name}
              </Link>
            );
          })}
        </nav>
      )}
      <TimezoneNote timezone={tz} label={timezoneLabel(tz)} />

      <nav aria-label="Días" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d) => {
          const isSel = d.day === selected;
          const empty = d.slots === 0;
          return (
            <Link
              key={d.day}
              href={url({ dia: d.day, ...(from !== today ? { desde: from } : {}) })}
              aria-current={isSel ? "date" : undefined}
              aria-disabled={empty || undefined}
              tabIndex={empty ? -1 : undefined}
              className={`flex min-h-16 min-w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-2xl border px-2 text-sm ${
                isSel ? "champagne border-transparent font-semibold" : empty ? "pointer-events-none border-[#2b2321] bg-[#141010] text-foreground/40" : "border-[#4a3f3c] bg-[#1a1516]/85 text-foreground hover:bg-[#241d1c]"
              }`}
            >
              {formatDayShort(d.day)}
              <span className="sr-only">{empty ? " (sin lugar)" : ` (${d.slots} horarios)`}</span>
            </Link>
          );
        })}
        {nextFrom < horizonEnd && (
          <Link href={url({ desde: nextFrom })} className="flex min-h-14 shrink-0 items-center glass rounded-[1.1rem] px-3 text-sm text-card-foreground hover:bg-accent">
            Más días →
          </Link>
        )}
      </nav>

      {!selected ? (
        <p className="text-foreground">No hay horarios libres en estos días. Probá con «Más días» o con otra profesional.</p>
      ) : slots.length === 0 ? (
        <p className="text-foreground">Ese día no quedan horarios libres.</p>
      ) : (
        <section aria-labelledby="horarios" className="flex flex-col gap-2">
          <h2 id="horarios" className="text-sm font-medium tracking-[0.14em] text-[#e4d3c8] uppercase">{formatDayShort(selected)}</h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <li key={s}>
                <Link
                  href={`${base}/confirmar?${new URLSearchParams({ p: chosen.professional_id, t: s }).toString()}`}
                  className="flex h-12 items-center justify-center rounded-2xl border border-[#4a3f3c] bg-[#1a1516]/85 font-medium text-foreground tabular-nums hover:border-transparent hover:bg-[linear-gradient(180deg,#ead3c4,#c9ab98)] hover:text-[#1f140e]"
                >
                  {formatTime(s, tz)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BookingShell>
  );
}
