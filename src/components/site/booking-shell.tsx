import { ChevronLeft, UserRound } from "lucide-react";
import Link from "next/link";
import { BrandCompact } from "@/components/cleo/brand";
import { BottomNav, type NavItem } from "@/components/cleo/nav";
import { SilkHero } from "@/components/cleo/silk";
import { getUser } from "@/lib/auth";
import { getBookingContext } from "@/lib/booking-data";
import type { PublicStudio } from "@/lib/studio";
import { studioBrand } from "@/lib/studio-brand";

const STEPS = ["Servicio", "Profesional", "Día y hora", "Confirmar"];

/**
 * Marco del flujo de reserva y del estado de la reserva, como la referencia
 * ("Reservá tu turno"): atrás, marca centrada, cuenta, pasos, título y barra inferior.
 */
export async function BookingShell({
  studio,
  step,
  title,
  subtitle,
  back,
  children,
}: {
  studio: PublicStudio;
  step: 1 | 2 | 3 | 4;
  title: string;
  subtitle?: string;
  back?: string;
  children: React.ReactNode;
}) {
  const [user, ctx] = await Promise.all([getUser(), getBookingContext(studio.slug)]);
  const items: NavItem[] = [
    { href: "/", label: "Inicio", icon: "home" },
    ...(ctx?.online_booking_enabled ? [{ href: "/reservar", label: "Reservar", icon: "book" } as NavItem] : []),
    { href: "/#servicios", label: "Servicios", icon: "sparkles" },
    { href: user ? "/mi-ficha" : "/ingresar?next=%2Fmi-ficha", label: "Mis turnos", icon: "calendar" },
  ];
  const circle = "flex size-11 shrink-0 items-center justify-center rounded-full border border-[#4a4040] bg-[#1a1617]/85 backdrop-blur";
  return (
    <div className="relative isolate flex flex-1 flex-col overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent)] opacity-80">
        <SilkHero />
      </div>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-[1.4rem] pt-7 pb-32">
        <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3">
          {back ? (
            <Link href={back} aria-label="Atrás" className={circle}>
              <ChevronLeft aria-hidden strokeWidth={1.6} className="size-5" />
            </Link>
          ) : <span />}
          <Link href="/" className="flex justify-center"><BrandCompact brand={studioBrand(studio)} /></Link>
          <Link href={user ? "/mi-ficha" : "/ingresar"} aria-label={user ? "Mi cuenta" : "Ingresar"} className={circle}>
            <UserRound aria-hidden strokeWidth={1.5} className="size-5" />
          </Link>
        </header>
        <div className="flex flex-col gap-1">
          <h1 className="font-sans text-[1.65rem] leading-tight font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-[0.98rem] text-[#e4d8d0]">{subtitle}</p>}
        </div>
        <ol aria-label="Pasos de la reserva" className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i + 1 === step ? "step" : undefined}
              className={`h-1 flex-1 rounded-full ${i + 1 <= step ? "bg-[linear-gradient(90deg,#ead3c4,#c9ab98)]" : "bg-[#2e2625]"}`}
            >
              <span className="sr-only">Paso {i + 1} de {STEPS.length}: {s}</span>
            </li>
          ))}
        </ol>
        {children}
      </main>
      <BottomNav items={items} />
    </div>
  );
}
