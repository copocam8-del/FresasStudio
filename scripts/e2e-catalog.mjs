// Pruebas de punta a punta del catálogo, profesionales, horarios y bloqueos (Sprint 3).
// Requiere la app en localhost:3000 (npm run dev o next start) apuntando al Supabase de
// DESARROLLO con el seed. Uso: node scripts/e2e-catalog.mjs (limpia lo que crea).
import { done, F, FRESAS_ID, login, ok, req, submit, supabaseAs } from "./e2e-lib.mjs";

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
ok(r.html.includes('aria-label="Cleo"'), "servicios: con la marca Cleo (Fresas no activó la propia)");

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

// ---------------------------------------------------------------------
// Horario del estudio y bloqueos generales
// ---------------------------------------------------------------------
r = await req(F, "/admin/horarios", { cookies: owner });
ok(r.status === 200 && r.html.includes("Guardar horario") && r.html.includes("Sábado"), "horarios: la dueña puede editar el horario del estudio");
r = await req(F, "/admin/horarios", { cookies: pro });
ok(r.status === 200 && r.html.includes("Solo lectura") && !r.html.includes("Guardar horario"), "horarios: la profesional solo lo ve");
// Envío forzado: el formulario de la dueña, mandado con la sesión de la profesional.
{
  const { formFields } = await import("./e2e-lib.mjs");
  const forced = formFields((await req(F, "/admin/horarios", { cookies: owner })).html, "Guardar horario");
  forced.set("ranges", "[]");
  r = await req(F, "/admin/horarios", { method: "POST", body: forced, cookies: pro });
}
ok(r.html.includes("No tenés permiso"), "horarios: la profesional no puede guardarlo aunque fuerce el envío");

const { data: studioRows } = await sb.from("working_hours").select("weekday, start_minute, end_minute").is("professional_id", null);
const original = studioRows.map((h) => ({ weekday: h.weekday, start: h.start_minute, end: h.end_minute }));
r = await submit(F, "/admin/horarios", "Guardar horario",
  { ranges: JSON.stringify([...original.filter((h) => h.weekday !== 6), { weekday: 6, start: 540, end: 600 }, { weekday: 6, start: 570, end: 660 }]) }, owner);
ok(r.html.includes("se superponen"), "horarios: franjas superpuestas se rechazan con un mensaje claro");
r = await submit(F, "/admin/horarios", "Guardar horario",
  { ranges: JSON.stringify([...original.filter((h) => h.weekday !== 6), { weekday: 6, start: 600, end: 840 }]) }, owner);
ok(r.html.includes("Guardamos el horario"), "horarios: cambiar el sábado a 10–14 se guarda");
r = await submit(F, "/admin/horarios", "Guardar horario", { ranges: JSON.stringify(original) }, owner);
ok(r.html.includes("Guardamos el horario"), "horarios: se restaura el horario original");

r = await req(F, "/admin/bloqueos", { cookies: owner });
ok(r.status === 200 && r.html.includes("Inmaculada Concepción") && r.html.includes("Todo el estudio") && r.html.includes("Caro"),
   "bloqueos: lista los del estudio y de cada profesional");
r = await submit(F, "/admin/bloqueos", "Agregar bloqueo",
  { kind: "block", professional_id: "", from_date: "2026-12-30", to_date: "2026-12-30", from_time: "15:00", to_time: "14:00", note: `E2E ${stamp}` }, owner);
ok(r.html.includes("terminar después de empezar"), "bloqueos: un horario al revés se rechaza");
r = await submit(F, "/admin/bloqueos", "Agregar bloqueo",
  { kind: "block", professional_id: "", from_date: "2026-12-30", to_date: "2026-12-30", from_time: "15:00", to_time: "16:30", note: `E2E ${stamp}` }, owner);
