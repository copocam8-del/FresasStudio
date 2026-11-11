"use client";

import { useSyncExternalStore } from "react";

// Reloj compartido: avisa una vez por segundo. El valor es el segundo actual, así
// React ve el mismo dato durante todo ese segundo.
function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}
const nowSecond = () => Math.floor(Date.now() / 1000);
const serverSnapshot = () => null;

/** Tiempo que queda para pagar. Solo informativo: el vencimiento lo decide la base. */
export function Countdown({ until }: { until: string }) {
  const now = useSyncExternalStore(subscribe, nowSecond, serverSnapshot);
  if (now === null) return null;
  const left = Math.max(0, Math.floor(new Date(until).getTime() / 1000) - now);
  if (left === 0) return <span>Se venció el plazo. Recargá la página.</span>;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <span aria-live="off" className="font-mono tabular-nums">
      {h > 0 ? `${h} h ` : ""}
      {String(m).padStart(2, "0")} min {String(s).padStart(2, "0")} s
    </span>
  );
}
