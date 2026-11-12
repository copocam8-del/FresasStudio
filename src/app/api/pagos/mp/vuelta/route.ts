import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { isValidSlug } from "@/lib/host";

/**
 * URL de vuelta de OAuth registrada en Mercado Pago (una sola para todos los
 * estudios: cleo.com.ar/api/pagos/mp/vuelta, o el túnel en desarrollo).
 *
 * No hace NADA con el código: solo lo reenvía al subdominio del estudio (el slug va
 * al principio del state), donde está la sesión de la dueña y se valida todo.
 * Solo reenvía a {slug}.<dominio raíz>: no sirve como redirección abierta.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const slug = state.split(".")[0];
  if (!isValidSlug(slug)) {
    return new NextResponse("El enlace de vuelta no es válido. Volvé al panel y probá de nuevo.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const root = publicEnv().NEXT_PUBLIC_ROOT_DOMAIN;
  const proto = /^localhost(:\d+)?$/.test(root) ? "http" : "https";
  const target = new URL(`${proto}://${slug}.${root}/admin/pagos/vuelta`);
  for (const key of ["code", "state", "error"]) {
    const v = params.get(key);
    if (v) target.searchParams.set(key, v);
  }
  return NextResponse.redirect(target, { status: 303 });
}
