// Pruebas de punta a punta del acceso (equipo, Cleo Admin, marca blanca).
// Requiere: `npm run build && npx next start -p 3000` apuntando al Supabase de DESARROLLO
// con el seed aplicado. Uso: node scripts/e2e-auth.mjs

// E2E de acceso del equipo contra next start + Supabase de desarrollo.
const BASE = "http://localhost:3000";
const PASS = "CleoDev-2026";
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`); if (!cond) fails++; };

import http from "node:http";
async function req(host, path, { method = "GET", body, cookies = {} } = {}) {
  // node:http (fetch ignora el header Host)
  const headers = { host };
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.cookie = c;
  let payload;
  if (body) {
    const r = new Request("http://x/", { method: "POST", body });
    payload = Buffer.from(await r.arrayBuffer());
    headers["content-type"] = r.headers.get("content-type");
    headers["content-length"] = payload.length;
    headers["origin"] = `http://${host}`;
  }
  return new Promise((resolve, reject) => {
    const rq = http.request({ host: "localhost", port: 3000, path, method, headers }, (res) => {
      let html = ""; res.setEncoding("utf8");
      res.on("data", (d) => (html += d));
      res.on("end", () => {
        const set = {};
        for (const sc of res.headers["set-cookie"] ?? []) {
          const [kv] = sc.split(";"); const i = kv.indexOf("=");
          set[kv.slice(0, i)] = kv.slice(i + 1);
        }
        resolve({ status: res.statusCode, location: res.headers.location ?? null, html, set });
      });
    });
    rq.on("error", reject);
    if (payload) rq.write(payload);
    rq.end();
  });
}

function formFields(html, marker) {
  // Toma el <form> que contiene `marker` y devuelve sus inputs ocultos.
  const forms = html.split("<form").slice(1).map((f) => "<form" + f.split("</form>")[0]);
  const form = forms.find((f) => f.includes(marker));
  if (!form) throw new Error("No encontré el formulario " + marker);
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1]; const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name) fd.append(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
  }
  return fd;
}

async function login(host, email, password = PASS, next) {
  const page = await req(host, "/admin/login" + (next ? `?next=${encodeURIComponent(next)}` : ""));
  const fd = formFields(page.html, 'name="email"');
  fd.append("email", email); fd.append("password", password);
  return req(host, "/admin/login", { method: "POST", body: fd });
}

const F = "fresas.localhost:3000", E = "estudio-prueba.localhost:3000";

let r = await req(F, "/admin");
ok(r.status === 307 && r.location?.includes("/admin/login?next=%2Fadmin"), `sin sesión, /admin redirige al login (HTTP ${r.status})`);

r = await req(F, "/admin/login");
ok(r.status === 200 && r.html.includes("<title>Ingresar al panel · Fresas Studio</title>"), "login con el nombre del estudio en el título");
ok(!/Cleo/.test(r.html), "el login del estudio no menciona Cleo (marca blanca)");

r = await login(F, "duena@fresasstudio.test", "incorrecta-123");
ok(r.html.includes("Email o contraseña incorrectos.") && !Object.keys(r.set).some((k) => k.startsWith("sb-")), "contraseña incorrecta: error genérico y sin sesión");

r = await login(F, "duena@estudioprueba.test");
ok(r.html.includes("Email o contraseña incorrectos.") && !Object.values(r.set).some((v) => v && v.length > 20),
   "dueña de OTRO estudio: mismo error genérico y sin sesión");

r = await login(F, "duena@fresasstudio.test");
const sess = Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
ok(r.status === 303 && r.location === "/admin" && Object.keys(sess).length > 0, `dueña de Fresas: login ok → 303 /admin con cookie de sesión`);

r = await req(F, "/admin", { cookies: sess });
ok(r.status === 200 && r.html.includes("Hola,") && r.html.includes("Dueña"), "dueña: ve el panel con su rol");
ok(r.html.includes("Equipo") && r.html.includes("Marca"), "dueña: ve Equipo y Marca en la navegación");
ok(!/Cleo/.test(r.html), "el panel del estudio no menciona Cleo (marca blanca)");

r = await req(E, "/admin", { cookies: sess });
ok(r.status === 404, `la sesión de Fresas llevada a mano a Estudio Prueba → 404 (HTTP ${r.status})`);

r = await req("admin.localhost:3000", "/", { cookies: sess });
ok(r.status === 404, `la sesión de la dueña en Cleo Admin → 404 (HTTP ${r.status})`);

r = await req(F, "/admin/login", { cookies: sess });
ok(r.status === 307 && r.location === "/admin", "con sesión, /admin/login lleva al panel");

r = await login(F, "profesional@fresasstudio.test");
const pro = Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
r = await req(F, "/admin", { cookies: pro });
ok(r.status === 200 && r.html.includes("Profesional") && !r.html.includes(">Equipo<") && !r.html.includes(">Marca<"),
   "profesional: entra, sin Equipo ni Marca en la navegación");

r = await login(F, "duena@fresasstudio.test", PASS, "//evil.com");
ok(r.status === 303 && r.location === "/admin", `next=//evil.com se ignora (va a ${r.location})`);

r = await req(F, "/admin/invitacion?token=abc");
ok(r.html.includes("no es válido"), "invitación con token inválido: mensaje claro");
r = await req(F, "/admin/invitacion?token=" + "a".repeat(64));
ok(r.html.includes("no es válido"), "invitación inexistente: mensaje claro");

r = await req("admin.localhost:3000", "/");
ok(r.status === 307 && r.location === "/login", "Cleo Admin sin sesión → /login");
const ap = await req("admin.localhost:3000", "/login");
const afd = formFields(ap.html, 'name="email"'); afd.append("email", "admin@cleo.test"); afd.append("password", PASS);
r = await req("admin.localhost:3000", "/login", { method: "POST", body: afd });
const adm = Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
r = await req("admin.localhost:3000", "/", { cookies: adm });
ok(r.status === 200 && r.html.includes("admin@cleo.test"), "Cleo Admin: la superadministradora entra");
const bfd = formFields(ap.html, 'name="email"'); bfd.append("email", "duena@fresasstudio.test"); bfd.append("password", PASS);
r = await req("admin.localhost:3000", "/login", { method: "POST", body: bfd });
ok(r.html.includes("Email o contraseña incorrectos."), "Cleo Admin: una dueña no puede entrar");

r = await req(F, "/");
ok(r.status === 200 && r.html.includes("Fresas Studio") && !/Cleo/.test(r.html), "sitio público de Fresas: 200, con su nombre y sin Cleo");
r = await req("no-existe.localhost:3000", "/");
ok(r.status === 404, `estudio inexistente → 404 real (HTTP ${r.status})`);

console.log(fails ? `\n${fails} FALLARON` : "\nTodo ok");
process.exit(fails ? 1 : 0);
