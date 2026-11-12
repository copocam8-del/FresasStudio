// Capturas de pantallas de la app (sprint de diseño), con Chrome/Edge sin ventana y el
// protocolo de DevTools (sin dependencias). Inicia sesión con las usuarias del seed de
// DESARROLLO y guarda PNG en docs/diseno/capturas/.
// Requiere la app en localhost:3000 (mejor `npm run build && npx next start`: sin el indicador de desarrollo).
// Uso: node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { F, login } from "./e2e-lib.mjs";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) { console.error("No encontré Chrome ni Edge."); process.exit(1); }

const OUT = "docs/diseno/capturas";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: "01-inicio-estudio-celular", url: `http://${F}/`, width: 390, height: 844, full: true, as: "clienta02@e2e.test", clientLogin: true },
  { name: "02-inicio-panel-celular", url: `http://${F}/admin`, width: 390, height: 844, full: true, as: "duena@fresasstudio.test" },
  { name: "03-inicio-panel-escritorio", url: `http://${F}/admin`, width: 1440, height: 900, full: false, as: "duena@fresasstudio.test" },
];

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

for (const s of SHOTS) {
  await send("Network.clearBrowserCookies");
  const cookies = await login(F, s.as, s.clientLogin ? "/admin/invitacion?token=x" : undefined);
  for (const [name, value] of Object.entries(cookies)) {
    await send("Network.setCookie", { name, value, domain: "fresas.localhost", path: "/" });
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: s.width, height: s.height, deviceScaleFactor: 2, mobile: s.width < 600,
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
      width: s.width, height: Math.ceil(contentSize.height), deviceScaleFactor: 2, mobile: true,
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
