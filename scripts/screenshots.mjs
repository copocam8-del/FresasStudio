// Capturas de pantallas de la app (sprint de diseño), con Chrome/Edge sin ventana y el
// protocolo de DevTools (sin dependencias). Inicia sesión con las usuarias del seed de
// DESARROLLO y guarda PNG en docs/diseno/capturas/.
// Requiere la app en localhost:3000 (mejor `npm run build && npx next start`: sin el indicador de desarrollo).
// Uso: node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { F, login, supabaseAs } from "./e2e-lib.mjs";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) { console.error("No encontré Chrome ni Edge."); process.exit(1); }

const OUT = "docs/diseno/capturas";
// Puerto de la app (si el 3000 está ocupado: compilar con NEXT_PUBLIC_ROOT_DOMAIN=localhost:<puerto>).
const PORT = process.env.SHOT_PORT ?? "3000";
const HOST = `fresas.localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

const ALL_SHOTS = [
  { name: "01-inicio-estudio-celular", url: `http://${F}/`, width: 390, height: 844, full: true, as: "clienta02@e2e.test", clientLogin: true },
  { name: "02-inicio-panel-celular", url: `http://${F}/admin`, width: 390, height: 844, full: true, as: "duena@fresasstudio.test" },
  { name: "03-inicio-panel-escritorio", url: `http://${F}/admin`, width: 1440, height: 900, full: false, as: "duena@fresasstudio.test" },
  // Mismo tamaño que las referencias de docs/diseno (para compararlas lado a lado)
  { name: "cmp-inicio-clienta", url: `http://${F}/`, width: 426, height: 923, full: false, scale: 2, as: "clienta02@e2e.test", clientLogin: true },
  { name: "cmp-inicio-panel", url: `http://${F}/admin`, width: 1536, height: 1024, full: false, scale: 1, as: "duena@fresasstudio.test" },
];
// Pantallas principales (sprint de diseño): node scripts/screenshots.mjs p-
const SEMI = "31000000-0000-4000-a000-000000000001";
const sbClient = await supabaseAs("clienta02@e2e.test");
const myCode = ((await sbClient.rpc("my_bookings", { p_slug: "fresas" })).data ?? []).find((b) => b.status === "confirmed")?.code;
const OWNER = "duena@fresasstudio.test";
const sbOwner = await supabaseAs(OWNER);
const fichaId = (await sbOwner.from("client_profiles").select("id").eq("email", "clienta08@e2e.test").maybeSingle()).data?.id;
const turnoId = (await sbOwner.from("appointments").select("id").eq("status", "confirmed")
  .gt("starts_at", new Date().toISOString()).order("starts_at").limit(1).maybeSingle()).data?.id;
