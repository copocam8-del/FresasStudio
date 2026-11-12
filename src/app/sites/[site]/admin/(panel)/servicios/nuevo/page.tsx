import type { Metadata } from "next";
import { PageHeader } from "@/components/panel/panel-ui";
import { requirePermission } from "@/lib/auth";
import { loadCatalog, studioDepositPercent } from "@/lib/catalog-data";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "Nuevo servicio" };

export default async function NewServicePage({ params }: PageProps<"/sites/[site]/admin/servicios/nuevo">) {
  const { site } = await params;
  const ctx = await requirePermission(site, "services.manage", "/admin/servicios/nuevo");
  const [{ categories }, deposit] = await Promise.all([loadCatalog(ctx), studioDepositPercent(ctx)]);
  return (
    <>
      <PageHeader title="Nuevo servicio" />
      <div className="glass rounded-[1.1rem] p-5">
        <ServiceForm
          initial={{
            name: "",
            category_id: null,
            description: null,
            duration_minutes: 60,
            buffer_after_minutes: 0,
            price_minor: null,
            price_is_from: false,
            deposit_percent: null,
            show_online: true,
            is_active: true,
          }}
          categories={categories.filter((c) => c.is_active)}
          studioDeposit={deposit}
          currency={ctx.studio.currency}
          photoUrl={null}
        />
      </div>
    </>
  );
}
