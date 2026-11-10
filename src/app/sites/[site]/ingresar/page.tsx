import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getStudio } from "@/lib/studio";
import { studioLogo } from "@/lib/studio-brand";
import { safeNext } from "@/lib/validation";
import { googleSignInAction } from "../client-actions";

export const metadata: Metadata = { title: "Ingresar" };

export default async function ClientSignInPage({ params, searchParams }: PageProps<"/sites/[site]/ingresar">) {
  const { site } = await params;
  const sp = await searchParams;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const next = safeNext(sp.next, "/mi-ficha");
  if (await getUser()) redirect(next);

  return (
    <AuthShell
      brandName={studio.name} logoUrl={studioLogo(studio)}
      title="Ingresar"
      description="Entrá con tu cuenta de Google para ver tus datos y, pronto, tus turnos."
    >
      {sp.error === "google" && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          No pudimos completar el ingreso con Google. Probá de nuevo.
        </p>
      )}
      <form action={googleSignInAction}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" size="lg" className="h-11 w-full">
          Continuar con Google
        </Button>
      </form>
    </AuthShell>
  );
}
