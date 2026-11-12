"use client";

import {
  Ban, Building2, CalendarDays, CalendarPlus, Clock, CreditCard, House, LogOut, Menu, Palette, Scissors,
  Settings2, Sparkles, UserRound, Users, Wallet, X, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";
import { SilkSidebar } from "@/components/cleo/silk";

/** Íconos por nombre (los componentes no se pueden pasar del servidor al cliente). */
const ICONS: Record<string, LucideIcon> = {
  home: House, calendar: CalendarDays, book: CalendarPlus, user: UserRound, scissors: Scissors, users: Users,
  clock: Clock, ban: Ban, team: Building2, settings: Settings2, card: CreditCard, wallet: Wallet, palette: Palette,
  sparkles: Sparkles,
};
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

function isActive(pathname: string, href: string, exact: boolean) {
  if (href.includes("#")) return false; // los anclas no son "la página actual"
  const path = href.split("?")[0];
  return exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Barra inferior de la clienta (celular), como la de la referencia: panel con esquinas
 * superiores redondeadas, ícono activo relleno en champagne y raya debajo del texto.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-[2.2rem] border-t border-[#2c2526] bg-[linear-gradient(180deg,#171314,#0f0c0d)] pb-[max(env(safe-area-inset-bottom),0.6rem)] shadow-[0_-12px_30px_-10px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_240_230/0.05)]"
    >
      <ul className="mx-auto grid max-w-md px-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const Icon = ICONS[it.icon];
          const active = isActive(pathname, it.href, it.href === "/");
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[4.6rem] flex-col items-center justify-center gap-1.5 pt-1 text-[0.84rem]",
                  active ? "font-semibold text-foreground" : "text-foreground/85 hover:text-foreground",
                )}
              >
                <Icon
                  aria-hidden
                  strokeWidth={active ? 1.6 : 1.4}
                  className={cn("size-[1.7rem]", active ? "text-[#ead6c8]" : "text-foreground")}
                  fill={active ? "currentColor" : "none"}
                  fillOpacity={active ? 0.95 : 0}
                />
                {it.label}
                <span aria-hidden className={cn("absolute bottom-0.5 h-[3px] w-16 rounded-full", active ? "bg-[#ead6c8]" : "bg-transparent")} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Menú del panel como el de la referencia: lateral de 236 px, marrón con seda brillante,
 * marca grande arriba, ítem activo en champagne. En el celular, un cajón.
 */
export function PanelNav({
  items,
  brand,
  brandCompact,
  footer,
}: {
  items: NavItem[];
  brand: React.ReactNode;
  brandCompact: React.ReactNode;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const list = (
    <ul className="flex flex-col gap-[0.3rem]">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = isActive(pathname, it.href, it.href === "/admin");
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={cn(
                "flex min-h-[3.4rem] items-center gap-4 rounded-[0.9rem] px-[1.4rem] text-[0.95rem] transition-colors",
                active ? "champagne-x font-medium" : "text-sidebar-foreground hover:bg-white/5",
              )}
            >
              <Icon aria-hidden strokeWidth={1.4} className="size-[1.6rem] shrink-0" />
              {it.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {/* Celular: barra superior con la marca y el botón de menú */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-sidebar-border bg-background/90 px-4 py-2.5 backdrop-blur-xl lg:hidden">
        {brandCompact}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir el menú"
          aria-expanded={open}
          className="glass flex size-11 items-center justify-center rounded-full"
        >
          <Menu aria-hidden strokeWidth={1.5} className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar el menú" className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-[17rem] flex-col gap-6 overflow-y-auto border-r border-sidebar-border bg-[linear-gradient(180deg,#1d1716,#141010)] p-4">
            <SilkSidebar />
            <div className="relative flex items-start justify-between gap-2">
              {brandCompact}
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar el menú"
                className="glass flex size-11 shrink-0 items-center justify-center rounded-full">
                <X aria-hidden strokeWidth={1.5} className="size-5" />
              </button>
            </div>
            <nav aria-label="Secciones del panel" className="relative">{list}</nav>
            <div className="relative mt-auto">{footer}</div>
          </div>
        </div>
      )}
      {/* Escritorio: menú lateral fijo */}
      <aside className="sticky top-0 hidden h-dvh w-[14.75rem] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-[linear-gradient(180deg,#1d1716,#151111_45%,#171211)] lg:flex">
        <SilkSidebar />
        <div className="relative flex justify-center px-4 pt-14 pb-10">{brand}</div>
        <nav aria-label="Secciones del panel" className="relative overflow-y-auto px-[1.2rem]">{list}</nav>
        <div className="relative mt-auto px-[1.2rem] pb-12">{footer}</div>
      </aside>
    </>
  );
}

export function SignOutIcon() {
  return <LogOut aria-hidden strokeWidth={1.4} className="size-[1.4rem]" />;
}
