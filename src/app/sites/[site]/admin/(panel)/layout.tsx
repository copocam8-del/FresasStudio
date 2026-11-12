import type { Metadata } from "next";
import Link from "next/link";
import { StudioLogo } from "@/components/brand/studio-logo";
import { Button } from "@/components/ui/button";
import { can, requireStaff } from "@/lib/auth";
import { studioLogo } from "@/lib/studio-brand";
import { signOutAction } from "../actions";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Panel del estudio (Cleo Manager, con la marca del estudio). Exige sesión y
 * membresía activa en ESTE estudio. Cada página y cada acción vuelve a verificar
 * sus permisos; este layout solo arma la navegación.
 */
export default async function PanelLayout({ children, params }: LayoutProps<"/sites/[site]/admin">) {
  const { site } = await params;
  const ctx = await requireStaff(site);

  const links = [
    { href: "/admin", label: "Inicio", show: true },
    { href: "/admin/turnos", label: "Turnos", show: can(ctx, "agenda.read_all") || can(ctx, "agenda.read_own") },
    { href: "/admin/servicios", label: "Servicios", show: true },
    { href: "/admin/profesionales", label: "Profesionales", show: true },
    { href: "/admin/horarios", label: "Horarios", show: true },
    { href: "/admin/bloqueos", label: "Bloqueos", show: true },
    { href: "/admin/equipo", label: "Equipo", show: can(ctx, "team.read") },
    { href: "/admin/reservas", label: "Reservas", show: can(ctx, "settings.manage") },
    { href: "/admin/pagos", label: "Mercado Pago", show: can(ctx, "payments.manage") || can(ctx, "settings.manage") },
    { href: "/admin/pagos/movimientos", label: "Pagos", show: can(ctx, "cash.read") },
    { href: "/admin/marca", label: "Marca", show: can(ctx, "settings.manage") },
  ].filter((l) => l.show);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <StudioLogo src={studioLogo(ctx.studio)} name={ctx.studio.name} className="h-9" />
            <div className="flex flex-col">
              <span className="font-semibold text-card-foreground">{ctx.studio.name}</span>
              <span className="text-sm text-muted-foreground">{ctx.roleName}</span>
            </div>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm" className="h-9">
              Cerrar sesión
            </Button>
          </form>
        </div>
        <nav aria-label="Secciones del panel" className="mx-auto flex w-full max-w-4xl gap-1 overflow-x-auto px-2 pb-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  );
}
