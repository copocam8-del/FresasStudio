import type { Metadata } from "next";
import Link from "next/link";
import { Badge, MoveButtons, PageHeader } from "@/components/panel/panel-ui";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog-data";
import { moveCategoryAction, setCategoryActiveAction } from "../actions";
import { CategoryForm } from "./category-form";

export const metadata: Metadata = { title: "Categorías" };

export default async function CategoriesPage({ params }: PageProps<"/sites/[site]/admin/servicios/categorias">) {
  const { site } = await params;
  const ctx = await requirePermission(site, "services.manage", "/admin/servicios/categorias");
  const { categories, services } = await loadCatalog(ctx);

  return (
    <>
      <PageHeader title="Categorías" description="Agrupan los servicios en el panel y en el sitio." />
      <Link href="/admin/servicios" className="text-sm text-foreground underline underline-offset-4">
        ← Volver a servicios
      </Link>
      <div className="rounded-xl border bg-card p-5">
        <CategoryForm />
      </div>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {categories.map((c, i) => {
          const count = services.filter((s) => s.category_id === c.id && !s.archived_at).length;
          return (
            <li key={c.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {count} {count === 1 ? "servicio" : "servicios"}
                {!c.is_active && <Badge tone="warn">Oculta</Badge>}
              </div>
              <CategoryForm id={c.id} name={c.name} />
              <div className="flex flex-wrap gap-2">
                <MoveButtons id={c.id} action={moveCategoryAction} isFirst={i === 0} isLast={i === categories.length - 1} label={c.name} />
                <form action={setCategoryActiveAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
                  <Button type="submit" variant="outline" className="h-11">
                    {c.is_active ? "Ocultar categoría" : "Mostrar categoría"}
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground">
        Ocultar una categoría saca sus servicios del sitio, pero no los borra.
      </p>
    </>
  );
}
