import "server-only";
import { userFacingDbError } from "@/lib/db-errors";
import { AccountUnavailableError, refreshAccount, withAccount } from "@/lib/payments/accounts";
import { requirePaymentsConfig } from "@/lib/payments/config";
import {
  createPreference, getPayment, MpError, normalizePayment, refundPayment, searchPaymentsByReference,
  type MpPayment,
} from "@/lib/payments/mp-api";
import { buildDepositPreference } from "@/lib/payments/preference";
import { serviceSupabase } from "@/lib/payments/service-client";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Flujos de pago del servidor. La regla de oro: NADA se confirma por lo que diga el
 * navegador ni el aviso de Mercado Pago. Todo pago se consulta a la API de Mercado
 * Pago con el token del estudio y la base decide (svc_mp_sync_payment).
 */

// ---------------------------------------------------------------------------
// "Pagar seña": link de Checkout Pro en la cuenta del estudio
// ---------------------------------------------------------------------------

type CheckoutRow = {
  intent_id: string;
  account_id: string;
  checkout_url: string | null;
  amount_minor: number;
  currency: string;
  expires_at: string;
  service_name: string;
  studio_name: string;
  code: string;
};

export type CheckoutResult = { url: string } | { error: string };

/**
 * La clienta (con su sesión) pide pagar SU reserva. start_deposit_checkout valida
 * dueña, estado y vencimiento y fija el monto; recién después se usa el token del
 * estudio para crear la preferencia.
 */
export async function createDepositCheckout(slug: string, code: string, origin: string): Promise<CheckoutResult> {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("start_deposit_checkout", { p_slug: slug, p_code: code });
  if (error) return { error: userFacingDbError(error) };
  const row = (data as CheckoutRow[])[0];
  if (!row) return { error: "No encontramos tu reserva." };
  if (row.checkout_url) return { url: row.checkout_url };

  const cfg = requirePaymentsConfig();
  try {
    const body = buildDepositPreference({
      intentId: row.intent_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      serviceName: row.service_name,
      studioName: row.studio_name,
      expiresAt: new Date(row.expires_at).toISOString(),
      returnUrl: `${origin}/reserva/${row.code}?pago=volvio`,
    });
    const pref = await withAccount(row.account_id, (token) =>
      createPreference(cfg.mp, token, body, `pref-${row.intent_id}`));
    const { data: url, error: setError } = await serviceSupabase().rpc("svc_mp_set_preference", {
      p_intent: row.intent_id,
      p_preference_id: pref.id,
      p_checkout_url: pref.init_point,
    });
    if (setError || typeof url !== "string") return { error: "Tu reserva ya no está esperando pago." };
    return { url };
  } catch (e) {
    if (e instanceof AccountUnavailableError) {
      return { error: "El estudio no puede cobrar online en este momento. Escribile para pagar la seña." };
    }
    console.error("Crear preferencia", e instanceof MpError ? e.message : "error");
    return { error: "Mercado Pago no respondió. Probá de nuevo en unos minutos." };
  }
}

// ---------------------------------------------------------------------------
// Registrar un pago (webhook o revisión)
// ---------------------------------------------------------------------------

type SyncRow = { payment_id: string | null; outcome: string | null; refund_id: string | null; ignored_reason: string | null };

async function syncVerified(accountId: string, p: MpPayment, via: "webhook" | "reconcile"): Promise<string> {
  const n = normalizePayment(p);
  const { data, error } = await serviceSupabase().rpc("svc_mp_sync_payment", {
    p_account: accountId,
    p_payment: n,
    p_via: via,
  });
  if (error) throw new Error(`svc_mp_sync_payment: ${error.code}`);
  const row = (data as SyncRow[])[0];
  if (row?.refund_id) await processRefund(row.refund_id, accountId, n.provider_payment_id);
  return row?.outcome ?? row?.ignored_reason ?? "unknown";
}

