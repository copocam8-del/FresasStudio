// Pruebas de punta a punta del catálogo, profesionales, horarios y bloqueos (Sprint 3).
// Requiere la app en localhost:3000 (npm run dev o next start) apuntando al Supabase de
// DESARROLLO con el seed. Uso: node scripts/e2e-catalog.mjs (limpia lo que crea).
import { done, F, login, ok, req, submit, supabaseAs } from "./e2e-lib.mjs";

const owner = await login(F, "duena@fresasstudio.test");
const pro = await login(F, "profesional@fresasstudio.test");
const stamp = Date.now().toString(36);

// Si una corrida anterior se cortó a mitad de camino, archiva lo que dejó (nombres "E2E…"/"Prueba E2E…").
{
  const sb0 = await supabaseAs("duena@fresasstudio.test");
  const now = new Date().toISOString();
  const leftovers = (await sb0.from("professionals").select("id").like("display_name", "E2E %").is("archived_at", null)).data ?? [];
  for (const p of leftovers) {
    await sb0.from("professional_services").delete().eq("professional_id", p.id);
    await sb0.from("working_hours").delete().eq("professional_id", p.id);
    await sb0.from("schedule_blocks").delete().eq("professional_id", p.id);
    await sb0.from("professionals").update({ archived_at: now, is_active: false }).eq("id", p.id);
  }
  await sb0.from("services").update({ archived_at: now, is_active: false }).like("name", "Prueba E2E %").is("archived_at", null);
}

// ---------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------
let r = await req(F, "/admin/servicios", { cookies: owner });
ok(r.status === 200 && r.html.includes("Esmaltado semipermanente") && r.html.includes("Lo hacen: Sofi, Caro"),
   "servicios: la dueña ve el catálogo con quién hace cada servicio");
ok(!/Cleo/.test(r.html), "servicios: sin la marca Cleo");

r = await req(F, "/admin/servicios", { cookies: pro });
ok(r.status === 200 && r.html.includes("Solo lectura") && !r.html.includes("+ Nuevo servicio"), "servicios: la profesional ve en solo lectura");
r = await req(F, "/admin/servicios/nuevo", { cookies: pro });
ok(r.status === 404, `servicios: la profesional no puede entrar a crear (HTTP ${r.status})`);

const name = `Prueba E2E ${stamp}`;
const base = { name, category_id: "", description: "Creado por el e2e", duration_minutes: "45", buffer_after_minutes: "5",
  price: "8.500", deposit_mode: "custom", deposit_percent: "20", is_active: "on", show_online: "on" };
r = await submit(F, "/admin/servicios/nuevo", "Crear servicio", { ...base, price: "8.5" }, owner);
ok(r.html.includes("Escribí el precio como 12.500"), "nuevo servicio: precio ambiguo se rechaza en el servidor");
r = await submit(F, "/admin/servicios/nuevo", "Crear servicio", { ...base, duration_minutes: "47" }, owner);
ok(r.html.includes("pasos de 5 minutos"), "nuevo servicio: duración que no es múltiplo de 5 se rechaza");
r = await submit(F, "/admin/servicios/nuevo", "Crear servicio", base, owner);
ok(r.status === 303 && r.location === "/admin/servicios", "nuevo servicio: se crea y vuelve a la lista");

const sb = await supabaseAs("duena@fresasstudio.test");
const { data: created } = await sb.from("services").select("*").eq("name", name).single();
ok(created?.price_minor === 850000 && created.duration_minutes === 45 && created.deposit_percent === 20 && created.buffer_after_minutes === 5,
   "nuevo servicio: guardado en centavos, con seña propia y tiempo extra");

const publicCatalog = async () => (await (await supabaseAs()).rpc("get_public_catalog", { p_slug: "fresas" })).data;
ok((await publicCatalog()).services.some((s) => s.name === name && s.duration_minutes === 45),
   "catálogo público: el servicio nuevo aparece con su duración");

r = await submit(F, `/admin/servicios/${created.id}`, "Guardar cambios", { ...base, price: "9.000", show_online: "" }, owner);
ok(r.status === 303, "editar servicio: guarda");
ok(!(await publicCatalog()).services.some((s) => s.name === name), "catálogo público: un servicio «no visible en el sitio» desaparece");
const { data: audit } = await sb.from("audit_logs").select("old_data, new_data").eq("entity_id", created.id).eq("action", "update");
ok((audit ?? []).some((a) => a.old_data?.price_minor === 850000 && a.new_data?.price_minor === 900000),
   "auditoría: el cambio de precio queda con el valor anterior y el nuevo");

// Archivar (limpieza): no se borra
r = await submit(F, `/admin/servicios/${created.id}`, "Archivar servicio", {}, owner);
ok(r.status === 303 && r.location === "/admin/servicios", "archivar: vuelve a la lista");
const { data: archived } = await sb.from("services").select("archived_at").eq("id", created.id).single();
ok(Boolean(archived?.archived_at), "archivar: el servicio queda archivado, no borrado");

// Categorías: repetida sin importar mayúsculas
r = await submit(F, "/admin/servicios/categorias", "Agregar", { name: "UÑAS" }, owner);
ok(r.html.includes("Ya existe una categoría con ese nombre"), "categorías: «UÑAS» se rechaza porque ya existe «Uñas»");

// ---------------------------------------------------------------------
// Profesionales: alta sin cuenta, servicios con precio propio, horario y bloqueos
// ---------------------------------------------------------------------
r = await req(F, "/admin/profesionales", { cookies: owner });
ok(r.status === 200 && r.html.includes("Sofi") && r.html.includes("usa el panel") && r.html.includes("sin cuenta"),
   "profesionales: lista con quién usa el panel y quién no");
