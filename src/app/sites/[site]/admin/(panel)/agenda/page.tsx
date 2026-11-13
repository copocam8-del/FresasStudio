import { AlertTriangle, Ban, ChevronLeft, ChevronRight, HeartPulse, Plus, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InitialsAvatar, PageTitle, StatusPill } from "@/components/cleo/ui";
import { EmptyState } from "@/components/panel/panel-ui";
import { AutoRefresh, QuickActions } from "@/components/panel/quick-actions";
import { buttonVariants } from "@/components/ui/button";
import { agendaAlerts, type AgendaAppointment, loadAgenda } from "@/lib/agenda-data";
import { blockBox, dayWindow, minutesOfDay, quickActions, staffStatus, staffTone } from "@/lib/agenda-layout";
import { can, requireStaff } from "@/lib/auth";
import { addDays, formatDayShort, formatTime, isYmd, ymdIn } from "@/lib/booking-format";

export const metadata: Metadata = { title: "Agenda" };

const PX_PER_MIN = 1.2;
const ACTIVE = new Set(["pending_payment", "confirmed", "completed", "no_show"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lunes de la semana de un día (YYYY-MM-DD). */
function mondayOf(ymd: string): string {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(ymd, -((dow + 6) % 7));
}

function dayLong(ymd: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${ymd}T12:00:00Z`)).replace(",", "");
}

/** Etiquetas de la clienta: frecuente, faltas, alergias (C17, C21). */
function ClientTags({ a }: { a: AgendaAppointment }) {
  if (!a.is_frequent && a.no_shows_180 === 0 && !a.has_allergies) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {a.is_frequent && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#d4b59d]/60 px-2 py-0.5 text-[0.75rem] text-foreground">
          <Star aria-hidden className="size-3 text-gold" strokeWidth={1.6} /> Frecuente
        </span>
      )}
      {a.no_shows_180 > 0 && (
        <span className="rounded-full border border-[#8d4d49] bg-status-cancel/50 px-2 py-0.5 text-[0.75rem] text-status-cancel-foreground">
          {a.no_shows_180 === 1 ? "1 falta" : `${a.no_shows_180} faltas`}
        </span>
      )}
      {a.has_allergies && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#8d4d49] px-2 py-0.5 text-[0.75rem] text-foreground">
          <HeartPulse aria-hidden className="size-3" strokeWidth={1.6} /> Alergias
        </span>
      )}
    </span>
  );
}

export default async function AgendaPage({ params, searchParams }: PageProps<"/sites/[site]/admin/agenda">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(site, "/admin/agenda");
  const readAll = can(ctx, "agenda.read_all");
  if (!readAll && !can(ctx, "agenda.read_own")) notFound();
  const manage = can(ctx, "agenda.manage");

  const tz = ctx.studio.timezone;
  const today = ymdIn(new Date(), tz);
  const day = isYmd(sp.dia) ? sp.dia : today;
  const week = sp.vista === "semana";
  const from = week ? mondayOf(day) : day;
  const span = week ? 7 : 1;
  const [{ appointments, hours, professionals }, alerts] = await Promise.all([loadAgenda(ctx, from, span), agendaAlerts(ctx)]);

  const proFilter = typeof sp.pro === "string" && UUID.test(sp.pro) && professionals.some((p) => p.id === sp.pro) ? sp.pro : null;
  const pros = proFilter ? professionals.filter((p) => p.id === proFilter) : professionals;
  const visible = appointments.filter((a) => !proFilter || a.professional_id === proFilter);
  const shown = visible.filter((a) => ACTIVE.has(a.status));
  const hidden = visible.length - shown.length;
  const now = new Date();

  const link = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | null> = { vista: week ? "semana" : null, dia: day, pro: proFilter, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/admin/agenda?${q.toString()}`;
  };
  const step = week ? 7 : 1;
  const chip = "flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm";
  const chipOn = "champagne border-transparent font-semibold text-primary-foreground";
  const chipOff = "border-[#4a3f3c] bg-[#1a1516]/85 text-foreground hover:bg-[#241d1c]";

  /** Tarjeta de un turno (celular y "para marcar"). */
  const Card = ({ a, showPro }: { a: AgendaAppointment; showPro: boolean }) => {
    const actions = quickActions(a, manage, now);
    return (
      <li className={`glass flex flex-col gap-3 rounded-[1.1rem] p-4 ${a.unclosed ? "!border-[#d4b59d]/70" : ""}`}>
        <Link href={`/admin/turnos/${a.id}`} className="flex items-start gap-3">
          <span className="flex w-14 shrink-0 flex-col text-sm tabular-nums">
            <span className="text-base font-semibold text-foreground">{formatTime(a.starts_at, tz)}</span>
            <span className="text-muted-foreground">{formatTime(a.ends_at, tz)}</span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium text-foreground">{a.client_name}</span>
              <StatusPill status={staffTone(a)}>{staffStatus(a)}</StatusPill>
            </span>
            <span className="text-sm text-foreground/90">{a.service_name}{showPro ? ` · ${a.professional_name}` : ""}</span>
            <ClientTags a={a} />
          </span>
        </Link>
        {actions.length > 0 && <QuickActions id={a.id} actions={actions} label={`${a.client_name}, ${formatTime(a.starts_at, tz)}`} />}
      </li>
    );
  };

  // ---- Grilla de escritorio (vista día) ----------------------------------------
  const ranges = [
    ...hours.filter((h) => !proFilter || h.professional_id === proFilter)
      .map((h) => ({ start: minutesOfDay(h.starts_at, tz), end: ymdIn(h.ends_at, tz) !== day ? 24 * 60 : minutesOfDay(h.ends_at, tz) })),
    ...shown.map((a) => ({ start: minutesOfDay(a.starts_at, tz), end: minutesOfDay(a.ends_at, tz) })),
  ];
  const win = dayWindow(ranges);
  const gridHeight = (win.end - win.start) * PX_PER_MIN;
  const hourMarks = Array.from({ length: (win.end - win.start) / 60 + 1 }, (_, i) => win.start + i * 60);
  const markable = shown.filter((a) => quickActions(a, manage, now).length > 0);

  return (
    <>
      <AutoRefresh />
      <PageTitle
        title="Agenda"
        description={week ? `Semana del ${formatDayShort(from)} al ${formatDayShort(addDays(from, 6))}` : dayLong(day)}
        action={manage ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/bloqueos?${new URLSearchParams({ dia: day, ...(proFilter ? { pro: proFilter } : {}) })}`}
              className={buttonVariants({ variant: "outline", className: "h-11" })}>
              <Ban aria-hidden strokeWidth={1.5} /> Bloquear
            </Link>
            <Link href="/admin/turnos/nuevo" className={buttonVariants({ className: "h-11" })}>
              <Plus aria-hidden strokeWidth={1.8} /> Nuevo turno
            </Link>
          </div>
        ) : undefined}
      />

      {alerts.unclosed > 0 && (
        <Link href="/admin/turnos?estado=sin-cerrar" className="flex min-h-11 items-center gap-3 rounded-2xl border border-[#d4b59d] bg-status-pending/20 p-3.5 text-sm text-foreground">
          <AlertTriangle aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-gold" />
          {alerts.unclosed === 1 ? "Hay 1 turno que ya pasó sin marcar" : `Hay ${alerts.unclosed} turnos que ya pasaron sin marcar`}: marcá si vino o si faltó.
        </Link>
      )}

      <div className="flex flex-col gap-3">
        <nav aria-label="Vista" className="flex flex-wrap gap-2">
          <Link href={link({ vista: null })} aria-current={!week ? "page" : undefined} className={`${chip} ${!week ? chipOn : chipOff}`}>Día</Link>
          <Link href={link({ vista: "semana" })} aria-current={week ? "page" : undefined} className={`${chip} ${week ? chipOn : chipOff}`}>Semana</Link>
          <Link href={`/admin/turnos?dia=${day}`} className={`${chip} ${chipOff}`}>Lista</Link>
        </nav>
        <nav aria-label="Fechas" className="flex items-center gap-2">
          <Link href={link({ dia: addDays(day, -step) })} aria-label={week ? "Semana anterior" : "Día anterior"}
            className="flex size-11 items-center justify-center rounded-full border border-[#4a3f3c] bg-[#1a1516]/85">
            <ChevronLeft aria-hidden strokeWidth={1.6} className="size-5" />
          </Link>
          <Link href={link({ dia: today })} className={`${chip} ${day === today ? chipOn : chipOff}`}>Hoy</Link>
          <Link href={link({ dia: addDays(day, step) })} aria-label={week ? "Semana siguiente" : "Día siguiente"}
            className="flex size-11 items-center justify-center rounded-full border border-[#4a3f3c] bg-[#1a1516]/85">
            <ChevronRight aria-hidden strokeWidth={1.6} className="size-5" />
          </Link>
          <form action="/admin/agenda" className="ml-auto flex items-center gap-2">
            {week && <input type="hidden" name="vista" value="semana" />}
            {proFilter && <input type="hidden" name="pro" value={proFilter} />}
            <label htmlFor="ir-dia" className="sr-only">Ir a un día</label>
            <input id="ir-dia" type="date" name="dia" defaultValue={day}
              className="h-11 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base text-foreground" />
            <button type="submit" className={`${chip} ${chipOff}`}>Ir</button>
          </form>
        </nav>
        {readAll && professionals.length > 1 && (
          <nav aria-label="Profesional" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Link href={link({ pro: null })} aria-current={!proFilter ? "true" : undefined} className={`${chip} shrink-0 ${!proFilter ? chipOn : chipOff}`}>Todas</Link>
            {professionals.map((p) => (
              <Link key={p.id} href={link({ pro: p.id })} aria-current={proFilter === p.id ? "true" : undefined}
                className={`${chip} shrink-0 ${proFilter === p.id ? chipOn : chipOff}`}>
                <InitialsAvatar name={p.name} className="size-7 text-xs" /> {p.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {week ? (
        // ---- Semana: en el celular, un día debajo del otro; en escritorio, 7 columnas ----
        <ol className="grid grid-cols-1 gap-3 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
            const items = shown.filter((a) => ymdIn(a.starts_at, tz) === d);
            return (
              <li key={d} className={`glass flex min-w-0 flex-col gap-2 rounded-[1.1rem] p-3 ${d === today ? "!border-[#d7baaa]/70" : ""}`}>
                <Link href={link({ vista: null, dia: d })} className="flex min-h-11 items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{formatDayShort(d)}</span>
                  {items.length > 0 && <span className="text-sm text-muted-foreground">{items.length === 1 ? "1 turno" : `${items.length} turnos`}</span>}
                </Link>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin turnos</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {items.map((a) => (
                      <li key={a.id}>
                        <Link href={`/admin/turnos/${a.id}`} className="flex flex-col gap-0.5 rounded-xl border border-[#3a302d] bg-[#1a1516]/80 p-2 text-sm hover:bg-[#241d1c]">
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-semibold tabular-nums text-foreground">{formatTime(a.starts_at, tz)}</span>
                            <StatusPill status={staffTone(a)} className="text-[0.7rem]">{staffStatus(a)}</StatusPill>
                          </span>
                          <span className="truncate text-foreground">{a.client_name}</span>
                          <span className="truncate text-muted-foreground">{a.service_name}{!proFilter && pros.length > 1 ? ` · ${a.professional_name}` : ""}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      ) : shown.length === 0 ? (
        <EmptyState>No hay turnos {day === today ? "hoy" : "este día"}{proFilter ? " para esta profesional" : ""}.</EmptyState>
      ) : (
        <>
          {/* ---- Celular: lista por hora con acciones de un toque ---- */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {shown.map((a) => <Card key={a.id} a={a} showPro={!proFilter && pros.length > 1} />)}
          </ul>

          {/* ---- Escritorio: una columna por profesional ---- */}
          <section aria-label="Grilla del día" className="glass hidden overflow-x-auto rounded-[1.1rem] p-4 lg:block">
            <div className="grid gap-3" style={{ gridTemplateColumns: `3.5rem repeat(${pros.length}, minmax(11rem, 1fr))` }}>
              <span />
              {pros.map((p) => (
                <span key={p.id} className="flex items-center gap-2 pb-2 text-sm font-medium text-foreground">
                  <InitialsAvatar name={p.name} className="size-8 text-xs" /> {p.name}
                </span>
              ))}
              <div className="relative" style={{ height: gridHeight }}>
                {hourMarks.map((m) => (
                  <span key={m} className="absolute -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: (m - win.start) * PX_PER_MIN }}>
                    {String(Math.floor(m / 60)).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {pros.map((p) => (
                <div key={p.id} className="relative rounded-xl bg-[#100c0b]" style={{ height: gridHeight }}>
                  {/* Horario en que atiende (fuera de horario queda más oscuro) */}
                  {hours.filter((h) => h.professional_id === p.id).map((h) => {
                    const box = blockBox(minutesOfDay(h.starts_at, tz), ymdIn(h.ends_at, tz) !== day ? 24 * 60 : minutesOfDay(h.ends_at, tz), win);
                    return <span key={h.starts_at} aria-hidden className="absolute inset-x-0 rounded-lg bg-[#1d1716]" style={{ top: box.top * PX_PER_MIN, height: box.height * PX_PER_MIN }} />;
                  })}
                  {hourMarks.map((m) => (
                    <span key={m} aria-hidden className="absolute inset-x-0 border-t border-[#2a2220]" style={{ top: (m - win.start) * PX_PER_MIN }} />
                  ))}
                  {shown.filter((a) => a.professional_id === p.id).map((a) => {
                    const box = blockBox(minutesOfDay(a.starts_at, tz), minutesOfDay(a.ends_at, tz), win);
                    return (
                      <Link
                        key={a.id}
                        href={`/admin/turnos/${a.id}`}
                        className={`absolute inset-x-1 flex flex-col gap-0.5 overflow-hidden rounded-lg border p-2 text-xs hover:brightness-110 ${
                          a.unclosed ? "border-[#d4b59d] bg-[#2a211d]" : a.status === "pending_payment" ? "border-dashed border-[#b6957a] bg-[#211a17]" : "border-[#4a3f3c] bg-[#2a2220]"}`}
                        style={{ top: box.top * PX_PER_MIN, height: box.height * PX_PER_MIN }}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span className="font-semibold tabular-nums text-foreground">{formatTime(a.starts_at, tz)}</span>
                          <StatusPill status={staffTone(a)} className="px-1.5 text-[0.68rem]">{staffStatus(a)}</StatusPill>
                        </span>
                        <span className="truncate text-[0.82rem] font-medium text-foreground">{a.client_name}</span>
                        <span className="truncate text-foreground/85">{a.service_name}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          {markable.length > 0 && (
            <section aria-labelledby="para-marcar" className="hidden flex-col gap-3 lg:flex">
              <h2 id="para-marcar" className="font-sans text-[1.05rem] text-foreground">Para marcar ahora</h2>
              <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {markable.map((a) => <Card key={a.id} a={a} showPro={!proFilter && pros.length > 1} />)}
              </ul>
            </section>
          )}
        </>
      )}

      {hidden > 0 && (
        <p className="text-sm text-muted-foreground">
          {hidden === 1 ? "1 turno cancelado, vencido o reprogramado no se muestra" : `${hidden} turnos cancelados, vencidos o reprogramados no se muestran`}.{" "}
          <Link href={`/admin/turnos?dia=${day}&estado=cancelados`} className="text-foreground underline underline-offset-4">Ver en la lista</Link>
        </p>
      )}
    </>
  );
}
