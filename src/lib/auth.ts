import "server-only";
import type { User } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getStudio, type PublicStudio } from "@/lib/studio";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Capa de acceso (DAL): toda verificación de sesión y permisos del lado de Next pasa
 * por acá. La base vuelve a validar todo con RLS y las RPC.
 */

/** Usuaria verificada contra Supabase Auth (no solo leyendo la cookie). */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export type StaffContext = {
  user: User;
  studio: PublicStudio;
  tenantId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
};

/** Membresía activa de la usuaria en ESE estudio (por slug), o null. */
export const getStaffContext = cache(async (siteParam: string): Promise<StaffContext | null> => {
  const [user, studio] = await Promise.all([getUser(), getStudio(siteParam)]);
  if (!user || !studio) return null;

  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("my_studios");
  if (error) throw new Error(`No se pudo leer la membresía: ${error.message}`);
  const row = (data as Array<{
    tenant_id: string; slug: string; role_key: string; role_name: string; permissions: string[];
  }>).find((s) => s.slug === studio.slug);
  if (!row) return null;

  return {
    user,
    studio,
    tenantId: row.tenant_id,
    roleKey: row.role_key,
    roleName: row.role_name,
    permissions: row.permissions,
  };
});

/**
 * Para páginas del panel (/admin): sin sesión → login; con sesión pero sin membresía
 * en este estudio → 404 (no revela que el panel existe).
 */
export async function requireStaff(siteParam: string, currentPath = "/admin"): Promise<StaffContext> {
  const user = await getUser();
  if (!user) redirect(`/admin/login?next=${encodeURIComponent(currentPath)}`);
  const ctx = await getStaffContext(siteParam);
  if (!ctx) notFound();
  return ctx;
}

/** Igual que requireStaff, y además exige un permiso. Sin el permiso → 404. */
export async function requirePermission(siteParam: string, permission: string, currentPath: string) {
  const ctx = await requireStaff(siteParam, currentPath);
  if (!ctx.permissions.includes(permission)) notFound();
  return ctx;
}

export function can(ctx: StaffContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}

/** ¿Es superadministradora de Cleo? (platform_admins, con RLS: solo ve su propia fila). */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) return false;
  const supabase = await serverSupabase();
  const { data, error } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(`No se pudo verificar Cleo Admin: ${error.message}`);
  return Boolean(data);
});