r = await req(F, "/admin/profesionales", { cookies: pro });
ok(r.status === 200 && !r.html.includes("+ Nueva profesional"), "profesionales: la profesional ve la lista sin poder crear");

const proName = `E2E ${stamp}`;
r = await submit(F, "/admin/profesionales/nueva", "Crear profesional",
  { display_name: proName, bio: "", membership_id: "", is_active: "on", show_online: "on", accepts_online_booking: "on" }, owner);
const newId = /\/admin\/profesionales\/([0-9a-f-]{36})\?tab=servicios/.exec(r.location ?? "")?.[1];
ok(r.status === 303 && Boolean(newId), "nueva profesional sin cuenta: se crea y va a elegir servicios");

const semi = "31000000-0000-4000-a000-000000000001";
const proUrl = `/admin/profesionales/${newId}`;
r = await submit(F, `${proUrl}?tab=servicios`, "Guardar servicios", { [`svc_${semi}`]: "on", [`price_${semi}`]: "11.000", [`dur_${semi}`]: "73" }, owner);
ok(r.html.includes("pasos de 5"), "servicios de la profesional: duración propia inválida se rechaza");
r = await submit(F, `${proUrl}?tab=servicios`, "Guardar servicios", { [`svc_${semi}`]: "on", [`price_${semi}`]: "11.000", [`dur_${semi}`]: "70" }, owner);
ok(r.html.includes("Guardamos 1 servicio"), "servicios de la profesional: se asigna con precio y duración propios");
const { data: asg } = await sb.from("professional_services").select("*").eq("professional_id", newId).single();
ok(asg?.price_minor_override === 1100000 && asg.duration_minutes_override === 70, "asignación guardada en centavos y minutos");
const cat1 = (await (await supabaseAs()).rpc("get_public_catalog", { p_slug: "fresas" })).data;
ok(cat1.services.find((s) => s.id === semi)?.price_minor === 1100000, "catálogo público: el semipermanente pasa a «desde $ 11.000»");

const hours = (ranges) => ({ mode: "own", ranges: JSON.stringify(ranges) });
r = await submit(F, `${proUrl}?tab=horario`, "Guardar horario", hours([{ weekday: 1, start: 480, end: 600 }]), owner);
ok(r.html.includes("dentro del horario del estudio"), "horario: fuera del horario del estudio se rechaza (N5)");
r = await submit(F, `${proUrl}?tab=horario`, "Guardar horario", hours([{ weekday: 1, start: 600, end: 720 }, { weekday: 3, start: 840, end: 960 }]), owner);
ok(r.html.includes("Guardamos el horario"), "horario: propio, dentro del del estudio, se guarda");
const { data: wh } = await sb.from("working_hours").select("weekday, start_minute, end_minute").eq("professional_id", newId).order("weekday");
ok(wh?.length === 2 && wh[0].start_minute === 600 && wh[1].weekday === 3, "horario guardado: lunes 10–12 y miércoles 14–16");
r = await submit(F, `${proUrl}?tab=horario`, "Guardar horario", { mode: "studio", ranges: "[]" }, owner);
const { data: wh2 } = await sb.from("working_hours").select("id").eq("professional_id", newId);
ok(r.html.includes("Guardamos el horario") && wh2?.length === 0, "horario: «igual al del estudio» borra el propio (N4)");

r = await req(F, `${proUrl}?tab=horario`, { cookies: pro });
ok(r.status === 200 && !r.html.includes("Guardar horario"), "horario: la profesional lo ve sin poder editar (N6)");

r = await submit(F, `${proUrl}?tab=bloqueos`, "Agregar bloqueo",
  { kind: "day_off", from_date: "2026-12-14", to_date: "2026-12-15", all_day: "on", note: "Turno médico" }, owner);
ok(r.html.includes("Bloqueo guardado"), "bloqueo: día libre de dos días se guarda");
r = await req(F, `${proUrl}?tab=bloqueos`, { cookies: owner });
ok(r.html.includes("Turno médico") && /14 dic\.? al mar[^<]*15 dic/.test(r.html.replace(/<!-- -->/g, "")), "bloqueo: aparece con sus fechas en hora del estudio");
ok(r.html.includes("Inmaculada Concepción"), "bloqueos de la profesional: también muestra los del estudio (feriado)");
const blockId = (await sb.from("schedule_blocks").select("id").eq("professional_id", newId).single()).data?.id;
r = await req(F, `${proUrl}?tab=bloqueos`, { cookies: owner });
const quitar = r.html.split("<form").find((f) => f.includes(blockId));
ok(Boolean(quitar), "bloqueo: tiene botón para quitarlo");

// Limpieza: quitar el bloqueo y archivar la profesional
await sb.from("schedule_blocks").delete().eq("id", blockId);
r = await submit(F, `${proUrl}?tab=datos`, "Archivar profesional", {}, owner);
ok(r.status === 303 && r.location === "/admin/profesionales", "archivar profesional: vuelve a la lista");
const cat2 = (await (await supabaseAs()).rpc("get_public_catalog", { p_slug: "fresas" })).data;
ok(!cat2.professionals.some((p) => p.id === newId) && cat2.services.find((s) => s.id === semi)?.price_minor === 1300000,
   "archivada: sale del sitio y el semipermanente vuelve a «desde $ 13.000»");

done();
