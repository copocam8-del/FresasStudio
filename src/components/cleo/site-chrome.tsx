import { UserRound } from "lucide-react";
import Link from "next/link";
import { BrandLarge, type BrandInfo } from "@/components/cleo/brand";
import { BottomNav, type NavItem } from "@/components/cleo/nav";
import { SilkHero } from "@/components/cleo/silk";

/**
 * Marco del sitio de un estudio para la clienta (celular primero), como la referencia:
 * seda brillante arriba a la derecha, marca (Cleo o la propia del estudio), botón de cuenta y barra
 * de navegación abajo. Solo secciones que existen (D6).
 */
export function SiteChrome({
  brand,
  signedIn,
  bookingEnabled,
  hasServices,
  children,
}: {
  brand: BrandInfo;
  signedIn: boolean;
  bookingEnabled: boolean;
  hasServices: boolean;
  children: React.ReactNode;
}) {
  const items: NavItem[] = [
    { href: "/", label: "Inicio", icon: "home" },
    ...(bookingEnabled ? [{ href: "/reservar", label: "Reservar", icon: "book" } as NavItem] : []),
    ...(hasServices ? [{ href: "/#servicios", label: "Servicios", icon: "sparkles" } as NavItem] : []),
    { href: signedIn ? "/mi-ficha" : "/ingresar?next=%2Fmi-ficha", label: "Mis turnos", icon: "calendar" },
  ];
  return (
    <div className="relative isolate flex flex-1 flex-col overflow-x-clip bg-[radial-gradient(120%_60%_at_50%_0%,#151112,transparent_70%)]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent)]">
        <SilkHero />
      </div>
      <header className="mx-auto flex w-full max-w-2xl items-start justify-between gap-3 px-[1.4rem] pt-7">
        <Link href="/" className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
          <BrandLarge brand={brand} />
        </Link>
        <Link
          href={signedIn ? "/mi-ficha" : "/ingresar"}
          aria-label={signedIn ? "Mi cuenta" : "Ingresar"}
          className="mt-9 flex size-[2.9rem] shrink-0 items-center justify-center rounded-full border border-[#4a4040] bg-[#1a1617]/85 shadow-[inset_0_1px_0_rgb(255_240_230/0.08)] backdrop-blur"
        >
          <UserRound aria-hidden strokeWidth={1.5} className="size-6 text-foreground" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-7 px-[1.4rem] pt-8 pb-32">{children}</main>
      <BottomNav items={items} />
    </div>
  );
}
