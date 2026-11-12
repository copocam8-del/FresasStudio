import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BookingShell } from "@/components/site/booking-shell";
import { TimezoneNote } from "@/components/site/timezone-note";
import { getAvailableDays, getAvailableSlots, getBookingContext, getServiceOptions } from "@/lib/booking-data";
import {
  addDays,
  confirmUrl,
  formatDayShort,
  formatTime,
  isYmd,
  parseProChoice,
  stepUrl,
  timezoneLabel,
  ymdIn,
} from "@/lib/booking-format";
import { catalogPhotoUrl } from "@/lib/catalog-photo";
import { formatMoney, formatPrice } from "@/lib/money";
import { getPublicCatalog, getStudio } from "@/lib/studio";
import { formatDuration } from "@/lib/time";

export const metadata: Metadata = { title: "Reservar" };

const DAYS_PER_PAGE = 14;

// Paso 2 (profesional) y paso 3 (día y horario), según los parámetros de la URL.
export default async function BookStep2and3({ params, searchParams }: PageProps<"/sites/[site]/reservar/[service]">) {
  const { site, service: serviceParam } = await params;
  const sp = await searchParams;
  const studio = await getStudio(site);
  if (!studio) notFound();
  const serviceId = z.uuid().safeParse(serviceParam);
  if (!serviceId.success) notFound();

  const [ctx, catalog] = await Promise.all([getBookingContext(studio.slug), getPublicCatalog(studio.slug)]);
  if (!ctx?.online_booking_enabled) redirect("/reservar");
  const service = catalog?.services.find((s) => s.id === serviceId.data);
  if (!service) notFound();

  const options = await getServiceOptions(studio.slug, service.id);
  const pro = parseProChoice(sp.p);

  // ---- Paso 2: profesional --------------------------------------------
  if (!pro) {
    const minPrice = Math.min(...options.map((o) => o.price_minor));
    const varies = new Set(options.map((o) => o.price_minor)).size > 1;
    return (
      <BookingShell studio={studio} step={2} title="¿Con quién?" back="/reservar">
        <p className="text-muted-foreground">{service.name}</p>
        {options.length === 0 ? (
          <p className="text-foreground">Por ahora nadie atiende este servicio online.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.length > 1 && (
              <li>
                <Link href={stepUrl(service.id, { pro: "any" })} className="glass flex min-h-16 items-center justify-between gap-3 rounded-[1.1rem] !border-[#d7baaa]/70 p-4 hover:brightness-110">
                  <span className="flex flex-col">
                    <span className="font-medium text-card-foreground">Cualquiera disponible</span>
                    <span className="text-sm text-muted-foreground">Te mostramos todos los horarios libres</span>
                  </span>
                  <span className="font-semibold text-card-foreground">{formatPrice(minPrice, varies || service.price_is_from, ctx.currency)}</span>
                </Link>
              </li>
            )}
            {options.map((o) => {
              const photo = catalogPhotoUrl(o.photo_path);
              return (
                <li key={o.professional_id}>
                  <Link href={stepUrl(service.id, { pro: o.professional_id })} className="flex min-h-14 items-center gap-3 glass rounded-[1.1rem] p-4 hover:bg-accent">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" className="size-11 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground">
                        {o.display_name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="flex flex-1 flex-col">
                      <span className="font-medium text-card-foreground">{o.display_name}</span>
                      <span className="text-sm text-muted-foreground">{formatDuration(o.duration_minutes)}</span>
                    </span>
                    <span className="font-semibold text-card-foreground">{formatPrice(o.price_minor, service.price_is_from, ctx.currency)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </BookingShell>
    );
  }

  // ---- Paso 3: día y horario --------------------------------------------
  const proId = pro === "any" ? null : pro;
  const chosen = options.find((o) => o.professional_id === proId);
  if (proId && !chosen) notFound();

  const today = ymdIn(new Date(), ctx.timezone);
  const from = isYmd(sp.desde) && sp.desde >= today ? sp.desde : today;
  const days = await getAvailableDays(studio.slug, service.id, proId, from, DAYS_PER_PAGE);
  const selected = isYmd(sp.dia) ? sp.dia : days.find((d) => d.slots > 0)?.day;
  const slots = selected ? await getAvailableSlots(studio.slug, service.id, proId, selected) : [];
  const horizonEnd = addDays(today, ctx.booking_horizon_days);
  const nextFrom = addDays(from, DAYS_PER_PAGE);
  const withFrom = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ p: pro, ...extra });
    if (from !== today) q.set("desde", from);
    return `/reservar/${service.id}?${q.toString()}`;
  };

  return (
    <BookingShell studio={studio} step={3} title="Elegí día y horario" back={stepUrl(service.id)}>
      <p className="text-muted-foreground">
        {service.name} · {chosen ? chosen.display_name : "Cualquiera disponible"}
      </p>
      <TimezoneNote timezone={ctx.timezone} label={timezoneLabel(ctx.timezone)} />

      <nav aria-label="Días" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d) => {
          const isSel = d.day === selected;
          const empty = d.slots === 0;
          return (
            <Link
              key={d.day}
              href={withFrom({ dia: d.day })}
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
          <Link href={`/reservar/${service.id}?${new URLSearchParams({ p: pro, desde: nextFrom }).toString()}`}
            className="flex min-h-14 shrink-0 items-center glass rounded-[1.1rem] px-3 text-sm text-card-foreground hover:bg-accent">
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
          <h2 id="horarios" className="text-sm font-medium tracking-[0.14em] text-[#e4d3c8] uppercase">
            {formatDayShort(selected)}
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <li key={s}>
                <Link href={confirmUrl(service.id, pro, s)}
                  className="flex h-12 items-center justify-center rounded-2xl border border-[#4a3f3c] bg-[#1a1516]/85 font-medium text-foreground tabular-nums hover:border-transparent hover:bg-[linear-gradient(180deg,#ead3c4,#c9ab98)] hover:text-[#1f140e]">
                  {formatTime(s, ctx.timezone)}
                </Link>
              </li>
            ))}
          </ul>
          {chosen && (
            <p className="text-sm text-muted-foreground">
              {formatDuration(chosen.duration_minutes)} · {formatPrice(chosen.price_minor, service.price_is_from, ctx.currency)} · seña {formatMoney(chosen.deposit_minor, ctx.currency)}
            </p>
          )}
        </section>
      )}
    </BookingShell>
  );
}
