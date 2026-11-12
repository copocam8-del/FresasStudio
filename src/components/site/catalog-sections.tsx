import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { stepUrl } from "@/lib/booking-format";
import { catalogPhotoUrl } from "@/lib/catalog-photo";
import { formatPrice } from "@/lib/money";
import type { PublicCatalog } from "@/lib/studio";
import { formatDuration } from "@/lib/time";

/**
 * Catálogo y profesionales en el sitio del estudio (marca blanca). El botón
 * "Reservar" aparece solo si el estudio tiene las reservas online prendidas.
 */
export function CatalogSections({ catalog, bookingEnabled }: { catalog: PublicCatalog; bookingEnabled: boolean }) {
  const proName = (id: string) => catalog.professionals.find((p) => p.id === id)?.display_name;
  const groups = [
    ...catalog.categories.map((c) => ({ key: c.id, title: c.name, items: catalog.services.filter((s) => s.category_id === c.id) })),
    { key: "otros", title: "Otros servicios", items: catalog.services.filter((s) => !s.category_id) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      {groups.length > 0 && (
        <section aria-labelledby="servicios" className="flex flex-col gap-6">
          <h2 id="servicios" className="scroll-mt-6 font-serif text-3xl font-semibold text-foreground">
            Servicios
          </h2>
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-3">
              <h3 className="font-sans text-sm font-medium tracking-[0.14em] text-gold uppercase">{g.title}</h3>
              <ul className="glass flex flex-col divide-y divide-border rounded-[1.25rem]">
                {g.items.map((s) => {
                  const photo = catalogPhotoUrl(s.photo_path);
                  const who = s.professional_ids.map(proName).filter(Boolean);
                  return (
                    <li key={s.id} className="flex gap-4 p-4">
                      {photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="font-medium text-card-foreground">{s.name}</span>
                          <span className="font-semibold text-card-foreground">
                            {formatPrice(s.price_minor, s.price_is_from, catalog.currency)}
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">{formatDuration(s.duration_minutes)}</span>
                        {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                        {who.length > 0 && <p className="text-sm text-muted-foreground">Con {who.join(" o ")}</p>}
                        {bookingEnabled && who.length > 0 && (
                          <Link href={stepUrl(s.id)} className={buttonVariants({ size: "sm", className: "mt-1 h-10 w-fit px-4" })}>
                            Reservar
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {catalog.services.some((s) => s.price_is_from) && (
            <p className="text-sm text-muted-foreground">
              «Desde»: el precio final depende de la profesional o del trabajo, y se confirma al reservar.
            </p>
          )}
        </section>
      )}

      {catalog.professionals.length > 0 && (
        <section aria-labelledby="profesionales" className="flex flex-col gap-3">
          <h2 id="profesionales" className="font-serif text-3xl font-semibold text-foreground">
            Profesionales
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {catalog.professionals.map((p) => {
              const photo = catalogPhotoUrl(p.photo_path);
              const services = p.service_ids.map((id) => catalog.services.find((s) => s.id === id)?.name).filter(Boolean);
              return (
                <li key={p.id} className="glass flex gap-3 rounded-[1.25rem] p-4">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={`Foto de ${p.display_name}`} className="size-16 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-full bg-secondary text-xl font-semibold text-secondary-foreground">
                      {p.display_name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium text-card-foreground">{p.display_name}</span>
                    {p.bio && <p className="text-sm text-muted-foreground">{p.bio}</p>}
                    {services.length > 0 && <p className="text-sm text-muted-foreground">{services.join(" · ")}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
