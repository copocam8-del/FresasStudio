import type { Metadata } from "next";
import { BlockForm } from "@/components/panel/block-form";
import { BlockList } from "@/components/panel/block-list";
import { PageHeader } from "@/components/panel/panel-ui";
import { can, requireStaff } from "@/lib/auth";
import { loadAgenda } from "@/lib/agenda-data";
import { formatDayShort, isYmd } from "@/lib/booking-format";
import { loadCatalog } from "@/lib/catalog-data";
import { loadUpcomingBlocks, todayIn } from "@/lib/schedule-data";

export const metadata: Metadata = { title: "Bloqueos" };

export default async function BlocksPage({ params, searchParams }: PageProps<"/sites/[site]/admin/bloqueos">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(site, "/admin/bloqueos");
  const canEdit = can(ctx, "agenda.manage");
  const [{ professionals }, blocks] = await Promise.all([loadCatalog(ctx), loadUpcomingBlocks(ctx)]);
  const active = professionals.filter((p) => !p.archived_at);
  // Desde la agenda («Bloquear»): día y profesional precargados, y aviso si ese día ya tiene turnos.
  const today = todayIn(ctx.studio.timezone);
  const day = isYmd(sp.dia) && sp.dia >= today ? sp.dia : undefined;
  const pro = typeof sp.pro === "string" && active.some((p) => p.id === sp.pro) ? sp.pro : undefined;
  const busy = day && (can(ctx, "agenda.read_all") || can(ctx, "agenda.read_own"))
    ? (await loadAgenda(ctx, day, 1)).appointments.filter((a) =>
        (a.status === "confirmed" || a.status === "pending_payment") && (!pro || a.professional_id === pro)).length
    : 0;
  return (
    <>
      <PageHeader
        title="Bloqueos"
        description="Feriados, vacaciones, días libres y horarios en los que no se atiende."
      />
      {canEdit && (
        <section aria-labelledby="nuevo-bloqueo" className="flex flex-col gap-4 glass rounded-[1.1rem] p-5">
          <h2 id="nuevo-bloqueo" className="text-lg font-semibold">Nuevo bloqueo</h2>
          {busy > 0 && day && (
            <p role="status" className="rounded-2xl border border-[#d4b59d] bg-status-pending/20 p-3.5 text-sm text-foreground">
              Ojo: el {formatDayShort(day)} ya {busy === 1 ? "hay 1 turno" : `hay ${busy} turnos`}
              {pro ? ` con ${active.find((p) => p.id === pro)?.display_name}` : ""}. Bloquear no los cancela: cancelalos o
              reprogramalos desde la agenda (si cancela el estudio, la clienta conserva la seña).
            </p>
          )}
          <BlockForm professionals={active} today={today} initialDate={day} initialProfessionalId={pro} />
        </section>
      )}
      <section aria-labelledby="proximos" className="flex flex-col gap-3">
        <h2 id="proximos" className="text-lg font-semibold">Próximos</h2>
        <BlockList blocks={blocks} timezone={ctx.studio.timezone} professionals={professionals} canEdit={canEdit} />
      </section>
    </>
  );
}
