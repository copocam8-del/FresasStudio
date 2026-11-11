import type { Metadata } from "next";
import { PageHeader } from "@/components/panel/panel-ui";
import { requirePermission } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";
import { BookingSettingsForm, type BookingSettings } from "./settings-form";

export const metadata: Metadata = { title: "Reglas de reservas" };

export default async function BookingSettingsPage({ params }: PageProps<"/sites/[site]/admin/reservas">) {
  const { site } = await params;
  const ctx = await requirePermission(site, "settings.manage", "/admin/reservas");
  const supabase = await serverSupabase();
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("online_booking_enabled, payments_connected, booking_min_notice_minutes, booking_horizon_days, slot_interval_minutes, booking_hold_minutes, deposit_percent, cancellation_window_hours")
    .eq("tenant_id", ctx.tenantId)
    .single();
  if (error) throw new Error(`No se pudo cargar la configuración: ${error.message}`);
  return (
    <>
      <PageHeader title="Reglas de reservas" description="Cómo y cuándo pueden reservar las clientas." />
      <div className="rounded-xl border bg-card p-5">
        <BookingSettingsForm s={data as BookingSettings} />
      </div>
    </>
  );
}
