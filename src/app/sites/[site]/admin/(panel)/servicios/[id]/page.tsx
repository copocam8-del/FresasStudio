import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/panel/panel-ui";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { loadCatalog, studioDepositPercent } from "@/lib/catalog-data";
import { catalogPhotoUrl } from "@/lib/catalog-photo";
import { setServiceFlagAction } from "../actions";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "Editar servicio" };

export default async function EditServicePage({ params }: PageProps<"/sites/[site]/admin/servicios/[id]">) {
  const { site, id } = await params;
  const ctx = await requirePermission(site, "services.manage", `/admin/servicios/${id}`);
  const [{ categories, services, professionals, assignments }, deposit] = await Promise.all([loadCatalog(ctx), studioDepositPercent(ctx)]);
  const service = services.find((s) => s.id === id);
  if (!service) notFound();

  const who = assignments
    .filter((a) => a.service_id === id)
    .map((a) => professionals.find((p) => p.id === a.professional_id)?.display_name)
    .filter(Boolean);

  return (
    <>
      <PageHeader
        title={service.name}
        description={who.length ? `Lo hacen: ${who.join(", ")}. Se asigna desde cada profesional.` : "Ninguna profesional lo tiene asignado: se asigna desde Profesionales."}
      />
      <div className="rounded-xl border bg-card p-5">
        <ServiceForm
          initial={service}
          categories={categories.filter((c) => c.is_active || c.id === service.category_id)}
          studioDeposit={deposit}
          currency={ctx.studio.currency}
          photoUrl={catalogPhotoUrl(service.photo_path)}
        />
      </div>
      {!service.archived_at && (
        <form action={setServiceFlagAction} className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-card p-5">
          <input type="hidden" name="id" value={service.id} />
          <input type="hidden" name="action" value="archive" />
          <p className="text-sm text-muted-foreground">
            Archivar lo saca del panel y del sitio. No se borra: los turnos que lo usen lo conservan y se puede restaurar.
          </p>
          <Button type="submit" variant="destructive" className="h-11">
            Archivar servicio
          </Button>
        </form>
      )}
    </>
  );
}
