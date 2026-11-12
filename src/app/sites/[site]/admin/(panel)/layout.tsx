import type { Metadata } from "next";
import { StudioMark } from "@/components/cleo/brand";
import { PanelNav, SignOutIcon, type NavItem } from "@/components/cleo/nav";
import { SilkBackground } from "@/components/cleo/silk";
import { can, requireStaff } from "@/lib/auth";
import { studioLogo } from "@/lib/studio-brand";
import { signOutAction } from "../actions";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Panel del estudio (Cleo Manager, con la marca del estudio). Exige sesión y
 * membresía activa en ESTE estudio. Cada página y cada acción vuelve a verificar
 * sus permisos; este layout solo arma la navegación (solo secciones que existen, D6).
 */
export default async function PanelLayout({ children, params }: LayoutProps<"/sites/[site]/admin">) {
  const { site } = await params;
  const ctx = await requireStaff(site);

  const links: (NavItem & { show: boolean })[] = [
    { href: "/admin", label: "Inicio", icon: "home", show: true },
    { href: "/admin/turnos", label: "Turnos", icon: "calendar", show: can(ctx, "agenda.read_all") || can(ctx, "agenda.read_own") },
    { href: "/admin/servicios", label: "Servicios", icon: "scissors", show: true },
    { href: "/admin/profesionales", label: "Profesionales", icon: "users", show: true },
    { href: "/admin/horarios", label: "Horarios", icon: "clock", show: true },
    { href: "/admin/bloqueos", label: "Bloqueos", icon: "ban", show: true },
    { href: "/admin/equipo", label: "Equipo", icon: "team", show: can(ctx, "team.read") },
    { href: "/admin/reservas", label: "Reservas", icon: "settings", show: can(ctx, "settings.manage") },
    { href: "/admin/pagos", label: "Mercado Pago", icon: "card", show: can(ctx, "payments.manage") || can(ctx, "settings.manage") },
    { href: "/admin/pagos/movimientos", label: "Pagos", icon: "wallet", show: can(ctx, "cash.read") },
    { href: "/admin/marca", label: "Marca", icon: "palette", show: can(ctx, "settings.manage") },
  ];
  const items: NavItem[] = links.filter((l) => l.show).map(({ href, label, icon }) => ({ href, label, icon }));

  const header = <StudioMark name={ctx.studio.name} logoSrc={studioLogo(ctx.studio)} size="sm" />;
  const footer = (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <p className="px-4 text-sm text-muted-foreground">{ctx.roleName}</p>
      <form action={signOutAction}>
        <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-full px-4 text-[0.95rem] text-sidebar-foreground hover:bg-sidebar-accent">
          <SignOutIcon /> Cerrar sesión
        </button>
      </form>
    </div>
  );

  return (
    <div className="relative isolate flex flex-1 flex-col lg:flex-row">
      <SilkBackground variant="panel" />
      <PanelNav items={items} header={header} footer={footer} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
