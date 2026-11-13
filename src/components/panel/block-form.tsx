"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { Label } from "@/components/ui/label";
import { createBlockAction, type BlockState } from "@/app/sites/[site]/admin/(panel)/bloqueos/actions";
import { BLOCK_KINDS } from "@/lib/block-kinds";


/** Nuevo bloqueo. Con `professionalId` queda fijo; si no, se elige "todo el estudio" o una profesional. */
export function BlockForm({
  professionalId,
  professionals,
  today,
  initialDate,
  initialProfessionalId,
}: {
  professionalId?: string;
  professionals?: { id: string; display_name: string }[];
  today: string;
  /** Precarga desde la agenda («Bloquear» un día). */
  initialDate?: string;
  initialProfessionalId?: string;
}) {
  const [state, action] = useActionState<BlockState, FormData>(createBlockAction, undefined);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState(initialDate ?? today);

  return (
    <form action={action} className="flex flex-col gap-4" key={state?.savedAt ?? "form"}>
      {professionalId && <input type="hidden" name="professional_id" value={professionalId} />}

      <div className="flex flex-col gap-2">
        <Label htmlFor="kind">Tipo</Label>
        <select id="kind" name="kind" defaultValue={professionalId || initialProfessionalId ? "day_off" : "holiday"} className="h-11 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base">
          {BLOCK_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      {!professionalId && professionals && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="professional_id">¿A quién afecta?</Label>
          <select id="professional_id" name="professional_id" defaultValue={initialProfessionalId ?? ""} className="h-11 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base">
            <option value="">Todo el estudio</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                Solo {p.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="all_day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-5" />
        Todo el día
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde" name="from_date" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="Hasta" name="to_date" type="date" required defaultValue={initialDate ?? today} min={from} />
        {!allDay && (
          <>
            <Field label="Desde las" name="from_time" type="time" step={300} required defaultValue="13:00" />
            <Field label="Hasta las" name="to_time" type="time" step={300} required defaultValue="14:00" />
          </>
        )}
      </div>
      {allDay && <p className="text-sm text-muted-foreground">«Hasta» incluye ese día completo.</p>}

      <Field label="Nota (opcional)" name="note" maxLength={200} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Agregar bloqueo</SubmitButton>
    </form>
  );
}
