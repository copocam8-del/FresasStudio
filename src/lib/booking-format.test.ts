import { describe, expect, it } from "vitest";
import {
  addDays,
  confirmUrl,
  formatDateTimeLong,
  formatDayShort,
  formatTime,
  isYmd,
  parseInstant,
  parseProChoice,
  stepUrl,
  timezoneLabel,
  ymdIn,
} from "./booking-format";

const BA = "America/Argentina/Buenos_Aires";

describe("fechas en la hora del estudio (B14)", () => {
  it("formatea en la zona del estudio aunque el instante esté en UTC", () => {
    expect(formatTime("2026-11-16T17:00:00Z", BA)).toBe("14:00");
    expect(ymdIn("2026-11-17T02:30:00Z", BA)).toBe("2026-11-16"); // 23:30 del 16 en Buenos Aires
    expect(formatTime("2026-11-16T17:00:00Z", "America/Mexico_City")).toBe("11:00");
  });
  it("etiquetas legibles", () => {
    expect(formatDayShort("2026-11-16")).toMatch(/^lun 16 nov$/);
    expect(formatDateTimeLong("2026-11-16T17:00:00Z", BA)).toBe("lunes 16 de noviembre, 14:00");
    expect(timezoneLabel(BA)).toBe("hora de Buenos Aires");
  });
  it("aritmética de días sin saltos por husos", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("parámetros de la URL", () => {
  it("isYmd", () => {
    expect(isYmd("2026-11-16")).toBe(true);
    for (const bad of ["2026-13-01", "2026-02-30", "16/11/2026", "", null, "2026-11-16x"]) expect(isYmd(bad)).toBe(false);
  });
  it("parseInstant acepta ISO con zona y rechaza lo demás", () => {
    expect(parseInstant("2026-11-16T17:00:00.000Z")?.toISOString()).toBe("2026-11-16T17:00:00.000Z");
    expect(parseInstant("2026-11-16T14:00:00-03:00")?.toISOString()).toBe("2026-11-16T17:00:00.000Z");
    for (const bad of ["2026-11-16 14:00", "mañana", "2026-11-16T14:00", "", null, "x".repeat(50)]) expect(parseInstant(bad)).toBeNull();
  });
  it("parseProChoice: 'any' o uuid", () => {
    expect(parseProChoice("any")).toBe("any");
    expect(parseProChoice("32000000-0000-4000-a000-000000000001")).toBe("32000000-0000-4000-a000-000000000001");
    for (const bad of ["cualquiera", "1", "", null, "../x"]) expect(parseProChoice(bad)).toBeNull();
  });
  it("URLs de los pasos", () => {
    expect(stepUrl("s1")).toBe("/reservar/s1");
    expect(stepUrl("s1", { pro: "any", day: "2026-11-16" })).toBe("/reservar/s1?p=any&dia=2026-11-16");
    expect(confirmUrl("s1", "any", "2026-11-16T17:00:00.000Z")).toBe("/reservar/confirmar?s=s1&p=any&t=2026-11-16T17%3A00%3A00.000Z");
  });
});
