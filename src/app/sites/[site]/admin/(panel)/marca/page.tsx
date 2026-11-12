import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { logoUrl, parseBrand } from "@/lib/brand";
import { publicEnv } from "@/lib/env";
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
        <h1 className="font-sans text-[2.1rem] leading-tight font-light text-[#f6e6dc]">Marca</h1>
        <p className="text-muted-foreground">
          Cómo se ve {ctx.studio.name}: con la marca Cleo o con la marca propia del estudio.
        </p>
      </div>
      <div className="glass rounded-[1.1rem] p-5">
        <BrandForm initial={brand} logoUrl={logoUrl(publicEnv().NEXT_PUBLIC_SUPABASE_URL, data.brand)} studioName={ctx.studio.name} />
      </div>
    </>
  );
}
