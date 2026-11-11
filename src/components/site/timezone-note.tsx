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
    <p role="note" className="rounded-lg border bg-secondary p-3 text-sm text-secondary-foreground">
      Los horarios están en {label}, la del estudio.
    </p>
  );
}
