import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getStaffContext, getUser } from "@/lib/auth";
import { getStudio } from "@/lib/studio";
import { studioBrand } from "@/lib/studio-brand";
import { safeNext } from "@/lib/validation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar al panel" };

const LINK_ERRORS: Record<string, string> = {
  link: "El link venció o ya se usó. Pedí uno nuevo.",
};

export default async function LoginPage({ params, searchParams }: PageProps<"/sites/[site]/admin/login">) {
  const { site } = await params;
  const sp = await searchParams;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const next = safeNext(sp.next, "/admin");
  // Si ya tiene sesión y es del equipo, no tiene sentido volver a pedir el login.
  if ((await getUser()) && (await getStaffContext(site))) redirect(next);

  const error = typeof sp.error === "string" ? LINK_ERRORS[sp.error] : undefined;

  return (
    <AuthShell brand={studioBrand(studio)} title="Ingresar al panel" description="Solo para el equipo del estudio.">
      <LoginForm next={next} initialError={error} />
    </AuthShell>
  );
}
