import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/panel/panel-ui";
import { Button } from "@/components/ui/button";
import { can, requirePermission } from "@/lib/auth";
import { ymdIn } from "@/lib/booking-format";
import { loadCatalog } from "@/lib/catalog-data";
import { serverSupabase } from "@/lib/supabase/server";
import { ManualBookingForm } from "./manual-form";

export const metadata: Metadata = { title: "Turno manual" };

export default async function NewTurnoPage({ params, searchParams }: PageProps<"/sites/[site]/admin/turnos/nuevo">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(site, "agenda.manage", "/admin/turnos/nuevo");
  const catalog = await loadCatalog(ctx);

  // Búsqueda de clienta (por nombre, teléfono o email), con la RLS de clients.read.
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  let clients: { id: string; label: string }[] = [];
  if (q.length >= 2 && can(ctx, "clients.read")) {
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;
    const supabase = await serverSupabase();
    const { data } = await supabase
      .from("client_profiles")
      .select("id, full_name, phone, email")
      .eq("tenant_id", ctx.tenantId)
      .or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .order("full_name")
      .limit(20);
    clients = (data ?? []).map((c) => ({ id: c.id, label: [c.full_name, c.phone, c.email].filter(Boolean).join(" · ") }));
  }

  const services = catalog.services.filter((s) => !s.archived_at && s.is_active).map((s) => ({ id: s.id, name: s.name }));
  const professionals = catalog.professionals
    .filter((p) => !p.archived_at && p.is_active)
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      serviceIds: catalog.assignments.filter((a) => a.professional_id === p.id).map((a) => a.service_id),
    }));

  return (
    <>
      <Link href="/admin/turnos" className="text-sm text-foreground underline underline-offset-4">← Turnos</Link>
      <PageHeader title="Turno manual" description="Para cuando la clienta reserva por WhatsApp o por teléfono." />

      {can(ctx, "clients.read") && (
        <form className="flex items-end gap-2 glass rounded-[1.1rem] p-4">
          <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
            Buscar clienta
            <input name="q" defaultValue={q} placeholder="Nombre, teléfono o email" minLength={2}
              className="h-11 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base font-normal" />
          </label>
          <Button type="submit" variant="outline" className="h-11">Buscar</Button>
        </form>
      )}

      <div className="glass rounded-[1.1rem] p-5">
        <ManualBookingForm
          clients={clients}
          searched={q.length >= 2}
          services={services}
          professionals={professionals}
          canCharge={can(ctx, "cash.manage")}
          today={ymdIn(new Date(), ctx.studio.timezone)}
        />
      </div>
    </>
  );
}
