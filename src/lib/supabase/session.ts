import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";

/**
 * Refresca la sesión de Supabase en el proxy (si hay cookies de auth) y devuelve la
 * respuesta con las cookies nuevas. `makeResponse` arma la respuesta (next o rewrite)
 * a partir del request con las cookies ya actualizadas.
 *
 * No decide nada de permisos: solo mantiene la sesión al día.
 */
export async function withSessionRefresh(
  request: NextRequest,
  makeResponse: () => NextResponse,
): Promise<NextResponse> {
  let response = makeResponse();
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!hasAuthCookie) return response;

  const env = publicEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = makeResponse();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Respuestas que setean cookies de sesión no se pueden cachear (CDN).
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch (error) {
    // Si Auth no responde, la página sigue y la verificación en el servidor decide.
    console.error("No se pudo refrescar la sesión", error);
  }
  return response;
}
