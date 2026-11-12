import type { Metadata } from "next";
import { PageHeader } from "@/components/panel/panel-ui";
import { requirePermission } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog-data";
import { linkableMembers } from "@/lib/team-options";
import { ProfessionalForm } from "../professional-forms";

export const metadata: Metadata = { title: "Nueva profesional" };

export default async function NewProfessionalPage({ params }: PageProps<"/sites/[site]/admin/profesionales/nueva">) {
  const { site } = await params;
  const ctx = await requirePermission(site, "services.manage", "/admin/profesionales/nueva");
  const { professionals } = await loadCatalog(ctx);
  const members = await linkableMembers(ctx, professionals.map((p) => p.membership_id), null);
  return (
    <>
      <PageHeader title="Nueva profesional" description="Después de crearla elegís qué servicios hace y su horario." />
      <div className="glass rounded-[1.1rem] p-5">
        <ProfessionalForm
          initial={{ display_name: "", bio: null, membership_id: null, show_online: true, accepts_online_booking: true, is_active: true }}
          members={members}
          photoUrl={null}
        />
      </div>
    </>
  );
}
