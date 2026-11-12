// Pruebas de punta a punta de Mercado Pago (Sprint 5), contra la app compilada y el
// Supabase de DESARROLLO, con un Mercado Pago SIMULADO en localhost:4010.
//
// Requiere: npm run build, el puerto 3000 libre (este script levanta su propio
// `next start` con las variables del simulado) y SUPABASE_SECRET_KEY en .env.local.
// Uso: node scripts/e2e-payments.mjs
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { done, F, FRESAS_ID, formFields, login, ok, req, supabaseAs } from "./e2e-lib.mjs";
import { CLIENT_ID, CLIENT_SECRET, FAKE_PORT, OTHER_SELLER, SELLER, startFakeMercadoPago } from "./fake-mercadopago.mjs";

const WEBHOOK_SECRET = "e2e-webhook-secret-0123456789";
const CRON_SECRET = "e2e-cron-secret-0123456789abcdefghijklmnop";
const FAKE = `http://localhost:${FAKE_PORT}`;
const SEMI = "31000000-0000-4000-a000-000000000001";
const OWNER = "duena@fresasstudio.test";
const clientEmail = (i) => `clienta${String(i).padStart(2, "0")}@e2e.test`;
const clientSession = (i) => login(F, clientEmail(i), "/admin/invitacion?token=x");
const strip = (h) => h.replace(/<!-- -->/g, "");

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (!env.SUPABASE_SECRET_KEY) {
  console.error("Falta SUPABASE_SECRET_KEY en .env.local (Supabase de DESARROLLO > Project Settings > API Keys > secret).");
  process.exit(1);
}
if (!existsSync(".next/BUILD_ID")) {
  console.error("Primero: npm run build");
  process.exit(1);
}

// ---------------------------------------------------------------------
// Mercado Pago simulado + app con sus variables
// ---------------------------------------------------------------------
const { server: fake } = await startFakeMercadoPago();
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3000"], {
  env: {
    ...process.env,
    MP_CLIENT_ID: CLIENT_ID,
    MP_CLIENT_SECRET: CLIENT_SECRET,
    MP_OAUTH_REDIRECT_URI: "http://localhost:3000/api/pagos/mp/vuelta",
    MP_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET,
    MP_API_BASE_URL: FAKE,
    MP_AUTH_BASE_URL: FAKE,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));
const finish = () => { app.kill(); fake.close(); done(); };
for (let i = 0; i < 60; i++) {
  if (/Ready in|started server|Local:/.test(appLog)) break;
  if (/EADDRINUSE/.test(appLog)) { console.error("El puerto 3000 está ocupado: detené el otro next start."); app.kill(); fake.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 500));

