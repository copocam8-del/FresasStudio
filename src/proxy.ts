import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { classifyHost, rewritePath } from "@/lib/host";

/**
 * Enruta cada request según el host (ver src/lib/host.ts):
 *   {slug}.<raíz>        → /sites/{slug}/…   (sitio del estudio y su panel en /admin)
 *   admin.<raíz>         → /platform/…       (Cleo Admin)
 *   <raíz>, www, vercel  → /…                (sitio de Cleo)
 *   dominio propio       → /sites/{dominio}/…
 *
 * Las rutas internas (/sites, /platform) dan 404 si se piden directo.
 *
 * El proxy NO autoriza: cada página, Server Action y Route Handler vuelve a
 * verificar sesión y permisos.
 */
export function proxy(request: NextRequest) {
  const kind = classifyHost(request.headers.get("host"), publicEnv().NEXT_PUBLIC_ROOT_DOMAIN);
  const pathname = request.nextUrl.pathname;
  const target = rewritePath(kind, pathname);

  if (target === null) {
    // Ruta que no existe: Next responde con la página 404 neutra y estado 404.
    const url = request.nextUrl.clone();
    url.pathname = "/_not-found";
    return NextResponse.rewrite(url, { status: 404 });
  }
  if (target === pathname) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url);
}

export const config = {
  // Todo menos archivos estáticos e imágenes optimizadas.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
