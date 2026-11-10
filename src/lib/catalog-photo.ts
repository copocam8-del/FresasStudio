import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectImageType, LOGO_MAX_BYTES, LOGO_MIME } from "@/lib/brand";
import { publicEnv } from "@/lib/env";

/**
 * Fotos de servicios y profesionales (bucket público "catalog"). Mismas protecciones
 * que el logo: tipo real por los bytes, máximo 1 MB, sin SVG, y se sube con la sesión
 * de la persona (Storage solo deja escribir en la carpeta de su estudio con
 * services.manage).
 */
export type PhotoKind = "services" | "professionals";

export function catalogPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${publicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/catalog/${path}`;
}

export async function uploadCatalogPhoto(
  supabase: SupabaseClient,
  tenantId: string,
  kind: PhotoKind,
  file: FormDataEntryValue | null,
): Promise<{ path: string | null; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { path: null };
  if (file.size > LOGO_MAX_BYTES) return { path: null, error: "La foto pesa más de 1 MB. Probá con una más liviana." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) return { path: null, error: "La foto tiene que ser PNG, JPG o WebP." };

  const path = `${tenantId}/${kind}/${crypto.randomUUID()}.${type}`;
  const { error } = await supabase.storage.from("catalog").upload(path, bytes, { contentType: LOGO_MIME[type], upsert: false });
  if (error) {
    console.error("upload catalog photo", error.message);
    return { path: null, error: "No pudimos subir la foto. Probá de nuevo." };
  }
  return { path };
}

export async function removeCatalogPhoto(supabase: SupabaseClient, path: string | null | undefined) {
  if (!path) return;
  const { error } = await supabase.storage.from("catalog").remove([path]);
  if (error) console.error("remove catalog photo", error.message);
}
