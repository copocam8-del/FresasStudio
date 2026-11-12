"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PayState } from "@/app/sites/[site]/reservar/actions";

/** Botón "Pagar seña": la acción del servidor redirige a Mercado Pago. */
export function PayDepositButton({
  code,
  label,
  action,
}: {
  code: string;
  label: string;
  action: (prev: PayState, formData: FormData) => Promise<PayState>;
}) {
  const [state, formAction, pending] = useActionState<PayState, FormData>(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="code" value={code} />
      <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
        {pending ? "Abriendo Mercado Pago…" : label}
      </Button>
      {state?.error && (
        <p role="alert" className="rounded-2xl border border-[#8d4d49] bg-status-cancel/70 p-3.5 text-status-cancel-foreground text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * Al volver de Mercado Pago: vuelve a pedir la página al servidor cada 4 segundos
 * (que lee el estado de la BASE, nunca lo que dice la URL) hasta 2 minutos.
 */
export function PaymentWatcher() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > 120_000) {
        setTimedOut(true);
        clearInterval(id);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [router]);
  return (
    <p role="status" aria-live="polite" className="text-sm">
      {timedOut
        ? "Tu pago puede tardar unos minutos en confirmarse. Te lo mostramos acá y en «Mis turnos»: no hace falta que pagues de nuevo."
        : "Estamos verificando tu pago con Mercado Pago… Esto tarda unos segundos."}
    </p>
  );
}