const fakePost = async (path, body = {}) => (await fetch(`${FAKE}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const fakeState = async () => (await fetch(`${FAKE}/__state`)).json();

/** Aviso de Mercado Pago firmado como lo firma Mercado Pago (o mal firmado). */
async function webhook(paymentId, { userId = SELLER, requestId = randomUUID(), type = "payment", badSignature = false } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", badSignature ? "otra-clave" : WEBHOOK_SECRET).update(manifest).digest("hex");
  const res = await fetch(`http://localhost:3000/api/pagos/mp/webhook?data.id=${paymentId}&type=${type}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${v1}` },
    body: JSON.stringify({ action: "payment.updated", api_version: "v1", type, data: { id: String(paymentId) }, user_id: userId, live_mode: false }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const owner = await supabaseAs(OWNER);
const ownerCookies = await login(F, OWNER);
const status = async () => (await owner.rpc("get_payments_status", { p_tenant: FRESAS_ID })).data?.[0];
const booking = async (sb, code) => (await sb.rpc("my_bookings", { p_slug: "fresas" })).data.find((b) => b.code === code);

/** Reserva online de una clienta en el primer horario libre de Esmaltado. */
async function book(sb) {
  const { data: studio } = await sb.rpc("get_public_studio", { p_slug: "fresas" });
  const from = new Date().toISOString().slice(0, 10);
  const { data: days } = await sb.rpc("get_available_days", { p_slug: "fresas", p_service: SEMI, p_professional: null, p_from: from, p_days: 40 });
  for (const d of (days ?? []).filter((x) => x.slots > 0)) {
    const { data: slots } = await sb.rpc("get_available_slots", { p_slug: "fresas", p_service: SEMI, p_professional: null, p_day: d.day });
    for (const s of slots ?? []) {
      const { data, error } = await sb.rpc("create_online_booking", {
        p_slug: "fresas", p_service: SEMI, p_professional: null, p_starts_at: s.starts_at,
        p_accepted_policy_version: studio[0].policy_version, p_phone: "11 5000-0099",
      });
      if (!error) return data[0].code;
      if (!/ocupar|no está disponible/.test(error.message)) throw new Error(`No se pudo reservar: ${error.message}`);
    }
  }
  throw new Error("No encontré horarios libres para reservar");
}

/** Toca «Pagar seña» en /reserva/[código] y devuelve a dónde manda (Checkout). */
async function payButton(code, cookies) {
  const page = await req(F, `/reserva/${code}`, { cookies });
  const fd = formFields(page.html, `name="code" value="${code}"`);
  if (!page.html.includes("con Mercado Pago")) throw new Error("No está el botón de pagar");
  // El formulario de pagar es el primero con el código (el segundo es «liberar»).
  const r = await req(F, `/reserva/${code}`, { method: "POST", body: fd, cookies });
  return r.location;
}

/** Conecta Mercado Pago desde el panel, siguiendo todas las redirecciones. */
async function connectFlow(cookies, button = "Conectar Mercado Pago") {
  const page = await req(F, "/admin/pagos", { cookies });
  const fd = formFields(page.html, button);
  const r1 = await req(F, "/admin/pagos", { method: "POST", body: fd, cookies });
  const toMp = r1.location ?? "";
  const r2 = await fetch(toMp, { redirect: "manual" });
  const toRoot = new URL(r2.headers.get("location"));
  const r3 = await req("localhost:3000", toRoot.pathname + toRoot.search);
  const toStudio = new URL(r3.location);
  const r4 = await req(F, toStudio.pathname + toStudio.search, { cookies });
  return { toMp, toRoot, toStudio, final: r4.location ?? "", vueltaPath: toStudio.pathname + toStudio.search };
}

try {
  // -------------------------------------------------------------------
  // Limpieza previa
  // -------------------------------------------------------------------
  if ((await status())?.status) await owner.rpc("disconnect_mp", { p_tenant: FRESAS_ID });
  for (const i of [2, 3]) {
    const sb = await supabaseAs(clientEmail(i));
    for (const b of (await sb.rpc("my_bookings", { p_slug: "fresas" })).data ?? []) {
      if (b.status === "pending_payment") await sb.rpc("release_my_pending_booking", { p_slug: "fresas", p_code: b.code });
    }
  }

  // -------------------------------------------------------------------
  // Conectar Mercado Pago (OAuth con PKCE)
  // -------------------------------------------------------------------
  let r = await req(F, "/admin/pagos", { cookies: ownerCookies });
  ok(r.status === 200 && r.html.includes("Mercado Pago no está conectado") && r.html.includes("Conectar Mercado Pago") && !/Cleo/.test(r.html),
     "panel: Mercado Pago sin conectar, con el botón (sin Cleo)");
  const manager = await login(F, "encargada@fresasstudio.test");
  r = await req(F, "/admin/pagos", { cookies: manager });
  ok(r.status === 200 && !r.html.includes(">Conectar Mercado Pago<") && r.html.includes("Solo la dueña"), "encargada: ve el estado pero no puede conectar (P5)");

  const flow = await connectFlow(ownerCookies);
  const auth = new URL(flow.toMp);
  ok(flow.toMp.startsWith(`${FAKE}/authorization`) && auth.searchParams.get("code_challenge_method") === "S256"
     && auth.searchParams.get("state").startsWith("fresas.") && auth.searchParams.get("redirect_uri") === "http://localhost:3000/api/pagos/mp/vuelta",
     "conectar: manda a Mercado Pago con state, PKCE y la URL de vuelta única");
  ok(flow.toStudio.host === F && flow.toStudio.pathname === "/admin/pagos/vuelta", "la vuelta del dominio raíz reenvía al subdominio del estudio");
  ok(flow.final.endsWith("/admin/pagos?ok=conectado"), "vuelta: conectado");
  let st = await status();
  ok(st?.status === "connected" && st.mp_nickname === "VENDEDOR-PRUEBA-E2E" && st.live_mode === false, "estado: conectada (cuenta de prueba)");
  r = await req(F, "/admin/pagos", { cookies: ownerCookies });
  ok(strip(r.html).includes("Conectado como") && r.html.includes("Cuenta de prueba"), "panel: «Conectado como…» y aviso de cuenta de prueba");

  r = await req(F, flow.vueltaPath, { cookies: ownerCookies });
  ok((r.location ?? "").endsWith("error=vencido"), "repetir la vuelta (mismo state): no sirve");
  r = await req(F, flow.vueltaPath, { cookies: manager });
  ok((r.location ?? "").endsWith("error=permiso"), "la encargada no puede completar una conexión");
  r = await req("localhost:3000", "/api/pagos/mp/vuelta?code=x&state=..%2F..%2Fevil.com");
  ok(r.status === 400, "vuelta del dominio raíz con un state raro: 400 (no redirige a cualquier lado)");
  const ownerTokens = await owner.from("payment_account_credentials").select("*");
  ok(ownerTokens.error && /permission denied/.test(ownerTokens.error.message), "la dueña no puede leer los tokens (ni cifrados)");

  await owner.from("tenant_settings").update({ online_booking_enabled: true }).eq("tenant_id", FRESAS_ID);

  // -------------------------------------------------------------------
  // Pagar la seña con Checkout Pro
  // -------------------------------------------------------------------
  const sb2 = await supabaseAs(clientEmail(2));
  const c2 = await clientSession(2);
  const code = await book(sb2);
  const b0 = await booking(sb2, code);
  r = await req(F, `/reserva/${code}`, { cookies: c2 });
  ok(strip(r.html).includes("Pagar seña") && r.html.includes("con Mercado Pago") && !/Cleo/.test(r.html), "reserva: botón «Pagar seña … con Mercado Pago»");
  const checkout = await payButton(code, c2);
  ok(checkout?.startsWith(`${FAKE}/checkout/`), "pagar seña: manda al Checkout de Mercado Pago");
  const prefId = checkout.split("/checkout/")[1];
  let pref = (await fakeState()).prefs.find((p) => p.id === prefId);
  ok(pref.items[0].unit_price * 100 === b0.deposit_minor && pref.items[0].currency_id === "ARS", `preferencia: el monto es la seña de la base ($ ${b0.deposit_minor / 100})`);
  ok(pref.binary_mode === true && pref.payment_methods.installments === 1
     && pref.payment_methods.excluded_payment_types.map((x) => x.id).join() === "ticket,atm"
     && pref.statement_descriptor === "FRESAS STUDIO" && !("marketplace_fee" in pref),
     "preferencia: binaria, 1 cuota, sin efectivo, nombre del estudio, sin comisión de Cleo (P1–P3, P10)");
  ok(pref.back_urls.success === `http://${F}/reserva/${code}?pago=volvio` && new Date(pref.expiration_date_to).getTime() === new Date(b0.hold_expires_at).getTime(),
     "preferencia: vuelve a la reserva y vence junto con ella");
  ok(pref.collector === SELLER, "preferencia: creada con el token del estudio (la plata va a su cuenta)");
  ok((await payButton(code, c2)) === checkout, "tocar «Pagar seña» de nuevo reutiliza el mismo link");

  // Volver de Mercado Pago NO confirma
  r = await req(F, `/reserva/${code}?pago=volvio&status=approved&collection_status=approved&payment_id=123`, { cookies: c2 });
  ok(strip(r.html).includes("Estamos verificando tu pago") && (await booking(sb2, code)).status === "pending_payment",
     "volver con «approved» en la URL: «verificando», la reserva sigue esperando pago");

  // -------------------------------------------------------------------
  // Webhook verificado
  // -------------------------------------------------------------------
  const { id: payId } = await fakePost("/__pay", { preference_id: prefId });
  let w = await webhook(payId, { badSignature: true });
  ok(w.status === 401 && (await booking(sb2, code)).status === "pending_payment", "aviso con firma inválida: 401 y no confirma");
  const reqId = randomUUID();
  w = await webhook(payId, { requestId: reqId });
  ok(w.status === 200 && w.json.result === "applied", "aviso firmado: consulta el pago a la API y confirma");
  let b = await booking(sb2, code);
  ok(b.status === "confirmed" && b.deposit_status === "paid", "la reserva queda confirmada con la seña pagada");
  r = await req(F, `/reserva/${code}?pago=volvio`, { cookies: c2 });
  ok(strip(r.html).includes("Confirmada") && !strip(r.html).includes("Estamos verificando"), "la pantalla de la clienta pasa a «Confirmada»");

  w = await webhook(payId, { requestId: reqId });
  ok(w.status === 200 && w.json.result === "duplicate", "el mismo aviso otra vez: duplicado, no hace nada");
  const many = await Promise.all(Array.from({ length: 10 }, () => webhook(payId)));
  ok(many.every((x) => x.status === 200 && x.json.result === "applied"), "10 avisos del mismo pago a la vez: todos 200");
  const { data: pays } = await owner.from("payments").select("id, outcome, fee_minor, net_minor, first_seen_via").eq("provider_payment_id", String(payId));
  ok(pays.length === 1 && pays[0].outcome === "applied" && pays[0].fee_minor > 0 && pays[0].net_minor > 0, "un solo registro del pago, con comisión y neto");
  const { data: payRow } = await owner.from("payments").select("appointment_id").eq("provider_payment_id", String(payId)).single();
  const { data: apptEvents } = await owner.from("appointment_events").select("event_type")
    .eq("appointment_id", payRow.appointment_id).eq("event_type", "deposit_paid");
  ok(apptEvents.length === 1, "una sola «seña pagada» en el historial del turno");

  // Avisos que no corresponden
  const { id: foreignId } = await fakePost("/__pay", { preference_id: prefId, collector: OTHER_SELLER });
  w = await webhook(foreignId);
  ok(w.status === 200 && w.json.result === "not_processed", "aviso de un pago de otra cuenta: la API no lo devuelve y no se registra");
  w = await webhook(payId, { userId: 999999 });
  ok(w.status === 200 && w.json.result === "ignored_account", "aviso de una cuenta desconocida: se ignora");
  w = await webhook(payId, { type: "merchant_order" });
  ok(w.status === 200 && w.json.result === "ignored_topic", "aviso de otro tipo: se ignora");

  // -------------------------------------------------------------------
  // Aviso perdido → la revisión cada 10 min lo levanta (P9)
  // -------------------------------------------------------------------
  const sb3 = await supabaseAs(clientEmail(3));
  const c3 = await clientSession(3);
  const code3 = await book(sb3);
  const pref3 = (await payButton(code3, c3)).split("/checkout/")[1];
  const { id: pay3 } = await fakePost("/__pay", { preference_id: pref3 });
  let cron = await fetch("http://localhost:3000/api/pagos/interno/revisar", { method: "POST" });
  ok(cron.status === 401, "revisión sin la clave: 401");
  cron = await fetch("http://localhost:3000/api/pagos/interno/revisar", { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } });
  const rep = await cron.json();
  ok(cron.status === 200 && rep.synced >= 1, `revisión: consulta los links abiertos (${rep.checked} revisados)`);
  ok((await booking(sb3, code3)).status === "confirmed", "sin webhook, la revisión confirma la reserva");
  const { data: p3 } = await owner.from("payments").select("first_seen_via").eq("provider_payment_id", String(pay3)).single();
  ok(p3?.first_seen_via === "reconcile", "el pago queda marcado como «encontrado por la revisión»");

  // -------------------------------------------------------------------
  // Pago de una reserva liberada → devolución automática (P4)
  // -------------------------------------------------------------------
  const code4 = await book(sb2);
  const pref4 = (await payButton(code4, c2)).split("/checkout/")[1];
  await sb2.rpc("release_my_pending_booking", { p_slug: "fresas", p_code: code4 });
  const { id: pay4 } = await fakePost("/__pay", { preference_id: pref4 });
  w = await webhook(pay4);
  const refunds = (await fakeState()).refunds;
  ok(w.status === 200 && refunds.some((x) => x.payment === pay4), "pago de una reserva liberada: se pide la devolución a Mercado Pago");
  const { data: p4 } = await owner.from("payments").select("outcome").eq("provider_payment_id", String(pay4)).single();
  ok(p4?.outcome === "refunded" && (await booking(sb2, code4)).status === "cancelled", "queda devuelto y la reserva no se reactiva");
  r = await req(F, `/reserva/${code4}`, { cookies: c2 });
  ok(strip(r.html).includes("Te devolvimos") && r.html.includes("se liberó la reserva"), "la clienta ve la devolución explicada");

  // -------------------------------------------------------------------
  // Conciliación en el panel
  // -------------------------------------------------------------------
  r = await req(F, "/admin/pagos/movimientos", { cookies: ownerCookies });
  const mov = strip(r.html);
  ok(r.status === 200 && mov.includes("Pagos recibidos") && mov.includes(String(payId)) && mov.includes("Confirmó la reserva")
     && mov.includes("Devuelto") && mov.includes("Comisión Mercado Pago") && !/Cleo/.test(r.html),
     "panel: pagos recibidos con resultado, comisión y devoluciones");
  r = await req(F, "/admin/pagos/movimientos/csv", { cookies: ownerCookies });
  ok(r.status === 200 && r.html.includes("Operación Mercado Pago") && r.html.includes(String(payId)) && r.html.includes(String(pay4)),
     "panel: CSV de pagos para cruzar con Mercado Pago");
  const pro = await login(F, "profesional@fresasstudio.test");
  r = await req(F, "/admin/pagos/movimientos/csv", { cookies: pro });
  ok(r.status === 404, "profesional: no puede bajar el CSV de pagos");
  r = await req(F, `/admin/turnos/${payRow.appointment_id}`, { cookies: ownerCookies });
  ok(strip(r.html).includes("Pagos con Mercado Pago") && strip(r.html).includes(`operación ${payId}`), "detalle del turno: muestra el pago de Mercado Pago");

  // -------------------------------------------------------------------
  // Token vencido → renovación automática; acceso revocado → volver a conectar
  // -------------------------------------------------------------------
  const before = (await fakeState()).refreshCount;
  await fakePost("/__expire");
  w = await webhook(payId);
  ok(w.status === 200 && w.json.result === "applied" && (await fakeState()).refreshCount === before + 1,
     "token vencido (401): se renueva solo una vez y sigue funcionando");

  await fakePost("/__revoke");
  w = await webhook(payId);
  st = await status();
  ok(w.status === 200 && st?.status === "needs_reconnect" && st.online_booking_enabled === false,
     "acceso revocado: «hay que volver a conectar» y reservas online apagadas (P7)");
  r = await req(F, "/admin/pagos", { cookies: ownerCookies });
  ok(r.html.includes("Hay que volver a conectar"), "panel: avisa que hay que volver a conectar");
  await fakePost("/__reset");
  const again = await connectFlow(ownerCookies, "Volver a conectar");
  ok(again.final.endsWith("ok=conectado") && (await status())?.status === "connected", "volver a conectar: conectada otra vez");

  // -------------------------------------------------------------------
  // Desconectar (P6)
  // -------------------------------------------------------------------
  await owner.from("tenant_settings").update({ online_booking_enabled: true }).eq("tenant_id", FRESAS_ID);
  const { error: discErr } = await owner.rpc("disconnect_mp", { p_tenant: FRESAS_ID });
  st = await status();
  ok(!discErr && !st?.status && st?.online_booking_enabled === false, "desconectar: sin cuenta y con las reservas online apagadas");
} catch (e) {
  ok(false, `error inesperado: ${e instanceof Error ? e.stack : e}`);
  console.error(appLog.split("\n").slice(-30).join("\n"));
} finally {
  // Deja Fresas como lo deja el seed (pagos "conectados" para el pago simulado de los otros e2e).
  const { error } = await owner.rpc("dev_restore_seed_payments", { p_slug: "fresas" });
  if (error) console.error("No se pudo restaurar el estado del seed:", error.message);
  finish();
}
