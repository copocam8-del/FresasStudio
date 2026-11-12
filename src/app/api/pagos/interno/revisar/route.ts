import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { paymentsConfig } from "@/lib/payments/config";
import { dailyTasks, reconcile } from "@/lib/payments/flows";

/**
 * Tareas internas de pagos. Las llama pg_cron (+ pg_net) desde Supabase:
 *   POST /api/pagos/interno/revisar            cada 10 min: revisión de pagos (P9)
 *   POST /api/pagos/interno/revisar?tarea=diaria  una vez por día: renovar tokens y limpiar
 * Protegido con CRON_SECRET (encabezado Authorization: Bearer …).
 */
export const maxDuration = 60;

function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function POST(request: NextRequest) {
  const cfg = paymentsConfig();
  if (!cfg) return NextResponse.json({ ok: false }, { status: 503 });
  if (!authorized(request, cfg.cronSecret)) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    if (request.nextUrl.searchParams.get("tarea") === "diaria") {
      return NextResponse.json({ ok: true, ...(await dailyTasks()) });
    }
    return NextResponse.json({ ok: true, ...(await reconcile()) });
  } catch (e) {
    console.error("Tarea de pagos", e instanceof Error ? e.message.slice(0, 80) : "error");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
