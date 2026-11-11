import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, PageHeader } from "@/components/panel/panel-ui";
import { Button } from "@/components/ui/button";
import { can, requireStaff } from "@/lib/auth";
import { DEPOSIT_LABEL, STATUS_LABEL } from "@/lib/appointment-labels";
import { effectiveStatus, loadDay } from "@/lib/appointments-data";
import { addDays, formatDayShort, formatTime, isYmd, ymdIn } from "@/lib/booking-format";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Turnos" };

export default async function TurnosPage({ params, searchParams }: PageProps<"/sites/[site]/admin/turnos">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(site, "/admin/turnos");
  const own = !can(ctx, "agenda.read_all");
  if (own && !can(ctx, "agenda.read_own")) notFound();

  const tz = ctx.studio.timezone;
  const today = ymdIn(new Date(), tz);
  const day = isYmd(sp.dia) ? sp.dia : today;
  const { appointments, clients } = await loadDay(ctx, day);

  return (
    <>
      <PageHeader
        title="Turnos"
        description={own ? "Tus turnos." : "Turnos del día. La agenda visual completa llega más adelante."}
        action={can(ctx, "agenda.manage") ? { href: "/admin/turnos/nuevo", label: "+ Turno manual" } : undefined}
      />
      <nav aria-label="Elegir día" className="flex flex-wrap items-end gap-2">
        <Link href={`/admin/turnos?dia=${addDays(day, -1)}`} className="flex h-11 items-center rounded-lg border px-3 text-sm hover:bg-accent">← Anterior</Link>
        <Link href="/admin/turnos" aria-current={day === today ? "date" : undefined}
          className={`flex h-11 items-center rounded-lg border px-3 text-sm ${day === today ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Hoy</Link>
        <Link href={`/admin/turnos?dia=${addDays(day, 1)}`} className="flex h-11 items-center rounded-lg border px-3 text-sm hover:bg-accent">Siguiente →</Link>
        <form className="flex items-end gap-2">
          <label className="flex flex-col text-sm">
            <span className="sr-only">Ir a una fecha</span>
            <input type="date" name="dia" defaultValue={day} className="h-11 rounded-lg border border-input bg-background px-2 text-base" />
          </label>
          <Button type="submit" variant="outline" className="h-11">Ir</Button>
        </form>
      </nav>
      <h2 className="text-lg font-semibold text-foreground">{formatDayShort(day)}</h2>

      {appointments.length === 0 ? (
        <EmptyState>No hay turnos este día.</EmptyState>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {appointments.map((a) => {
            const st = effectiveStatus(a);
            const client = clients.get(a.client_profile_id);
            return (
              <li key={a.id}>
                <Link href={`/admin/turnos/${a.id}`} className={`flex gap-3 p-4 hover:bg-accent ${st === "cancelled" || st === "expired" ? "opacity-60" : ""}`}>
                  <span className="w-14 shrink-0 font-semibold text-card-foreground">{formatTime(a.starts_at, tz)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-card-foreground">{client?.full_name ?? "Clienta"} · {a.service_name}</span>
                    <span className="text-sm text-muted-foreground">
                      {a.professional_name} · hasta {formatTime(a.ends_at, tz)} · {formatMoney(a.price_minor, a.currency)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={st === "pending_payment" ? "warn" : "muted"}>{STATUS_LABEL[st]}</Badge>
                      {st === "pending_payment" && a.hold_expires_at && <Badge tone="warn">vence {formatTime(a.hold_expires_at, tz)}</Badge>}
                      {st === "confirmed" && <Badge>{DEPOSIT_LABEL[a.deposit_status]}</Badge>}
                      {a.source === "staff" && <Badge>manual</Badge>}
                      {a.forced_outside_hours && <Badge tone="warn">fuera de horario</Badge>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
