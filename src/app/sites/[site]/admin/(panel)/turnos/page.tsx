import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock3, Eye, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { appointmentTone, InitialsAvatar, PageTitle, StatCard, StatusPill } from "@/components/cleo/ui";
import { EmptyState } from "@/components/panel/panel-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { DEPOSIT_LABEL, STATUS_LABEL } from "@/lib/appointment-labels";
import { effectiveStatus, loadDay } from "@/lib/appointments-data";
import { can, requireStaff } from "@/lib/auth";
import { addDays, formatDayShort, formatTime, isYmd, ymdIn } from "@/lib/booking-format";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Turnos" };

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "confirmados", label: "Confirmados" },
  { key: "pendientes", label: "Pendientes" },
  { key: "cancelados", label: "Cancelados" },
] as const;

export default async function TurnosPage({ params, searchParams }: PageProps<"/sites/[site]/admin/turnos">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(site, "/admin/turnos");
  const own = !can(ctx, "agenda.read_all");
  if (own && !can(ctx, "agenda.read_own")) notFound();

  const tz = ctx.studio.timezone;
  const today = ymdIn(new Date(), tz);
  const day = isYmd(sp.dia) ? sp.dia : today;
  const filter = FILTERS.find((f) => f.key === sp.estado)?.key ?? "todos";
  const { appointments, clients } = await loadDay(ctx, day);

  const rows = appointments.map((a) => ({ a, st: effectiveStatus(a) }));
  const counts = {
    total: rows.filter((r) => r.st !== "cancelled" && r.st !== "expired").length,
    confirmed: rows.filter((r) => r.st === "confirmed").length,
    pending: rows.filter((r) => r.st === "pending_payment").length,
    cancelled: rows.filter((r) => r.st === "cancelled" || r.st === "expired").length,
  };
  const visible = rows.filter(({ st }) =>
    filter === "todos" ? true
      : filter === "confirmados" ? st === "confirmed"
      : filter === "pendientes" ? st === "pending_payment"
      : st === "cancelled" || st === "expired");
  // D5: solo números reales y mayores que cero.
  const stats = [
    { icon: CalendarDays, value: counts.total, label: "Turnos del día" },
    { icon: CircleCheck, value: counts.confirmed, label: "Confirmados" },
    { icon: Clock3, value: counts.pending, label: "Pendientes de pago" },
    { icon: CircleX, value: counts.cancelled, label: "Cancelados o vencidos" },
  ].filter((s) => s.value > 0);

  const q = (extra: Record<string, string>) => `/admin/turnos?${new URLSearchParams({ dia: day, estado: filter, ...extra })}`;
  const pill = "flex h-11 items-center gap-1.5 rounded-full border border-[#4a3f3c] bg-[#1a1516]/85 px-4 text-sm text-foreground hover:bg-[#241d1c]";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle title="Turnos" description={own ? "Tus turnos del día." : "Gestioná todos los turnos de tu estudio"} />
        {can(ctx, "agenda.manage") && (
          <Link href="/admin/turnos/nuevo" className={buttonVariants({ className: "gap-2 px-5" })}>
            <Plus aria-hidden strokeWidth={1.8} className="size-5" /> Nuevo turno
          </Link>
        )}
      </div>

      {stats.length > 0 && (
        <section aria-label="Resumen del día" className="grid grid-cols-2 gap-[1.4rem] xl:grid-cols-4">
          {stats.map((s) => <StatCard key={s.label} icon={s.icon} value={String(s.value)} label={s.label} />)}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={q({ estado: f.key })} aria-current={filter === f.key ? "true" : undefined}
              className={filter === f.key ? "champagne flex h-11 items-center rounded-full px-5 text-sm font-medium" : pill}>
              {f.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Elegir día" className="flex flex-wrap items-center gap-2">
          <Link href={q({ dia: addDays(day, -1) })} aria-label="Día anterior" className={pill}>
            <ChevronLeft aria-hidden strokeWidth={1.6} className="size-4" />
          </Link>
          <Link href={`/admin/turnos?estado=${filter}`} aria-current={day === today ? "date" : undefined}
            className={day === today ? "champagne flex h-11 items-center rounded-full px-4 text-sm font-medium" : pill}>Hoy</Link>
          <Link href={q({ dia: addDays(day, 1) })} aria-label="Día siguiente" className={pill}>
            <ChevronRight aria-hidden strokeWidth={1.6} className="size-4" />
          </Link>
          <form className="flex items-center gap-2">
            <input type="hidden" name="estado" value={filter} />
            <label>
              <span className="sr-only">Ir a una fecha</span>
              <input type="date" name="dia" defaultValue={day}
                className="h-11 rounded-full border border-[#4a3f3c] bg-[#1a1516]/85 px-4 text-sm text-foreground [color-scheme:dark]" />
            </label>
            <Button type="submit" variant="outline">Ir</Button>
          </form>
        </nav>
      </div>

      <section aria-labelledby="dia" className="glass flex flex-col gap-1 rounded-[1.1rem] p-3 sm:p-4">
        <h2 id="dia" className="px-2 pt-1 pb-2 text-[1.05rem] font-normal text-foreground first-letter:uppercase">{formatDayShort(day)}</h2>
        {visible.length === 0 ? (
          <EmptyState>{appointments.length === 0 ? "No hay turnos este día." : "No hay turnos con ese estado."}</EmptyState>
        ) : (
          <>
            {/* Escritorio: tabla como en la referencia */}
            <table className="hidden w-full text-left text-[0.92rem] lg:table">
              <thead>
                <tr className="text-foreground/85">
                  <th scope="col" className="rounded-l-xl bg-[#1d1716] px-4 py-3 font-normal">Clienta</th>
                  <th scope="col" className="bg-[#1d1716] px-4 py-3 font-normal">Servicio</th>
                  <th scope="col" className="bg-[#1d1716] px-4 py-3 font-normal">Profesional</th>
                  <th scope="col" className="bg-[#1d1716] px-4 py-3 font-normal">Horario</th>
                  <th scope="col" className="bg-[#1d1716] px-4 py-3 font-normal">Estado</th>
                  <th scope="col" className="rounded-r-xl bg-[#1d1716] px-4 py-3 font-normal"><span className="sr-only">Ver</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2220]">
                {visible.map(({ a, st }) => {
                  const name = clients.get(a.client_profile_id)?.full_name ?? "Clienta";
                  return (
                    <tr key={a.id} className={st === "cancelled" || st === "expired" ? "opacity-70" : ""}>
                      <td className="px-4 py-3"><span className="flex items-center gap-3"><InitialsAvatar name={name} />{name}</span></td>
                      <td className="px-4 py-3">{a.service_name}</td>
                      <td className="px-4 py-3">{a.professional_name}</td>
                      <td className="px-4 py-3 tabular-nums">{formatTime(a.starts_at, tz)} – {formatTime(a.ends_at, tz)} hs</td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1">
                          <StatusPill status={appointmentTone(st)}>{STATUS_LABEL[st]}</StatusPill>
                          {st === "pending_payment" && a.hold_expires_at && <StatusPill status="neutral">vence {formatTime(a.hold_expires_at, tz)}</StatusPill>}
                          {a.forced_outside_hours && <StatusPill status="neutral">fuera de horario</StatusPill>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/turnos/${a.id}`} aria-label={`Ver el turno de ${name}`} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-white/5">
                          <Eye aria-hidden strokeWidth={1.5} className="size-5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Celular: filas */}
            <ul className="flex flex-col gap-2.5 lg:hidden">
              {visible.map(({ a, st }) => {
                const name = clients.get(a.client_profile_id)?.full_name ?? "Clienta";
                return (
                  <li key={a.id}>
                    <Link href={`/admin/turnos/${a.id}`}
                      className={`flex min-h-[3.6rem] items-center gap-3 rounded-[0.8rem] border border-[#2b2321] bg-[#181413]/85 px-2.5 py-2 hover:bg-[#221b1a] ${st === "cancelled" || st === "expired" ? "opacity-70" : ""}`}>
                      <span className="flex min-w-[4.1rem] shrink-0 items-center justify-center rounded-[0.65rem] border border-[#3a302d] bg-[#120e0e] px-2 py-2 text-[0.9rem] tabular-nums">
                        {formatTime(a.starts_at, tz)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[0.95rem]">{name}</span>
                        <span className="truncate text-[0.8rem] text-foreground/80">{a.service_name} · {a.professional_name} · {formatMoney(a.price_minor, a.currency)}</span>
                        <span className="flex flex-wrap gap-1">
                          <StatusPill status={appointmentTone(st)}>{STATUS_LABEL[st]}</StatusPill>
                          {st === "confirmed" && <StatusPill status="neutral">{DEPOSIT_LABEL[a.deposit_status]}</StatusPill>}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
