import {
  AlertTriangle, Ban, Bell, CalendarCheck, CalendarDays, CalendarPlus, CircleDollarSign, Clock3, CreditCard, Hourglass,
  CalendarX2, RotateCcw, Wallet, type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthCalendar } from "@/components/cleo/month-calendar";
import { appointmentTone, GlassCard, InitialsAvatar, PageTitle, StatCard, StatusPill } from "@/components/cleo/ui";
import { buttonVariants } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/appointment-labels";
import { type Appointment, type ClientLite } from "@/lib/appointments-data";
import { can, requireStaff } from "@/lib/auth";
import { formatDayShort, formatTime, ymdIn } from "@/lib/booking-format";
import { agendaAlerts } from "@/lib/agenda-data";
import { loadDashboard, timeAgo, todayLabel } from "@/lib/dashboard-data";
import { formatMoney } from "@/lib/money";
import { OUTCOME_LABEL } from "@/lib/payment-labels";
import { paymentsToResolve } from "@/lib/payments-data";
import { serverSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Panel" };

const ACTIVITY: Record<string, { label: string; icon: LucideIcon }> = {
  created: { label: "Nueva reserva", icon: CalendarPlus },
  confirmed: { label: "Turno confirmado", icon: CalendarCheck },
  deposit_paid: { label: "Seña pagada online", icon: CreditCard },
  deposit_paid_offline: { label: "Seña cobrada en el estudio", icon: Wallet },
  cancelled: { label: "Turno cancelado", icon: Ban },
  expired: { label: "Reserva vencida sin pago", icon: Clock3 },
  deposit_refunded: { label: "Seña devuelta", icon: RotateCcw },
  payment_disputed: { label: "Contracargo de una seña", icon: AlertTriangle },
  completed: { label: "Turno atendido", icon: CalendarCheck },
  no_show: { label: "Faltó a un turno", icon: CalendarX2 },
  rescheduled: { label: "Turno reprogramado", icon: RotateCcw },
};

export default async function PanelHome({ params, searchParams }: PageProps<"/sites/[site]/admin">) {
  const { site } = await params;
  const q = await searchParams;
  const ctx = await requireStaff(site);
  const tz = ctx.studio.timezone;
  const seesAgenda = can(ctx, "agenda.read_all") || can(ctx, "agenda.read_own");

  const supabase = await serverSupabase();
  const [{ data: profile }, dash, resolve, reconnect, alerts] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    seesAgenda ? loadDashboard(ctx, q.mes) : Promise.resolve(null),
    can(ctx, "cash.read") ? paymentsToResolve(ctx) : Promise.resolve(null),
    can(ctx, "payments.manage") || can(ctx, "settings.manage")
      ? supabase.rpc("get_payments_status", { p_tenant: ctx.tenantId })
          .then(({ data }) => (data as Array<{ status: string | null }> | null)?.[0]?.status === "needs_reconnect")
      : Promise.resolve(false),
    seesAgenda ? agendaAlerts(ctx) : Promise.resolve({ unclosed: 0, no_shows_month: 0 }),
  ]);
  const name = (profile?.full_name || "").split(" ")[0] || null;

  // D5: solo números reales y mayores que cero; las curvas también son reales.
  const stats = dash
    ? [
        { icon: CalendarDays, value: dash.stats.today, label: dash.stats.today === 1 ? "Turno hoy" : "Turnos hoy", series: dash.series.last14 },
        { icon: Hourglass, value: dash.stats.pending, label: "Esperando pago" },
        { icon: CalendarCheck, value: dash.stats.next7, label: "Confirmados, próximos 7 días", series: dash.series.next7 },
        { icon: CalendarX2, value: alerts.no_shows_month, label: alerts.no_shows_month === 1 ? "Falta este mes" : "Faltas este mes", series: undefined },
      ].filter((s) => s.value > 0)
    : [];
  const collected = dash?.stats.collectedMonth ?? 0;
  const canCreate = can(ctx, "agenda.manage");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle title={name ? `Hola, ${name}` : "Panel del estudio"} description="Gestioná tu estudio en un solo lugar ✨" />
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[0.95rem] text-foreground/85">{todayLabel(tz)}</span>
          {canCreate && (
            <Link href="/admin/turnos/nuevo" className={buttonVariants({ className: "gap-2" })}>
              <CalendarPlus aria-hidden strokeWidth={1.5} className="size-5" /> Nuevo turno
            </Link>
          )}
        </div>
      </div>

      {reconnect && (
        <Alert href="/admin/pagos" link="Ir a Mercado Pago">
          Hay que volver a conectar Mercado Pago. Mientras tanto no se cobran señas y las reservas online están apagadas.
        </Alert>
      )}
      {resolve && resolve.count > 0 && (
        <Alert href={`/admin/pagos/movimientos?desde=${resolve.desde}`} link="Ver pagos">
          {resolve.count === 1 ? "Hay 1 pago a resolver." : `Hay ${resolve.count} pagos a resolver.`}
        </Alert>
      )}

      {alerts.unclosed > 0 && (
        <Alert href="/admin/turnos?estado=sin-cerrar" link="Marcar">
          {alerts.unclosed === 1 ? "Hay 1 turno que ya pasó sin marcar si vino o faltó." : `Hay ${alerts.unclosed} turnos que ya pasaron sin marcar si vino o faltó.`}
        </Alert>
      )}

      {(stats.length > 0 || collected > 0) && (
        <section aria-label="Resumen" className="grid grid-cols-2 gap-[1.4rem] xl:grid-cols-4">
          {stats.map((s) => <StatCard key={s.label} icon={s.icon} value={String(s.value)} label={s.label} series={s.series} />)}
          {collected > 0 && (
            <StatCard icon={CircleDollarSign} value={formatMoney(collected, dash!.stats.currency)} label="Señas cobradas este mes"
              series={dash!.series.collectedMonth} />
          )}
        </section>
      )}

      {dash && (
        <div className="grid grid-cols-1 gap-[1.4rem] xl:grid-cols-[1.25fr_1fr_0.82fr]">
          <GlassCard title="Turnos de hoy" icon={CalendarDays} more={{ href: "/admin/agenda", label: "Ver agenda" }}>
            {dash.today.length > 0 ? (
              <AppointmentList items={dash.today} clients={dash.clients} time={(a) => ({ time: formatTime(a.starts_at, tz) })} />
            ) : (
              <p className="text-muted-foreground">No hay turnos para hoy.</p>
            )}
          </GlassCard>
          <GlassCard title="Calendario de turnos" icon={CalendarDays}>
            <MonthCalendar
              ym={dash.month.ym}
              counts={dash.month.counts}
              todayYmd={dash.todayYmd}
              prevHref={`/admin?mes=${dash.month.prev}`}
              nextHref={`/admin?mes=${dash.month.next}`}
              dayHref={(d) => `/admin/turnos?dia=${d}`}
            />
          </GlassCard>
          {dash.activity.length > 0 && (
            <GlassCard title="Actividad reciente" icon={Bell}>
              <ul className="flex flex-col gap-3.5">
                {dash.activity.map((e) => {
                  const a = ACTIVITY[e.type] ?? { label: e.type, icon: CalendarDays };
                  return (
                    <li key={e.id}>
                      <Link href={`/admin/turnos/${e.appointmentId}`} className="flex items-center gap-3 rounded-xl hover:bg-white/5">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#4a3f3c] bg-[#1d1716]">
                          <a.icon aria-hidden strokeWidth={1.4} className="size-5 text-foreground" />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[0.92rem] text-foreground">{a.label}</span>
                          <span className="truncate text-[0.78rem] text-foreground/80">
                            {timeAgo(e.at)}{e.client ? ` · ${e.client}` : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </GlassCard>
          )}
        </div>
      )}

      {dash && (dash.upcoming.length > 0 || dash.payments.length > 0) && (
        <div className="grid grid-cols-1 gap-[1.4rem] xl:grid-cols-[1.25fr_1fr]">
          {dash.upcoming.length > 0 && (
            <GlassCard title="Próximos turnos" icon={Clock3} more={{ href: "/admin/turnos", label: "Ver agenda" }}>
              <AppointmentList
                items={dash.upcoming}
                clients={dash.clients}
                time={(a) => ({ day: formatDayShort(ymdIn(a.starts_at, tz)), time: formatTime(a.starts_at, tz) })}
              />
            </GlassCard>
          )}
          {dash.payments.length > 0 && (
            <GlassCard title="Pagos recientes" icon={Wallet} more={{ href: "/admin/pagos/movimientos", label: "Ver todos" }}>
              <ul className="flex flex-col divide-y divide-[#2a2220]">
                {dash.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.92rem] text-foreground">{p.client ?? "Clienta"} · turno {p.code}</span>
                      <span className="text-[0.78rem] text-foreground/80">{timeAgo(p.at)} · {p.outcome ? OUTCOME_LABEL[p.outcome] ?? p.outcome : p.status}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{formatMoney(p.amountMinor, p.currency)}</span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </div>
      )}

      {dash && dash.today.length === 0 && dash.upcoming.length === 0 && canCreate && (
        <GlassCard>
          <p className="text-2xl font-light">Todavía no hay turnos</p>
          <p className="text-muted-foreground">Cuando las clientas reserven online o cargues uno, los vas a ver acá.</p>
          <Link href="/admin/turnos/nuevo" className={buttonVariants({ className: "self-start" })}>Cargar un turno</Link>
        </GlassCard>
      )}
    </>
  );
}

function AppointmentList({
  items,
  clients,
  time,
}: {
  items: Appointment[];
  clients: Map<string, ClientLite>;
  time: (a: Appointment) => { day?: string; time: string };
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((a) => {
        const t = time(a);
        const clientName = clients.get(a.client_profile_id)?.full_name ?? "Clienta";
        const pill = <StatusPill status={appointmentTone(a.status)}>{STATUS_LABEL[a.status]}</StatusPill>;
        return (
          <li key={a.id}>
            <Link
              href={`/admin/turnos/${a.id}`}
              className="flex min-h-[3.6rem] items-center gap-3 rounded-[0.8rem] border border-[#2b2321] bg-[#181413]/85 px-2.5 py-2 transition-colors hover:bg-[#221b1a]"
            >
              <span className="flex min-w-[4.1rem] shrink-0 flex-col items-center rounded-[0.65rem] border border-[#3a302d] bg-[#120e0e] px-2 py-1.5 text-center leading-tight tabular-nums">
                {t.day && <span className="text-[0.68rem] whitespace-nowrap text-foreground/80">{t.day}</span>}
                <span className="text-[0.9rem] text-foreground">{t.time}</span>
              </span>
              <InitialsAvatar name={clientName} className="hidden sm:flex" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[0.92rem] text-foreground">{clientName}</span>
                <span className="truncate text-[0.8rem] text-foreground/80">{a.service_name} · {a.professional_name}</span>
                <span className="sm:hidden">{pill}</span>
              </span>
              <span className="hidden sm:inline">{pill}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Alert({ href, link, children }: { href: string; link: string; children: React.ReactNode }) {
  return (
    <p role="alert" className="glass flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[1.1rem] p-4 text-sm text-foreground">
      <AlertTriangle aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-destructive" />
      <span className="flex-1">{children}</span>
      <Link href={href} className="font-medium underline decoration-gold underline-offset-4">{link}</Link>
    </p>
  );
}
