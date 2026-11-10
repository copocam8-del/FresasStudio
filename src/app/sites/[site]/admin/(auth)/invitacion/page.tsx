import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { getStudio } from "@/lib/studio";
import { serverSupabase } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/lib/validation";
import { signOutAction } from "../../actions";
import { AcceptForm, SignUpForm } from "./invitation-forms";

export const metadata: Metadata = {
  title: "Invitación al equipo",
  // El token va en la URL: que no viaje como Referer a otros sitios.
  referrer: "no-referrer",
  robots: { index: false },
};

type Preview = {
  status: "valid" | "expired" | "used" | "revoked" | "unavailable" | "invalid";
  studio_slug: string | null;
  studio_name: string | null;
  role_name: string | null;
  email_masked: string | null;
  expires_at: string | null;
};

const STATUS_MESSAGES: Record<Exclude<Preview["status"], "valid">, string> = {
  invalid: "El link de invitación no es válido. Revisá que lo hayas copiado completo.",
  expired: "La invitación venció. Pedile a la dueña del estudio que te mande una nueva.",
  used: "Esta invitación ya se usó. Si ya sos parte del equipo, ingresá con tu email y contraseña.",
  revoked: "La invitación fue anulada. Pedile a la dueña del estudio que te mande una nueva.",
  unavailable: "Este estudio no está disponible en este momento.",
};

export default async function InvitationPage({ params, searchParams }: PageProps<"/sites/[site]/admin/invitacion">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const sp = await searchParams;
  const parsed = invitationTokenSchema.safeParse(sp.token);
  let preview: Preview = { status: "invalid", studio_slug: null, studio_name: null, role_name: null, email_masked: null, expires_at: null };
  if (parsed.success) {
    const supabase = await serverSupabase();
    const { data } = await supabase.rpc("get_invitation_preview", { p_token: parsed.data });
    if (Array.isArray(data) && data[0]) preview = data[0] as Preview;
  }

  const shell = (children: React.ReactNode, description?: React.ReactNode) => (
    <AuthShell brandName={studio.name} title="Invitación al equipo" description={description}>
      {children}
    </AuthShell>
  );

  if (preview.status !== "valid") {
    return shell(<p className="text-sm text-foreground">{STATUS_MESSAGES[preview.status]}</p>);
  }
  if (preview.studio_slug !== studio.slug) {
    return shell(<p className="text-sm text-foreground">Esta invitación es de otro estudio. Abrí el link tal cual te llegó.</p>);
  }

  const token = parsed.data!;
  const expires = new Date(preview.expires_at!).toLocaleDateString("es-AR", {
    day: "numeric", month: "long", timeZone: studio.timezone,
  });
  const description = (
    <>
      Te invitaron a sumarte a <strong className="text-foreground">{preview.studio_name}</strong> como{" "}
      <strong className="text-foreground">{preview.role_name}</strong>. La invitación es para{" "}
      <strong className="text-foreground">{preview.email_masked}</strong> y vence el {expires}.
    </>
  );

  const user = await getUser();

  if (!user) {
    const loginHref = `/admin/login?next=${encodeURIComponent(`/admin/invitacion?token=${token}`)}`;
    return shell(
      <>
        <SignUpForm token={token} />
        <p className="text-center text-sm text-muted-foreground">
          ¿Ya tenés cuenta?{" "}
          <Link href={loginHref} className="text-foreground underline underline-offset-4">
            Ingresá
          </Link>
        </p>
      </>,
      description,
    );
  }

  if (!user.email_confirmed_at) {
    return shell(
      <p className="text-sm text-foreground">
        Confirmá tu email con el link que te enviamos y volvé a abrir esta invitación.
      </p>,
      description,
    );
  }

  return shell(
    <>
      <p className="text-sm text-muted-foreground">
        Vas a aceptar con <strong className="text-foreground">{user.email}</strong>.
      </p>
      <AcceptForm token={token} />
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" className="h-11 w-full">
          No soy yo: cerrar sesión
        </Button>
      </form>
    </>,
    description,
  );
}
