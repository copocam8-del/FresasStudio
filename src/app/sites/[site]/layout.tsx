import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandCssVars } from "@/lib/brand";
import { getStudio } from "@/lib/studio";
import { studioLogo } from "@/lib/studio-brand";

// Sitio y panel de un estudio (marca blanca): todo lo que cuelga de acá muestra
// solo el nombre y la marca del estudio, nunca "Cleo".

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
  return (
    <div style={style} className="flex flex-1 flex-col bg-background text-foreground">
      {children}
    </div>
  );
}