const C = "clienta02@e2e.test";
const m = (name, path, as, extra = {}) => ({ name: `p-${name}`, url: `http://${HOST}${path}`, width: 390, height: 844, full: true, scale: 2, as, ...extra });
const d = (name, path, as, extra = {}) => ({ name: `p-${name}`, url: `http://${HOST}${path}`, width: 1440, height: 900, full: true, scale: 1, as, ...extra });
ALL_SHOTS.push(
  m("01-cel-inicio-clienta", "/", C, { clientLogin: true }),
  m("02-cel-reservar-servicio", "/reservar", C, { clientLogin: true }),
  m("03-cel-reservar-dia-hora", `/reservar/${SEMI}?p=any`, C, { clientLogin: true }),
  ...(myCode ? [m("04-cel-mi-reserva", `/reserva/${myCode}`, C, { clientLogin: true })] : []),
  m("05-cel-mis-turnos", "/mi-ficha", C, { clientLogin: true }),
  m("06-cel-ingresar", "/ingresar", null),
  m("07-cel-panel-turnos", "/admin/turnos", OWNER),
  d("10-esc-panel-inicio", "/admin", OWNER),
  d("11-esc-panel-turnos", "/admin/turnos", OWNER),
  d("12-esc-panel-servicios", "/admin/servicios", OWNER),
  d("13-esc-panel-profesionales", "/admin/profesionales", OWNER),
  d("14-esc-panel-horarios", "/admin/horarios", OWNER),
  d("15-esc-panel-equipo", "/admin/equipo", OWNER),
  d("16-esc-panel-reservas", "/admin/reservas", OWNER),
  d("17-esc-panel-mercado-pago", "/admin/pagos", OWNER),
  d("18-esc-panel-pagos", "/admin/pagos/movimientos", OWNER),
  d("19-esc-panel-marca", "/admin/marca", OWNER),
  d("20-esc-panel-login", "/admin/login", null),
  m("30-cel-agenda-dia", "/admin/agenda", OWNER),
  m("31-cel-agenda-semana", "/admin/agenda?vista=semana", OWNER),
  d("32-esc-agenda-dia", "/admin/agenda", OWNER),
  d("33-esc-agenda-semana", "/admin/agenda?vista=semana", OWNER),
  m("34-cel-clientas", "/admin/clientas", OWNER),
  d("35-esc-clientas", "/admin/clientas", OWNER),
  ...(fichaId ? [d("36-esc-ficha", `/admin/clientas/${fichaId}`, OWNER), m("37-cel-ficha", `/admin/clientas/${fichaId}`, OWNER)] : []),
  d("38-esc-asistencia", "/admin/asistencia", OWNER),
  ...(turnoId ? [m("39-cel-detalle-turno", `/admin/turnos/${turnoId}`, OWNER)] : []),
  ...(myCode ? [m("40-cel-cancelar", `/reserva/${myCode}/cancelar`, C, { clientLogin: true }),
                m("41-cel-cambiar", `/reserva/${myCode}/cambiar`, C, { clientLogin: true })] : []),
  m("42-cel-agenda-profesional", "/admin/agenda", "profesional@fresasstudio.test"),
  { name: "p-21-esc-cleo", url: `http://localhost:${PORT}/`, width: 1440, height: 900, full: false, scale: 1, as: null },
  { name: "p-22-esc-cleo-admin", url: `http://admin.localhost:${PORT}/login`, width: 1440, height: 900, full: false, scale: 1, as: null },
);

// node scripts/screenshots.mjs [prefijo]  → solo las capturas cuyo nombre empieza así
const only = process.argv[2];
const SHOTS = ALL_SHOTS.filter((s) => (only ? s.name.startsWith(only) : !s.name.startsWith("cmp-")));

const port = 9333;
const profile = join(tmpdir(), `cleo-shots-${Date.now()}`);
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run",
  "--hide-scrollbars", "--force-color-profile=srgb", "about:blank",
], { stdio: "ignore" });

async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* todavía arrancando */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("El navegador no respondió");
}

const ws = new WebSocket(await cdpTarget());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method) for (const w of [...waiters]) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const waitFor = (method) => new Promise((resolve) => waiters.push({ method, resolve }));

await send("Page.enable");
await send("Network.enable");
// La bienvenida se ve una vez por sesión: en las capturas se da por vista.
await send("Page.addScriptToEvaluateOnNewDocument", { source: 'try{sessionStorage.setItem("cleo-welcome","1")}catch(e){}' });

for (const s of SHOTS) {
  await send("Network.clearBrowserCookies");
  const cookies = s.as ? await login(F, s.as, s.clientLogin ? "/admin/invitacion?token=x" : undefined) : {};
  for (const [name, value] of Object.entries(cookies)) {
    await send("Network.setCookie", { name, value, domain: "fresas.localhost", path: "/" });
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: s.width, height: s.height, deviceScaleFactor: s.scale ?? 2, mobile: s.width < 600,
  });
  const loaded = waitFor("Page.loadEventFired");
  await send("Page.navigate", { url: s.url });
  await loaded;
  await new Promise((r) => setTimeout(r, 1500)); // fuentes y desenfoques
  if (s.full) {
    // Página entera: se agranda la ventana al alto del contenido, así lo fijo (barra
    // inferior) queda abajo como en el celular.
    const { contentSize } = await send("Page.getLayoutMetrics");
    await send("Emulation.setDeviceMetricsOverride", {
      width: s.width, height: Math.ceil(contentSize.height), deviceScaleFactor: s.scale ?? 2, mobile: s.width < 600,
    });
    await new Promise((r) => setTimeout(r, 600));
  }
  // Control: a ese ancho no puede haber desplazamiento horizontal.
  const { result } = await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth" });
  if (result.value > s.width) console.log(`AVISO  ${s.name}: desplazamiento horizontal (${result.value} px > ${s.width} px)`);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${s.name}.png`), Buffer.from(data, "base64"));
  console.log(`ok  ${OUT}/${s.name}.png`);
}

ws.close();
browser.kill();
process.exit(0);
