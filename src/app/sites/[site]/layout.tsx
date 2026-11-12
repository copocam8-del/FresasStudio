import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandCssVars } from "@/lib/brand";
import { getStudio } from "@/lib/studio";
import { BrandLarge, CleoLogo } from "@/components/cleo/brand";
import { WelcomeSplash } from "@/components/cleo/welcome";
import { studioBrand, studioLogo } from "@/lib/studio-brand";

// Sitio y panel de un estudio. Marca: por defecto, Cleo; si el estudio activó su marca
// propia (/admin/marca), su nombre, logo y colores con el logo de Cleo chiquito.

export async function generateMetadata({ params }: LayoutProps<"/sites/[site]">): Promise<Metadata> {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) return { title: "Página no encontrada" };
  return {
    title: { default: studio.name, template: `%s · ${studio.name}` },
    description: studio.description ?? undefined,
    icons: studioLogo(studio) ? { icon: studioLogo(studio)! } : undefined,
  };
}

export default async function SiteLayout({ children, params }: LayoutProps<"/sites/[site]">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  // Colores del estudio sobre el tema de Cleo (solo hex validados; nada si no pasan contraste).
  const style = brandCssVars(studio.brand) as React.CSSProperties;
  const brand = studioBrand(studio);
  return (
    <div style={style} className="flex flex-1 flex-col bg-background text-foreground">
      <WelcomeSplash>
        {brand.ownBrand ? <BrandLarge brand={brand} align="center" sizeClass="text-[3.4rem]" /> : <CleoLogo className="h-[9rem]" />}
      </WelcomeSplash>
      {children}
    </div>
  );
}
