import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { MyBookings } from "@/components/site/my-bookings";
import { MyCredit } from "@/components/site/my-credit";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getStudio } from "@/lib/studio";
import { studioBrand } from "@/lib/studio-brand";
import { serverSupabase } from "@/lib/supabase/server";
import { clientSignOutAction, createMyProfileAction } from "../client-actions";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Mis datos", robots: { index: false } };

type MyProfile = { full_name: string; email: string | null; phone: string | null };

export default async function MyProfilePage({ params }: PageProps<"/sites/[site]/mi-ficha">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const user = await getUser();
  if (!user) redirect(`/ingresar?next=${encodeURIComponent("/mi-ficha")}`);

  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("my_client_profile", { p_slug: studio.slug });
  if (error) throw new Error(`No se pudo cargar la ficha: ${error.message}`);
  const profile = (data as MyProfile[])[0];

  const signOut = (
    <form action={clientSignOutAction}>
      <Button type="submit" variant="ghost" className="h-11 w-full">
        Cerrar sesión
      </Button>
    </form>
  );

  if (!profile) {
    return (
      <AuthShell brand={studioBrand(studio)} title="Mis datos">
        <p className="text-sm text-foreground">
          Todavía no tenés tus datos cargados en {studio.name}.
        </p>
        <form action={createMyProfileAction}>
          <Button type="submit" size="lg" className="h-11 w-full">
            Crear mi ficha
          </Button>
        </form>
        {signOut}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      brand={studioBrand(studio)}
      title="Mis datos"
      description={profile.email ? <>Ingresaste con {profile.email}.</> : undefined}
    >
      <ProfileForm fullName={profile.full_name} phone={profile.phone ?? ""} />
      <MyCredit slug={studio.slug} />
      <MyBookings slug={studio.slug} />
      {signOut}
    </AuthShell>
  );
}
