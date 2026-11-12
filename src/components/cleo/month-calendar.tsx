import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const WEEK = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * Calendario del mes con los días que tienen turnos (datos reales). Lunes primero, como
 * en la referencia. "Con turnos" = 3 o más; "Pocos turnos" = 1 o 2.
 */
export function MonthCalendar({
  ym,
  counts,
  todayYmd,
  prevHref,
  nextHref,
  dayHref,
}: {
  ym: string;
  counts: Record<string, number>;
  todayYmd: string;
  prevHref: string;
  nextHref: string;
  dayHref: (ymd: string) => string;
}) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // lunes = 0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const cells: { label: number; ymd: string | null }[] = [];
  for (let i = lead; i > 0; i--) cells.push({ label: prevDays - i + 1, ymd: null });
  for (let d = 1; d <= days; d++) cells.push({ label: d, ymd: `${ym}-${String(d).padStart(2, "0")}` });
  while (cells.length % 7) cells.push({ label: cells.length - lead - days + 1, ymd: null });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="sr-only">Mes</span>
        <p className="w-full text-center text-[1rem] text-foreground">{MONTHS[m - 1]} {y}</p>
      </div>
      <div className="absolute top-5 right-4 flex gap-1">
        <Link href={prevHref} aria-label="Mes anterior" className="flex size-9 items-center justify-center rounded-full hover:bg-white/5">
          <ChevronLeft aria-hidden strokeWidth={1.6} className="size-5" />
        </Link>
        <Link href={nextHref} aria-label="Mes siguiente" className="flex size-9 items-center justify-center rounded-full hover:bg-white/5">
          <ChevronRight aria-hidden strokeWidth={1.6} className="size-5" />
        </Link>
      </div>
      <div role="grid" aria-label={`${MONTHS[m - 1]} ${y}`} className="grid grid-cols-7 gap-y-1 text-center">
        {WEEK.map((w) => <span key={w} role="columnheader" className="pb-1 text-[0.82rem] text-foreground/85">{w}</span>)}
        {cells.map((c, i) => {
          if (!c.ymd) return <span key={`o${i}`} className="py-1.5 text-[0.95rem] text-foreground/35">{c.label}</span>;
          const n = counts[c.ymd] ?? 0;
          const isToday = c.ymd === todayYmd;
          return (
            <Link
              key={c.ymd}
              href={dayHref(c.ymd)}
              aria-label={`${c.label}: ${n === 0 ? "sin turnos" : n === 1 ? "1 turno" : `${n} turnos`}`}
              className="flex flex-col items-center justify-center py-0.5"
            >
              <span className={cn(
                "flex size-9 items-center justify-center rounded-full text-[0.95rem] tabular-nums",
                isToday ? "bg-[linear-gradient(180deg,#ead3c4,#c9ab98)] font-semibold text-[#1f140e]" : "text-foreground hover:bg-white/5",
              )}>
                {c.label}
              </span>
              <span aria-hidden className={cn("mt-0.5 size-[5px] rounded-full", n >= 3 ? "bg-[#d9bba7]" : n > 0 ? "bg-[#7d675c]" : "bg-transparent")} />
            </Link>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[0.75rem] text-foreground/85">
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[#d9bba7]" /> Con turnos</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[#7d675c]" /> Pocos turnos</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border border-[#4a3f3c] bg-[#2a2221]" /> Sin turnos</span>
      </div>
    </div>
  );
}
