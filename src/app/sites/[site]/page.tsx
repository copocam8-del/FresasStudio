import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getBookingContext } from "@/lib/booking-data";
import { StudioLogo } from "@/components/brand/studio-logo";
import { CatalogSections } from "@/components/site/catalog-sections";
import { contactItems } from "@/lib/contact";
import { getPublicCatalog, getStudio } from "@/lib/studio";
import { studioLogo } from "@/lib/studio-brand";

// Página pública de un estudio. Todos los datos son reales (get_public_studio y
// get_public_catalog).
export default async function StudioHome({ params }: PageProps<"/sites/[site]">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const contact = contactItems(studio.contact);
  const [user, catalog, booking] = await Promise.all([getUser(), getPublicCatalog(studio.slug), getBookingContext(studio.slug)]);
  const bookingEnabled = Boolean(booking?.online_booking_enabled);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-12">
      <nav aria-label="Cuenta" className="flex justify-end">
        <Link
          href={user ? "/mi-ficha" : "/ingresar"}
          className="rounded-lg border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {user ? "Mis datos" : "Ingresar"}
        </Link>
      </nav>
      <header className="flex flex-col gap-3">
        <StudioLogo src={studioLogo(studio)} name={studio.name} className="h-16 self-start" />
        <div className="h-px w-12 bg-gold" aria-hidden />
        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">{studio.name}</h1>
        {studio.description && (
          <p className="whitespace-pre-line text-lg text-muted-foreground">{studio.description}</p>
        )}
        {bookingEnabled && (
          <Link href="/reservar" className={buttonVariants({ size: "lg", className: "mt-2 h-12 w-fit px-6 text-base" })}>
            Reservar turno
          </Link>
        )}
      </header>

      {catalog && <CatalogSections catalog={catalog} bookingEnabled={bookingEnabled} />}

      {contact.length > 0 && (
        <section aria-labelledby="contacto" className="flex flex-col gap-3">
          <h2 id="contacto" className="text-xl font-semibold text-foreground">
            Contacto
          </h2>
          <ul className="flex flex-col gap-2">
            {contact.map((item) => (
              <li key={item.key} className="flex flex-col sm:flex-row sm:gap-2">
                <span className="text-sm text-muted-foreground sm:w-28">{item.label}</span>
                {item.href ? (
                  <a
                    href={item.href}
                    className="text-foreground underline underline-offset-4"
                    rel="noopener noreferrer"
                    target={item.href.startsWith("https://") ? "_blank" : undefined}
                  >
                    {item.value}
                  </a>
                ) : (
                  <span className="text-foreground">{item.value}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="politicas" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h2 id="politicas" className="text-xl font-semibold text-card-foreground">
          Seña y cancelaciones
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-card-foreground">
          <li>Para reservar se abona una seña del {studio.deposit_percent}% del total.</li>
          <li>
            Si cancelás o reprogramás con {studio.cancellation_window_hours} horas o más de
            anticipación, conservás la seña.
          </li>
          <li>Con menos anticipación, la seña se pierde.</li>
        </ul>
        {studio.policy_text && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{studio.policy_text}</p>
        )}
      </section>
    </main>
  );
}
