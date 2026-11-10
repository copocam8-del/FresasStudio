import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { parseBrand } from "@/lib/brand";
import { studioLogo } from "@/lib/studio-brand";
import { serverSupabase } from "@/lib/supabase/server";
import { BrandForm } from "./brand-form";

export const metadata: Metadata = { title: "Marca" };

export default async function BrandPage({ params }: PageProps<"/sites/[site]/admin/marca">) {
  const { site } = await params;
  const ctx = await requirePermission(site, "settings.manage", "/admin/marca");

  // Se lee la marca guardada (no la del caché de la página pública).
  const supabase = await serverSupabase();
  const { data, error } = await supabase.from("tenant_settings").select("brand").eq("tenant_id", ctx.tenantId).single();
  if (error) throw new Error(`No se pudo cargar la marca: ${error.message}`);
  const brand = parseBrand(data.brand);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Marca</h1>
        <p className="text-muted-foreground">
          Colores y logo de {ctx.studio.name}. Se aplican en tu sitio y en este panel.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <BrandForm initial={brand} logoUrl={studioLogo({ ...ctx.studio, brand: data.brand })} studioName={ctx.studio.name} />
      </div>
    </>
  );
}
