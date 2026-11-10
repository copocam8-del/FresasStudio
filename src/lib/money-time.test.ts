import { describe, expect, it } from "vitest";
import { formatMoney, formatPrice, MAX_PRICE_MINOR, minorToInput, parseMoneyToMinor } from "./money";
import { checkDayRanges, formatDuration, hhmmToMinutes, minutesToHHMM } from "./time";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("parseMoneyToMinor", () => {
  it.each([
    ["12500", 1250000],
    ["12.500", 1250000],
    ["$ 12.500", 1250000],
    ["12.500,50", 1250050],
    ["12500,5", 1250050],
    ["1.250.000", 125000000],
    ["0", 0],
  ])("%s → %d centavos", (input, minor) => {
    expect(parseMoneyToMinor(input)).toEqual({ ok: true, minor });
  });

  it.each(["", "abc", "-100", "12.5", "12,500.00", "12.50.0", "1,234", "12,345", "1e5", "12.500,505"])(
    "rechaza %j (ambiguo o inválido)",
    (input) => {
      expect(parseMoneyToMinor(input).ok).toBe(false);
    },
  );

  it("respeta el tope de la base", () => {
    expect(parseMoneyToMinor("100.000.000")).toEqual({ ok: true, minor: MAX_PRICE_MINOR });
    expect(parseMoneyToMinor("100.000.001").ok).toBe(false);
  });
});

describe("formatMoney / formatPrice / minorToInput", () => {
  it("formato argentino, sin decimales si son ,00", () => {
    expect(nbsp(formatMoney(1250000))).toBe("$ 12.500");
    expect(nbsp(formatMoney(1250050))).toBe("$ 12.500,50");
    expect(nbsp(formatPrice(1300000, true))).toBe("desde $ 13.000");
  });
  it("ida y vuelta con el campo del formulario", () => {
    for (const minor of [0, 900000, 1250000, 1250050, 125000000]) {
      const parsed = parseMoneyToMinor(minorToInput(minor));
      expect(parsed).toEqual({ ok: true, minor });
    }
  });
});

describe("tiempo", () => {
  it("formatDuration", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(600)).toBe("10 h");
  });
  it("minutos ↔ HH:MM", () => {
    expect(minutesToHHMM(540)).toBe("09:00");
    expect(minutesToHHMM(1440)).toBe("24:00");
    expect(hhmmToMinutes("9:00")).toBe(540);
    expect(hhmmToMinutes("24:00")).toBe(1440);
    for (const bad of ["9:03", "25:00", "24:05", "9", "09:60", "", null, "9.00"]) {
      expect(hhmmToMinutes(bad)).toBeNull();
    }
  });
  it("checkDayRanges detecta superposiciones y franjas al revés", () => {
    expect(checkDayRanges([{ start: 540, end: 780 }, { start: 840, end: 1140 }])).toEqual([]);
    expect(checkDayRanges([{ start: 540, end: 780 }, { start: 780, end: 840 }])).toEqual([]);
    expect(checkDayRanges([{ start: 540, end: 800 }, { start: 780, end: 840 }])).toHaveLength(1);
    expect(checkDayRanges([{ start: 600, end: 540 }])).toHaveLength(1);
  });
});
