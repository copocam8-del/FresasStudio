import { z } from "zod";

/**
 * Variables públicas (van al navegador). Ninguna es secreta: la clave publishable
 * está protegida por RLS. La clave secret/service_role NO se lee acá ni en ningún
 * módulo que pueda llegar al cliente.
 *
 * Se leen con nombres literales (process.env.NEXT_PUBLIC_X) para que Next las incluya
 * en el bundle del cliente.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  // "cleo.com.ar" en producción, "localhost:3000" en desarrollo.
  NEXT_PUBLIC_ROOT_DOMAIN: z.string().regex(/^[a-z0-9.-]+(:\d+)?$/, "Dominio raíz inválido"),
});

export type PublicEnv = z.infer<typeof schema>;

let cached: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Faltan o son inválidas estas variables de entorno: ${missing}. Ver .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
