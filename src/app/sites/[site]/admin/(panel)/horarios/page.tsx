import type { Metadata } from "next";
import { PageHeader } from "@/components/panel/panel-ui";
import { WeekHoursEditor } from "@/components/panel/week-hours-editor";
import { can, requireStaff } from "@/lib/auth";
import { loadHours } from "@/lib/schedule-data";

export const metadata: Metadata = { title: "Horarios" };

export default async function StudioHoursPage({ params }: PageProps<"/sites/[site]/admin/horarios">) {
  const { site } = await params;
  const ctx = await requireStaff(site, "/admin/horarios");
  const canEdit = can(ctx, "settings.manage");
  const hours = await loadHours(ctx, null);
  return (
    <>
      <PageHeader
        title="Horario del estudio"
        description={
          canEdit
            ? "Cargá franjas por día. Los huecos entre franjas son descansos. Las profesionales siempre atienden dentro de este horario."
            : "Solo lectura: no tenés permiso para cambiar el horario del estudio."
        }
      />
      <div className="glass rounded-[1.1rem] p-5">
        <WeekHoursEditor initial={hours} canEdit={canEdit} />
      </div>
    </>
  );
}
