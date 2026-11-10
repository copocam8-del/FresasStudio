import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getStudio } from "@/lib/studio";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default async function RecoverPage({ params }: PageProps<"/sites/[site]/admin/recuperar">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  return (
    <AuthShell
      brandName={studio.name}
      title="Recuperar contraseña"
      description="Te enviamos un link para crear una contraseña nueva."
    >
      <RecoverForm />
    </AuthShell>
  );
}
