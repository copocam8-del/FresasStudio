import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Cliente sin sesión para lecturas públicas (página pública de un estudio).
 * Usa la clave publishable: solo puede lo que la base permite a "anon" (las RPC
 * públicas). No guarda ni refresca sesiones.
 */
export function publicSupabase() {
  const env = publicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
