import { CalendarDays, CalendarPlus, ChevronRight, MessageCircle, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BannerSilk, Sparkle } from "@/components/cleo/silk";
import { SiteChrome } from "@/components/cleo/site-chrome";
import { ActionTile, appointmentTone, GlassCard, StatusPill } from "@/components/cleo/ui";
import type { LucideIcon } from "lucide-react";
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

  // Accesos (2×2 como en la referencia), solo a secciones que existen.
  const tiles: { href: string; icon: LucideIcon; title: string; text: string }[] = [
    ...(bookingEnabled ? [{ href: "/reservar", icon: CalendarPlus, title: "Turnos", text: "Reservá tu turno" }] : []),
    { href: user ? "/mi-ficha" : "/ingresar?next=%2Fmi-ficha", icon: CalendarDays, title: "Mis turnos", text: user ? "Tus reservas" : "Ingresá para verlos" },
    ...(catalog && catalog.services.length > 0 ? [{ href: "#servicios", icon: Sparkles, title: "Servicios", text: "Precios y duración" }] : []),
    { href: user ? "/mi-ficha" : "/ingresar?next=%2Fmi-ficha", icon: UserRound, title: "Mis datos", text: user ? "Tu ficha" : "Ingresá con Google" },
    ...(contact.length > 0 ? [{ href: "#contacto", icon: MessageCircle, title: "Contacto", text: "Escribinos" }] : []),
  ].slice(0, 4);

  return (
    <SiteChrome studioName={studio.name} logoSrc={studioLogo(studio)} signedIn={Boolean(user)} bookingEnabled={bookingEnabled}>
      <section aria-labelledby="hola" className="relative -mt-1 flex flex-col gap-2">
        <Sparkle className="pointer-events-none absolute -top-5 right-[22%] size-[2.9rem] drop-shadow-[0_0_12px_rgb(240_215_200/0.4)]" />
        <h1 id="hola" className="font-sans text-[2.15rem] leading-tight font-semibold tracking-normal text-foreground">
          ¡Hola{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p className="flex items-center gap-2.5 text-[1.07rem] text-[#ece2db]">
          ¿Qué querés hacer hoy? <Sparkle className="size-[1.6rem]" />
        </p>
      </section>

      <nav aria-label="Accesos" className="grid grid-cols-2 gap-[0.85rem]">
        {tiles.map((t, i) => (
          <ActionTile key={t.href} href={t.href} icon={t.icon} title={t.title} text={t.text} sheen={(i % 4) as 0 | 1 | 2 | 3} />
        ))}
      </nav>

      {next && (
        <Link
          href={`/reserva/${next.code}`}
          className="glass relative flex min-h-[8.4rem] items-center overflow-hidden rounded-[1.4rem] p-5 pl-6 hover:brightness-110"
        >
          <BannerSilk />
          <span className="relative flex max-w-[62%] flex-col gap-1.5">
            <span className="text-sm tracking-[0.14em] text-[#e4d3c8] uppercase">Tu próximo turno</span>
            <span className="text-[1.45rem] leading-tight font-normal text-foreground">{next.service_name}</span>
            <span className="text-[0.92rem] text-[#e4d8d0]">
              {formatDateTimeLong(next.starts_at, studio.timezone)} · con {next.professional_name}
            </span>
            <StatusPill status={appointmentTone(next.status)} className="self-start">{STATUS[next.status]}</StatusPill>
          </span>
          <span className="absolute right-4 bottom-4 flex size-8 items-center justify-center rounded-full border border-[#5b4d48] bg-[#2a2324]/90">
            <ChevronRight aria-hidden strokeWidth={1.8} className="size-4" />
          </span>
        </Link>
      )}

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
