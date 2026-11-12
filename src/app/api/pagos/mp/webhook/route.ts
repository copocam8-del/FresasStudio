import { NextResponse, type NextRequest } from "next/server";
import { AccountUnavailableError } from "@/lib/payments/accounts";
import { paymentsConfig } from "@/lib/payments/config";
import { processPayment } from "@/lib/payments/flows";
import { MpError } from "@/lib/payments/mp-api";
import { serviceSupabase } from "@/lib/payments/service-client";
import { verifyWebhookSignature } from "@/lib/payments/signature";

/**
 * Avisos (webhooks) de Mercado Pago. Una sola URL para todos los estudios, configurada
 * en la aplicación (Webhooks → Configurar notificaciones). El estudio sale del
 * `user_id` del aviso (la cuenta conectada por OAuth).
 *
 *   1. Firma x-signature (filtro).  2. Bandeja idempotente por x-request-id.
 *   3. Consulta del pago a la API con el token del estudio.  4. La base decide.
 *
 * Responde 200 a todo lo que no hay que reintentar y 500 solo ante errores
 * temporales (Mercado Pago reintenta y, además, la revisión cada 10 min lo levanta).
 */
const ok = (result: string) => NextResponse.json({ ok: true, result }, { status: 200 });

export async function POST(request: NextRequest) {
  const cfg = paymentsConfig();
  if (!cfg) return NextResponse.json({ ok: false }, { status: 503 });

  const raw = await request.text();
  if (raw.length > 20_000) return NextResponse.json({ ok: false }, { status: 413 });
  let body: { type?: unknown; topic?: unknown; action?: unknown; user_id?: unknown; data?: { id?: unknown } } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }

  const params = request.nextUrl.searchParams;
  const queryId = params.get("data.id") ?? params.get("id");
  const dataId = queryId ?? (body.data?.id != null ? String(body.data.id) : null);
  const type = String(params.get("type") ?? params.get("topic") ?? body.type ?? body.topic ?? "");
  const requestId = request.headers.get("x-request-id");

  const signed = verifyWebhookSignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: requestId,
    dataId: queryId ?? dataId,
    secret: cfg.webhookSecret,
  });
  if (!signed) return NextResponse.json({ ok: false }, { status: 401 });

  if (type !== "payment") return ok("ignored_topic");
  if (!dataId || !/^\d{1,20}$/.test(dataId) || !requestId || requestId.length > 100) return ok("ignored_malformed");
  const userId = Number(body.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return ok("ignored_no_user");

  const db = serviceSupabase();
  const { data: accounts, error: accError } = await db.rpc("svc_mp_account_by_user", { p_mp_user_id: userId });
  if (accError) return NextResponse.json({ ok: false }, { status: 500 });
  const account = (accounts as Array<{ account_id: string; status: string }>)[0];
  // Cuenta desconocida o desconectada: no hay nada que hacer (no damos pistas).
  if (!account || account.status !== "connected") return ok("ignored_account");

  const { data: inbox, error: inboxError } = await db.rpc("svc_mp_record_notification", {
    p_account: account.account_id,
    p_request_id: requestId,
    p_topic: type,
    p_resource_id: dataId,
  });
  if (inboxError) return NextResponse.json({ ok: false }, { status: 500 });
  if (inbox === "duplicate") return ok("duplicate");

  try {
    const outcome = await processPayment(account.account_id, dataId, "webhook");
    await db.rpc("svc_mp_notification_done", { p_request_id: requestId, p_result: outcome });
    return ok(outcome);
  } catch (e) {
    if (e instanceof AccountUnavailableError || (e instanceof MpError && e.status === 404)) {
      // Acceso revocado o pago inexistente para esa cuenta: reintentar no sirve.
      await db.rpc("svc_mp_notification_done", {
        p_request_id: requestId,
        p_result: e instanceof MpError ? "not_found" : "account_unavailable",
      });
      return ok("not_processed");
    }
    console.error("Webhook de Mercado Pago", e instanceof MpError ? e.message : e instanceof Error ? e.message.slice(0, 80) : "error");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
