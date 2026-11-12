import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/panel/panel-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { can, requireStaff } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog-data";
import { catalogPhotoUrl } from "@/lib/catalog-photo";
import { setProfessionalFlagAction } from "./actions";

export const metadata: Metadata = { title: "Profesionales" };

export default async function ProfessionalsPage({ params }: PageProps<"/sites/[site]/admin/profesionales">) {
  const { site } = await params;
  const ctx = await requireStaff(site, "/admin/profesionales");
  const canEdit = can(ctx, "services.manage");
  const { professionals, assignments } = await loadCatalog(ctx);
  const live = professionals.filter((p) => !p.archived_at);
  const archived = professionals.filter((p) => p.archived_at);

  return (
    <>
      <PageHeader
        title="Profesionales"
        description="Quiénes atienden, qué servicios hacen y cuándo."
        action={canEdit ? { href: "/admin/profesionales/nueva", label: "+ Nueva profesional" } : undefined}
      />
      {live.length === 0 && <EmptyState>Todavía no hay profesionales.</EmptyState>}
      <ul className="flex flex-col divide-y glass rounded-[1.1rem]">
        {live.map((p) => {
          const photo = catalogPhotoUrl(p.photo_path);
          const count = assignments.filter((a) => a.professional_id === p.id).length;
          return (
            <li key={p.id}>
              <Link href={`/admin/profesionales/${p.id}`} className="flex items-center gap-3 p-4 hover:bg-accent">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="size-12 rounded-full border object-cover" />
                ) : (
                  <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground">
                    {p.display_name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-card-foreground">{p.display_name}</span>
                  <span className="text-sm text-muted-foreground">
                    {count} {count === 1 ? "servicio" : "servicios"} · {p.membership_id ? "usa el panel" : "sin cuenta"}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {!p.is_active && <Badge tone="warn">Inactiva</Badge>}
                    {!p.show_online && <Badge>No visible en el sitio</Badge>}
                    {!p.accepts_online_booking && <Badge>Sin reservas online</Badge>}
                  </span>
                </span>
                <span aria-hidden className={buttonVariants({ variant: "outline", className: "h-11" })}>Ver</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {canEdit && archived.length > 0 && (
        <details className="glass rounded-[1.1rem] p-4">
          <summary className="cursor-pointer font-medium">Archivadas ({archived.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {archived.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>{p.display_name}</span>
                <form action={setProfessionalFlagAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="action" value="restore" />
                  <Button type="submit" variant="outline" className="h-11">Restaurar</Button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
