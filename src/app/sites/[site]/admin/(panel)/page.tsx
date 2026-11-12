import { AlertTriangle, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, Hourglass, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { appointmentTone, GlassCard, PageTitle, StatCard, StatusPill } from "@/components/cleo/ui";
import { buttonVariants } from "@/components/ui/button";
import { STATUS_LABEL } from "@/lib/appointment-labels";
import { type Appointment, type ClientLite } from "@/lib/appointments-data";
import { can, requireStaff } from "@/lib/auth";
import { formatDayShort, formatTime, ymdIn } from "@/lib/booking-format";
import { loadDashboard, todayLabel } from "@/lib/dashboard-data";
import { formatMoney } from "@/lib/money";
import { paymentsToResolve } from "@/lib/payments-data";
import { serverSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Panel" };

export default async function PanelHome({ params }: PageProps<"/sites/[site]/admin">) {
  const { site } = await params;
  const ctx = await requireStaff(site);
  const tz = ctx.studio.timezone;
  const seesAgenda = can(ctx, "agenda.read_all") || can(ctx, "agenda.read_own");

  const supabase = await serverSupabase();
  const [{ data: profile }, dash, resolve, reconnect] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    seesAgenda ? loadDashboard(ctx) : Promise.resolve(null),
    can(ctx, "cash.read") ? paymentsToResolve(ctx) : Promise.resolve(null),
    can(ctx, "payments.manage") || can(ctx, "settings.manage")
      ? supabase.rpc("get_payments_status", { p_tenant: ctx.tenantId })
          .then(({ data }) => (data as Array<{ status: string | null }> | null)?.[0]?.status === "needs_reconnect")
      : Promise.resolve(false),
  ]);
  const name = (profile?.full_name || "").split(" ")[0] || null;
  const today = todayLabel(tz);

  // D5: solo números reales y mayores que cero.
  const stats = dash
    ? [
        { icon: CalendarDays, value: dash.stats.today, label: dash.stats.today === 1 ? "Turno hoy" : "Turnos hoy" },
        { icon: Hourglass, value: dash.stats.pending, label: "Esperando pago" },
        { icon: CalendarCheck, value: dash.stats.next7, label: "Confirmados, próximos 7 días" },
      ].filter((s) => s.value > 0)
    : [];
  const collected = dash?.stats.collectedMonth ?? 0;
  const canCreate = can(ctx, "agenda.manage");

  return (
    <>
      <PageTitle
        title={name ? `Hola, ${name}` : "Hola"}
        description={<span className="first-letter:uppercase">{today} · {ctx.studio.name}</span>}
        action={canCreate ? (
          <Link href="/admin/turnos/nuevo" className={buttonVariants({ className: "gap-2" })}>
            <CalendarPlus aria-hidden strokeWidth={1.5} className="size-5" /> Nuevo turno
          </Link>
        ) : undefined}
      />

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

      {(stats.length > 0 || collected > 0) && (
        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => <StatCard key={s.label} icon={s.icon} value={String(s.value)} label={s.label} />)}
          {collected > 0 && (
            <StatCard icon={Wallet} value={formatMoney(collected, dash!.stats.currency)} label="Señas cobradas este mes" hint="con Mercado Pago" />
          )}
        </section>
      )}

      {dash && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {dash.today.length > 0 ? (
            <GlassCard title="Turnos de hoy" icon={CalendarDays} more={{ href: "/admin/turnos", label: "Ver todos" }}>
              <AppointmentList items={dash.today} clients={dash.clients} time={(a) => ({ time: formatTime(a.starts_at, tz) })} />
            </GlassCard>
          ) : (
            <GlassCard title="Turnos de hoy" icon={CalendarDays}>
              <p className="text-muted-foreground">No hay turnos para hoy.</p>
            </GlassCard>
          )}
          {dash.upcoming.length > 0 && (
            <GlassCard title="Próximos turnos" icon={CalendarClock} more={{ href: "/admin/turnos", label: "Ver agenda" }}>
              <AppointmentList
                items={dash.upcoming}
                clients={dash.clients}
                time={(a) => ({ day: formatDayShort(ymdIn(a.starts_at, tz)), time: formatTime(a.starts_at, tz) })}
              />
            </GlassCard>
          )}
        </div>
      )}

      {dash && dash.today.length === 0 && dash.upcoming.length === 0 && canCreate && (
        <GlassCard>
          <p className="font-serif text-2xl font-semibold">Todavía no hay turnos</p>
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
    <ul className="flex flex-col gap-2">
      {items.map((a) => {
        const t = time(a);
        const pill = <StatusPill status={appointmentTone(a.status)}>{STATUS_LABEL[a.status]}</StatusPill>;
        return (
        <li key={a.id}>
          <Link
            href={`/admin/turnos/${a.id}`}
            className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-background/40 px-3 py-2 transition-colors hover:bg-accent"
          >
            <span className="flex w-16 shrink-0 flex-col items-center rounded-2xl border border-border px-2 py-1 text-center leading-tight tabular-nums">
              {t.day && <span className="text-[0.7rem] whitespace-nowrap text-muted-foreground">{t.day}</span>}
              <span className="text-sm font-medium text-foreground">{t.time}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium text-foreground">{clients.get(a.client_profile_id)?.full_name ?? "Clienta"}</span>
              <span className="truncate text-sm text-muted-foreground">{a.service_name} · {a.professional_name}</span>
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
    <p role="alert" className="glass flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[1.25rem] border-destructive/50 p-4 text-sm text-foreground">
      <AlertTriangle aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-destructive" />
      <span className="flex-1">{children}</span>
      <Link href={href} className="font-medium underline decoration-gold underline-offset-4">{link}</Link>
    </p>
  );
}
