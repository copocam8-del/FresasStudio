"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { type Brand, brandCssVars, checkBrand, THEME } from "@/lib/brand";
import { saveBrandAction, type BrandState } from "./actions";

type ColorKey = "primary" | "accent" | "background";

const FIELDS: { key: ColorKey; label: string; hint: string; fallback: string }[] = [
  { key: "primary", label: "Color principal", hint: "Botones y elementos destacados.", fallback: THEME.primary },
  { key: "accent", label: "Color de acento", hint: "Detalles decorativos (líneas, íconos). No se usa para textos.", fallback: THEME.gold },
  { key: "background", label: "Fondo", hint: "Fondo del sitio y del panel. Tiene que ser claro.", fallback: THEME.background },
];

export function BrandForm({
  initial,
  logoUrl,
  studioName,
}: {
  initial: Brand;
  logoUrl: string | null;
  studioName: string;
}) {
  const [state, action] = useActionState<BrandState, FormData>(saveBrandAction, undefined);
  const [colors, setColors] = useState<Record<ColorKey, string | null>>({
    primary: initial.primary ?? null,
    accent: initial.accent ?? null,
    background: initial.background ?? null,
  });

  const draft: Brand = Object.fromEntries(Object.entries(colors).filter(([, v]) => v)) as Brand;
  const issues = checkBrand(draft);
  const preview = brandCssVars(draft) as React.CSSProperties;

  return (
    <form action={action} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-2 text-lg font-semibold text-card-foreground">Colores</legend>
        {FIELDS.map((f) => {
          const value = colors[f.key];
          const issue = issues.find((i) => i.field === f.key);
          return (
            <div key={f.key} className="flex flex-col gap-2">
              <Label htmlFor={f.key}>{f.label}</Label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id={f.key}
                  type="color"
                  value={value ?? f.fallback}
                  onChange={(e) => setColors((c) => ({ ...c, [f.key]: e.target.value }))}
                  aria-describedby={`${f.key}-hint`}
                  aria-invalid={issue ? true : undefined}
                  className="h-11 w-16 cursor-pointer rounded-lg border border-input bg-background p-1"
                />
                <span className="font-mono text-sm text-card-foreground">{value ?? "predeterminado"}</span>
                {value && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => setColors((c) => ({ ...c, [f.key]: null }))}
                  >
                    Usar el predeterminado
                  </Button>
                )}
                <input type="hidden" name={f.key} value={value ?? ""} />
              </div>
              <p id={`${f.key}-hint`} className="text-sm text-muted-foreground">
                {f.hint}
              </p>
              {issue && (
                <p role="alert" className="text-sm text-destructive">
                  {issue.message}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <section aria-label="Vista previa" style={preview} className="flex flex-col gap-3 rounded-xl border bg-background p-5 text-foreground">
        <span className="text-sm text-muted-foreground">Vista previa</span>
        <div className="h-px w-12 bg-gold" aria-hidden />
        <p className="text-xl font-semibold">{studioName}</p>
        <p className="text-muted-foreground">Así se ven los textos sobre tu fondo.</p>
        <span className="inline-flex h-11 w-fit items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground">
          Reservar turno
        </span>
      </section>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-semibold text-card-foreground">Logo</legend>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`Logo actual de ${studioName}`} className="h-16 w-auto max-w-[220px] object-contain" />
        )}
        <Label htmlFor="logo">{logoUrl ? "Reemplazar logo" : "Subir logo"}</Label>
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby="logo-hint"
          className="text-sm text-card-foreground file:mr-3 file:h-11 file:rounded-lg file:border file:border-input file:bg-secondary file:px-4 file:text-secondary-foreground"
        />
        <p id="logo-hint" className="text-sm text-muted-foreground">
          PNG, JPG o WebP de hasta 1 MB. Mejor con fondo transparente.
        </p>
        {logoUrl && (
          <label className="flex items-center gap-2 text-sm text-card-foreground">
            <input type="checkbox" name="remove_logo" className="size-4" />
            Quitar el logo
          </label>
        )}
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Guardar marca</SubmitButton>
    </form>
  );
}
