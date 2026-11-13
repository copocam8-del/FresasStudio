"use client";

import { useActionState } from "react";
import {
  addNoteAction,
  adjustCreditAction,
  type ClientState,
  createClientAction,
  setPreferencesAction,
  updateClientAction,
} from "@/app/sites/[site]/admin/(panel)/clientas/actions";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { Label } from "@/components/ui/label";

const textarea = "w-full rounded-xl border border-input/80 bg-[#141010]/80 px-3 py-2 text-base text-foreground";
const select = "h-11 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base text-foreground";

export function ClientContactForm({
  client,
}: {
  client?: { id: string; full_name: string; phone: string | null; email: string | null };
}) {
  const [state, action] = useActionState<ClientState, FormData>(client ? updateClientAction : createClientAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {client && <input type="hidden" name="id" value={client.id} />}
      <Field label="Nombre y apellido" name="full_name" required minLength={2} maxLength={120} defaultValue={client?.full_name} autoComplete="off" />
      <Field label="Teléfono (WhatsApp)" name="phone" type="tel" maxLength={30} defaultValue={client?.phone ?? ""} autoComplete="off" />
      <Field label="Email" name="email" type="email" maxLength={254} defaultValue={client?.email ?? ""} autoComplete="off"
        hint="Si después entra con Google con este email, su cuenta se vincula sola a esta ficha." />
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">{client ? "Guardar datos" : "Crear ficha"}</SubmitButton>
    </form>
  );
}

export function NoteForm({ clientId }: { clientId: string }) {
  const [state, action] = useActionState<ClientState, FormData>(addNoteAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3" key={state?.savedAt ?? "nota"}>
      <input type="hidden" name="id" value={clientId} />
      <Label htmlFor="body">Nota nueva (solo la ve el equipo)</Label>
      <textarea id="body" name="body" required maxLength={1000} rows={3} className={textarea} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…" variant="outline">Agregar nota</SubmitButton>
    </form>
  );
}

export function PreferencesForm({
  clientId,
  allergies,
  preferences,
  preferredProfessionalId,
  professionals,
}: {
  clientId: string;
  allergies: string | null;
  preferences: string | null;
  preferredProfessionalId: string | null;
  professionals: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<ClientState, FormData>(setPreferencesAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={clientId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="allergies">Alergias o cuidados de salud</Label>
        <textarea id="allergies" name="allergies" maxLength={500} rows={2} defaultValue={allergies ?? ""} className={textarea}
          aria-describedby="allergies-hint" />
        <p id="allergies-hint" className="text-sm text-muted-foreground">Dato de salud: lo ve solo el equipo y se muestra en cada turno.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="preferences">Preferencias</Label>
        <textarea id="preferences" name="preferences" maxLength={1000} rows={3} defaultValue={preferences ?? ""} className={textarea} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="preferred_professional">Profesional preferida</Label>
        <select id="preferred_professional" name="preferred_professional" defaultValue={preferredProfessionalId ?? ""} className={select}>
          <option value="">Sin preferencia</option>
          {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…" variant="outline">Guardar preferencias</SubmitButton>
    </form>
  );
}

export function AdjustCreditForm({ clientId }: { clientId: string }) {
  const [state, action] = useActionState<ClientState, FormData>(adjustCreditAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3" key={state?.savedAt ?? "ajuste"}>
      <input type="hidden" name="id" value={clientId} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Sumar o restar</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="direction" value="add" defaultChecked className="size-5" /> Sumar</label>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="direction" value="remove" className="size-5" /> Restar</label>
      </fieldset>
      <Field label="Monto ($)" name="amount" inputMode="numeric" required placeholder="5.000" />
      <Field label="Motivo" name="reason" required minLength={3} maxLength={200} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Ajustando…" variant="outline">Ajustar saldo</SubmitButton>
    </form>
  );
}
