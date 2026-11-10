import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStudio } from "@/lib/studio";

// Sitio y panel de un estudio (marca blanca): todo lo que cuelga de acá muestra
// solo el nombre y la marca del estudio, nunca "Cleo".

export async function generateMetadata({ params }: LayoutProps<"/sites/[site]">): Promise<Metadata> {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) return { title: "Página no encontrada" };
  return {
    title: { default: studio.name, template: `%s · ${studio.name}` },
    description: studio.description ?? undefined,
  };
}

export default async function SiteLayout({ children, params }: LayoutProps<"/sites/[site]">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  return <div className="flex flex-1 flex-col">{children}</div>;
}
