"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Si el dispositivo está en otra zona horaria que el estudio, lo aclara (B14). */
export function TimezoneNote({ timezone, label }: { timezone: string; label: string }) {
  const deviceTz = useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => timezone,
  );
  if (deviceTz === timezone) return null;
  return (
    <p role="note" className="rounded-2xl border border-border bg-[#1d1716]/85 p-3.5 text-sm text-foreground">
      Los horarios están en {label}, la del estudio.
    </p>
  );
}
