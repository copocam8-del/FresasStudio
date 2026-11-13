// Pruebas de punta a punta del Sprint 6: cancelaciones y saldo a favor, reprogramar,
// agenda y asistencia, fichas de clientas y permisos.
// Requiere la app compilada (npm run build && npx next start) apuntando al Supabase de
// DESARROLLO con el seed. Uso: node scripts/e2e-agenda.mjs  (E2E_PORT=… si no es el 3000)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { done, F, FRESAS_ID, formFields, login, ok, req, submit, supabaseAs } from "./e2e-lib.mjs";

const SEMI = "31000000-0000-4000-a000-000000000001";
const SOFI = "32000000-0000-4000-a000-000000000001";
const CARO = "32000000-0000-4000-a000-000000000002";
const strip = (html) => html.replace(/<!-- -->/g, "").replace(/ /g, " ");
const clientSession = (email) => login(F, email, "/admin/invitacion?token=x");
const CLI = "clienta07@e2e.test";
const CLI2 = "clienta08@e2e.test";

const owner = await supabaseAs("duena@fresasstudio.test");
const cli = await supabaseAs(CLI);
const cli2 = await supabaseAs(CLI2);
await cli.rpc("ensure_client_profile", { p_slug: "fresas" });
await cli2.rpc("ensure_client_profile", { p_slug: "fresas" });
const profileId = async (email) =>
  (await owner.from("client_profiles").select("id").eq("tenant_id", FRESAS_ID).eq("email", email).single()).data.id;
const cp = await profileId(CLI);
const cp2 = await profileId(CLI2);

// Limpieza: reservas pendientes de corridas anteriores.
for (const sb of [cli, cli2]) {
  const { data } = await sb.rpc("my_bookings", { p_slug: "fresas" });
  for (const b of data ?? []) if (b.status === "pending_payment") await sb.rpc("release_my_pending_booking", { p_slug: "fresas", p_code: b.code });
}

// Limpieza: turnos futuros que dejaron corridas anteriores de este e2e (los cancela el
// estudio, así la clienta de prueba conserva la seña y el horario queda libre).
{
  const { data: leftovers } = await owner.from("appointments").select("id").eq("tenant_id", FRESAS_ID)
    .eq("status", "confirmed").like("client_note", "e2e sprint 6%").gt("starts_at", new Date().toISOString());
  for (const a of leftovers ?? []) {
    await owner.rpc("cancel_booking", { p_appointment: a.id, p_by: "studio", p_reason: "Limpieza del e2e",
      p_refund_mode: "credit", p_refund_method: null, p_expected: "credited" });
  }
}

/** Turno manual confirmado (seña cobrada) en un horario libre, a partir de `start`. */
async function manual(client, start, pro = SOFI, stepMinutes = 120) {
  for (let i = 0; i < 40; i++) {
    const at = new Date(start.getTime() + i * stepMinutes * 60_000);
    const { data, error } = await owner.rpc("create_manual_booking", {
      p_tenant: FRESAS_ID, p_client_profile: client, p_new_client_name: null, p_new_client_phone: null,
      p_service: SEMI, p_professional: pro, p_starts_at: at.toISOString(), p_force_outside_hours: true,
      p_paid_offline_method: "cash", p_note: "e2e sprint 6",
    });
    if (!error) return data[0];
    if (i === 0 || i === 39) console.error("turno manual:", at.toISOString(), pro === SOFI ? "Sofi" : "Caro", error.message);
  }
  throw new Error("No encontré un horario libre para el turno manual");
}
/**
 * Turno YA PASADO (confirmado, seña cobrada) para probar faltas e indicadores. Las funciones
 * no dejan crear turnos en el pasado (bien): se inserta con la clave de servidor de
 * DESARROLLO, como hace el e2e de pagos. Nunca se usa en flujos de la app.
 */
async function pastTurn(client, minutesAgo) {
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Falta SUPABASE_SECRET_KEY (DESARROLLO) en .env.local");
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const pv = (await svc.from("tenant_settings").select("policy_version").eq("tenant_id", FRESAS_ID).single()).data.policy_version;
  for (let i = 0; i < 30; i++) {
    const start = new Date(Date.now() - (minutesAgo + i * 75) * 60_000);
    start.setUTCSeconds(0, 0); start.setUTCMinutes(start.getUTCMinutes() - (start.getUTCMinutes() % 5));
    const end = new Date(start.getTime() + 60 * 60_000);
    const code = Array.from({ length: 6 }, () => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(Math.random() * 31)]).join("");
    const { data, error } = await svc.from("appointments").insert({
      tenant_id: FRESAS_ID, code, client_profile_id: client, professional_id: CARO, service_id: SEMI,
      starts_at: start.toISOString(), ends_at: end.toISOString(), occupied_until: end.toISOString(),
      service_name: "Esmaltado semipermanente", professional_name: "Caro", duration_minutes: 60, buffer_minutes: 0,
      price_minor: 1500000, price_is_from: false, currency: "ARS", deposit_percent: 50, deposit_minor: 750000,
      policy_version: pv, cancellation_window_hours: 24, status: "confirmed", deposit_status: "paid_offline", source: "staff",
      client_note: "e2e sprint 6 (pasado)",
    }).select("id").single();
    if (!error) return data.id;
  }
  throw new Error("No pude crear el turno pasado");
}
const hourFromNow = (h) => { const d = new Date(Date.now() + h * 3600_000); d.setUTCMinutes(0, 0, 0); return d; };

