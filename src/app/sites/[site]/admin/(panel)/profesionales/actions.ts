"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { removeCatalogPhoto, uploadCatalogPhoto } from "@/lib/catalog-photo";
import { firstIssue, overrideSchema, professionalSchema } from "@/lib/catalog-schemas";
import { userFacingDbError } from "@/lib/db-errors";
import { serverSupabase } from "@/lib/supabase/server";

export type ProState = { error?: string; ok?: string } | undefined;

const uuid = z.uuid();

async function manager() {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "services.manage")) return null;
  return ctx;
}

/** Datos de la profesional (alta o edición), con foto y vínculo opcional a una cuenta. */
export async function saveProfessionalAction(_prev: ProState, formData: FormData): Promise<ProState> {
  const ctx = await manager();
  if (!ctx) return { error: "No tenés permiso para editar profesionales." };
  const id = formData.get("id") ? uuid.safeParse(formData.get("id")) : null;
  if (id && !id.success) return { error: "Profesional inválida." };

  const parsed = professionalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await serverSupabase();
  let previousPhoto: string | null = null;
  if (id) {
    const { data } = await supabase.from("professionals").select("photo_path").eq("id", id.data).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!data) return { error: "No encontramos a la profesional." };
    previousPhoto = data.photo_path;
  }

  const upload = await uploadCatalogPhoto(supabase, ctx.tenantId, "professionals", formData.get("photo"));
  if (upload.error) return { error: upload.error };
  const photo_path = upload.path ?? (formData.get("remove_photo") === "on" ? null : previousPhoto);

  const row = { ...parsed.data, photo_path };
  const result = id
    ? await supabase.from("professionals").update(row).eq("id", id.data).eq("tenant_id", ctx.tenantId).select("id").single()
    : await supabase.from("professionals").insert({ ...row, tenant_id: ctx.tenantId, position: 1000 }).select("id").single();
  if (result.error) {
    if (upload.path) await removeCatalogPhoto(supabase, upload.path);
    return { error: userFacingDbError(result.error) };
  }
  if (previousPhoto && previousPhoto !== photo_path) await removeCatalogPhoto(supabase, previousPhoto);

  revalidatePath("/", "layout");
  if (!id) redirect(`/admin/profesionales/${result.data.id}?tab=servicios`);
  return { ok: "Guardamos los datos." };
}

/**
 * Qué servicios hace y si cobra o tarda distinto. Se guarda la lista entera:
 * tildado → se agrega o actualiza; destildado → se quita.
 */
export async function saveProfessionalServicesAction(_prev: ProState, formData: FormData): Promise<ProState> {
  const ctx = await manager();
  if (!ctx) return { error: "No tenés permiso para editar profesionales." };
  const pro = uuid.safeParse(formData.get("professional_id"));
  if (!pro.success) return { error: "Profesional inválida." };

  const supabase = await serverSupabase();
  const [{ data: services }, { data: current }] = await Promise.all([
    supabase.from("services").select("id, name").eq("tenant_id", ctx.tenantId).is("archived_at", null),
    supabase.from("professional_services").select("id, service_id").eq("tenant_id", ctx.tenantId).eq("professional_id", pro.data),
  ]);
  if (!services || !current) return { error: "No pudimos cargar los servicios." };

  const wanted: { service_id: string; price_minor_override: number | null; duration_minutes_override: number | null }[] = [];
  for (const s of services) {
    if (formData.get(`svc_${s.id}`) !== "on") continue;
    const o = overrideSchema.safeParse({ price: String(formData.get(`price_${s.id}`) ?? ""), duration: String(formData.get(`dur_${s.id}`) ?? "") });
    if (!o.success) return { error: `${s.name}: ${firstIssue(o.error)}` };
    wanted.push({ service_id: s.id, price_minor_override: o.data.price, duration_minutes_override: o.data.duration });
  }

  const toRemove = current.filter((c) => !wanted.some((w) => w.service_id === c.service_id)).map((c) => c.id);
  if (toRemove.length) {
    const { error } = await supabase.from("professional_services").delete().in("id", toRemove).eq("tenant_id", ctx.tenantId);
    if (error) return { error: userFacingDbError(error) };
  }
  // Altas nuevas por un lado y cambios de precio/duración por otro: un upsert intentaría
  // actualizar tenant_id, que a propósito no se puede modificar.
  const existing = new Map(current.map((c) => [c.service_id, c.id]));
  const toInsert = wanted.filter((w) => !existing.has(w.service_id));
  if (toInsert.length) {
    const { error } = await supabase
      .from("professional_services")
      .insert(toInsert.map((w) => ({ ...w, tenant_id: ctx.tenantId, professional_id: pro.data })));
    if (error) return { error: userFacingDbError(error) };
  }
  for (const w of wanted.filter((x) => existing.has(x.service_id))) {
    const { error } = await supabase
      .from("professional_services")
      .update({ price_minor_override: w.price_minor_override, duration_minutes_override: w.duration_minutes_override })
      .eq("id", existing.get(w.service_id)!)
      .eq("tenant_id", ctx.tenantId);
    if (error) return { error: userFacingDbError(error) };
  }
  revalidatePath("/", "layout");
  return { ok: `Guardamos ${wanted.length} ${wanted.length === 1 ? "servicio" : "servicios"}.` };
}

export async function setProfessionalFlagAction(formData: FormData): Promise<void> {
  const ctx = await manager();
  const id = uuid.safeParse(formData.get("id"));
  const action = formData.get("action");
  if (!ctx || !id.success) return;
  const patch =
    action === "archive" ? { archived_at: new Date().toISOString(), is_active: false, membership_id: null }
    : action === "restore" ? { archived_at: null }
    : null;
  if (!patch) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.from("professionals").update(patch).eq("id", id.data).eq("tenant_id", ctx.tenantId);
  if (error) console.error("setProfessionalFlag", userFacingDbError(error));
  revalidatePath("/", "layout");
  if (action === "archive") redirect("/admin/profesionales");
}
