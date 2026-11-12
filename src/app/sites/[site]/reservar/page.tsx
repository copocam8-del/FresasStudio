import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingShell } from "@/components/site/booking-shell";
import { buttonVariants } from "@/components/ui/button";
import { getBookingContext } from "@/lib/booking-data";
import { stepUrl } from "@/lib/booking-format";
import { formatPrice } from "@/lib/money";
import { getPublicCatalog, getStudio } from "@/lib/studio";
import { formatDuration } from "@/lib/time";

export const metadata: Metadata = { title: "Reservar" };

// Paso 1: elegir servicio.
export default async function BookStep1({ params }: PageProps<"/sites/[site]/reservar">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();
  const [ctx, catalog] = await Promise.all([getBookingContext(studio.slug), getPublicCatalog(studio.slug)]);

  if (!ctx?.online_booking_enabled || !catalog) {
    return (
      <BookingShell studio={studio} step={1} title="Reservar">
        <p className="text-foreground">
          Las reservas online todavía no están disponibles. Escribinos y te damos un turno.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "h-11" })}>
          Volver
        </Link>
      </BookingShell>
    );
  }

  const groups = [
    ...catalog.categories.map((c) => ({ key: c.id, title: c.name, items: catalog.services.filter((s) => s.category_id === c.id) })),
    { key: "otros", title: "Otros servicios", items: catalog.services.filter((s) => !s.category_id) },
  ].filter((g) => g.items.length > 0);

  return (
    <BookingShell studio={studio} step={1} title="¿Qué te querés hacer?">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`} className="flex flex-col gap-2">
          <h2 id={`g-${g.key}`} className="text-sm font-medium tracking-[0.14em] text-[#e4d3c8] uppercase">
            {g.title}
          </h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((s) => (
              <li key={s.id}>
                <Link
                  href={stepUrl(s.id)}
                  className="flex min-h-14 items-center justify-between gap-3 glass rounded-[1.1rem] p-4 hover:bg-accent"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-card-foreground">{s.name}</span>
                    <span className="text-sm text-muted-foreground">{formatDuration(s.duration_minutes)}</span>
                  </span>
                  <span className="font-semibold text-card-foreground">{formatPrice(s.price_minor, s.price_is_from, catalog.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </BookingShell>
  );
}
