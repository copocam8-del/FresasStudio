import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AA_LARGE_OR_UI, AA_TEXT, contrast, over, parseColor, parseOklch, type Rgb } from "./color";

/**
 * Contraste del tema por defecto de Cleo (src/app/globals.css), en claro y oscuro.
 * Si alguien cambia un color y rompe el contraste, este test falla.
 */
const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(".", "\\.");
  const m = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`No encontré el bloque ${selector} en globals.css`);
  const vars: Record<string, string> = {};
  for (const v of m[1].matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)) vars[v[1]] = v[2];
  return vars;
}

const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["accent-foreground", "accent"],
  ["primary", "background"],
  ["primary", "card"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["foreground", "muted"],
  ["foreground", "secondary"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
];

// Elementos que no son texto chico: bordes de campos, foco y el dorado de acento.
const UI_PAIRS: [string, string][] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
  ["gold", "background"],
  ["gold", "card"],
];

for (const mode of [":root", ".dark"]) {
  describe(`tema por defecto (${mode === ":root" ? "claro" : "oscuro"})`, () => {
    const vars = block(mode);
    const color = (name: string): Rgb => {
      if (!vars[name]) throw new Error(`Falta --${name} en ${mode}`);
      return parseColor(vars[name]);
    };

    it("todos los colores están dentro del gamut sRGB", () => {
      const out = Object.entries(vars).filter(([, v]) => !parseOklch(v).inGamut).map(([k]) => k);
      expect(out).toEqual([]);
    });

    it.each(TEXT_PAIRS)("texto --%s sobre --%s >= 4.5:1", (fg, bg) => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(UI_PAIRS)("--%s sobre --%s >= 3:1 (no es texto chico)", (fg, bg) => {
      const bgColor = color(bg);
      expect(contrast(over(color(fg), bgColor), bgColor)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    });

    it("no define un color de texto para el dorado (es solo acento)", () => {
      expect(vars["gold-foreground"]).toBeUndefined();
    });
  });
}
