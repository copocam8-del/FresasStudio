import "server-only";
import type { BrandInfo } from "@/components/cleo/brand";
import { logoUrl, usesOwnBrand } from "@/lib/brand";
import { publicEnv } from "@/lib/env";
import type { PublicStudio } from "@/lib/studio";

/** URL pública del logo del estudio, solo si activó su marca propia (si no, se ve Cleo). */
export function studioLogo(studio: PublicStudio): string | null {
  if (!usesOwnBrand(studio.brand)) return null;
  return logoUrl(publicEnv().NEXT_PUBLIC_SUPABASE_URL, studio.brand);
}

/** Qué marca mostrar: Cleo por defecto, o la del estudio si la activó. */
export function studioBrand(studio: PublicStudio): BrandInfo {
  return { name: studio.name, ownBrand: usesOwnBrand(studio.brand), logoSrc: studioLogo(studio) };
}
