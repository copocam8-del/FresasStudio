import { describe, expect, it } from "vitest";
import { overrideSchema, professionalSchema, serviceSchema } from "./catalog-schemas";
import { userFacingDbError } from "./db-errors";

const base = {
  name: "Esmaltado",
  category_id: "",
  description: "  ",
  duration_minutes: "60",
  buffer_after_minutes: "10",
  price: "12.500",
  price_is_from: "",
  deposit_mode: "studio",
  deposit_percent: "",
  show_online: "on",
  is_active: "on",
};

describe("serviceSchema", () => {
  it("convierte el formulario a lo que guarda la base", () => {
    expect(serviceSchema.parse(base)).toEqual({
      name: "Esmaltado",
      category_id: null,
      description: null,
      duration_minutes: 60,
      buffer_after_minutes: 10,
      price_minor: 1250000,
      price_is_from: false,
      deposit_percent: null,
      show_online: true,
      is_active: true,
    });
  });
  it("las casillas sin tildar no viajan en el formulario (campo ausente = false)", () => {
    const rest: Partial<typeof base> = { ...base };
    delete rest.price_is_from;
    delete rest.show_online;
    const parsed = serviceSchema.parse(rest);
    expect(parsed.price_is_from).toBe(false);
    expect(parsed.show_online).toBe(false);
  });
  it("seña propia (N1)", () => {
    expect(serviceSchema.parse({ ...base, deposit_mode: "custom", deposit_percent: "30" }).deposit_percent).toBe(30);
    expect(serviceSchema.safeParse({ ...base, deposit_mode: "custom", deposit_percent: "130" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...base, deposit_mode: "custom", deposit_percent: "0" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...base, deposit_mode: "custom", deposit_percent: "" }).success).toBe(false);
  });
  it.each([
    ["duración no múltiplo de 5", { duration_minutes: "62" }],
    ["duración de más de 10 h", { duration_minutes: "605" }],
    ["tiempo extra no múltiplo de 5", { buffer_after_minutes: "7" }],
    ["precio ambiguo", { price: "12.5" }],
    ["nombre corto", { name: "X" }],
    ["categoría que no es un uuid", { category_id: "1 or 1=1" }],
  ])("rechaza: %s", (_, patch) => {
    expect(serviceSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe("professionalSchema y overrideSchema", () => {
  it("profesional sin cuenta", () => {
    expect(professionalSchema.parse({ display_name: " Caro ", bio: "", membership_id: "", show_online: "on", accepts_online_booking: "", is_active: "on" }))
      .toEqual({ display_name: "Caro", bio: null, membership_id: null, show_online: true, accepts_online_booking: false, is_active: true });
  });
  it("cobra o tarda distinto: vacío = igual al servicio", () => {
    expect(overrideSchema.parse({ price: "", duration: "" })).toEqual({ price: null, duration: null });
    expect(overrideSchema.parse({ price: "13.000", duration: "75" })).toEqual({ price: 1300000, duration: 75 });
    expect(overrideSchema.safeParse({ price: "", duration: "73" }).success).toBe(false);
  });
});

describe("userFacingDbError", () => {
  it("traduce restricciones conocidas", () => {
    expect(userFacingDbError({ code: "23505", message: 'duplicate key value violates unique constraint "service_categories_tenant_name"' }))
      .toBe("Ya existe una categoría con ese nombre.");
    expect(userFacingDbError({ code: "23P01", message: 'conflicting key value violates exclusion constraint "working_hours_no_overlap"' }))
      .toBe("Esa franja se superpone con otra del mismo día.");
  });
  it("no muestra errores internos", () => {
    expect(userFacingDbError({ code: "42P01", message: 'relation "x" does not exist' })).toBe("Algo salió mal. Probá de nuevo en unos minutos.");
    expect(userFacingDbError({ code: "23514", message: 'new row violates check constraint "otra_cosa"' })).toBe("Algo salió mal. Probá de nuevo en unos minutos.");
  });
  it("muestra los mensajes escritos por nosotros", () => {
    expect(userFacingDbError({ code: "23514", message: "El horario de la profesional tiene que estar dentro del horario del estudio" }))
      .toBe("El horario de la profesional tiene que estar dentro del horario del estudio");
  });
});
