import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { classifyHost, isPlatformApiPath, rewritePath } from "@/lib/host";
import { withSessionRefresh } from "@/lib/supabase/session";

/**
 * Enruta cada request según el host (ver src/lib/host.ts):
 *   {slug}.<raíz>        → /sites/{slug}/…   (sitio del estudio y su panel en /admin)
 *   admin.<raíz>         → /platform/…       (Cleo Admin)
 *   <raíz>, www, render  → /…                (sitio de Cleo)
 *   dominio propio       → /sites/{dominio}/…
 *
 * Las rutas internas (/sites, /platform) dan 404 si se piden directo.
 * En los sitios de estudios y en Cleo Admin además refresca la sesión de Supabase.
 *
 * El proxy NO autoriza: cada página, Server Action y Route Handler vuelve a
 * verificar sesión y permisos.
 */
export async function proxy(request: NextRequest) {
  const kind = classifyHost(request.headers.get("host"), publicEnv().NEXT_PUBLIC_ROOT_DOMAIN);
  const pathname = request.nextUrl.pathname;
  const target = rewritePath(kind, pathname);

  if (target === null) {
    const url = request.nextUrl.clone();
    url.pathname = "/_not-found";
    return NextResponse.rewrite(url, { status: 404 });
  }

  // Webhooks y OAuth de pagos: sin sesión ni reescritura, en cualquier host.
  if (isPlatformApiPath(pathname)) return NextResponse.next({ request });

  const url = request.nextUrl.clone();
  url.pathname = target;
  const makeResponse = () =>
    target === pathname ? NextResponse.next({ request }) : NextResponse.rewrite(url, { request });

  if (kind.kind === "root") return makeResponse();
  return withSessionRefresh(request, makeResponse);
}

export const config = {
  // Todo menos archivos estáticos e imágenes optimizadas.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
