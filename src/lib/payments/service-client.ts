import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { requirePaymentsConfig } from "@/lib/payments/config";

/**
 * Cliente con la clave SECRETA de Supabase (service_role). Solo para las funciones
 * `svc_mp_*` de pagos, que no tienen grant para nadie más:
 *   - webhook y revisión periódica (no hay una usuaria detrás),
 *   - leer y rotar los tokens cifrados de Mercado Pago.
 * Nunca para leer o escribir tablas de negocio salteando RLS en flujos de usuarias:
 * esas validaciones las hacen las RPC con la sesión de la persona.
 */
export function serviceSupabase() {
  const cfg = requirePaymentsConfig();
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, cfg.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "public" },
  });
}