ok(r.html.includes("Bloqueo guardado"), "bloqueos: el estudio cierra de 15 a 16:30 un día");
const blk = (await sb.from("schedule_blocks").select("id, period").eq("note", `E2E ${stamp}`).single()).data;
ok(blk?.period?.startsWith('["2026-12-30 18:00:00+00"'), "bloqueos: guardado en hora de Buenos Aires (15:00 = 18:00 UTC)");
r = await req(F, "/admin/bloqueos", { cookies: owner });
const delFd = (await import("./e2e-lib.mjs")).formFields(r.html, blk.id);
r = await req(F, "/admin/bloqueos", { method: "POST", body: delFd, cookies: owner });
ok(!(await sb.from("schedule_blocks").select("id").eq("id", blk.id)).data?.length, "bloqueos: «Quitar» lo borra");
r = await req(F, "/admin/bloqueos", { cookies: pro });
ok(r.status === 200 && !r.html.includes("Nuevo bloqueo"), "bloqueos: la profesional los ve sin poder cargar (N6)");

// ---------------------------------------------------------------------
// Sitio público: catálogo y profesionales
// ---------------------------------------------------------------------
r = await req(F, "/");
const site = r.html.replace(/<!-- -->/g, "");
ok(r.status === 200 && site.includes(">Servicios<") && site.includes(">Uñas<") && site.includes(">Pestañas<"),
   "sitio: muestra los servicios agrupados por categoría");
ok(/desde \$\s13\.000/.test(site) && /\$\s9\.000/.test(site) && site.includes("1 h 30 min"),
   "sitio: precios en formato argentino («desde» cuando corresponde) y duraciones legibles");
ok(site.includes("Con Sofi o Caro") && site.includes(">Profesionales<") && site.includes("Especialista en uñas."),
   "sitio: muestra las profesionales y quién hace cada servicio");
ok(!site.includes("Diseño con henna"), "sitio: el servicio «no visible en el sitio» no aparece");
ok(site.includes('aria-label="Cleo"'), "sitio: con la marca Cleo por defecto");
ok(site.includes('href="/reservar"') && site.includes("Reservar turno"),
   "sitio: con las reservas online prendidas (seed de desarrollo) ofrece «Reservar turno»");
r = await req("estudio-prueba.localhost:3000", "/");
ok(r.status === 200 && !r.html.includes(">Servicios<") && !r.html.includes("Esmaltado"), "Estudio Prueba: no muestra nada del catálogo de Fresas");

// ---------------------------------------------------------------------
// Fotos (bucket "catalog", Storage real)
// ---------------------------------------------------------------------
{
  const png = { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), type: "image/png", name: "foto.png" };
  const svg = { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), type: "image/png", name: "foto.png" };
  const photoName = `Prueba E2E foto ${stamp}`;
  const fields = { ...base, name: photoName, deposit_mode: "studio", deposit_percent: "" };

  r = await submit(F, "/admin/servicios/nuevo", "Crear servicio", fields, owner, { photo: svg });
  ok(r.html.includes("PNG, JPG o WebP"), "foto: un SVG disfrazado de .png se rechaza (se miran los bytes)");
  r = await submit(F, "/admin/servicios/nuevo", "Crear servicio", fields, owner, { photo: png });
  ok(r.status === 303, "foto: el servicio se crea con su foto");
  const svc = (await sb.from("services").select("id, photo_path").eq("name", photoName).single()).data;
  ok(new RegExp(`^${FRESAS_ID}/services/[0-9a-f-]{36}\.png$`).test(svc?.photo_path ?? ""), "foto: guardada en la carpeta del estudio");

  r = await req(F, "/");
  const src = new RegExp(`<img src="([^"]+/storage/v1/object/public/catalog/${svc.photo_path})"`).exec(r.html)?.[1];
  ok(Boolean(src), "sitio: el servicio muestra su foto");
  const img = src ? await fetch(src) : null;
  ok(img?.status === 200 && img.headers.get("content-type") === "image/png", "foto: Storage la sirve como image/png");

  r = await submit(F, `/admin/servicios/${svc.id}`, "Guardar cambios", { ...fields, remove_photo: "on" }, owner);
  const after = (await sb.from("services").select("photo_path").eq("id", svc.id).single()).data;
  const left = await sb.storage.from("catalog").list(`${FRESAS_ID}/services`);
  ok(r.status === 303 && after?.photo_path === null && !left.data?.some((o) => svc.photo_path.endsWith(o.name)),
     "foto: «Quitar la foto» la borra del servicio y del bucket");
  await submit(F, `/admin/servicios/${svc.id}`, "Archivar servicio", {}, owner);
}

done();
