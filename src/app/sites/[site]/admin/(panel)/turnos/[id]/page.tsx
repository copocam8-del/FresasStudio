import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge, PageHeader } from "@/components/panel/panel-ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { can, requireStaff } from "@/lib/auth";
import { DEPOSIT_LABEL, STATUS_LABEL } from "@/lib/appointment-labels";
import { effectiveStatus, loadAppointment } from "@/lib/appointments-data";
import { formatDateTimeLong, formatTime, ymdIn } from "@/lib/booking-format";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { cancelUnpaidAction, markPaidOfflineAction } from "../actions";

export const metadata: Metadata = { title: "Turno" };

const EVENT_LABEL: Record<string, string> = {
  created: "Reserva creada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  expired: "Venció sin pago",
  deposit_paid: "Seña pagada online",
  deposit_paid_offline: "Seña cobrada en el estudio",
};
const METHOD: Record<string, string> = { transfer: "transferencia", cash: "efectivo" };

export default async function TurnoPage({ params }: PageProps<"/sites/[site]/admin/turnos/[id]">) {
  const { site, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaff(site, `/admin/turnos/${id}`);
  const data = await loadAppointment(ctx, id);
  if (!data) notFound();
  const { appointment: a, events, client } = data;
  const tz = ctx.studio.timezone;
  const st = effectiveStatus(a);

  const actor = (e: (typeof events)[number]) =>
    e.actor_user_id === null ? "Sistema" : client?.user_id === e.actor_user_id ? "La clienta" : "El equipo";

  return (
    <>
      <Link href={`/admin/turnos?dia=${ymdIn(a.starts_at, tz)}`} className="text-sm text-foreground underline underline-offset-4">← Turnos del día</Link>
      <PageHeader title={`${a.service_name} · ${formatTime(a.starts_at, tz)}`} description={`Código ${a.code}`} />

      <section aria-label="Detalle" className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex flex-wrap gap-1">
          <Badge tone={st === "pending_payment" ? "warn" : "muted"}>{STATUS_LABEL[st]}</Badge>
          <Badge>{DEPOSIT_LABEL[a.deposit_status]}</Badge>
          <Badge>{a.source === "online" ? "online" : "manual"}</Badge>
          {a.forced_outside_hours && <Badge tone="warn">fuera de horario</Badge>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Clienta</dt>
          <dd>{client ? `${client.full_name}${client.phone ? ` · ${client.phone}` : ""}` : "—"}</dd>
          <dt className="text-muted-foreground">Cuándo</dt>
          <dd>{formatDateTimeLong(a.starts_at, tz)} · {formatDuration(a.duration_minutes)}{a.buffer_minutes ? ` + ${a.buffer_minutes} min extra` : ""}</dd>
          <dt className="text-muted-foreground">Profesional</dt>
          <dd>{a.professional_name}</dd>
          <dt className="text-muted-foreground">Precio acordado</dt>
          <dd>{a.price_is_from ? "desde " : ""}{formatMoney(a.price_minor, a.currency)}</dd>
          <dt className="text-muted-foreground">Seña</dt>
          <dd>{formatMoney(a.deposit_minor, a.currency)} ({a.deposit_percent}%)</dd>
          <dt className="text-muted-foreground">Política</dt>
          <dd>versión {a.policy_version} · ventana de {a.cancellation_window_hours} h</dd>
          {st === "pending_payment" && a.hold_expires_at && (
            <>
              <dt className="text-muted-foreground">Vence</dt>
              <dd>{formatDateTimeLong(a.hold_expires_at, tz)}</dd>
            </>
          )}
          {a.client_note && (
            <>
              <dt className="text-muted-foreground">Nota</dt>
              <dd>{a.client_note}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-muted-foreground">Lo acordado (precio, duración, seña y política) no cambia aunque se modifique el servicio.</p>
      </section>

      {st === "pending_payment" && (can(ctx, "cash.manage") || can(ctx, "agenda.manage")) && (
        <section aria-labelledby="acciones" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <h2 id="acciones" className="font-semibold">Acciones</h2>
          {can(ctx, "cash.manage") && (
            <form action={markPaidOfflineAction} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={a.id} />
              <Label htmlFor="method">La clienta pagó la seña ({formatMoney(a.deposit_minor, a.currency)}) por</Label>
              <div className="flex gap-2">
                <select id="method" name="method" className="h-11 flex-1 rounded-lg border border-input bg-background px-3 text-base">
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Efectivo</option>
                </select>
                <Button type="submit" className="h-11">Marcar cobrada</Button>
              </div>
            </form>
          )}
          {can(ctx, "agenda.manage") && (
            <form action={cancelUnpaidAction} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={a.id} />
              <Label htmlFor="reason">Cancelar (sin seña cobrada)</Label>
              <div className="flex gap-2">
                <input id="reason" name="reason" maxLength={200} placeholder="Motivo (opcional)" className="h-11 flex-1 rounded-lg border border-input bg-background px-3 text-base" />
                <Button type="submit" variant="destructive" className="h-11">Cancelar turno</Button>
              </div>
            </form>
          )}
        </section>
      )}

      <section aria-labelledby="historial" className="flex flex-col gap-2">
        <h2 id="historial" className="font-semibold text-foreground">Historial</h2>
        <ol className="flex flex-col divide-y rounded-xl border bg-card">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col p-3 text-sm">
              <span className="font-medium text-card-foreground">
                {EVENT_LABEL[e.event_type] ?? e.event_type}
                {typeof e.detail.payment_method === "string" ? ` (${METHOD[e.detail.payment_method] ?? e.detail.payment_method})` : ""}
              </span>
              <span className="text-muted-foreground">
                {formatDateTimeLong(e.created_at, tz)} · {actor(e)}
                {typeof e.detail.note === "string" ? ` · «${e.detail.note}»` : ""}
                {e.detail.reason === "released_by_client" ? " · la clienta liberó el horario" : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
