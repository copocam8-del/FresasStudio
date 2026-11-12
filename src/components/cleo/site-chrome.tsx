import { UserRound } from "lucide-react";
import Link from "next/link";
import { StudioMark } from "@/components/cleo/brand";
import { BottomNav, type NavItem } from "@/components/cleo/nav";
import { SilkBackground } from "@/components/cleo/silk";

/**
 * Marco del sitio de un estudio para la clienta (celular primero): seda de fondo,
 * marca del estudio arriba con el acceso a su cuenta y barra de navegación abajo.
 * Solo secciones que existen (D6).
 */
export function SiteChrome({
  studioName,
  logoSrc,
  signedIn,
  bookingEnabled,
  children,
}: {
  studioName: string;
  logoSrc: string | null;
  signedIn: boolean;
  bookingEnabled: boolean;
  children: React.ReactNode;
}) {
  const items: NavItem[] = [
    { href: "/", label: "Inicio", icon: "home" },
    ...(bookingEnabled ? [{ href: "/reservar", label: "Reservar", icon: "book" } as NavItem] : []),
    { href: signedIn ? "/mi-ficha" : "/ingresar?next=%2Fmi-ficha", label: "Mis turnos", icon: "calendar" },
  ];
  return (
    <div className="relative isolate flex flex-1 flex-col">
      <SilkBackground />
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 pt-6">
        <Link href="/" className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
          <StudioMark name={studioName} logoSrc={logoSrc} size="md" />
        </Link>
        <Link
          href={signedIn ? "/mi-ficha" : "/ingresar"}
          aria-label={signedIn ? "Mi cuenta" : "Ingresar"}
          className="glass flex size-12 shrink-0 items-center justify-center rounded-full"
        >
          <UserRound aria-hidden strokeWidth={1.5} className="size-6 text-foreground" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-8 pb-28">{children}</main>
      <BottomNav items={items} />
    </div>
  );
}
