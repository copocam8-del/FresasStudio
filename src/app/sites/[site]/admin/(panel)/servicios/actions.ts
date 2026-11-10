"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { removeCatalogPhoto, uploadCatalogPhoto } from "@/lib/catalog-photo";
import { categorySchema, firstIssue, serviceSchema } from "@/lib/catalog-schemas";
import { userFacingDbError } from "@/lib/db-errors";
import { serverSupabase } from "@/lib/supabase/server";

export type CatalogState = { error?: string; ok?: string } | undefined;

const uuid = z.uuid();

async function manager() {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "services.manage")) return null;
  return ctx;
}

// ---------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------
export async function saveServiceAction(_prev: CatalogState, formData: FormData): Promise<CatalogState> {
  const ctx = await manager();
  if (!ctx) return { error: "No tenés permiso para editar servicios." };

  const id = formData.get("id") ? uuid.safeParse(formData.get("id")) : null;
  if (id && !id.success) return { error: "Servicio inválido." };

  const parsed = serviceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await serverSupabase();
  let previousPhoto: string | null = null;
  if (id) {
    const { data } = await supabase.from("services").select("photo_path").eq("id", id.data).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!data) return { error: "No encontramos el servicio." };
    previousPhoto = data.photo_path;
  }

  const upload = await uploadCatalogPhoto(supabase, ctx.tenantId, "services", formData.get("photo"));
  if (upload.error) return { error: upload.error };
  const removePhoto = formData.get("remove_photo") === "on";
  const photo_path = upload.path ?? (removePhoto ? null : previousPhoto);

  const row = { ...parsed.data, photo_path };
  const { error } = id
    ? await supabase.from("services").update(row).eq("id", id.data).eq("tenant_id", ctx.tenantId)
    : await supabase.from("services").insert({ ...row, tenant_id: ctx.tenantId, position: 1000 });
  if (error) {
    if (upload.path) await removeCatalogPhoto(supabase, upload.path);
    return { error: userFacingDbError(error) };
  }
  if (previousPhoto && previousPhoto !== photo_path) await removeCatalogPhoto(supabase, previousPhoto);

  revalidatePath("/", "layout");
  redirect("/admin/servicios");
}

export async function setServiceFlagAction(formData: FormData): Promise<void> {
  const ctx = await manager();
  const id = uuid.safeParse(formData.get("id"));
  const action = formData.get("action");
  if (!ctx || !id.success) return;
  const patch =
    action === "activate" ? { is_active: true }
    : action === "deactivate" ? { is_active: false }
    : action === "archive" ? { archived_at: new Date().toISOString(), is_active: false }
    : action === "restore" ? { archived_at: null }
    : null;
  if (!patch) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.from("services").update(patch).eq("id", id.data).eq("tenant_id", ctx.tenantId);
  if (error) console.error("setServiceFlag", userFacingDbError(error));
  revalidatePath("/", "layout");
  if (action === "archive") redirect("/admin/servicios");
}

/** Sube o baja un elemento dentro de su lista (servicios de una categoría, o categorías). */
async function move(table: "services" | "service_categories", formData: FormData) {
  const ctx = await manager();
  const id = uuid.safeParse(formData.get("id"));
  const dir = formData.get("dir");
  if (!ctx || !id.success || (dir !== "up" && dir !== "down")) return;
  const supabase = await serverSupabase();

  let query = supabase.from(table).select("id, position, name").eq("tenant_id", ctx.tenantId);
  if (table === "services") {
    const { data: current } = await supabase.from("services").select("category_id").eq("id", id.data).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!current) return;
    query = current.category_id ? query.eq("category_id", current.category_id) : query.is("category_id", null);
    query = query.is("archived_at", null);
  }
  const { data: rows } = await query.order("position").order("name");
  if (!rows) return;
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(id.data);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  // Renumera (las listas son cortas). RLS vuelve a validar cada fila.
  for (const [pos, rowId] of ids.entries()) {
    if (rows.find((r) => r.id === rowId)?.position !== pos) {
      const { error } = await supabase.from(table).update({ position: pos }).eq("id", rowId).eq("tenant_id", ctx.tenantId);
      if (error) return console.error("move", userFacingDbError(error));
    }
  }
  revalidatePath("/", "layout");
}

export async function moveServiceAction(formData: FormData): Promise<void> {
  await move("services", formData);
}

// ---------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------
export async function saveCategoryAction(_prev: CatalogState, formData: FormData): Promise<CatalogState> {
  const ctx = await manager();
  if (!ctx) return { error: "No tenés permiso para editar categorías." };
  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const id = formData.get("id") ? uuid.safeParse(formData.get("id")) : null;
  if (id && !id.success) return { error: "Categoría inválida." };

  const supabase = await serverSupabase();
  const { error } = id
    ? await supabase.from("service_categories").update({ name: parsed.data.name }).eq("id", id.data).eq("tenant_id", ctx.tenantId)
    : await supabase.from("service_categories").insert({ tenant_id: ctx.tenantId, name: parsed.data.name, position: 1000 });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath("/", "layout");
  return { ok: id ? "Guardamos el nombre." : `Agregamos la categoría «${parsed.data.name}».` };
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const ctx = await manager();
  const id = uuid.safeParse(formData.get("id"));
  if (!ctx || !id.success) return;
  const supabase = await serverSupabase();
  const { error } = await supabase
    .from("service_categories")
    .update({ is_active: formData.get("active") === "true" })
    .eq("id", id.data)
    .eq("tenant_id", ctx.tenantId);
  if (error) console.error("setCategoryActive", userFacingDbError(error));
  revalidatePath("/", "layout");
}

export async function moveCategoryAction(formData: FormData): Promise<void> {
  await move("service_categories", formData);
}