// ---------------------------------------------------------------------
// 1) La clienta cancela con más de 24 h: la seña pasa a su saldo
// ---------------------------------------------------------------------
const c1 = await clientSession(CLI);
const creditBefore = ((await cli.rpc("my_credit", { p_slug: "fresas" })).data ?? []).reduce((s, l) => s + l.remaining_minor, 0);
const t1 = await manual(cp, hourFromNow(24 * 45 + Math.floor(Math.random() * 24 * 10)));
let r = await req(F, `/reserva/${t1.code}`, { cookies: c1 });
ok(r.status === 200 && strip(r.html).includes("Cambios y cancelación") && strip(r.html).includes("sin perder la seña hasta el"),
  "reserva confirmada: muestra hasta cuándo conserva la seña");
r = await req(F, `/reserva/${t1.code}/cancelar`, { cookies: c1 });
ok(r.status === 200 && strip(r.html).includes("Conservás la seña") && strip(r.html).includes("queda como saldo a favor"),
  "cancelar: repite la consecuencia antes de confirmar");
r = await submit(F, `/reserva/${t1.code}/cancelar`, 'name="expected"', {}, c1);
ok(r.status === 303 && r.location === `/reserva/${t1.code}`, "cancelar: confirma y vuelve a la reserva");
r = await req(F, `/reserva/${t1.code}`, { cookies: c1 });
ok(/Cancelaste con tiempo: sumamos \$ 7\.500 a tu saldo a favor/.test(strip(r.html)), "la reserva explica que la seña pasó al saldo");
const creditAfter = ((await cli.rpc("my_credit", { p_slug: "fresas" })).data ?? []).reduce((s, l) => s + l.remaining_minor, 0);
ok(creditAfter - creditBefore === 750000, "el saldo a favor sube $ 7.500");
r = await req(F, "/mi-ficha", { cookies: c1 });
ok(strip(r.html).includes("Saldo a favor") && /hasta el \d{1,2} de \w+ de \d{4}/.test(strip(r.html)),
  "Mis datos: muestra el saldo y hasta cuándo se puede usar");

// La consecuencia vieja ya no sirve: si se manda "credited" sobre un turno a menos de 24 h, no hace nada.
const tLate = await manual(cp, hourFromNow(6));
const { error: lateErr } = await cli.rpc("cancel_my_booking", { p_slug: "fresas", p_code: tLate.code, p_expected: "credited" });
ok(lateErr && /Pasó el plazo/.test(lateErr.message), "a menos de 24 h, si esperaba conservar la seña: no se cancela y se avisa");
r = await req(F, `/reserva/${tLate.code}/cancelar`, { cookies: c1 });
ok(strip(r.html).includes("Perdés la seña") && strip(r.html).includes("Cancelar igual y perder la seña"), "a menos de 24 h: avisa que pierde la seña");

