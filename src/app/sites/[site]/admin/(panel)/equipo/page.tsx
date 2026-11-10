import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { can, requirePermission } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";
import { revokeInvitationAction } from "./actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Equipo" };

type Member = {
  membership_id: string;
  full_name: string | null;
  email: string;
  role_name: string;
  status: "active" | "suspended" | "revoked";
  is_me: boolean;
};

export default async function TeamPage({ params }: PageProps<"/sites/[site]/admin/equipo">) {
  const { site } = await params;
  const ctx = await requirePermission(site, "team.read", "/admin/equipo");
  const canManage = can(ctx, "team.manage");
  const supabase = await serverSupabase();

  const { data: members, error } = await supabase.rpc("team_members", { p_tenant: ctx.tenantId });
  if (error) throw new Error(`No se pudo cargar el equipo: ${error.message}`);

  let invitations: { id: string; email: string; expires_at: string; roles: { name: string } | null }[] = [];
  let assignableRoles: { id: string; name: string }[] = [];

  if (canManage) {
    const [{ data: inv }, { data: roles }] = await Promise.all([
      supabase
        .from("invitations")
        .select("id, email, expires_at, roles(name)")
        .eq("tenant_id", ctx.tenantId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("roles")
        .select("id, name, key, tenant_id, role_permissions(permission_code)")
        .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
        .order("name"),
    ]);
    invitations = (inv ?? []) as unknown as typeof invitations;
    // Solo roles cuyos permisos tiene quien invita (la base lo vuelve a validar).
    assignableRoles = (roles ?? [])
      .filter((r) => (r.role_permissions ?? []).every((p) => ctx.permissions.includes(p.permission_code)))
      .map((r) => ({ id: r.id, name: r.name }));
  }

  const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: ctx.studio.timezone });

  return (
    <>
      <h1 className="text-2xl font-semibold text-foreground">Equipo</h1>

      <section aria-labelledby="miembros" className="flex flex-col gap-3">
        <h2 id="miembros" className="text-lg font-semibold text-foreground">
          Personas ({(members as Member[]).length})
        </h2>
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {(members as Member[]).map((m) => (
            <li key={m.membership_id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span className="font-medium text-card-foreground">
                  {m.full_name || m.email}
                  {m.is_me && <span className="text-muted-foreground"> (vos)</span>}
                </span>
                {m.full_name && <span className="text-sm text-muted-foreground">{m.email}</span>}
              </div>
              <span className="text-sm text-card-foreground">
                {m.role_name}
                {m.status === "suspended" && <span className="text-destructive"> · suspendida</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <>
          <section aria-labelledby="invitar" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
            <div className="flex flex-col gap-1">
              <h2 id="invitar" className="text-lg font-semibold text-card-foreground">
                Invitar a alguien
              </h2>
              <p className="text-sm text-muted-foreground">
                Se genera un link para que lo mandes por WhatsApp. La persona crea su cuenta con ese
                mismo email.
              </p>
            </div>
            <InviteForm roles={assignableRoles} studioName={ctx.studio.name} />
          </section>

          {invitations.length > 0 && (
            <section aria-labelledby="pendientes" className="flex flex-col gap-3">
              <h2 id="pendientes" className="text-lg font-semibold text-foreground">
                Invitaciones pendientes
              </h2>
              <ul className="flex flex-col divide-y rounded-xl border bg-card">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium text-card-foreground">{inv.email}</span>
                      <span className="text-sm text-muted-foreground">
                        {inv.roles?.name} · vence el {dateFmt.format(new Date(inv.expires_at))}
                      </span>
                    </div>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="invitation_id" value={inv.id} />
                      <Button type="submit" variant="outline" size="sm" className="h-9">
                        Anular
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
