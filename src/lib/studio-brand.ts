import "server-only";
import { logoUrl } from "@/lib/brand";
import { publicEnv } from "@/lib/env";
import type { PublicStudio } from "@/lib/studio";

/** URL pública del logo del estudio, o null si no tiene. */
export function studioLogo(studio: PublicStudio): string | null {
  return logoUrl(publicEnv().NEXT_PUBLIC_SUPABASE_URL, studio.brand);
}
