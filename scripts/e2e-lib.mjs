// Helpers comunes de los E2E (contra la app en localhost:3000 y Supabase de DESARROLLO).
import http from "node:http";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export const PASS = "CleoDev-2026";
export const F = "fresas.localhost:3000";
export const E = "estudio-prueba.localhost:3000";
export const FRESAS_ID = "10000000-0000-4000-a000-000000000001";

let fails = 0;
export const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`); if (!cond) fails++; };
export const done = () => { console.log(fails ? `\n${fails} FALLARON` : "\nTodo ok"); process.exit(fails ? 1 : 0); };

/** Request con Host propio (fetch de Node ignora el header Host). */
export async function req(host, path, { method = "GET", body, cookies = {} } = {}) {
  const headers = { host };
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.cookie = c;
  let payload;
  if (body) {
    const r = new Request("http://x/", { method: "POST", body });
    payload = Buffer.from(await r.arrayBuffer());
    headers["content-type"] = r.headers.get("content-type");
    headers["content-length"] = payload.length;
    headers.origin = `http://${host}`;
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

/** Inputs ocultos del <form> que contiene `marker` (incluye los ids de la Server Action). */
export function formFields(html, marker) {
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

/** Inicia sesión en el panel de un estudio y devuelve las cookies de sesión. */
export async function login(host, email, next) {
  const page = await req(host, "/admin/login" + (next ? `?next=${encodeURIComponent(next)}` : ""));
  const fd = formFields(page.html, 'name="email"');
  fd.append("email", email); fd.append("password", PASS);
  const r = await req(host, "/admin/login", { method: "POST", body: fd });
  return Object.fromEntries(Object.entries(r.set).filter(([k, v]) => k.startsWith("sb-") && v));
}

/** POST de un formulario de la página `path`, con campos propios. */
export async function submit(host, path, marker, fields, cookies, files = {}) {
  const page = await req(host, path, { cookies });
  const fd = formFields(page.html, marker);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [k, f] of Object.entries(files)) fd.set(k, new Blob([f.bytes], { type: f.type }), f.name);
  return req(host, path, { method: "POST", body: fd, cookies });
}

/** Cliente de Supabase con la sesión de una usuaria del seed (respeta RLS). */
export async function supabaseAs(email) {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  if (email) await sb.auth.signInWithPassword({ email, password: PASS });
  return sb;
}
