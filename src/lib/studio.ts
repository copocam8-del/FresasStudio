import "server-only";
import { cache } from "react";
import { siteKeyFromParam } from "@/lib/host";
import { publicSupabase } from "@/lib/supabase/public";

/** Datos públicos de un estudio (lo que devuelve public.get_public_studio). */
export type PublicStudio = {
  slug: string;
  name: string;
  description: string | null;
  timezone: string;
  currency: string;
  contact: Record<string, unknown>;
  brand: Record<string, unknown>;
  deposit_percent: number;
  cancellation_window_hours: number;
  policy_text: string | null;
  policy_version: number;
};

/**
 * Resuelve el estudio a partir del segmento [site] de /sites/[site] (un slug o un
 * dominio propio). Devuelve null si no existe, está suspendido o el valor es inválido.
 * Se cachea por request: layout, metadata y página comparten una sola consulta.
 */
export const getStudio = cache(async (siteParam: string): Promise<PublicStudio | null> => {
  const key = siteKeyFromParam(siteParam);
  if (!key) return null;

  const supabase = publicSupabase();
  let slug: string;

  if (key.by === "slug") {
    slug = key.slug;
  } else {
    const { data, error } = await supabase.rpc("resolve_custom_domain", { p_domain: key.domain });
    if (error) {
      // Mientras no exista la función (o si falla), un dominio propio simplemente no resuelve.
      console.error("resolve_custom_domain", error.message);
      return null;
    }
    if (typeof data !== "string" || !data) return null;
    slug = data;
  }

  const { data, error } = await supabase.rpc("get_public_studio", { p_slug: slug });
  if (error) throw new Error(`No se pudo cargar el estudio: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  return (row as PublicStudio | undefined) ?? null;
});

/** Catálogo público (public.get_public_catalog): solo lo activo y visible. */
export type PublicCatalog = {
  currency: string;
  categories: { id: string; name: string }[];
  services: {
    id: string;
    category_id: string | null;
    name: string;
    description: string | null;
    duration_minutes: number;
    price_minor: number;
    price_is_from: boolean;
    photo_path: string | null;
    professional_ids: string[];
  }[];
  professionals: { id: string; display_name: string; bio: string | null; photo_path: string | null; service_ids: string[] }[];
};

export const getPublicCatalog = cache(async (slug: string): Promise<PublicCatalog | null> => {
  const { data, error } = await publicSupabase().rpc("get_public_catalog", { p_slug: slug });
  if (error) throw new Error(`No se pudo cargar el catálogo: ${error.message}`);
  return (data as PublicCatalog | null) ?? null;
});
