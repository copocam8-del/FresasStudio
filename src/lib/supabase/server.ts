import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Cliente con la sesión de la persona (cookies del host actual). Todo lo que hace
 * pasa por RLS como "authenticated" (o "anon" si no hay sesión).
 *
 * Las cookies son del host: iniciar sesión en fresas.cleo.com.ar no abre sesión en
 * otro estudio ni en Cleo Admin.
 *
 * Crear uno nuevo por request (no reutilizar entre requests).
 */
export async function serverSupabase() {
  const env = publicEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // En Server Components no se pueden escribir cookies; el proxy ya refresca la sesión.
        }
      },
    },
  });
}
