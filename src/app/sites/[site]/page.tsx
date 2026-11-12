import { CalendarDays, CalendarPlus, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CleoEmblem } from "@/components/cleo/brand";
import { SiteChrome } from "@/components/cleo/site-chrome";
import { ActionTile, appointmentTone, GlassCard, StatusPill } from "@/components/cleo/ui";
import { CatalogSections } from "@/components/site/catalog-sections";
import { buttonVariants } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getBookingContext, myNextBooking } from "@/lib/booking-data";
import { formatDateTimeLong } from "@/lib/booking-format";
import { contactItems } from "@/lib/contact";
import { getPublicCatalog, getStudio } from "@/lib/studio";
import { studioLogo } from "@/lib/studio-brand";

const STATUS: Record<string, string> = { confirmed: "Confirmado", pending_payment: "Pendiente de pago" };

// Página pública de un estudio. Todos los datos son reales (get_public_studio,
// get_public_catalog y, con sesión, las reservas de la propia clienta).
export default async function StudioHome({ params }: PageProps<"/sites/[site]">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const contact = contactItems(studio.contact);
  const [user, catalog, booking] = await Promise.all([getUser(), getPublicCatalog(studio.slug), getBookingContext(studio.slug)]);
  const bookingEnabled = Boolean(booking?.online_booking_enabled);
  const firstName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.split(" ")[0] : null;

  // Próximo turno de la clienta (solo si tiene sesión y uno activo).
  const next = user ? await myNextBooking(studio.slug) : null;

  return (
    <SiteChrome studioName={studio.name} logoSrc={studioLogo(studio)} signedIn={Boolean(user)} bookingEnabled={bookingEnabled}>
      <section aria-labelledby="hola" className="flex flex-col gap-2">
        <h1 id="hola" className="font-serif text-[2.75rem] leading-none font-semibold text-foreground">
          ¡Hola{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p className="flex items-center gap-2 text-lg text-muted-foreground">
          ¿Qué querés hacer hoy? <CleoEmblem className="size-4" />
        </p>
      </section>

      {next && (
        <GlassCard title="Tu próximo turno" icon={CalendarDays}>
          <Link href={`/reserva/${next.code}`} className="-m-2 flex items-center justify-between gap-3 rounded-xl p-2 hover:bg-accent/60">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-foreground">{next.service_name}</span>
              <span className="text-sm text-muted-foreground">
                {formatDateTimeLong(next.starts_at, studio.timezone)} · con {next.professional_name}
              </span>
            </span>
            <StatusPill status={appointmentTone(next.status)}>{STATUS[next.status]}</StatusPill>
          </Link>
        </GlassCard>
      )}

      <nav aria-label="Accesos" className="grid grid-cols-2 gap-3">
        {bookingEnabled && <ActionTile href="/reservar" icon={CalendarPlus} title="Reservar" text="Elegí servicio y horario" />}
        <ActionTile
          href={user ? "/mi-ficha" : "/ingresar?next=%2Fmi-ficha"}
          icon={CalendarDays}
          title="Mis turnos"
          text={user ? "Consultá tus reservas" : "Ingresá para verlos"}
        />
        {catalog && catalog.services.length > 0 && (
          <ActionTile href="#servicios" icon={Sparkles} title="Servicios" text="Precios y duración" />
        )}
        {contact.length > 0 && <ActionTile href="#contacto" icon={MessageCircle} title="Contacto" text="Escribinos o visitanos" />}
      </nav>

      {studio.description && (
        <GlassCard>
          <p className="whitespace-pre-line text-foreground">{studio.description}</p>
          {bookingEnabled && (
            <Link href="/reservar" className={buttonVariants({ size: "lg", className: "self-start" })}>
              Reservar turno
            </Link>
          )}
        </GlassCard>
      )}

      {catalog && <CatalogSections catalog={catalog} bookingEnabled={bookingEnabled} />}

      {contact.length > 0 && (
        <GlassCard title="Contacto" icon={MessageCircle} anchor="contacto">
          <ul className="flex flex-col gap-3">
            {contact.map((item) => (
              <li key={item.key} className="flex flex-col">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                {item.href ? (
                  <a
                    href={item.href}
                    className="text-foreground underline decoration-gold/60 underline-offset-4"
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
        </GlassCard>
      )}

      <GlassCard title="Seña y cancelaciones">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-card-foreground marker:text-gold">
          <li>Para reservar se abona una seña del {studio.deposit_percent}% del total.</li>
          <li>
            Si cancelás o reprogramás con {studio.cancellation_window_hours} horas o más de anticipación, conservás la seña.
          </li>
          <li>Con menos anticipación, la seña se pierde.</li>
        </ul>
        {studio.policy_text && <p className="whitespace-pre-line text-sm text-muted-foreground">{studio.policy_text}</p>}
      </GlassCard>
    </SiteChrome>
  );
}
