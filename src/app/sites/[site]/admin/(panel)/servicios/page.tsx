import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, MoveButtons, PageHeader } from "@/components/panel/panel-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { can, requireStaff } from "@/lib/auth";
import { loadCatalog, type Service } from "@/lib/catalog-data";
import { formatPrice } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { moveServiceAction, setServiceFlagAction } from "./actions";

export const metadata: Metadata = { title: "Servicios" };

export default async function ServicesPage({ params }: PageProps<"/sites/[site]/admin/servicios">) {
  const { site } = await params;
  const ctx = await requireStaff(site, "/admin/servicios");
  const canEdit = can(ctx, "services.manage");
  const { categories, services, professionals, assignments } = await loadCatalog(ctx);

  const live = services.filter((s) => !s.archived_at);
  const archived = services.filter((s) => s.archived_at);
  const groups = [
    ...categories.map((c) => ({ key: c.id, title: c.name, inactive: !c.is_active, items: live.filter((s) => s.category_id === c.id) })),
    { key: "none", title: "Sin categoría", inactive: false, items: live.filter((s) => !s.category_id) },
  ].filter((g) => g.items.length > 0 || g.key !== "none");

  const whoDoes = (s: Service) =>
    assignments
      .filter((a) => a.service_id === s.id)
      .map((a) => professionals.find((p) => p.id === a.professional_id)?.display_name)
      .filter(Boolean)
      .join(", ");

  return (
    <>
      <PageHeader
        title="Servicios"
        description={canEdit ? "Lo que ofrece el estudio, con su duración y precio." : "Solo lectura: no tenés permiso para editar servicios."}
        action={canEdit ? { href: "/admin/servicios/nuevo", label: "+ Nuevo servicio" } : undefined}
      />
      {canEdit && (
        <Link href="/admin/servicios/categorias" className="text-sm text-foreground underline underline-offset-4">
          Editar categorías
        </Link>
      )}

      {live.length === 0 && <EmptyState>Todavía no hay servicios. {canEdit && "Empezá con «+ Nuevo servicio»."}</EmptyState>}

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`cat-${g.key}`} className="flex flex-col gap-3">
          <h2 id={`cat-${g.key}`} className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {g.title}
            {g.inactive && <Badge tone="warn">Categoría oculta</Badge>}
          </h2>
          {g.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin servicios en esta categoría.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {g.items.map((s, i) => (
                <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium text-card-foreground">{s.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDuration(s.duration_minutes)}
                      {s.buffer_after_minutes > 0 && ` + ${s.buffer_after_minutes} min extra`} ·{" "}
                      {formatPrice(s.price_minor, s.price_is_from, ctx.studio.currency)}
                      {s.deposit_percent !== null && ` · seña ${s.deposit_percent}%`}
                    </span>
                    <span className="text-sm text-muted-foreground">{whoDoes(s) ? `Lo hacen: ${whoDoes(s)}` : "Ninguna profesional lo tiene asignado"}</span>
                    <div className="flex flex-wrap gap-1">
                      {!s.is_active && <Badge tone="warn">Inactivo</Badge>}
                      {!s.show_online && <Badge>No visible en el sitio</Badge>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2">
                      <MoveButtons id={s.id} action={moveServiceAction} isFirst={i === 0} isLast={i === g.items.length - 1} label={s.name} />
                      <form action={setServiceFlagAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="action" value={s.is_active ? "deactivate" : "activate"} />
                        <Button type="submit" variant="outline" className="h-11">
                          {s.is_active ? "Desactivar" : "Activar"}
                        </Button>
                      </form>
                      <Link href={`/admin/servicios/${s.id}`} className={buttonVariants({ className: "h-11 px-4" })}>
                        Editar
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {canEdit && archived.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-medium text-card-foreground">Archivados ({archived.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {archived.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="text-card-foreground">{s.name}</span>
                <form action={setServiceFlagAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="action" value="restore" />
                  <Button type="submit" variant="outline" className="h-11">
                    Restaurar
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
