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
                <Link href={stepUrl(service.id, { pro: "any" })} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-primary bg-card p-4 hover:bg-accent">
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
                  <Link href={stepUrl(service.id, { pro: o.professional_id })} className="flex min-h-14 items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent">
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
              className={`flex min-h-14 min-w-16 shrink-0 flex-col items-center justify-center rounded-xl border px-2 text-sm ${
                isSel ? "border-primary bg-primary text-primary-foreground" : empty ? "pointer-events-none bg-muted text-muted-foreground opacity-60" : "bg-card text-card-foreground hover:bg-accent"
              }`}
            >
              {formatDayShort(d.day)}
              <span className="sr-only">{empty ? " (sin lugar)" : ` (${d.slots} horarios)`}</span>
            </Link>
          );
        })}
        {nextFrom < horizonEnd && (
          <Link href={`/reservar/${service.id}?${new URLSearchParams({ p: pro, desde: nextFrom }).toString()}`}
            className="flex min-h-14 shrink-0 items-center rounded-xl border bg-card px-3 text-sm text-card-foreground hover:bg-accent">
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
          <h2 id="horarios" className="font-semibold text-foreground">
            {formatDayShort(selected)}
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <li key={s}>
                <Link href={confirmUrl(service.id, pro, s)}
                  className="flex h-12 items-center justify-center rounded-lg border bg-card font-medium text-card-foreground hover:bg-accent">
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
