import type { Metadata } from "next";
import Link from "next/link";
import { can, requireStaff } from "@/lib/auth";
import { paymentsToResolve } from "@/lib/payments-data";
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

  // Avisos de pagos: conexión caída (P7) y pagos a resolver de los últimos 90 días.
  let reconnect = false;
  if (can(ctx, "payments.manage") || can(ctx, "settings.manage")) {
    const { data } = await supabase.rpc("get_payments_status", { p_tenant: ctx.tenantId });
    reconnect = (data as Array<{ status: string | null }> | null)?.[0]?.status === "needs_reconnect";
  }
  const resolve = can(ctx, "cash.read") ? await paymentsToResolve(ctx) : null;
  const toResolve = resolve?.count ?? 0;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Hola, {name}</h1>
        <p className="text-muted-foreground">
          Ingresaste al panel de {ctx.studio.name} como {ctx.roleName}.
        </p>
      </div>
      {reconnect && (
        <p role="alert" className="rounded-xl border-2 border-destructive/40 bg-card p-4 text-sm text-card-foreground">
          <strong className="text-destructive">Hay que volver a conectar Mercado Pago.</strong> Mientras tanto no se cobran señas y
          las reservas online están apagadas. <Link href="/admin/pagos" className="underline underline-offset-4">Ir a Mercado Pago</Link>
        </p>
      )}
      {toResolve > 0 && (
        <p role="alert" className="rounded-xl border-2 border-destructive/40 bg-card p-4 text-sm text-card-foreground">
          <strong className="text-destructive">{toResolve === 1 ? "Hay 1 pago a resolver." : `Hay ${toResolve} pagos a resolver.`}</strong>{" "}
          <Link href={`/admin/pagos/movimientos?desde=${resolve?.desde ?? ""}`} className="underline underline-offset-4">Ver pagos</Link>
        </p>
      )}
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