/** Consulta el pago a Mercado Pago con el token del estudio y lo registra. */
export async function processPayment(accountId: string, paymentId: string, via: "webhook" | "reconcile"): Promise<string> {
  const cfg = requirePaymentsConfig();
  const payment = await withAccount(accountId, (token) => getPayment(cfg.mp, token, paymentId));
  return syncVerified(accountId, payment, via);
}

/**
 * Devolución total por Mercado Pago. La clave de idempotencia (id de la devolución)
 * evita devolver dos veces aunque se reintente. Errores temporales (red, 5xx): queda
 * pedida y la revisión periódica la reintenta.
 */
export async function processRefund(refundId: string, accountId: string, providerPaymentId: string): Promise<void> {
  const cfg = requirePaymentsConfig();
  const db = serviceSupabase();
  try {
    const r = await withAccount(accountId, (token) => refundPayment(cfg.mp, token, providerPaymentId, `refund-${refundId}`));
    await db.rpc("svc_mp_refund_result", { p_refund: refundId, p_ok: true, p_provider_refund_id: r.id, p_error: null });
  } catch (e) {
    const temporary = e instanceof MpError ? e.status === 0 || e.status >= 500 : !(e instanceof AccountUnavailableError);
    if (temporary) {
      console.error("Devolución (se reintenta)", e instanceof MpError ? e.message : "error");
      return;
    }
    const code = e instanceof MpError ? e.code : "account_unavailable";
    await db.rpc("svc_mp_refund_result", { p_refund: refundId, p_ok: false, p_provider_refund_id: null, p_error: code });
  }
}

// ---------------------------------------------------------------------------
// Revisión periódica (P9) y tareas diarias
// ---------------------------------------------------------------------------

export type ReconcileReport = { checked: number; synced: number; refunds: number; errors: number; refreshed?: number };

export async function reconcile(): Promise<ReconcileReport> {
  const cfg = requirePaymentsConfig();
  const db = serviceSupabase();
  const report: ReconcileReport = { checked: 0, synced: 0, refunds: 0, errors: 0 };

  const { data: targets, error } = await db.rpc("svc_mp_reconcile_targets");
  if (error) throw new Error(`svc_mp_reconcile_targets: ${error.code}`);
  for (const t of targets as Array<{ kind: "intent" | "payment"; account_id: string; reference: string }>) {
    report.checked++;
    try {
      if (t.kind === "intent") {
        const found = await withAccount(t.account_id, (token) => searchPaymentsByReference(cfg.mp, token, t.reference));
        for (const p of found) {
          await syncVerified(t.account_id, p, "reconcile");
          report.synced++;
        }
      } else {
        await processPayment(t.account_id, t.reference, "reconcile");
        report.synced++;
      }
    } catch (e) {
      report.errors++;
      console.error("Revisión de pagos", t.kind, e instanceof MpError ? e.message : e instanceof Error ? e.name : "error");
    }
  }

  const { data: refunds } = await db.rpc("svc_mp_pending_refunds");
  for (const r of (refunds ?? []) as Array<{ refund_id: string; account_id: string; provider_payment_id: string }>) {
    report.refunds++;
    await processRefund(r.refund_id, r.account_id, r.provider_payment_id).catch(() => { report.errors++; });
  }
  return report;
}

/** Una vez por día: renovar tokens que vencen en menos de 30 días y limpiar. */
export async function dailyTasks(): Promise<{ refreshed: number; errors: number }> {
  const db = serviceSupabase();
  const before = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.rpc("svc_mp_accounts_to_refresh", { p_before: before });
  if (error) throw new Error(`svc_mp_accounts_to_refresh: ${error.code}`);
  let refreshed = 0;
  let errors = 0;
  for (const a of data as Array<{ account_id: string }>) {
    try {
      if (await refreshAccount(a.account_id)) refreshed++;
    } catch {
      errors++;
    }
  }
  await db.rpc("svc_mp_housekeeping");
  return { refreshed, errors };
}
