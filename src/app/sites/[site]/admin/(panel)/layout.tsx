import type { Metadata } from "next";
import { BrandCompact, BrandLarge } from "@/components/cleo/brand";
import { PanelNav, SignOutIcon, type NavItem } from "@/components/cleo/nav";
import { SilkPanelTop } from "@/components/cleo/silk";
import { InitialsAvatar } from "@/components/cleo/ui";
import { can, requireStaff } from "@/lib/auth";
import { studioBrand } from "@/lib/studio-brand";
import { serverSupabase } from "@/lib/supabase/server";
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
  const supabase = await serverSupabase();
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle();
  const personName = profile?.full_name || ctx.user.email || "";

  const links: (NavItem & { show: boolean })[] = [
    { href: "/admin", label: "Inicio", icon: "home", show: true },
    { href: "/admin/agenda", label: "Agenda", icon: "calendar", show: can(ctx, "agenda.read_all") || can(ctx, "agenda.read_own") },
    { href: "/admin/clientas", label: "Clientas", icon: "contact", show: can(ctx, "clients.read") || can(ctx, "clients.read_own") },
    { href: "/admin/asistencia", label: "Asistencia", icon: "chart", show: can(ctx, "reports.read") },
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
  const brand = studioBrand(ctx.studio);

  const footer = (
    <form action={signOutAction}>
      <button type="submit" className="flex min-h-11 w-full items-center gap-4 rounded-[0.9rem] px-[1.4rem] text-[0.9rem] text-sidebar-foreground hover:bg-white/5">
        <SignOutIcon /> Cerrar sesión
      </button>
    </form>
  );

  return (
    <div className="relative isolate flex flex-1 flex-col lg:flex-row">
      <PanelNav
        items={items}
        brand={<BrandLarge brand={brand} align="center" sizeClass="text-[2.6rem] max-w-[11.5rem]" />}
        brandCompact={<BrandCompact brand={brand} />}
        footer={footer}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <SilkPanelTop className="-z-10 hidden lg:block" />
        <header className="hidden h-[5.6rem] items-center justify-end gap-3 border-b border-[#2a2220] px-10 lg:flex">
          <InitialsAvatar name={personName} className="size-[2.4rem] border-0 bg-[linear-gradient(180deg,#e2c8b8,#b8998a)] text-[#2a1b12]" />
          <span className="flex flex-col leading-tight">
            <span className="text-[0.95rem] text-foreground">{personName}</span>
            <span className="text-xs text-muted-foreground">{ctx.roleName}</span>
          </span>
        </header>
        <main className="mx-auto flex w-full max-w-[82rem] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
