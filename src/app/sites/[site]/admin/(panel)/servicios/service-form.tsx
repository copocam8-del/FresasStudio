"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { PhotoField } from "@/components/panel/photo-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatPrice, minorToInput, parseMoneyToMinor } from "@/lib/money";
import { formatDuration, QUICK_DURATIONS } from "@/lib/time";
import { saveServiceAction, type CatalogState } from "./actions";

type Initial = {
  id?: string;
  name: string;
  category_id: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  price_minor: number | null;
  price_is_from: boolean;
  deposit_percent: number | null;
  show_online: boolean;
  is_active: boolean;
};

const BUFFERS = [0, 5, 10, 15, 20, 30];

export function ServiceForm({
  initial,
  categories,
  studioDeposit,
  currency,
  photoUrl,
}: {
  initial: Initial;
  categories: { id: string; name: string }[];
  studioDeposit: number;
  currency: string;
  photoUrl: string | null;
}) {
  const [state, action] = useActionState<CatalogState, FormData>(saveServiceAction, undefined);
  const [duration, setDuration] = useState(String(initial.duration_minutes));
  const [price, setPrice] = useState(initial.price_minor === null ? "" : minorToInput(initial.price_minor));
  const [isFrom, setIsFrom] = useState(initial.price_is_from);
  const [depositMode, setDepositMode] = useState(initial.deposit_percent === null ? "studio" : "custom");

  const parsedPrice = price ? parseMoneyToMinor(price) : null;
  const durationNum = Number(duration);

  return (
    <form action={action} className="flex flex-col gap-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Nombre" name="name" defaultValue={initial.name} required maxLength={80} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="category_id">Categoría</Label>
        <select
          id="category_id"
          name="category_id"
          defaultValue={initial.category_id ?? ""}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground"
        >
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Descripción</Label>
        <textarea
          id="description"
          name="description"
          defaultValue={initial.description ?? ""}
          maxLength={1000}
          rows={3}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Duración</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Duraciones rápidas">
          {QUICK_DURATIONS.map((d) => (
            <Button
              key={d}
              type="button"
              variant={durationNum === d ? "default" : "outline"}
              className="h-11"
              aria-pressed={durationNum === d}
              onClick={() => setDuration(String(d))}
            >
              {formatDuration(d)}
            </Button>
          ))}
        </div>
        <Field
          label="Minutos"
          name="duration_minutes"
          type="number"
          inputMode="numeric"
          min={5}
          max={600}
          step={5}
          required
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          hint={durationNum >= 5 ? `= ${formatDuration(durationNum)}. En pasos de 5 minutos.` : "En pasos de 5 minutos."}
        />
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="buffer_after_minutes">Tiempo extra después del turno</Label>
        <select
          id="buffer_after_minutes"
          name="buffer_after_minutes"
          defaultValue={String(initial.buffer_after_minutes)}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground"
          aria-describedby="buffer-hint"
        >
          {BUFFERS.map((b) => (
            <option key={b} value={b}>
              {b === 0 ? "Sin tiempo extra" : `${b} minutos`}
            </option>
          ))}
        </select>
        <p id="buffer-hint" className="text-sm text-muted-foreground">
          Para limpiar o preparar antes del próximo turno. La clienta no lo ve.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Precio</legend>
        <Field
          label="Precio"
          name="price"
          inputMode="decimal"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="12.500"
          hint={
            parsedPrice?.ok
              ? `Se muestra: ${formatPrice(parsedPrice.minor, isFrom, currency)}`
              : parsedPrice
                ? parsedPrice.error
                : "Por ejemplo 12.500"
          }
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="price_is_from" checked={isFrom} onChange={(e) => setIsFrom(e.target.checked)} className="size-5" />
          Es «precio desde» (el final se define en el estudio)
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Seña</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="deposit_mode" value="studio" checked={depositMode === "studio"} onChange={() => setDepositMode("studio")} className="size-5" />
          La del estudio ({studioDeposit}%)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="deposit_mode" value="custom" checked={depositMode === "custom"} onChange={() => setDepositMode("custom")} className="size-5" />
          Otra para este servicio
        </label>
        {depositMode === "custom" && (
          <Field
            label="Seña (%)"
            name="deposit_percent"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            required
            defaultValue={initial.deposit_percent ?? ""}
          />
        )}
      </fieldset>

      <PhotoField currentUrl={photoUrl} label="Foto del servicio" />

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Estado</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={initial.is_active} className="size-5" />
          Activo (se ofrece)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="show_online" defaultChecked={initial.show_online} className="size-5" />
          Visible en el sitio del estudio
        </label>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">{initial.id ? "Guardar cambios" : "Crear servicio"}</SubmitButton>
    </form>
  );
}
