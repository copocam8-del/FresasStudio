import type { Metadata } from "next";
import { BlockForm } from "@/components/panel/block-form";
import { BlockList } from "@/components/panel/block-list";
import { PageHeader } from "@/components/panel/panel-ui";
import { can, requireStaff } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog-data";
import { loadUpcomingBlocks, todayIn } from "@/lib/schedule-data";

export const metadata: Metadata = { title: "Bloqueos" };

export default async function BlocksPage({ params }: PageProps<"/sites/[site]/admin/bloqueos">) {
  const { site } = await params;
  const ctx = await requireStaff(site, "/admin/bloqueos");
  const canEdit = can(ctx, "agenda.manage");
  const [{ professionals }, blocks] = await Promise.all([loadCatalog(ctx), loadUpcomingBlocks(ctx)]);
  const active = professionals.filter((p) => !p.archived_at);
  return (
    <>
      <PageHeader
        title="Bloqueos"
        description="Feriados, vacaciones, días libres y horarios en los que no se atiende."
      />
      {canEdit && (
        <section aria-labelledby="nuevo-bloqueo" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <h2 id="nuevo-bloqueo" className="text-lg font-semibold">Nuevo bloqueo</h2>
          <BlockForm professionals={active} today={todayIn(ctx.studio.timezone)} />
        </section>
      )}
      <section aria-labelledby="proximos" className="flex flex-col gap-3">
        <h2 id="proximos" className="text-lg font-semibold">Próximos</h2>
        <BlockList blocks={blocks} timezone={ctx.studio.timezone} professionals={professionals} canEdit={canEdit} />
      </section>
    </>
  );
}
