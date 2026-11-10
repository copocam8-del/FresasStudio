import { describe, expect, it } from "vitest";
import { contrast, isHexColor, parseColor, parseHex, parseOklch, toHex } from "./color";

// Valores de referencia de WCAG y conversiones conocidas: si la matemática se rompe,
// los tests de contraste del tema y de la marca de cada estudio dejarían de valer.
describe("color", () => {
  it("blanco sobre negro da 21:1 y un color consigo mismo 1:1", () => {
    expect(contrast(parseHex("#ffffff"), parseHex("#000000"))).toBeCloseTo(21, 5);
    expect(contrast(parseHex("#6b4f3a"), parseHex("#6b4f3a"))).toBeCloseTo(1, 5);
  });

  it("coincide con valores de referencia WCAG", () => {
    expect(contrast(parseHex("#777777"), parseHex("#ffffff"))).toBeCloseTo(4.48, 2);
    expect(contrast(parseHex("#767676"), parseHex("#ffffff"))).toBeCloseTo(4.54, 2);
    expect(contrast(parseHex("#0000ff"), parseHex("#ffffff"))).toBeCloseTo(8.59, 2);
  });

  it("el contraste es simétrico", () => {
    const a = parseHex("#c9a227");
    const b = parseHex("#faf6f0");
    expect(contrast(a, b)).toBeCloseTo(contrast(b, a), 10);
  });

  it("convierte oklch a sRGB (blanco, negro y un color conocido)", () => {
    expect(toHex(parseOklch("oklch(1 0 0)"))).toBe("#ffffff");
    expect(toHex(parseOklch("oklch(0 0 0)"))).toBe("#000000");
    // oklch(0.6279 0.2577 29.23) es el rojo sRGB puro
    expect(toHex(parseOklch("oklch(0.6279 0.2577 29.23)"))).toBe("#ff0000");
  });

  it("lee el alfa de oklch y lo compone sobre el fondo", () => {
    const c = parseOklch("oklch(1 0 0 / 35%)");
    expect(c.alpha).toBeCloseTo(0.35);
    const black = parseHex("#000000");
    // 35% de blanco sobre negro: más contraste que nada, mucho menos que blanco puro
    const ratio = contrast(c, black);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(21);
  });

  it("valida hexadecimales estrictos", () => {
    expect(isHexColor("#6b4f3a")).toBe(true);
    expect(isHexColor("#6B4F3A")).toBe(true);
    for (const bad of ["6b4f3a", "#fff", "#6b4f3a00", "red", "#6b4f3g", "url(x)"]) {
      expect(isHexColor(bad)).toBe(false);
    }
    expect(() => parseColor("javascript:alert(1)")).toThrow();
  });
});
