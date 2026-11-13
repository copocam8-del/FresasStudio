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
    const rq = http.request({ host: "localhost", port: Number(process.env.E2E_PORT ?? 3000), path, method, headers }, (res) => {
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
ok(r.html.includes('aria-label="Cleo"'), "el login del estudio muestra la marca Cleo (Fresas no activó su marca propia)");

r = await login(F, "duena@fresasstudio.test", "incorrecta-123");
ok(r.html.includes("Email o contraseña incorrectos.") && !Object.keys(r.set).some((k) => k.startsWith("sb-")), "contraseña incorrecta: error genérico y sin sesión");

r = await login(F, "duena@estudioprueba.test");
ok(r.html.includes("Email o contraseña incorrectos.") && !Object.values(r.set).some((v) => v && v.length > 20),
   "dueña de OTRO estudio: mismo error genérico y sin sesión");

r = await login(F, "duena@fresasstudio.test");
const sess = Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
ok(r.status === 303 && r.location === "/admin" && Object.keys(sess).length > 0, `dueña de Fresas: login ok → 303 /admin con cookie de sesión`);

r = await req(F, "/admin", { cookies: sess });
ok(r.status === 200 && (r.html.includes("Hola,") || r.html.includes("Panel del estudio")) && r.html.includes("Dueña"), "dueña: ve el panel con su rol");
ok(r.html.includes("Equipo") && r.html.includes("Marca"), "dueña: ve Equipo y Marca en la navegación");
ok(r.html.includes('aria-label="Cleo"'), "el panel del estudio muestra la marca Cleo por defecto");

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
ok(r.status === 200 && r.html.includes("<title>Fresas Studio</title>") && r.html.includes('aria-label="Cleo"'), "sitio público de Fresas: 200, su nombre en el título y la marca Cleo");
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

// ---------------------------------------------------------------------
// Clientas: Google y "Mis datos"
// ---------------------------------------------------------------------
r = await req(F, "/");
ok(r.html.includes('href="/ingresar"'), "sitio: ofrece Ingresar a quien no tiene sesión");
r = await req(F, "/ingresar");
ok(r.status === 200 && r.html.includes("Continuar con Google") && r.html.includes('aria-label="Cleo"'), "ingresar: botón de Google, con la marca Cleo");
const gfd = formFields(r.html, "Continuar con Google");
r = await req(F, "/ingresar", { method: "POST", body: gfd });
const authorize = r.location ? new URL(r.location) : null;
ok(r.status === 303 && authorize?.pathname === "/auth/v1/authorize" && authorize.searchParams.get("provider") === "google",
   "Google: redirige al authorize de Supabase con provider=google");
ok(authorize?.searchParams.get("redirect_to") === "http://fresas.localhost:3000/auth/callback?next=%2Fmi-ficha",
   "Google: vuelve al callback del MISMO estudio");
ok(Boolean(authorize?.searchParams.get("code_challenge")) && Object.keys(r.set).some((k) => k.endsWith("-code-verifier")),
   "Google: usa PKCE (code_challenge + verificador en cookie del host)");

r = await req(F, "/auth/callback");
ok(r.status === 307 && r.location === "http://fresas.localhost:3000/ingresar?error=google", "callback sin código → vuelve a ingresar con error");
r = await req(F, "/auth/callback?code=falso");
ok(r.status === 307 && r.location?.endsWith("/ingresar?error=google"), "callback con código inválido → error, sin sesión");
r = await req(F, "/mi-ficha");
ok(r.status === 307 && r.location === "/ingresar?next=%2Fmi-ficha", "mis datos sin sesión → ingresar");

// Sesión de prueba (cuenta con contraseña del seed) para ejercitar "Mis datos".
r = await login(F, "externa@otro.test", PASS, "/admin/invitacion?token=x");
const cli = Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
r = await req(F, "/mi-ficha", { cookies: cli });
if (r.html.includes("Crear mi ficha")) {
  const cfd = formFields(r.html, "Crear mi ficha");
  const c = await req(F, "/mi-ficha", { method: "POST", body: cfd, cookies: cli });
  ok(c.status === 303 && c.location === "/mi-ficha", "mis datos: crear la ficha");
  r = await req(F, "/mi-ficha", { cookies: cli });
}
ok(r.status === 200 && r.html.includes("Nombre y apellido") && r.html.includes("externa@otro.test"), "mis datos: muestra su ficha");
const pfd = formFields(r.html, 'name="full_name"');
pfd.append("full_name", "Externa E2E"); pfd.append("phone", "telefono-malo");
r = await req(F, "/mi-ficha", { method: "POST", body: pfd, cookies: cli });
ok(r.html.includes("Ese teléfono no parece válido"), "mis datos: valida el teléfono en el servidor");
const pfd2 = formFields(r.html, 'name="full_name"');
pfd2.append("full_name", "Externa E2E"); pfd2.append("phone", "+54 11 5555-0000");
r = await req(F, "/mi-ficha", { method: "POST", body: pfd2, cookies: cli });
ok(r.html.includes("guardamos tus datos"), "mis datos: guarda nombre y teléfono");
// La cookie identifica a la PERSONA (el navegador la limita al host). Copiada a mano a
// otro estudio sigue siendo la misma clienta: ahí ve solo su ficha de ESE estudio.
r = await req(E, "/mi-ficha", { cookies: cli });
ok(r.status === 200 && r.html.includes("Crear mi ficha") && !r.html.includes("Externa E2E") && !r.html.includes("5555-0000"),
   "en otro estudio, la misma cuenta no ve los datos que cargó en Fresas");

// ---------------------------------------------------------------------
// Marca del estudio: colores y logo (Storage real), con limpieza al final
// ---------------------------------------------------------------------
r = await req(F, "/admin/marca", { cookies: pro });
ok(r.status === 404, `marca: una profesional (sin settings.manage) → 404 (HTTP ${r.status})`);
r = await req(F, "/admin/marca", { cookies: owner });
ok(r.status === 200 && r.html.includes("Guardar marca"), "marca: la dueña ve el formulario");

async function saveBrand(fields, logo) {
  const page = await req(F, "/admin/marca", { cookies: owner });
  const fd = formFields(page.html, "Guardar marca");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (logo) fd.set("logo", new Blob([logo.bytes], { type: logo.type }), logo.name);
  return req(F, "/admin/marca", { method: "POST", body: fd, cookies: owner });
}

r = await saveBrand({ enabled: "on", primary: "", accent: "", background: "#f5f0e6" });
ok(r.html.includes("El fondo es demasiado claro"), "marca: un fondo claro se rechaza en el servidor (el tema es oscuro)");
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
r = await saveBrand({ primary: "", accent: "", background: "" }, { bytes: svg, type: "image/png", name: "logo.png" });
ok(r.html.includes("PNG, JPG o WebP"), "marca: un SVG disfrazado de .png se rechaza (se miran los bytes)");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
r = await saveBrand({ primary: "#e91e63", accent: "#b28324", background: "#1a1416" }, { bytes: png, type: "image/png", name: "logo.png" });
ok(r.html.includes("guardamos la marca"), "marca: guarda colores y logo con la marca propia apagada");
r = await req(F, "/");
ok(!r.html.includes("--primary:#e91e63") && !r.html.includes("/public/brand/") && r.html.includes('aria-label="Cleo"'),
   "marca propia apagada: el sitio sigue con la marca Cleo aunque haya colores y logo guardados");
r = await saveBrand({ enabled: "on", primary: "#e91e63", accent: "#b28324", background: "#1a1416" });
ok(r.html.includes("guardamos la marca"), "marca: activa la marca propia");

r = await req(F, "/");
const logoSrc = /<img src="([^"]+\/storage\/v1\/object\/public\/brand\/[^"]+\.png)"/.exec(r.html)?.[1];
ok(r.html.includes("--primary:#e91e63") && r.html.includes("--primary-foreground:#000000") && r.html.includes("--background:#1a1416"),
   "marca propia: el sitio aplica los colores del estudio");
ok(r.html.includes(">Fresas Studio</span>") && r.html.includes('aria-label="Cleo"'),
   "marca propia: el nombre del estudio grande, con el logo de Cleo chiquito");
ok(Boolean(logoSrc) && r.html.includes(`rel="icon" href="${logoSrc}"`), "sitio de Fresas: muestra el logo y lo usa como ícono");
const logoRes = logoSrc ? await fetch(logoSrc.replace(/&amp;/g, "&")) : null;
ok(logoRes?.status === 200 && logoRes.headers.get("content-type") === "image/png", "el logo se sirve desde Storage como image/png");
r = await req(E, "/");
ok(!r.html.includes("#e91e63") && !r.html.includes("/public/brand/"), "Estudio Prueba no hereda la marca de Fresas");

r = await saveBrand({ primary: "", accent: "", background: "", remove_logo: "on" });
ok(r.html.includes("guardamos la marca"), "limpieza: apaga la marca propia, vuelve a los colores de Cleo y quita el logo");
// La URL pública puede seguir respondiendo un rato por la caché del CDN de Supabase;
// lo que importa es que el archivo ya no esté en Storage.
const left = await sb.storage.from("brand").list("10000000-0000-4000-a000-000000000001");
ok(!left.error && left.data.filter((o) => o.name.startsWith("logo-")).length === 0,
   "limpieza: el archivo del logo anterior se borró de Storage");
r = await req(F, "/");
ok(!r.html.includes("--primary:") && !r.html.includes("/public/brand/") && r.html.includes('aria-label="Cleo"'), "sitio de Fresas: con la marca Cleo otra vez");

console.log(fails ? `\n${fails} FALLARON` : "\nTodo ok");
process.exit(fails ? 1 : 0);
