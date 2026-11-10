// Pruebas de punta a punta del catálogo, profesionales, horarios y bloqueos (Sprint 3).
// Requiere la app en localhost:3000 (npm run dev o next start) apuntando al Supabase de
// DESARROLLO con el seed. Uso: node scripts/e2e-catalog.mjs (limpia lo que crea).
import { done, F, formFields, login, ok, req, submit, supabaseAs } from "./e2e-lib.mjs";

const owner = await login(F, "duena@fresasstudio.test");
const pro = await login(F, "profesional@fresasstudio.test");
const stamp = Date.now().toString(36);

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

export { owner, pro, sb, stamp };
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("e2e-catalog.mjs")) done();
