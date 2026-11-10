import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Panel" };

export default async function PanelHome({ params }: PageProps<"/sites/[site]/admin">) {
  const { site } = await params;
  const ctx = await requireStaff(site);

  const supabase = await serverSupabase();
  const [{ data: profile }, { data: permissions }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    supabase.from("permissions").select("code, description").in("code", ctx.permissions).order("module"),
  ]);

  const name = profile?.full_name || ctx.user.email;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Hola, {name}</h1>
        <p className="text-muted-foreground">
          Ingresaste al panel de {ctx.studio.name} como {ctx.roleName}.
        </p>
      </div>
      <section aria-labelledby="permisos" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h2 id="permisos" className="text-lg font-semibold text-card-foreground">
          Lo que podés hacer
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-card-foreground">
          {(permissions ?? []).map((p) => (
            <li key={p.code}>{p.description}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Las secciones de agenda, clientas y caja se van a sumar en los próximos sprints.
        </p>
      </section>
    </>
  );
}
