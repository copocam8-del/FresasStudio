"use server";

import { revalidatePath } from "next/cache";
import { can, currentStaff } from "@/lib/auth";
import { type Brand, checkBrand, detectImageType, LOGO_MAX_BYTES, LOGO_MIME, parseBrand } from "@/lib/brand";
import { isHexColor } from "@/lib/color";
import { serverSupabase } from "@/lib/supabase/server";

export type BrandState = { error?: string; ok?: string } | undefined;

/**
 * Guarda colores y logo del estudio del HOST actual. Valida acá para dar mensajes
 * claros; la base vuelve a validar todo (app.validate_brand) y Storage solo deja
 * escribir en la carpeta del estudio con settings.manage.
 */
export async function saveBrandAction(_prev: BrandState, formData: FormData): Promise<BrandState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "settings.manage")) return { error: "No tenés permiso para cambiar la marca." };

  // Marca propia: sin esto el estudio se ve con la marca Cleo (se guarda igual lo cargado).
  const brand: Brand = { enabled: formData.get("enabled") === "on" };
  for (const key of ["primary", "accent", "background"] as const) {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) continue; // vacío = usar el color por defecto
    if (!isHexColor(raw)) return { error: "Uno de los colores no es válido." };
    brand[key] = raw.toLowerCase();
  }
  const issues = checkBrand(brand);
  if (issues.length > 0) return { error: issues.map((i) => i.message).join(" ") };

  const supabase = await serverSupabase();
  const { data: current, error: readError } = await supabase
    .from("tenant_settings")
    .select("brand")
    .eq("tenant_id", ctx.tenantId)
    .single();
  if (readError) return { error: "No pudimos leer la marca actual. Probá de nuevo." };
  const previousLogo = parseBrand(current.brand).logo_path;

  const removeLogo = formData.get("remove_logo") === "on";
  const file = formData.get("logo");
  let uploaded: string | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > LOGO_MAX_BYTES) return { error: "El logo pesa más de 1 MB. Probá con una imagen más liviana." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type) return { error: "El logo tiene que ser una imagen PNG, JPG o WebP." };
    uploaded = `${ctx.tenantId}/logo-${crypto.randomUUID()}.${type}`;
    const { error } = await supabase.storage
      .from("brand")
      .upload(uploaded, bytes, { contentType: LOGO_MIME[type], upsert: false });
    if (error) {
      console.error("upload logo", error.message);
      return { error: "No pudimos subir el logo. Probá de nuevo." };
    }
    brand.logo_path = uploaded;
  } else if (previousLogo && !removeLogo) {
    brand.logo_path = previousLogo;
  }

  const { error } = await supabase.from("tenant_settings").update({ brand }).eq("tenant_id", ctx.tenantId);
  if (error) {
    if (uploaded) await supabase.storage.from("brand").remove([uploaded]);
    if (error.code === "22023") return { error: error.message };
    console.error("update brand", error.code, error.message);
    return { error: "No pudimos guardar la marca. Probá de nuevo." };
  }

  // El logo anterior ya no se usa: se borra (si falla, solo queda un archivo huérfano).
  if (previousLogo && previousLogo !== brand.logo_path) {
    const { error: removeError } = await supabase.storage.from("brand").remove([previousLogo]);
    if (removeError) console.error("remove old logo", removeError.message);
  }

  revalidatePath("/", "layout");
  return { ok: "Listo, guardamos la marca. Ya se ve en el sitio y en el panel." };
}
