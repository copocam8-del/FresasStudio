import { describe, expect, it } from "vitest";
import { blockBox, dayWindow, minutesOfDay, quickActions, staffStatus, staffTone, whatsappLink } from "./agenda-layout";

const BA = "America/Argentina/Buenos_Aires";

describe("grilla del día", () => {
  it("minutos en la hora del estudio", () => {
    expect(minutesOfDay("2027-03-10T13:30:00Z", BA)).toBe(10 * 60 + 30);
  });
  it("ventana: de la primera a la última hora, redondeada", () => {
    expect(dayWindow([{ start: 9 * 60 + 15, end: 13 * 60 }, { start: 14 * 60, end: 18 * 60 + 40 }])).toEqual({ start: 540, end: 1140 });
    expect(dayWindow([])).toEqual({ start: 540, end: 1140 });
  });
  it("bloque: posición y alto dentro de la ventana", () => {
    const win = { start: 540, end: 1140 };
    expect(blockBox(600, 660, win)).toEqual({ top: 60, height: 60 });
    expect(blockBox(500, 560, win)).toEqual({ top: 0, height: 20 });   // empieza antes de la ventana
    expect(blockBox(600, 605, win).height).toBe(15);                    // mínimo visible
  });
});

describe("acciones rápidas", () => {
  const start = new Date("2027-03-10T13:00:00Z");
  const base = { status: "confirmed", starts_at: start.toISOString(), checked_in_at: null, started_at: null, can_mark: true };
  const at = (min: number) => new Date(start.getTime() + min * 60_000);
  it("más de 2 h antes: nada", () => {
    expect(quickActions(base, true, at(-121))).toEqual([]);
  });
  it("antes de la hora: llegó y terminó, todavía no faltó", () => {
    expect(quickActions(base, true, at(-30))).toEqual(["checked_in", "finished"]);
  });
  it("desde la hora: también faltó (si puede marcar faltas)", () => {
    expect(quickActions(base, true, at(5))).toEqual(["checked_in", "finished", "no_show"]);
    expect(quickActions(base, false, at(5))).toEqual(["checked_in", "finished"]);
  });
  it("después de llegó: empezó; después de empezó: terminó", () => {
    expect(quickActions({ ...base, checked_in_at: at(0).toISOString() }, true, at(5))).toEqual(["started", "finished"]);
    expect(quickActions({ ...base, checked_in_at: at(0).toISOString(), started_at: at(2).toISOString() }, true, at(5))).toEqual(["finished"]);
  });
  it("sin permiso o turno cerrado: nada", () => {
    expect(quickActions({ ...base, can_mark: false }, true, at(5))).toEqual([]);
    expect(quickActions({ ...base, status: "completed" }, true, at(5))).toEqual([]);
  });
});

describe("estado para el equipo", () => {
  it("cuenta la asistencia", () => {
    expect(staffStatus({ status: "confirmed", checked_in_at: "x", started_at: null })).toBe("Llegó");
    expect(staffStatus({ status: "confirmed", checked_in_at: "x", started_at: "y" })).toBe("En curso");
    expect(staffStatus({ status: "confirmed", checked_in_at: null, started_at: null, unclosed: true })).toBe("Sin cerrar");
    expect(staffStatus({ status: "no_show", checked_in_at: null, started_at: null })).toBe("Faltó");
    expect(staffTone({ status: "no_show", checked_in_at: null })).toBe("cancel");
    expect(staffTone({ status: "completed", checked_in_at: "x" })).toBe("ok");
  });
});

describe("WhatsApp", () => {
  it("teléfono argentino sin código de país", () => {
    expect(whatsappLink("11 5555-0001", "Hola")).toBe("https://wa.me/5491155550001?text=Hola");
    expect(whatsappLink("011 5555-0001", "Hola")).toBe("https://wa.me/5491155550001?text=Hola");
  });
  it("con código de país o internacional, se respeta", () => {
    expect(whatsappLink("+54 9 11 5555-0001", "a b")).toBe("https://wa.me/5491155550001?text=a%20b");
    expect(whatsappLink("+34 600 000 000", "x")).toBe("https://wa.me/34600000000?text=x");
  });
  it("sin teléfono válido: null", () => {
    expect(whatsappLink(null, "x")).toBeNull();
    expect(whatsappLink("123", "x")).toBeNull();
  });
});
