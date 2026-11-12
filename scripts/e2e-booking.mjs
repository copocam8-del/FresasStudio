// Pruebas de punta a punta del motor de reservas (Sprint 4).
// Requiere la app en localhost:3000 (npm run build && npx next start -p 3000) apuntando al
// Supabase de DESARROLLO con el seed y NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS=true en .env.local.
// Uso: node scripts/e2e-booking.mjs
import { done, F, formFields, login, ok, req, submit, supabaseAs } from "./e2e-lib.mjs";

const SEMI = "31000000-0000-4000-a000-000000000001";
const SOFI = "32000000-0000-4000-a000-000000000001";
const clientEmail = (i) => `clienta${String(i).padStart(2, "0")}@e2e.test`;
// Sesión de clienta con contraseña (las del seed de desarrollo). El login del panel deja
// entrar a quien no es del equipo solo si va a una invitación: se usa ese camino.
const clientSession = (i) => login(F, clientEmail(i), "/admin/invitacion?token=x");

// Limpieza previa: libera reservas pendientes que hayan quedado de corridas anteriores.
for (let i = 1; i <= 10; i++) {
  const sb = await supabaseAs(clientEmail(i));
  const { data } = await sb.rpc("my_bookings", { p_slug: "fresas" });
  for (const b of data ?? []) if (b.status === "pending_payment") await sb.rpc("release_my_pending_booking", { p_slug: "fresas", p_code: b.code });
}

// ---------------------------------------------------------------------
// Flujo de la clienta
// ---------------------------------------------------------------------
let r = await req(F, "/reservar");
ok(r.status === 200 && r.html.includes("¿Qué te querés hacer?") && r.html.includes("Esmaltado semipermanente") && r.html.includes('aria-label="Cleo"'),
   "paso 1: lista de servicios, con la marca Cleo");
r = await req(F, `/reservar/${SEMI}`);
ok(r.status === 200 && r.html.includes("Cualquiera disponible") && r.html.includes("Sofi") && r.html.includes("Caro"),
   "paso 2: «Cualquiera disponible» primero y cada profesional");
