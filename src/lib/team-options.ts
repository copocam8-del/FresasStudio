import "server-only";
import type { StaffContext } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Cuentas del equipo que se pueden vincular a una profesional: activas y no
 * vinculadas a otra (más la actual). Si quien edita no puede ver el equipo
 * (sin team.read), solo se ofrece la vinculación actual.
 */
export async function linkableMembers(
  ctx: StaffContext,
  linkedIds: (string | null)[],
  currentId: string | null,
): Promise<{ id: string; label: string }[]> {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("team_members", { p_tenant: ctx.tenantId });
  if (error) return currentId ? [{ id: currentId, label: "Cuenta vinculada" }] : [];
  const taken = new Set(linkedIds.filter((x): x is string => Boolean(x) && x !== currentId));
  return (data as { membership_id: string; full_name: string | null; email: string; status: string }[])
    .filter((m) => m.status === "active" && !taken.has(m.membership_id))
    .map((m) => ({ id: m.membership_id, label: m.full_name ? `${m.full_name} (${m.email})` : m.email }));
}
