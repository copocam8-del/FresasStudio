import { describe, expect, it } from "vitest";
import { brandCssVars, checkBrand, detectImageType, parseBrand, primaryForeground, THEME } from "./brand";

// Los mismos casos están en db/tests/07_brand.sql: la base tiene que decidir igual.
export const BRAND_VECTORS = {
  valid: [
    { primary: "#d4a5a5", accent: "#c9a48c", background: "#1a1416", enabled: true },
    { primary: "#e91e63" }, // rosa medio: texto negro encima
    { primary: "#888888" }, // gris medio: texto negro (5.9:1)
    { primary: "#f8bbd0", background: "#1f1a2e" },
    { accent: "#b28324" },
    { enabled: false },
    {},
  ],
  invalid: [
    { brand: { background: "#f5f0e6" }, field: "background" }, // fondo claro (el tema es oscuro)
    { brand: { background: "#e91e63" }, field: "background" }, // fondo intenso
    { brand: { accent: "#1a1416" }, field: "accent" }, // acento casi igual al fondo
    { brand: { primary: "#141012" }, field: "primary" }, // botón casi igual al fondo
  ],
} as const;

describe("checkBrand", () => {
  it.each(BRAND_VECTORS.valid)("acepta %o", (brand) => {
    expect(checkBrand(brand)).toEqual([]);
  });
  it.each(BRAND_VECTORS.invalid)("rechaza $brand en $field", ({ brand, field }) => {
    expect(checkBrand(brand).map((i) => i.field)).toContain(field);
  });
  it("los colores por defecto de Cleo pasan", () => {
    expect(checkBrand({ primary: THEME.primary, accent: THEME.gold, background: THEME.background })).toEqual([]);
  });
});

describe("primaryForeground", () => {
  it("con blanco o negro, cualquier color principal llega a 4.5:1 (peor caso ≈ 4.58)", () => {
    for (let v = 0; v <= 255; v++) {
      const hex = "#" + v.toString(16).padStart(2, "0").repeat(3);
      expect(checkBrand({ primary: hex }).filter((i) => i.message.includes("texto de los botones"))).toEqual([]);
    }
  });
  it("blanco sobre colores oscuros, negro sobre medios y claros", () => {
    expect(primaryForeground("#5f402a")).toBe("#ffffff");
    expect(primaryForeground("#e91e63")).toBe("#000000");
    expect(primaryForeground("#f8bbd0")).toBe("#000000");
  });
});

describe("parseBrand / brandCssVars", () => {
  it("descarta valores mal formados y claves desconocidas", () => {
    expect(parseBrand({ primary: "red", accent: "#B28324", background: "url(x)", evil: "x", logo_path: "../x.png" }))
      .toEqual({ accent: "#b28324" });
    expect(parseBrand(null)).toEqual({});
  });
  it("genera las variables CSS de una marca propia activada", () => {
    expect(brandCssVars({ enabled: true, primary: "#e91e63", accent: "#b28324", background: "#1a1416" })).toMatchObject({
      "--primary": "#e91e63",
      "--primary-foreground": "#000000",
      "--gold": "#b28324",
      "--background": "#1a1416",
    });
  });
  it("sin la marca propia activada, se ve con los colores de Cleo", () => {
    expect(brandCssVars({ primary: "#e91e63", accent: "#b28324" })).toEqual({});
    expect(brandCssVars({ enabled: false, primary: "#e91e63" })).toEqual({});
    expect(parseBrand({ enabled: true }).enabled).toBe(true);
    expect(parseBrand({ enabled: "si" }).enabled).toBeUndefined();
  });
  it("si la marca guardada no pasa los controles, usa los colores de Cleo", () => {
    expect(brandCssVars({ enabled: true, primary: "#141012" })).toEqual({});
    expect(brandCssVars({ enabled: true, background: "#ffffff" })).toEqual({});
  });
  it("no deja inyectar CSS", () => {
    expect(brandCssVars({ enabled: true, primary: "#000;}body{display:none" })).toEqual({});
  });
});

describe("detectImageType", () => {
  const bytes = (...xs: number[]) => new Uint8Array(xs);
  it("reconoce PNG, JPEG y WebP por sus bytes", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
    expect(detectImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  });
  it("rechaza SVG, HTML y archivos renombrados", () => {
    expect(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(detectImageType(bytes())).toBeNull();
  });
});

describe("LOGO_PATH_RE", () => {
  it("exige <uuid del estudio>/logo-<uuid>.<png|jpg|webp>", async () => {
    const { LOGO_PATH_RE } = await import("./brand");
    const t = "10000000-0000-4000-a000-000000000001";
    const f = "a1b2c3d4-0000-4000-8000-000000000000";
    expect(LOGO_PATH_RE.test(`${t}/logo-${f}.png`)).toBe(true);
    expect(LOGO_PATH_RE.exec(`${t}/logo-${f}.webp`)?.[1]).toBe(t);
    for (const bad of [`${t}/logo-${f}.svg`, `${t}/../logo-${f}.png`, `------------------------------------/logo-${f}.png`,
      `${t}/otro-${f}.png`, `${t}/logo-${f}.png.html`, `x/${t}/logo-${f}.png`, `${t}/logo-${f}Xpng`]) {
      expect(LOGO_PATH_RE.test(bad)).toBe(false);
    }
  });
});