r = await req(F, `/reservar/${SEMI}?p=${SOFI}`);
const stepPage = r.html;
const slotLinks = [...r.html.matchAll(/href="(\/reservar\/confirmar\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
ok(r.status === 200 && slotLinks.length > 0, `paso 3: día y horarios libres de Sofi (${slotLinks.length} horarios)`);
ok(/>1[4-8]:[0-5][05]</.test(r.html.replace(/<!-- -->/g, "")) && !/>0[89]:/.test(r.html.replace(/<!-- -->/g, "")),
   "paso 3: los horarios de Sofi son de tarde, en la hora del estudio");

const confirmPath = slotLinks[0];
r = await req(F, confirmPath);
ok(r.status === 307 && r.location?.startsWith("/ingresar?next=%2Freservar%2Fconfirmar"), "paso 4 sin sesión: pide ingresar y vuelve al mismo lugar (B1)");

const c1 = await clientSession(1);
r = await req(F, confirmPath, { cookies: c1 });
const page = r.html.replace(/<!-- -->/g, "");
ok(r.status === 200 && page.includes("Revisá y confirmá") && page.includes("con Sofi") && /Seña a pagar ahora/.test(page),
   "paso 4: resumen con profesional, precio total y seña");
ok(/\$\s15\.000/.test(page) && /\$\s7\.500/.test(page) && page.includes("24 horas"), "resumen: $ 15.000, seña $ 7.500 y política de 24 h");

r = await submit(F, confirmPath, "Reservar y pagar seña", { phone: "11 5000-0001", note: "" }, c1);
ok(r.html.includes("aceptar la política"), "sin aceptar la política no se puede reservar");
r = await submit(F, confirmPath, "Reservar y pagar seña", { phone: "11 5000-0001", accept_policy: "on", note: "Prueba e2e" }, c1);
const code = /\/reserva\/([2-9A-HJKMNP-Z]{6})$/.exec(r.location ?? "")?.[1];
ok(r.status === 303 && Boolean(code), `reservar: crea la reserva y va a /reserva/${code}`);

r = await req(F, `/reserva/${code}`, { cookies: c1 });
ok(r.status === 200 && r.html.includes("Te guardamos el horario") && r.html.includes("Pagá la seña para confirmar"),
   "reserva: esperando pago, con el tiempo para pagar");
const sb1 = await supabaseAs(clientEmail(1));
const mine = (await sb1.rpc("my_bookings", { p_slug: "fresas" })).data.find((b) => b.code === code);
ok(mine?.status === "pending_payment" && mine.price_minor === 1500000 && mine.deposit_minor === 750000 && mine.cancellation_window_hours === 24,
   "en la base: esperando pago, $ 15.000, seña $ 7.500, ventana 24 h");
ok(Math.abs(new Date(mine.hold_expires_at).getTime() - Date.now() - 2 * 3600_000) < 60_000, "bloqueo temporal de 2 horas");

// Un horario de OTRO día (nunca se superpone con la reserva recién hecha).
const dayLinks = [...stepPage.matchAll(/href="(\/reservar\/[^"?]+\?p=[^&"]+&amp;dia=\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const firstDay = new URL("http://x" + confirmPath).searchParams.get("t");
const firstYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(firstDay));
let otherSlot;
for (const link of dayLinks.filter((l) => !l.endsWith(firstYmd))) {
  const page = await req(F, link);
  otherSlot = [...page.html.matchAll(/href="(\/reservar\/confirmar\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))[0];
  if (otherSlot) break;
}
r = await submit(F, otherSlot, "Reservar y pagar seña", { phone: "11 5000-0001", accept_policy: "on" }, c1);
ok(r.html.includes("Ya tenés una reserva esperando pago"), "B7: no puede apartar otro horario mientras tiene uno pendiente");

// Lo acordado no cambia aunque cambie el precio
const owner = await supabaseAs("duena@fresasstudio.test");
await owner.from("services").update({ price_minor: 9999900 }).eq("id", SEMI);
const after = (await sb1.rpc("my_bookings", { p_slug: "fresas" })).data.find((b) => b.code === code);
await owner.from("services").update({ price_minor: 1500000 }).eq("id", SEMI);
ok(after?.price_minor === 1500000 && after.deposit_minor === 750000, "cambiar el precio del servicio no cambia la reserva");

// Pago simulado (solo desarrollo) → confirmada
r = await req(F, `/reserva/${code}`, { cookies: c1 });
ok(r.html.includes("Simular pago aprobado (solo desarrollo)"), "desarrollo: aparece el pago simulado");
r = await req(F, `/reserva/${code}`, { method: "POST", body: formFields(r.html, "Simular pago aprobado"), cookies: c1 });
r = await req(F, `/reserva/${code}`, { cookies: c1 });
ok(r.html.includes("Reserva confirmada"), "pago verificado (simulado) → reserva confirmada");

// ---------------------------------------------------------------------
// Carrera: 10 clientas confirman el MISMO horario a la vez contra la app real
// ---------------------------------------------------------------------
const raceSlot = otherSlot; // libre: el intento de B7 se rechazó y no lo ocupó
const sessions = await Promise.all([...Array(10)].map((_, i) => clientSession(i + 1)));
const pages = await Promise.all(sessions.map((s) => req(F, raceSlot, { cookies: s })));
const forms = pages.map((p) => {
  const fd = formFields(p.html, "Reservar y pagar seña");
  fd.set("phone", "11 5000-0000"); fd.set("accept_policy", "on");
  return fd;
});
const results = await Promise.all(forms.map((fd, i) => req(F, "/reservar/confirmar", { method: "POST", body: fd, cookies: sessions[i] })));
const wins = results.filter((x) => x.status === 303 && /\/reserva\//.test(x.location ?? "")).length;
const clear = results.filter((x) => /se acaba de ocupar|no está disponible|Ya tenés una reserva/.test(x.html)).length;
ok(wins === 1, `10 clientas a la vez por el mismo horario: exactamente 1 reserva (${wins})`);
ok(clear === 9, `las otras 9 ven un mensaje claro (${clear})`);

// ---------------------------------------------------------------------
// Panel: turnos, detalle, turno manual, seña cobrada y cancelar
// ---------------------------------------------------------------------
const staff = await login(F, "duena@fresasstudio.test");
const day = new URL("http://x" + confirmPath).searchParams.get("t");
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(day));
r = await req(F, `/admin/turnos?dia=${ymd}`, { cookies: staff });
ok(r.status === 200 && r.html.includes("Esmaltado semipermanente") && r.html.includes("Confirmado"), "panel: la dueña ve los turnos del día");
const pro = await login(F, "profesional@fresasstudio.test");
r = await req(F, `/admin/turnos?dia=${ymd}`, { cookies: pro });
ok(r.status === 200 && !/Caro ·/.test(r.html), "panel: la profesional (Sofi) ve solo los suyos");

// Los turnos manuales confirmados no se pueden cancelar (B13): para poder repetir el e2e,
// cada corrida usa un día distinto y lejano (entre 70 y 370 días adelante).
const manualYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
  .format(new Date(Date.now() + (70 + (Math.floor(Date.now() / 60_000) % 300)) * 86_400_000));
r = await submit(F, "/admin/turnos/nuevo", "Guardar turno", {
  client_mode: "new", new_name: "Clienta WhatsApp E2E", new_phone: "11 5000-9999", professional: SOFI, service: SEMI,
  date: manualYmd, time: "03:00", payment: "pending", note: "" }, staff);
ok(r.html.includes("no está disponible"), "turno manual a las 3 AM sin el tilde: no disponible");
r = await submit(F, "/admin/turnos/nuevo", "Guardar turno", {
  client_mode: "new", new_name: "Clienta WhatsApp E2E", new_phone: "11 5000-9999", professional: SOFI, service: SEMI,
  date: manualYmd, time: "07:00", force: "on", payment: "pending", note: "" }, staff);
const manualId = /\/admin\/turnos\/([0-9a-f-]{36})$/.exec(r.location ?? "")?.[1];
ok(r.status === 303 && Boolean(manualId), "turno manual forzado fuera de horario: se crea esperando pago");
r = await req(F, `/admin/turnos/${manualId}`, { cookies: staff });
ok(r.html.includes("Marcar cobrada") && r.html.includes("Cancelar turno") && r.html.includes("Reserva creada"), "detalle: acciones e historial");
r = await req(F, `/admin/turnos/${manualId}`, { method: "POST", body: (() => { const fd = formFields(r.html, "Marcar cobrada"); fd.set("method", "transfer"); return fd; })(), cookies: staff });
r = await req(F, `/admin/turnos/${manualId}`, { cookies: staff });
ok(r.html.includes("Confirmado") && r.html.replace(/<!-- -->/g, "").includes("Seña cobrada en el estudio (transferencia)"), "marcar seña cobrada por transferencia → confirmado, con el medio en el historial");

r = await submit(F, "/admin/turnos/nuevo", "Guardar turno", {
  client_mode: "new", new_name: "Clienta Cancela E2E", new_phone: "11 5000-8888", professional: SOFI, service: SEMI,
  date: manualYmd, time: "05:00", force: "on", payment: "pending", note: "" }, staff); // 05:00–06:10: no pisa el de las 07:00
const cancelId = /\/admin\/turnos\/([0-9a-f-]{36})$/.exec(r.location ?? "")?.[1];
r = await req(F, `/admin/turnos/${cancelId}`, { cookies: staff });
r = await req(F, `/admin/turnos/${cancelId}`, { method: "POST", body: (() => { const fd = formFields(r.html, "Cancelar turno"); fd.set("reason", "No confirmó"); return fd; })(), cookies: staff });
r = await req(F, `/admin/turnos/${cancelId}`, { cookies: staff });
ok(r.html.includes("Cancelado") && r.html.replace(/<!-- -->/g, "").includes("«No confirmó»"), "cancelar un turno sin seña: queda cancelado con el motivo");

// Reglas de reservas
r = await req(F, "/admin/reservas", { cookies: staff });
ok(r.status === 200 && r.html.includes("Reglas de reservas") && r.html.includes("Tiempo para pagar"), "panel: reglas de reservas");
r = await submit(F, "/admin/reservas", "Guardar reglas", {
  online_booking_enabled: "on", booking_min_notice_minutes: "720", booking_horizon_days: "60", slot_interval_minutes: "15",
  booking_hold_minutes: "120", deposit_percent: "0", cancellation_window_hours: "24" }, staff);
ok(r.html.includes("toda reserva lleva seña"), "reglas: seña 0% rechazada");

done();
