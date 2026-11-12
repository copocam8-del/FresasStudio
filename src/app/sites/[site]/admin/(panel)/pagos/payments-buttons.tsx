"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { connectMpAction, disconnectMpAction, type PaymentsActionState } from "./actions";

export function ConnectButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<PaymentsActionState>(connectMpAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Button type="submit" className="h-11 self-start px-5" disabled={disabled || pending}>
        {pending ? "Abriendo Mercado Pago…" : label}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

/** Desconectar pide confirmación y dice qué pasa (P6). */
export function DisconnectButton({ pendingOnline }: { pendingOnline: number }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<PaymentsActionState>(disconnectMpAction, undefined);
  if (state?.ok) return <FormMessage state={state} />;
  if (!confirming) {
    return (
      <Button type="button" variant="outline" className="h-11 self-start px-5" onClick={() => setConfirming(true)}>
        Desconectar
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-[#8d4d49] bg-status-cancel/30 p-4">
      <p className="text-sm font-semibold text-foreground">¿Desconectar Mercado Pago?</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>Se apagan las reservas online en el momento.</li>
        {pendingOnline > 0 && (
          <li>
            {pendingOnline === 1 ? "Hay 1 reserva esperando pago: se queda" : `Hay ${pendingOnline} reservas esperando pago: se quedan`} sin
            forma de pagar y vence{pendingOnline === 1 ? "" : "n"} sola{pendingOnline === 1 ? "" : "s"}.
          </li>
        )}
        <li>Los turnos confirmados no cambian.</li>
        <li>Para cortar el acceso del todo, quitá también el permiso desde tu cuenta de Mercado Pago (Seguridad → Aplicaciones conectadas).</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" className="h-11 px-5" disabled={pending}>
          {pending ? "Desconectando…" : "Sí, desconectar"}
        </Button>
        <Button type="button" variant="outline" className="h-11 px-5" onClick={() => setConfirming(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
