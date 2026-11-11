"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { Label } from "@/components/ui/label";
import { createManualBookingAction, type TurnoState } from "../actions";

const select = "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground";

export function ManualBookingForm({
  clients,
  searched,
  services,
  professionals,
  canCharge,
  today,
}: {
  clients: { id: string; label: string }[];
  searched: boolean;
  services: { id: string; name: string }[];
  professionals: { id: string; name: string; serviceIds: string[] }[];
  canCharge: boolean;
  today: string;
}) {
  const [state, action] = useActionState<TurnoState, FormData>(createManualBookingAction, undefined);
  const [mode, setMode] = useState<"existing" | "new">(clients.length > 0 ? "existing" : "new");
  const [pro, setPro] = useState(professionals[0]?.id ?? "");
  const [force, setForce] = useState(false);
  const proServices = services.filter((s) => professionals.find((p) => p.id === pro)?.serviceIds.includes(s.id));

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Clienta</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="client_mode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")}
            disabled={clients.length === 0} className="size-5" />
          Una que ya está cargada {clients.length === 0 && (searched ? "(no encontramos ninguna con esa búsqueda)" : "(buscala arriba)")}
        </label>
        {mode === "existing" && clients.length > 0 && (
          <select name="client_id" className={select} aria-label="Clienta" required>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="client_mode" value="new" checked={mode === "new"} onChange={() => setMode("new")} className="size-5" />
          Una clienta nueva
        </label>
        {mode === "new" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" name="new_name" required autoComplete="off" />
            <Field label="Teléfono (WhatsApp)" name="new_phone" type="tel" required autoComplete="off" />
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="professional">Profesional</Label>
        <select id="professional" name="professional" value={pro} onChange={(e) => setPro(e.target.value)} className={select} required>
          {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="service">Servicio</Label>
        <select id="service" name="service" className={select} required key={pro}>
          {proServices.length === 0 && <option value="">Esta profesional no tiene servicios asignados</option>}
          {proServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Día" name="date" type="date" required defaultValue={today} min={today} />
        <Field label="Hora" name="time" type="time" step={300} required defaultValue="10:00" />
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="force" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5 size-5" />
        <span>
          Lo atiendo igual fuera del horario o en un día bloqueado
          {force && <span className="block text-destructive">Ojo: se saltea el horario y los bloqueos. Nunca se puede superponer con otro turno.</span>}
        </span>
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Seña</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="payment" value="pending" defaultChecked className="size-5" />
          Todavía no la pagó: queda esperando pago (se libera sola si no paga)
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="payment" value="transfer" disabled={!canCharge} className="size-5" />
          Ya la pagó por transferencia: queda confirmado
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="payment" value="cash" disabled={!canCharge} className="size-5" />
          Ya la pagó en efectivo: queda confirmado
        </label>
        {!canCharge && <p className="text-sm text-muted-foreground">Registrar cobros requiere permiso de caja.</p>}
      </fieldset>

      <Field label="Nota (opcional)" name="note" maxLength={300} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Guardar turno</SubmitButton>
    </form>
  );
}
