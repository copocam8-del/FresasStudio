import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getUser, isPlatformAdmin } from "@/lib/auth";
import { platformSignOutAction } from "./actions";

export const metadata: Metadata = { title: "Cleo Admin", robots: { index: false } };

// Cleo Admin (admin.cleo.com.ar). Por ahora solo acceso; las pantallas de
// administración (estudios, planes, dominios) llegan en otro sprint.
export default async function PlatformHome() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin())) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-12">
      <div className="h-px w-12 bg-gold" aria-hidden />
      <h1 className="text-2xl font-semibold text-foreground">Cleo Admin</h1>
      <p className="text-muted-foreground">Sesión iniciada como {user.email}.</p>
      <form action={platformSignOutAction}>
        <Button type="submit" variant="outline" className="h-11">
          Cerrar sesión
        </Button>
      </form>
    </main>
  );
}
