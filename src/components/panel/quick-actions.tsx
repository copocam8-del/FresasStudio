"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "cn";
import { markAttendanceAction, markNoShowAction, type TurnoState } from "@/app/sites/[site]/admin/(panel)/turnos/actions";
import { Button } from "@/components/ui/button";
import { QUICK_LABEL, type QuickAction } from "@/lib/agenda-layout";

function Submit({ children, variant, className }: { children: React.ReactNode; variant?: "default" | "outline" | "destructive"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={cn("h-11 min-w-[5.5rem] px-4", className)} disabled={pending} aria-busy={pending}>
      {pending ? "…" : children}
    </Button>
  );
}

/**
 * Acciones de un toque de la agenda: Llegó → Empezó → Terminó, y Faltó (con un segundo
 * toque de confirmación, porque la seña se pierde). La base decide si se puede.
 */
export function QuickActions({ id, actions, label }: { id: string; actions: QuickAction[]; label: string }) {
  const [state, attend] = useActionState<TurnoState, FormData>(markAttendanceAction, undefined);
  const [noShowState, noShow] = useActionState<TurnoState, FormData>(markNoShowAction, undefined);
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  if (actions.length === 0) return null;
  const error = state?.error ?? noShowState?.error;
  const steps = actions.filter((a) => a !== "no_show");

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={`Acciones: ${label}`}>
      <div className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <form key={s} action={attend}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="step" value={s} />
            <Submit variant={i === 0 ? "default" : "outline"}>{QUICK_LABEL[s]}</Submit>
          </form>
        ))}
        {actions.includes("no_show") && !confirmNoShow && (
          <Button type="button" variant="outline" className="h-11 px-4" onClick={() => setConfirmNoShow(true)}>
            Faltó
          </Button>
        )}
      </div>
      {confirmNoShow && (
        <form action={noShow} className="flex flex-col gap-2 rounded-2xl border border-[#8d4d49] bg-status-cancel/40 p-3">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-foreground">¿Seguro que faltó? Queda registrada la falta y la seña se pierde (según la política del estudio).</p>
          <div className="flex flex-wrap gap-2">
            <Submit variant="destructive">Sí, faltó</Submit>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirmNoShow(false)}>No</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Vuelve a pedir la agenda al servidor cada 60 s y al volver a la pestaña. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const t = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [router, seconds]);
  return null;
}
