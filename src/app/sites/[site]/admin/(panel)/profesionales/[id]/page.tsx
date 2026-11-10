import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BlockForm } from "@/components/panel/block-form";
import { BlockList } from "@/components/panel/block-list";
import { PageHeader } from "@/components/panel/panel-ui";
import { WeekHoursEditor } from "@/components/panel/week-hours-editor";
import { Button } from "@/components/ui/button";
import { can, requireStaff } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog-data";
import { catalogPhotoUrl } from "@/lib/catalog-photo";
import { loadHours, loadUpcomingBlocks, todayIn } from "@/lib/schedule-data";
import { linkableMembers } from "@/lib/team-options";
import { setProfessionalFlagAction } from "../actions";
import { ProfessionalForm, ProfessionalServicesForm } from "../professional-forms";

export const metadata: Metadata = { title: "Profesional" };

const TABS = [
  { key: "datos", label: "Datos" },
  { key: "servicios", label: "Servicios" },
  { key: "horario", label: "Horario" },
  { key: "bloqueos", label: "Bloqueos" },
] as const;

export default async function ProfessionalPage({ params, searchParams }: PageProps<"/sites/[site]/admin/profesionales/[id]">) {
  const { site, id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaff(site, `/admin/profesionales/${id}`);
  const catalog = await loadCatalog(ctx);
  const pro = catalog.professionals.find((p) => p.id === id);
  if (!pro) notFound();

  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "datos";
  const canManage = can(ctx, "services.manage");
  const canAgenda = can(ctx, "agenda.manage");

  let content: React.ReactNode;
  if (tab === "datos") {
    content = canManage ? (
      <ProfessionalForm
        initial={pro}
        members={await linkableMembers(ctx, catalog.professionals.map((p) => p.membership_id), pro.membership_id)}
        photoUrl={catalogPhotoUrl(pro.photo_path)}
      />
    ) : (
      <p className="text-muted-foreground">{pro.bio ?? "Sin descripción."}</p>
    );
  } else if (tab === "servicios") {
    const services = catalog.services
      .filter((s) => !s.archived_at)
      .map((s) => ({ ...s, category: catalog.categories.find((c) => c.id === s.category_id)?.name ?? "Sin categoría" }));
    const assignments = catalog.assignments.filter((a) => a.professional_id === pro.id);
    content = canManage ? (
      <ProfessionalServicesForm professionalId={pro.id} services={services} assignments={assignments} currency={ctx.studio.currency} />
    ) : (
      <ul className="list-disc pl-5">
        {assignments.map((a) => (
          <li key={a.id}>{services.find((s) => s.id === a.service_id)?.name}</li>
        ))}
      </ul>
    );
  } else if (tab === "horario") {
    const [own, studio] = await Promise.all([loadHours(ctx, pro.id), loadHours(ctx, null)]);
    content = <WeekHoursEditor initial={own} professionalId={pro.id} studioHours={studio} canEdit={canAgenda} />;
  } else {
    const blocks = await loadUpcomingBlocks(ctx, pro.id);
    content = (
      <div className="flex flex-col gap-5">
        {canAgenda && <BlockForm professionalId={pro.id} today={todayIn(ctx.studio.timezone)} />}
        <h2 className="text-lg font-semibold">Próximos bloqueos (suyos y de todo el estudio)</h2>
        <BlockList blocks={blocks} timezone={ctx.studio.timezone} professionals={catalog.professionals} canEdit={canAgenda} />
      </div>
    );
  }

  return (
    <>
      <Link href="/admin/profesionales" className="text-sm text-foreground underline underline-offset-4">
        ← Profesionales
      </Link>
      <PageHeader title={pro.display_name} description={pro.archived_at ? "Archivada" : undefined} />
      <nav aria-label="Secciones de la profesional" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/profesionales/${pro.id}?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`min-h-11 px-3 py-2.5 text-sm font-medium ${t.key === tab ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="rounded-xl border bg-card p-5">{content}</div>
      {tab === "datos" && canManage && !pro.archived_at && (
        <form action={setProfessionalFlagAction} className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-card p-5">
          <input type="hidden" name="id" value={pro.id} />
          <input type="hidden" name="action" value="archive" />
          <p className="text-sm text-muted-foreground">
            Archivar la saca del panel y del sitio y desvincula su cuenta. No se borra: sus turnos la conservan.
          </p>
          <Button type="submit" variant="destructive" className="h-11">
            Archivar profesional
          </Button>
        </form>
      )}
    </>
  );
}
