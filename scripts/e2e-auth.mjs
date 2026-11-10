// Pruebas de punta a punta del acceso (equipo, Cleo Admin, marca blanca).
// Requiere: `npm run build && npx next start -p 3000` apuntando al Supabase de DESARROLLO
// con el seed aplicado. Uso: node scripts/e2e-auth.mjs

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

// ---------------------------------------------------------------------
// Equipo e invitación de punta a punta (con limpieza al final)
// ---------------------------------------------------------------------
const owner = sess;
r = await req(F, "/admin/equipo", { cookies: owner });
ok(r.status === 200 && /Personas \((<!-- -->)?3(<!-- -->)?\)/.test(r.html), "equipo: la dueña ve a las 3 personas");
ok(r.html.includes("Crear link de invitación"), "equipo: la dueña ve el formulario de invitación");
const roleId = /<option value="([0-9a-f-]{36})"[^>]*>Recepción<\/option>/.exec(r.html)?.[1];
ok(Boolean(roleId), "equipo: el rol Recepción está entre los que puede asignar");

r = await req(F, "/admin/equipo", { cookies: pro });
ok(r.status === 404, `equipo: una profesional (sin team.read) → 404 (HTTP ${r.status})`);

async function invite(email) {
  const page = await req(F, "/admin/equipo", { cookies: owner });
  const fd = formFields(page.html, 'name="role_id"');
  fd.append("email", email);
  fd.append("role_id", roleId);
  return req(F, "/admin/equipo", { method: "POST", body: fd, cookies: owner });
}

r = await invite("duena@fresasstudio.test");
ok(r.html.includes("Esa persona ya forma parte del estudio"), "invitar a alguien que ya está: mensaje claro");

r = await invite("externa@otro.test");
const token = /invitacion\?token=([0-9a-f]{64})/.exec(r.html)?.[1];
ok(Boolean(token) && r.html.includes("una sola vez"), "invitar: genera el link y avisa que se muestra una sola vez");
ok(r.html.includes("wa.me/?text="), "invitar: ofrece enviarlo por WhatsApp");

r = await req(E, `/admin/invitacion?token=${token}`);
ok(r.html.includes("es de otro estudio"), "el link abierto en otro estudio: «es de otro estudio»");

r = await req(F, `/admin/invitacion?token=${token}`);
ok(r.html.includes("Recepción") && r.html.includes("e***@otro.test") && r.html.includes("Crear cuenta"),
   "invitación sin sesión: muestra rol, email enmascarado y crear cuenta");
ok(r.html.includes('name="referrer" content="no-referrer"'), "invitación: el token no viaja como Referer");

r = await login(F, "externa@otro.test", PASS, `/admin/invitacion?token=${token}`);
const ext = Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
ok(r.status === 303 && r.location === `/admin/invitacion?token=${token}`,
   "quien todavía no es del equipo puede ingresar para aceptar");

r = await req(F, `/admin/invitacion?token=${token}`, { cookies: ext });
ok(r.html.includes("Aceptar invitación") && r.html.includes("externa@otro.test"), "con sesión: botón para aceptar");
const acceptFd = formFields(r.html, "Aceptar invitación");
r = await req(F, `/admin/invitacion?token=${token}`, { method: "POST", body: acceptFd, cookies: ext });
ok(r.status === 303 && r.location === "/admin", `aceptar → 303 /admin (HTTP ${r.status})`);
r = await req(F, "/admin", { cookies: ext });
ok(r.status === 200 && r.html.includes("Recepción"), "después de aceptar entra al panel como Recepción");
r = await req(F, `/admin/invitacion?token=${token}`);
ok(r.html.includes("ya se usó"), "el link no sirve dos veces");

// Limpieza: la dueña da de baja a la persona (por la API, con RLS) para poder repetir.
const { readFileSync } = await import("node:fs");
const { createClient } = await import("@supabase/supabase-js");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
await sb.auth.signInWithPassword({ email: "duena@fresasstudio.test", password: PASS });
const team = await sb.rpc("team_members", { p_tenant: "10000000-0000-4000-a000-000000000001" });
const extId = team.data?.find((m) => m.email === "externa@otro.test")?.membership_id;
const baja = await sb.from("memberships").update({ status: "revoked" }).eq("id", extId).select("id");
ok(!baja.error && baja.data?.length === 1, "limpieza: la persona invitada queda dada de baja");
r = await req(F, "/admin", { cookies: ext });
ok(r.status === 404, `después de la baja pierde el acceso al instante (HTTP ${r.status})`);

console.log(fails ? `\n${fails} FALLARON` : "\nTodo ok");
process.exit(fails ? 1 : 0);
