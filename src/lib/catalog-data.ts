import "server-only";
import type { StaffContext } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";

/** Lecturas del panel (con la sesión de la persona: RLS limita todo a su estudio). */

export type Category = { id: string; name: string; position: number; is_active: boolean };
export type Service = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  price_minor: number;
  price_is_from: boolean;
  deposit_percent: number | null;
  photo_path: string | null;
  is_active: boolean;
  show_online: boolean;
  position: number;
  archived_at: string | null;
};
export type Professional = {
  id: string;
  membership_id: string | null;
  display_name: string;
  bio: string | null;
  photo_path: string | null;
  is_active: boolean;
  show_online: boolean;
  accepts_online_booking: boolean;
  position: number;
  archived_at: string | null;
};
export type Assignment = {
  id: string;
  professional_id: string;
  service_id: string;
  price_minor_override: number | null;
  duration_minutes_override: number | null;
};

export async function loadCatalog(ctx: StaffContext) {
  const supabase = await serverSupabase();
  const [cats, srv, pros, asg] = await Promise.all([
    supabase.from("service_categories").select("id, name, position, is_active").eq("tenant_id", ctx.tenantId).order("position").order("name"),
    supabase.from("services").select("*").eq("tenant_id", ctx.tenantId).order("position").order("name"),
    supabase.from("professionals").select("*").eq("tenant_id", ctx.tenantId).order("position").order("display_name"),
    supabase.from("professional_services").select("id, professional_id, service_id, price_minor_override, duration_minutes_override").eq("tenant_id", ctx.tenantId),
  ]);
  for (const r of [cats, srv, pros, asg]) if (r.error) throw new Error(`No se pudo cargar el catálogo: ${r.error.message}`);
  return {
    categories: (cats.data ?? []) as Category[],
    services: (srv.data ?? []) as Service[],
    professionals: (pros.data ?? []) as Professional[],
    assignments: (asg.data ?? []) as Assignment[],
  };
}

/** Seña que se aplica por defecto en el estudio (tenant_settings.deposit_percent). */
export async function studioDepositPercent(ctx: StaffContext): Promise<number> {
  const supabase = await serverSupabase();
  const { data } = await supabase.from("tenant_settings").select("deposit_percent").eq("tenant_id", ctx.tenantId).single();
  return data?.deposit_percent ?? 50;
}
