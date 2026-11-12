import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CleoLogo } from "@/components/cleo/brand";
import { SilkHero } from "@/components/cleo/silk";
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
    <main className="relative isolate mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-[1.4rem] py-12">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent)]">
        <SilkHero />
      </div>
      <CleoLogo className="h-24 self-start" />
      <h1 className="font-sans text-[2.1rem] leading-tight font-light text-[#f6e6dc]">Cleo Admin</h1>
      <p className="text-foreground/90">Sesión iniciada como {user.email}.</p>
      <form action={platformSignOutAction}>
        <Button type="submit" variant="outline" className="h-11">
          Cerrar sesión
        </Button>
      </form>
    </main>
  );
}
