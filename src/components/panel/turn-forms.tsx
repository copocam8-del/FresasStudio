"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  cancelBookingAction,
  correctNoShowAction,
  rescheduleBookingAction,
  type TurnoState,
} from "@/app/sites/[site]/admin/(panel)/turnos/actions";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { Label } from "@/components/ui/label";

const select = "h-11 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base text-foreground";
const box = "flex flex-col gap-3 rounded-2xl border p-3.5 text-sm";

/** Si la base dice que cambió la consecuencia, se vuelve a pedir la página (muestra la nueva). */
function useRefreshOnError(state: TurnoState) {
  const router = useRouter();
  useEffect(() => {
    if (state?.error) router.refresh();
  }, [state, router]);
}

/**
 * Cancelar un turno confirmado (C5, C6): primero, ¿quién cancela? La clienta → regla de
 * 24 h (se muestra la consecuencia exacta). El estudio → motivo obligatorio y saldo a
 * favor o devolución: la clienta nunca pierde la seña.
 */
export function CancelTurnForm({
  id,
  clientConsequence,
  expectedClient,
  keepsDeposit,
  amountLabel,
  canRefund,
  maybeOffline,
}: {
  id: string;
  clientConsequence: string;
  expectedClient: "credited" | "forfeited";
  keepsDeposit: boolean;
  amountLabel: string;
  canRefund: boolean;
  maybeOffline: boolean;
}) {
  const [state, action] = useActionState<TurnoState, FormData>(cancelBookingAction, undefined);
  useRefreshOnError(state);
  const [by, setBy] = useState<"client" | "studio" | "">("");
  const [mode, setMode] = useState<"credit" | "refund">("credit");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expected_client" value={expectedClient} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">¿Quién cancela?</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="by" value="client" checked={by === "client"} onChange={() => setBy("client")} className="size-5" />
          La clienta (avisó que no viene)
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="by" value="studio" checked={by === "studio"} onChange={() => setBy("studio")} className="size-5" />
          El estudio
        </label>
      </fieldset>

      {by === "client" && (
        <p className={`${box} ${keepsDeposit ? "border-border bg-[#1d1716]/85" : "border-[#8d4d49] bg-status-cancel/50"}`}>{clientConsequence}</p>
      )}

      {by === "studio" && (
        <div className="flex flex-col gap-3">
          <p className={`${box} border-border bg-[#1d1716]/85`}>Si cancela el estudio, la clienta nunca pierde la seña ({amountLabel}).</p>
          <Field label="Motivo (la clienta lo va a ver)" name="reason" required minLength={3} maxLength={200} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">¿Qué prefiere la clienta?</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" name="refund_mode" value="credit" checked={mode === "credit"} onChange={() => setMode("credit")} className="size-5" />
              Saldo a favor para su próximo turno
            </label>
            <label className={`flex min-h-11 items-center gap-3 ${canRefund ? "" : "opacity-60"}`}>
              <input type="radio" name="refund_mode" value="refund" disabled={!canRefund} checked={mode === "refund"} onChange={() => setMode("refund")} className="size-5" />
              Que le devolvamos el dinero{canRefund ? "" : " (hace falta permiso de caja)"}
            </label>
          </fieldset>
          {mode === "refund" && (
            <p className="text-muted-foreground">
              Si pagó con Mercado Pago, la devolución se pide sola. Lo que se había cubierto con saldo vuelve como saldo.
            </p>
          )}
          {mode === "refund" && maybeOffline && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="refund_method">Si la seña se cobró en el estudio, ¿cómo se la devolvés?</Label>
              <select id="refund_method" name="refund_method" className={select} defaultValue="transfer">
                <option value="transfer">Transferencia</option>
                <option value="cash">Efectivo</option>
              </select>
            </div>
          )}
        </div>
      )}

      <FormMessage state={state} />
      {by && (
        <SubmitButton pendingText="Cancelando…" variant="destructive">
          {by === "client" ? (keepsDeposit ? "Cancelar (la seña pasa al saldo)" : "Cancelar (la seña se pierde)") : "Cancelar por el estudio"}
        </SubmitButton>
      )}
    </form>
  );
}

/** Reprogramar desde el panel: profesional, día y hora; la consecuencia sale de la base. */
export function RescheduleTurnForm({
  id,
  professionals,
  currentProfessional,
  defaultDate,
  defaultTime,
  expected,
  consequence,
  canCash,
}: {
  id: string;
  professionals: { id: string; name: string }[];
  currentProfessional: string;
  defaultDate: string;
  defaultTime: string;
  expected: "transferred" | "forfeited";
  consequence: string;
  canCash: boolean;
}) {
  const [state, action] = useActionState<TurnoState, FormData>(rescheduleBookingAction, undefined);
  useRefreshOnError(state);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expected" value={expected} />
      <p className={`${box} ${expected === "transferred" ? "border-border bg-[#1d1716]/85" : "border-[#8d4d49] bg-status-cancel/50"}`}>{consequence}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="professional">Profesional</Label>
        <select id="professional" name="professional" defaultValue={currentProfessional} className={select}>
          {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Día" name="date" type="date" required defaultValue={defaultDate} />
        <Field label="Hora" name="time" type="time" step={300} required defaultValue={defaultTime} />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="force" className="size-5" />
        Fuera del horario o sobre un bloqueo: lo atiendo igual (nunca encima de otro turno)
      </label>
      {expected === "forfeited" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="payment">Seña nueva</Label>
          <select id="payment" name="payment" defaultValue="pending" className={select}>
            <option value="pending">Queda esperando pago (o la cubre su saldo)</option>
            {canCash && <option value="transfer">Ya la pagó por transferencia</option>}
            {canCash && <option value="cash">Ya la pagó en efectivo</option>}
          </select>
        </div>
      )}
      <FormMessage state={state} />
      <SubmitButton pendingText="Reprogramando…">Reprogramar</SubmitButton>
    </form>
  );
}

export function CorrectNoShowForm({ id }: { id: string }) {
  const [state, action] = useActionState<TurnoState, FormData>(correctNoShowAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Field label="¿Por qué se corrige? (vino y se marcó mal, por ejemplo)" name="reason" required minLength={3} maxLength={200} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Corrigiendo…" variant="outline">Corregir: vino y fue atendida</SubmitButton>
    </form>
  );
}