// ---------------------------------------------------------------------
// 2) Reservar online con el saldo: la seña la cubre el saldo y queda confirmada
// ---------------------------------------------------------------------
r = await req(F, `/reservar/${SEMI}?p=${SOFI}`);
const dayLinks = [...r.html.matchAll(/href="(\/reservar\/[^"?]+\?p=[^&"]+&amp;dia=\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
let slot;
for (const link of dayLinks) {
  const page = await req(F, link);
  slot = [...page.html.matchAll(/href="(\/reservar\/confirmar\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))
    .find((p) => new Date(new URL("http://x" + p).searchParams.get("t")).getTime() > Date.now() + 40 * 3600_000);
  if (slot) break;
}
ok(Boolean(slot), "hay un horario libre a más de 40 h");
r = await req(F, slot, { cookies: c1 });
ok(strip(r.html).includes("Usás de tu saldo a favor") && strip(r.html).includes("Tu saldo cubre la seña"), "resumen: muestra el saldo que se usa");
r = await submit(F, slot, "Reservar con mi saldo a favor", { phone: "11 5000-0007", accept_policy: "on", note: "" }, c1);
const code2 = /\/reserva\/([2-9A-HJKMNP-Z]{6})$/.exec(r.location ?? "")?.[1];
ok(r.status === 303 && Boolean(code2), "reservar con saldo: crea la reserva");
r = await req(F, `/reserva/${code2}`, { cookies: c1 });
ok(strip(r.html).includes("Turno confirmado") && strip(r.html).includes("Cubierto con tu saldo a favor"),
  "reserva con saldo: confirmada al instante, sin pasar por Mercado Pago");

// ---------------------------------------------------------------------
// 3) Cambiar el día (a tiempo): la seña pasa entera, una sola vez desde la web
// ---------------------------------------------------------------------
r = await req(F, `/reserva/${code2}/cambiar`, { cookies: c1 });
ok(r.status === 200 && strip(r.html).includes("Tu seña pasa entera al turno nuevo"), "cambiar: avisa que conserva la seña");
const changeLinks = [...r.html.matchAll(/href="(\/reserva\/[A-Z0-9]{6}\/cambiar\?[^"]*dia=[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
let changeSlot = [...r.html.matchAll(/href="(\/reserva\/[A-Z0-9]{6}\/cambiar\/confirmar\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))[0];
for (const link of changeLinks.slice(2)) {
  const page = await req(F, link, { cookies: c1 });
  const s = [...page.html.matchAll(/href="(\/reserva\/[A-Z0-9]{6}\/cambiar\/confirmar\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))[0];
  if (s) { changeSlot = s; break; }
}
ok(Boolean(changeSlot), "cambiar: ofrece horarios libres");
r = await req(F, changeSlot, { cookies: c1 });
ok(strip(r.html).includes("Antes") && strip(r.html).includes("Ahora") && strip(r.html).includes("Conservás la seña"), "confirmar el cambio: Antes / Ahora");
r = await submit(F, changeSlot, 'name="expected"', {}, c1);
const code3 = /\/reserva\/([2-9A-HJKMNP-Z]{6})$/.exec(r.location ?? "")?.[1];
ok(r.status === 303 && code3 && code3 !== code2, "cambiar: crea el turno nuevo");
r = await req(F, `/reserva/${code3}`, { cookies: c1 });
ok(strip(r.html).includes("Turno confirmado") && strip(r.html).includes(`reemplaza al`) && strip(r.html).includes("ya se cambió una vez"),
  "turno nuevo: confirmado, enlazado al anterior y sin otro cambio online");
r = await req(F, `/reserva/${code2}`, { cookies: c1 });
ok(strip(r.html).includes("la seña pasó entera al turno nuevo"), "el turno viejo explica el cambio");

// ---------------------------------------------------------------------
// 4) Panel: cancela el estudio → la clienta conserva la seña y ve el motivo
// ---------------------------------------------------------------------
const ownerC = await login(F, "duena@fresasstudio.test");
const id3 = (await owner.from("appointments").select("id").eq("tenant_id", FRESAS_ID).eq("code", code3).single()).data.id;
r = await req(F, `/admin/turnos/${id3}`, { cookies: ownerC });
ok(r.status === 200 && strip(r.html).includes("Cancelar el turno") && strip(r.html).includes("¿Quién cancela?"), "detalle del turno: pregunta quién cancela");
r = await submit(F, `/admin/turnos/${id3}`, 'name="expected_client"', { by: "studio", reason: "Se enfermó la profesional (e2e)", refund_mode: "credit" }, ownerC);
ok(r.status === 303, "cancela el estudio con saldo a favor");
r = await req(F, `/reserva/${code3}`, { cookies: c1 });
ok(strip(r.html).includes("El estudio canceló tu turno. Motivo: Se enfermó la profesional (e2e). Sumamos $ 7.500 a tu saldo a favor."),
  "la clienta ve el motivo y que no perdió la seña");

// ---------------------------------------------------------------------
// 5) Agenda y asistencia
// ---------------------------------------------------------------------
// Turno que empieza en 10–100 minutos (se puede marcar desde 2 h antes); busca un hueco cada 15 min.
const t5 = await manual(cp2, new Date(Date.now() + 10 * 60_000 - (Date.now() % 300_000)), SOFI, 15);
const id5 = t5.appointment_id;
r = await req(F, "/admin/agenda", { cookies: ownerC });
ok(r.status === 200 && strip(r.html).includes("Agenda") && strip(r.html).includes("Semana") && strip(r.html).includes("Llegó"),
  "agenda del día: se ve el turno con la acción «Llegó»");
r = await req(F, "/admin/agenda?vista=semana", { cookies: ownerC });
ok(r.status === 200 && strip(r.html).includes("Semana del"), "agenda: vista semana");
r = await req(F, `/admin/turnos/${id5}`, { cookies: ownerC });
let fd = formFields(r.html, 'value="checked_in"');
r = await req(F, `/admin/turnos/${id5}`, { method: "POST", body: fd, cookies: ownerC });
r = await req(F, `/admin/turnos/${id5}`, { cookies: ownerC });
ok(strip(r.html).includes("llegó ") && strip(r.html).includes("Empezó"), "«Llegó» queda registrado y ofrece «Empezó»");
fd = formFields(r.html, 'value="finished"');
await req(F, `/admin/turnos/${id5}`, { method: "POST", body: fd, cookies: ownerC });
const a5 = (await owner.from("appointments").select("status, deposit_outcome").eq("id", id5).single()).data;
ok(a5.status === "completed" && a5.deposit_outcome === "applied", "«Terminó»: atendida y la seña cuenta como pago");

// Profesional (Sofi): solo lo suyo, marca su turno, no marca faltas
const pro = await supabaseAs("profesional@fresasstudio.test");
const proC = await login(F, "profesional@fresasstudio.test");
r = await req(F, "/admin/agenda?vista=semana", { cookies: proC });
ok(r.status === 200 && !strip(r.html).includes(">Todas<"), "profesional: agenda sin filtro de profesionales (ve solo la suya)");
const tCaro = await manual(cp2, hourFromNow(24 * 70 + Math.floor(Math.random() * 200)), CARO);
const { data: proAgenda } = await pro.rpc("agenda_range", {
  p_tenant: FRESAS_ID, p_from: new Date(Date.now() - 86_400_000).toISOString(), p_to: new Date(Date.now() + 30 * 86_400_000).toISOString(),
});
ok((proAgenda ?? []).every((x) => x.professional_id === SOFI), "profesional: en la agenda ve solo sus turnos");
const tPast = await pastTurn(cp2, 120);
const { error: proNoShow } = await pro.rpc("mark_no_show", { p_appointment: tPast });
ok(Boolean(proNoShow), "profesional: no puede marcar faltas");
const { data: noShow, error: noShowErr } = await owner.rpc("mark_no_show", { p_appointment: tPast });
if (noShowErr) console.error(noShowErr.message);
ok(noShow === "forfeited", "la dueña marca la falta: la seña se pierde");
r = await req(F, "/admin/clientas", { cookies: proC });
ok(r.status === 200 && !strip(r.html).includes("Nueva clienta"), "profesional: ve el directorio (solo sus clientas) sin poder dar altas");
const { data: proClients } = await pro.rpc("list_clients", { p_tenant: FRESAS_ID });
const { data: sofiClients } = await owner.from("appointments").select("client_profile_id").eq("tenant_id", FRESAS_ID).eq("professional_id", SOFI);
const allowed = new Set((sofiClients ?? []).map((x) => x.client_profile_id));
ok((proClients ?? []).every((c) => allowed.has(c.id)), "profesional: solo clientas que atendió o va a atender");
r = await req(F, "/admin/asistencia", { cookies: proC });
ok(r.status === 404, "profesional: sin indicadores del estudio (HTTP 404)");
void tCaro;

// ---------------------------------------------------------------------
// 6) Ficha de la clienta: notas internas que la clienta nunca ve
// ---------------------------------------------------------------------
r = await req(F, `/admin/clientas/${cp2}`, { cookies: ownerC });
ok(r.status === 200 && strip(r.html).includes("Notas internas") && strip(r.html).includes("Faltas"), "ficha: indicadores, turnos y notas");
r = await submit(F, `/admin/clientas/${cp2}`, 'name="body"', { body: "Prefiere la tarde (e2e)" }, ownerC);
r = await req(F, `/admin/clientas/${cp2}`, { cookies: ownerC });
ok(strip(r.html).includes("Prefiere la tarde (e2e)"), "la nota se guarda y la ve el equipo");
const { data: leaked } = await cli2.from("client_notes").select("id");
ok((leaked ?? []).length === 0, "la clienta no puede leer sus notas internas");
r = await req(F, "/admin/clientas?q=clienta08", { cookies: ownerC });
ok(strip(r.html).includes("Faltas") || strip(r.html).includes("falta"), "directorio: la búsqueda encuentra a la clienta, con sus faltas");
r = await req(F, "/admin/asistencia", { cookies: ownerC });
ok(r.status === 200 && strip(r.html).includes("Clientas frecuentes") && strip(r.html).includes("Faltas repetidas"), "asistencia: indicadores y rankings");
r = await req(F, "/admin", { cookies: ownerC });
ok(r.status === 200, "inicio del panel con los avisos nuevos");

done();
