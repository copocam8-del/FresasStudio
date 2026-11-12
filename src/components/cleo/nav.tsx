"use client";

import {
  Ban, Building2, CalendarDays, CalendarPlus, Clock, CreditCard, Home, LogOut, Menu, Palette, Scissors,
  Settings2, UserRound, Users, Wallet, X, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";

/** Íconos por nombre (los componentes no se pueden pasar del servidor al cliente). */
const ICONS: Record<string, LucideIcon> = {
  home: Home, calendar: CalendarDays, book: CalendarPlus, user: UserRound, scissors: Scissors, users: Users,
  clock: Clock, ban: Ban, team: Building2, settings: Settings2, card: CreditCard, wallet: Wallet, palette: Palette,
};
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

function isActive(pathname: string, href: string, exact: boolean) {
  const path = href.split("#")[0].split("?")[0];
  return exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

/** Barra inferior de la clienta (celular). En pantallas anchas queda centrada y angosta. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const Icon = ICONS[it.icon];
          const active = isActive(pathname, it.href, it.href === "/");
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs",
                  active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden strokeWidth={active ? 1.9 : 1.5} className={cn("size-6", active && "text-primary")} />
                {it.label}
                {active && <span aria-hidden className="absolute bottom-1.5 h-0.5 w-10 rounded-full bg-primary" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Menú del panel: lateral fijo en escritorio; en el celular, un cajón que se abre con
 * el botón de menú. `header` es la marca del estudio (se renderiza en el servidor).
 */
export function PanelNav({
  items,
  header,
  footer,
}: {
  items: NavItem[];
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const list = (
    <ul className="flex flex-col gap-1">
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
                "flex min-h-11 items-center gap-3 rounded-full px-4 text-[0.95rem] transition-colors",
                active ? "champagne font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]" : "text-sidebar-foreground hover:bg-sidebar-accent",
              )}
            >
              <Icon aria-hidden strokeWidth={1.5} className={cn("size-5", !active && "text-gold")} />
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
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-2 backdrop-blur-xl lg:hidden">
        {header}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir el menú"
          aria-expanded={open}
          className="flex size-11 items-center justify-center rounded-full border border-border bg-card/60"
        >
          <Menu aria-hidden strokeWidth={1.5} className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar el menú" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col gap-6 overflow-y-auto border-r border-border bg-sidebar p-4">
            <div className="flex items-center justify-between gap-2">
              {header}
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar el menú"
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border">
                <X aria-hidden strokeWidth={1.5} className="size-5" />
              </button>
            </div>
            <nav aria-label="Secciones del panel">{list}</nav>
            <div className="mt-auto">{footer}</div>
          </div>
        </div>
      )}
      {/* Escritorio: menú lateral fijo con la marca arriba */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 overflow-y-auto border-r border-border bg-sidebar/80 px-4 py-6 backdrop-blur lg:flex">
        <div className="px-2">{header}</div>
        <nav aria-label="Secciones del panel">{list}</nav>
        <div className="mt-auto">{footer}</div>
      </aside>
    </>
  );
}

export function SignOutIcon() {
  return <LogOut aria-hidden strokeWidth={1.5} className="size-5 text-gold" />;
}
