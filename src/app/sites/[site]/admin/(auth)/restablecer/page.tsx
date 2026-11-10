import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getUser } from "@/lib/auth";
import { getStudio } from "@/lib/studio";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Contraseña nueva" };

// Se llega desde el link del email (pasando por /admin/auth/confirm, que abre la sesión).
export default async function ResetPage({ params }: PageProps<"/sites/[site]/admin/restablecer">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();
  const user = await getUser();

  return (
    <AuthShell brandName={studio.name} title="Contraseña nueva">
      {user ? (
        <ResetForm />
      ) : (
        <p className="text-sm text-muted-foreground">
          El link venció o ya se usó.{" "}
          <Link href="/admin/recuperar" className="text-foreground underline underline-offset-4">
            Pedí uno nuevo
          </Link>
          .
        </p>
      )}
    </AuthShell>
  );
}
