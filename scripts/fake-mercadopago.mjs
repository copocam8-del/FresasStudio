// Mercado Pago SIMULADO para los e2e de pagos (solo en la propia máquina).
// Imita lo que usa Cleo: OAuth con PKCE y renovación, /users/me, preferencias,
// pagos, búsqueda y devoluciones. Las rutas /__… las maneja el e2e para simular lo
// que haría la compradora o Mercado Pago (pagar, vencer tokens, revocar, etc.).
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

export const FAKE_PORT = 4010;
export const SELLER = 3300001;      // vendedora de prueba (la cuenta del estudio)
export const OTHER_SELLER = 3300002; // otra cuenta
export const CLIENT_ID = "1234567890";
export const CLIENT_SECRET = "e2e-client-secret-0123456789";

const rand = () => randomBytes(12).toString("hex");

export function startFakeMercadoPago(port = FAKE_PORT) {
  const S = {
    codes: new Map(), access: new Map(), refresh: new Map(), prefs: new Map(), payments: new Map(),
    refunds: [], failRefunds: false, revoked: false, refreshCount: 0, nextPayment: 70000001,
  };

  const issue = (user) => {
    const access = `APP_USR-e2e-${rand()}`;
    const refresh = `TG-e2e-${rand()}`;
    S.access.set(access, user);
    S.refresh.set(refresh, user);
    return {
      access_token: access, token_type: "bearer", expires_in: 15552000, scope: "offline_access read write",
      user_id: user, refresh_token: refresh, public_key: `APP_USR-pub-${rand()}`, live_mode: false,
    };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    };
    const auth = () => S.access.get((req.headers.authorization ?? "").replace(/^Bearer /, "")) ?? null;
    const path = url.pathname;

    // ---------------- OAuth ----------------
    if (req.method === "GET" && path === "/authorization") {
      const code = `TG-code-${rand()}`;
      S.codes.set(code, { challenge: url.searchParams.get("code_challenge"), redirect: url.searchParams.get("redirect_uri") });
      const to = new URL(url.searchParams.get("redirect_uri"));
      to.searchParams.set("code", code);
      to.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: to.toString() });
      return res.end();
    }
    if (req.method === "POST" && path === "/oauth/token") {
      if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) return send(401, { error: "invalid_client" });
      if (body.grant_type === "authorization_code") {
        const c = S.codes.get(body.code);
        S.codes.delete(body.code);
        const challenge = body.code_verifier ? createHash("sha256").update(body.code_verifier).digest("base64url") : null;
        if (!c || c.redirect !== body.redirect_uri || c.challenge !== challenge) return send(400, { error: "invalid_grant" });
        return send(200, issue(SELLER));
      }
      if (body.grant_type === "refresh_token") {
        const user = S.refresh.get(body.refresh_token);
        if (!user || S.revoked) return send(400, { error: "invalid_grant", message: "invalid refresh token" });
        S.refresh.delete(body.refresh_token); // un solo uso: rota
        S.refreshCount++;
        return send(200, issue(user));
      }
      return send(400, { error: "unsupported_grant_type" });
    }

    // ---------------- Control del e2e ----------------
    if (path === "/__pay") {
      const pref = S.prefs.get(body.preference_id);
      if (!pref) return send(404, { error: "no_pref" });
      const id = S.nextPayment++;
      S.payments.set(String(id), {
        id, status: body.status ?? "approved", status_detail: body.status === "rejected" ? "cc_rejected_other_reason" : "accredited",
        transaction_amount: body.amount ?? pref.items[0].unit_price, transaction_amount_refunded: 0,
        currency_id: pref.items[0].currency_id, external_reference: pref.external_reference,
        collector_id: body.collector ?? pref.collector, live_mode: false, date_approved: new Date().toISOString(),
        payment_method_id: "visa", payment_type_id: "credit_card", installments: 1,
        fee_details: [{ amount: Math.round(pref.items[0].unit_price * 6.29) / 100 }],
        transaction_details: { net_received_amount: Math.round(pref.items[0].unit_price * 93.71) / 100 },
      });
      return send(200, { id });
    }
    if (path === "/__expire") { S.access.clear(); return send(200, { ok: true }); }
    if (path === "/__revoke") { S.revoked = true; S.access.clear(); return send(200, { ok: true }); }
    if (path === "/__reset") { S.revoked = false; S.failRefunds = false; return send(200, { ok: true }); }
    if (path === "/__fail_refunds") { S.failRefunds = Boolean(body.on); return send(200, { ok: true }); }
    if (path === "/__state") {
      return send(200, { prefs: [...S.prefs.values()], refunds: S.refunds, refreshCount: S.refreshCount });
    }

    // ---------------- API con token ----------------
    const user = auth();
    if (!user) return send(401, { message: "invalid_token", status: 401 });

    if (req.method === "GET" && path === "/users/me") {
      return send(200, { id: user, nickname: "VENDEDOR-PRUEBA-E2E", site_id: "MLA", tags: ["normal", "test_user"] });
    }
    if (req.method === "POST" && path === "/checkout/preferences") {
      const id = `${user}-${rand()}`;
      S.prefs.set(id, { ...body, id, collector: user, idempotency: req.headers["x-idempotency-key"] });
      return send(201, { id, init_point: `http://localhost:${port}/checkout/${id}` });
    }
    if (req.method === "GET" && path === "/v1/payments/search") {
      const ref = url.searchParams.get("external_reference");
      return send(200, { results: [...S.payments.values()].filter((p) => p.external_reference === ref && p.collector_id === user) });
    }
    let m = /^\/v1\/payments\/(\d+)$/.exec(path);
    if (req.method === "GET" && m) {
      const p = S.payments.get(m[1]);
      if (!p || p.collector_id !== user) return send(404, { message: "Payment not found", status: 404 });
      return send(200, p);
    }
    m = /^\/v1\/payments\/(\d+)\/refunds$/.exec(path);
    if (req.method === "POST" && m) {
      const p = S.payments.get(m[1]);
      if (!p || p.collector_id !== user) return send(404, { message: "Payment not found" });
      if (S.failRefunds) return send(400, { error: "insufficient_funds" });
      const key = req.headers["x-idempotency-key"];
      const prev = S.refunds.find((r) => r.key === key);
      if (prev) return send(201, { id: prev.id });
      const refund = { id: S.refunds.length + 9000001, payment: p.id, key };
      S.refunds.push(refund);
      p.status = "refunded";
      p.transaction_amount_refunded = p.transaction_amount;
      return send(201, { id: refund.id });
    }
    return send(404, { message: "not_found" });
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, state: S })));
}
