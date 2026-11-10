"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import { saveHoursAction, type HoursState } from "@/app/sites/[site]/admin/(panel)/horarios/actions";
import { checkDayRanges, hhmmToMinutes, minutesToHHMM, WEEKDAYS } from "@/lib/time";

export type WeekRange = { weekday: number; start: number; end: number };
type Row = { start: string; end: string };

/**
 * Horario de la semana por franjas (los descansos son los huecos). Se guarda entero.
 * Para una profesional: "Igual al horario del estudio" (N4) u horario propio, que
 * tiene que caer dentro del del estudio (N5).
 */
export function WeekHoursEditor({
  initial,
  professionalId,
  studioHours,
  canEdit,
}: {
  initial: WeekRange[];
  professionalId?: string;
  studioHours?: WeekRange[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState<HoursState, FormData>(saveHoursAction, undefined);
  const [mode, setMode] = useState<"studio" | "own">(professionalId && initial.length === 0 ? "studio" : "own");
  const [days, setDays] = useState<Record<number, Row[]>>(() => {
    const seed = initial.length === 0 && professionalId && studioHours ? studioHours : initial;
    return Object.fromEntries(
      WEEKDAYS.map((d) => [
        d.iso,
        seed.filter((r) => r.weekday === d.iso).sort((a, b) => a.start - b.start)
          .map((r) => ({ start: minutesToHHMM(r.start), end: minutesToHHMM(r.end) })),
      ]),
    );
  });

  const ranges: WeekRange[] = [];
  const problems: string[] = [];
  for (const d of WEEKDAYS) {
    const parsed = days[d.iso].map((r) => ({ start: hhmmToMinutes(r.start), end: hhmmToMinutes(r.end) }));
    if (parsed.some((r) => r.start === null || r.end === null)) {
      problems.push(`${d.name}: revisá las horas (en pasos de 5 minutos).`);
      continue;
    }
    const valid = parsed as { start: number; end: number }[];
    for (const issue of checkDayRanges(valid)) problems.push(`${d.name}: ${issue}`);
    for (const r of valid) ranges.push({ weekday: d.iso, ...r });
  }

  const update = (iso: number, rows: Row[]) => setDays((prev) => ({ ...prev, [iso]: rows }));
  const copyTo = (from: number, targets: number[]) =>
    setDays((prev) => ({ ...prev, ...Object.fromEntries(targets.map((t) => [t, prev[from].map((r) => ({ ...r }))])) }));
  const showDays = !professionalId || mode === "own";

  return (
    <form action={action} className="flex flex-col gap-5">
      {professionalId && <input type="hidden" name="professional_id" value={professionalId} />}
      <input type="hidden" name="ranges" value={JSON.stringify(ranges)} />
      <input type="hidden" name="mode" value={professionalId ? mode : "own"} />

      {professionalId && (
        <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
          <legend className="mb-1 text-sm font-medium">¿Cuándo atiende?</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" checked={mode === "studio"} onChange={() => setMode("studio")} className="size-5" />
            Igual al horario del estudio
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" checked={mode === "own"} onChange={() => setMode("own")} className="size-5" />
            Horario propio (siempre dentro del horario del estudio)
          </label>
        </fieldset>
      )}

      {showDays &&
        WEEKDAYS.map((d) => {
          const rows = days[d.iso];
          return (
            <fieldset key={d.iso} className="flex flex-col gap-2 border-b pb-4 last:border-b-0" disabled={!canEdit}>
              <legend className="flex w-full items-center justify-between gap-2 font-medium">
                {d.name}
                {rows.length === 0 && <span className="text-sm font-normal text-muted-foreground">Cerrado</span>}
              </legend>
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`d${d.iso}-${i}-s`}>{`${d.name}, franja ${i + 1}, desde`}</label>
                  <input
                    id={`d${d.iso}-${i}-s`}
                    type="time"
                    step={300}
                    value={r.start}
                    onChange={(e) => update(d.iso, rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                    className="h-11 flex-1 rounded-lg border border-input bg-background px-2 text-base"
                  />
                  <span aria-hidden>a</span>
                  <label className="sr-only" htmlFor={`d${d.iso}-${i}-e`}>{`${d.name}, franja ${i + 1}, hasta`}</label>
                  <input
                    id={`d${d.iso}-${i}-e`}
                    type="time"
                    step={300}
                    value={r.end === "24:00" ? "23:59" : r.end}
                    onChange={(e) => update(d.iso, rows.map((x, j) => (j === i ? { ...x, end: e.target.value === "23:59" ? "24:00" : e.target.value } : x)))}
                    className="h-11 flex-1 rounded-lg border border-input bg-background px-2 text-base"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Quitar franja ${i + 1} del ${d.name}`}
                    onClick={() => update(d.iso, rows.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    const last = rows.at(-1);
                    const start = last ? Math.min((hhmmToMinutes(last.end) ?? 780) + 60, 1380) : 540;
                    update(d.iso, [...rows, { start: minutesToHHMM(start), end: minutesToHHMM(Math.min(start + 240, 1440)) }]);
                  }}
                >
                  <Plus aria-hidden /> {rows.length ? "Agregar franja" : "Abrir este día"}
                </Button>
                {d.iso === 1 && rows.length > 0 && (
                  <Button type="button" variant="ghost" className="h-11" onClick={() => copyTo(1, [2, 3, 4, 5])}>
                    Copiar a martes–viernes
                  </Button>
                )}
              </div>
            </fieldset>
          );
        })}

      {professionalId && mode === "studio" && studioHours && (
        <p className="text-sm text-muted-foreground">
          {studioHours.length === 0
            ? "El estudio todavía no tiene horario cargado."
            : "Va a atender en el horario del estudio. Si el estudio cambia su horario, se actualiza solo."}
        </p>
      )}

      {canEdit && (
        <>
          {problems.length > 0 && (
            <ul role="alert" className="list-disc rounded-lg border border-destructive/40 bg-destructive/5 p-3 pl-6 text-sm text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <FormMessage state={state} />
          <SubmitButton pendingText="Guardando…">Guardar horario</SubmitButton>
        </>
      )}
    </form>
  );
}
