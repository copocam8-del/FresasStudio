"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { PhotoField } from "@/components/panel/photo-field";
import { Label } from "@/components/ui/label";
import { formatPrice, minorToInput } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { saveProfessionalAction, saveProfessionalServicesAction, type ProState } from "./actions";

type ProInitial = {
  id?: string;
  display_name: string;
  bio: string | null;
  membership_id: string | null;
  show_online: boolean;
  accepts_online_booking: boolean;
  is_active: boolean;
};

export function ProfessionalForm({
  initial,
  members,
  photoUrl,
}: {
  initial: ProInitial;
  members: { id: string; label: string }[];
  photoUrl: string | null;
}) {
  const [state, action] = useActionState<ProState, FormData>(saveProfessionalAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Nombre" name="display_name" defaultValue={initial.display_name} required maxLength={60} hint="Como la conocen las clientas, por ejemplo «Caro»." />
      <div className="flex flex-col gap-2">
        <Label htmlFor="bio">Descripción corta</Label>
        <textarea id="bio" name="bio" defaultValue={initial.bio ?? ""} maxLength={500} rows={3}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="membership_id">¿Usa el panel?</Label>
        <select id="membership_id" name="membership_id" defaultValue={initial.membership_id ?? ""} aria-describedby="membership-hint"
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground">
          <option value="">No, no tiene cuenta</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              Sí: {m.label}
            </option>
          ))}
        </select>
        <p id="membership-hint" className="text-sm text-muted-foreground">
          Si trabaja con su propia cuenta del equipo, vinculala acá. Si no usa la app, dejalo en «No».
        </p>
      </div>
      <PhotoField currentUrl={photoUrl} label="Foto" note="Se muestra en el sitio: subila solo si ella está de acuerdo." />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Estado</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={initial.is_active} className="size-5" /> Activa (atiende)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="show_online" defaultChecked={initial.show_online} className="size-5" /> Visible en el sitio
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="accepts_online_booking" defaultChecked={initial.accepts_online_booking} className="size-5" /> Acepta reservas online
        </label>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">{initial.id ? "Guardar datos" : "Crear profesional"}</SubmitButton>
    </form>
  );
}

type Svc = { id: string; name: string; category: string; duration_minutes: number; price_minor: number; price_is_from: boolean };
type Asg = { service_id: string; price_minor_override: number | null; duration_minutes_override: number | null };

export function ProfessionalServicesForm({
  professionalId,
  services,
  assignments,
  currency,
}: {
  professionalId: string;
  services: Svc[];
  assignments: Asg[];
  currency: string;
}) {
  const [state, action] = useActionState<ProState, FormData>(saveProfessionalServicesAction, undefined);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(services.map((s) => [s.id, assignments.some((a) => a.service_id === s.id)])),
  );
  const groups = [...new Set(services.map((s) => s.category))];

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="professional_id" value={professionalId} />
      {services.length === 0 && <p className="text-muted-foreground">Primero cargá servicios en «Servicios».</p>}
      {groups.map((g) => (
        <fieldset key={g} className="flex flex-col gap-3">
          <legend className="mb-1 font-medium">{g}</legend>
          {services.filter((s) => s.category === g).map((s) => {
            const a = assignments.find((x) => x.service_id === s.id);
            return (
              <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <label className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" name={`svc_${s.id}`} checked={checked[s.id]} className="size-5"
                    onChange={(e) => setChecked((c) => ({ ...c, [s.id]: e.target.checked }))} />
                  <span className="flex flex-col">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDuration(s.duration_minutes)} · {formatPrice(s.price_minor, s.price_is_from, currency)}
                    </span>
                  </span>
                </label>
                {checked[s.id] && (
                  <details open={Boolean(a?.price_minor_override || a?.duration_minutes_override)}>
                    <summary className="cursor-pointer text-sm text-foreground underline underline-offset-4">Cobra o tarda distinto</summary>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <Field label="Su precio" name={`price_${s.id}`} inputMode="decimal"
                        defaultValue={a?.price_minor_override != null ? minorToInput(a.price_minor_override) : ""}
                        placeholder={minorToInput(s.price_minor)} hint="Vacío = el del servicio" />
                      <Field label="Sus minutos" name={`dur_${s.id}`} type="number" inputMode="numeric" min={5} max={600} step={5}
                        defaultValue={a?.duration_minutes_override ?? ""} placeholder={String(s.duration_minutes)} hint="Vacío = la del servicio" />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Guardar servicios</SubmitButton>
    </form>
  );
}
