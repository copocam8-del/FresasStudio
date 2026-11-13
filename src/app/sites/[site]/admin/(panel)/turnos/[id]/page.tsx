import { HeartPulse, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { StatusPill } from "@/components/cleo/ui";
import { Badge, PageHeader } from "@/components/panel/panel-ui";
import { QuickActions } from "@/components/panel/quick-actions";
import { CancelTurnForm, CorrectNoShowForm, RescheduleTurnForm } from "@/components/panel/turn-forms";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { bookingTerms } from "@/lib/agenda-data";
import { quickActions, staffStatus, staffTone, whatsappLink } from "@/lib/agenda-layout";
import { DEPOSIT_LABEL, OUTCOME_LABEL } from "@/lib/appointment-labels";
import { effectiveStatus, loadAppointment } from "@/lib/appointments-data";
import { can, requireStaff } from "@/lib/auth";
import { formatDateTimeLong, formatTime, ymdIn } from "@/lib/booking-format";
import { cancelConsequence, cancelExpected, formatDeadline, rescheduleConsequence, rescheduleExpected } from "@/lib/booking-terms";
import { formatMoney } from "@/lib/money";
import { OUTCOME_LABEL as PAY_OUTCOME, paymentMethodLabel, STATUS_LABEL as PAY_STATUS } from "@/lib/payment-labels";
import { serverSupabase } from "@/lib/supabase/server";
import { formatDuration } from "@/lib/time";
import { cancelUnpaidAction, markPaidOfflineAction } from "../actions";

export const metadata: Metadata = { title: "Turno" };

const EVENT_LABEL: Record<string, string> = {
  created: "Reserva creada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  expired: "Venció sin pago",
  rescheduled: "Reprogramada",
  rescheduled_in: "Viene de una reprogramación",
  completed: "Atendida",
  no_show: "Faltó",
  no_show_corrected: "Falta corregida",
  checked_in: "Llegó",
  started: "Empezó",
  deposit_paid: "Seña pagada online",
  deposit_paid_offline: "Seña cobrada en el estudio",
  deposit_credit: "Seña cubierta con saldo a favor",
  deposit_transferred: "Seña transferida del turno anterior",
  deposit_refunded: "Seña devuelta",
  refunded_offline: "Seña devuelta en el estudio",
  credit_returned: "El saldo usado volvió a la clienta",
  payment_disputed: "Contracargo de la seña",
};
const OUTCOME_EVENT: Record<string, string> = {
  credited: "la seña pasó al saldo", forfeited: "la seña se perdió", refunded: "la seña se devuelve",
  transferred: "la seña pasó al turno nuevo", applied: "la seña cuenta como pago",
};

type TurnPayment = {
  id: string; provider_payment_id: string; status: string; outcome: string | null; amount_minor: number;
  refunded_minor: number; currency: string; payment_method: string | null; payment_type: string | null;
  approved_at: string | null; created_at: string;
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
  const manage = can(ctx, "agenda.manage");
  const supabase = await serverSupabase();

  const [{ data: payData }, { data: prefs }, { data: links }, terms] = await Promise.all([
    // RLS: solo quien tiene caja o la agenda completa ve los pagos.
    supabase.from("payments")
      .select("id, provider_payment_id, status, outcome, amount_minor, refunded_minor, currency, payment_method, payment_type, approved_at, created_at")
      .eq("tenant_id", ctx.tenantId).eq("appointment_id", a.id).order("created_at"),
    supabase.from("client_preferences").select("allergies").eq("tenant_id", ctx.tenantId).eq("client_profile_id", a.client_profile_id).maybeSingle(),
    supabase.from("appointments").select("id, code").eq("tenant_id", ctx.tenantId).or(`rescheduled_from.eq.${a.id},id.eq.${a.rescheduled_from ?? a.id}`),
    st === "confirmed" ? bookingTerms(a.id) : Promise.resolve(null),
  ]);
  const payments = (payData ?? []) as TurnPayment[];
  const allergies = (prefs as { allergies: string | null } | null)?.allergies ?? null;
  const next = ((links ?? []) as { id: string; code: string }[]).find((l) => l.id !== a.id && l.id !== a.rescheduled_from);
  const prev = a.rescheduled_from ? ((links ?? []) as { id: string; code: string }[]).find((l) => l.id === a.rescheduled_from) : undefined;

  // Profesionales que hacen el servicio (para reprogramar)
  let pros: { id: string; name: string }[] = [];
  if (st === "confirmed" && manage) {
    const { data: ps } = await supabase.from("professional_services")
      .select("professional_id, professionals!inner(display_name, is_active, archived_at)")
      .eq("tenant_id", ctx.tenantId).eq("service_id", a.service_id);
    pros = ((ps ?? []) as unknown as { professional_id: string; professionals: { display_name: string; is_active: boolean; archived_at: string | null } }[])
      .filter((p) => p.professionals.is_active && !p.professionals.archived_at)
      .map((p) => ({ id: p.professional_id, name: p.professionals.display_name }));
  }

  const actor = (e: (typeof events)[number]) =>
    e.actor_user_id === null ? "Sistema" : client?.user_id === e.actor_user_id ? "La clienta" : "El equipo";
  const agendaItem = { ...a, status: st, can_mark: manage || (can(ctx, "agenda.mark_own")), unclosed: st === "confirmed" && new Date(a.ends_at).getTime() < new Date().getTime() };
  const actions = quickActions(agendaItem, manage);
  const wa = whatsappLink(client?.phone, `Hola ${client?.full_name.split(" ")[0] ?? ""}, te escribimos de ${ctx.studio.name} por tu turno de ${a.service_name} del ${formatDateTimeLong(a.starts_at, tz)}.`);
  const closedRecently = a.closed_at && new Date().getTime() - new Date(a.closed_at).getTime() < 7 * 86_400_000;
  const clientsAccess = can(ctx, "clients.read") || can(ctx, "clients.read_own");

  return (
    <>
      <Link href={`/admin/agenda?dia=${ymdIn(a.starts_at, tz)}`} className="text-sm text-foreground underline underline-offset-4">← Agenda del día</Link>
      <PageHeader title={`${a.service_name} · ${formatTime(a.starts_at, tz)}`} description={`Código ${a.code}`} />

      {allergies && (
        <p role="note" className="flex items-start gap-3 rounded-2xl border border-[#8d4d49] bg-status-cancel/50 p-3.5 text-sm text-status-cancel-foreground">
          <HeartPulse aria-hidden strokeWidth={1.5} className="mt-0.5 size-5 shrink-0" />
          <span><strong>Alergias:</strong> {allergies}</span>
        </p>
      )}

      <section aria-label="Detalle" className="flex flex-col gap-3 glass rounded-[1.1rem] p-5 text-card-foreground">
        <div className="flex flex-wrap gap-1">
          <StatusPill status={staffTone(agendaItem)}>{staffStatus(agendaItem)}</StatusPill>
          <Badge>{DEPOSIT_LABEL[a.deposit_status]}</Badge>
          <Badge>{a.source === "online" ? "online" : "manual"}</Badge>
          {a.forced_outside_hours && <Badge tone="warn">fuera de horario</Badge>}
          {a.cancelled_by && <Badge tone="warn">canceló {a.cancelled_by === "studio" ? "el estudio" : "la clienta"}</Badge>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Clienta</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {client ? (
              clientsAccess ? <Link href={`/admin/clientas/${client.id}`} className="underline underline-offset-4">{client.full_name}</Link> : client.full_name
            ) : "—"}
            {client?.phone && <span>{client.phone}</span>}
          </dd>
          <dt className="text-muted-foreground">Cuándo</dt>
          <dd>{formatDateTimeLong(a.starts_at, tz)} · {formatDuration(a.duration_minutes)}{a.buffer_minutes ? ` + ${a.buffer_minutes} min extra` : ""}</dd>
          <dt className="text-muted-foreground">Profesional</dt>
          <dd>{a.professional_name}</dd>
          <dt className="text-muted-foreground">Precio acordado</dt>
          <dd>{a.price_is_from ? "desde " : ""}{formatMoney(a.price_minor, a.currency)}</dd>
          <dt className="text-muted-foreground">Seña</dt>
          <dd>
            {formatMoney(a.deposit_minor, a.currency)} ({a.deposit_percent}%)
            {a.credit_applied_minor > 0 ? ` · ${formatMoney(a.credit_applied_minor, a.currency)} con saldo a favor` : ""}
          </dd>
          {a.deposit_outcome && (
            <>
              <dt className="text-muted-foreground">Qué pasó con la seña</dt>
              <dd>{formatMoney(a.deposit_outcome_minor ?? 0, a.currency)} {OUTCOME_LABEL[a.deposit_outcome]}</dd>
            </>
          )}
          {a.cancel_reason && (
            <>
              <dt className="text-muted-foreground">Motivo</dt>
              <dd>{a.cancel_reason}</dd>
            </>
          )}
          {(a.checked_in_at || a.started_at || a.finished_at) && (
            <>
              <dt className="text-muted-foreground">Asistencia</dt>
              <dd>
                {[a.checked_in_at && `llegó ${formatTime(a.checked_in_at, tz)}`, a.started_at && `empezó ${formatTime(a.started_at, tz)}`,
                  a.finished_at && `terminó ${formatTime(a.finished_at, tz)}`].filter(Boolean).join(" · ")}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Política</dt>
          <dd>versión {a.policy_version} · ventana de {a.cancellation_window_hours} h</dd>
          {terms && (
            <>
              <dt className="text-muted-foreground">Plazo</dt>
              <dd>{terms.keeps_deposit ? `Conserva la seña si cancela hasta el ${formatDeadline(terms.deadline, tz)}` : "Ya pasó el plazo: si cancela o cambia, pierde la seña"}</dd>
            </>
          )}
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
        {(prev || next) && (
          <p className="text-sm">
            {prev && <>Viene del turno <Link href={`/admin/turnos/${prev.id}`} className="underline underline-offset-4">{prev.code}</Link>. </>}
            {next && <>Se reprogramó al turno <Link href={`/admin/turnos/${next.id}`} className="underline underline-offset-4">{next.code}</Link>.</>}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Lo acordado (precio, duración, seña y política) no cambia aunque se modifique el servicio.</p>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-11 w-fit items-center gap-2 rounded-full border border-border px-4 text-sm text-foreground hover:bg-accent">
            <MessageCircle aria-hidden strokeWidth={1.5} className="size-4" /> Avisar por WhatsApp
          </a>
        )}
      </section>

      {actions.length > 0 && (
        <section aria-labelledby="asistencia" className="flex flex-col gap-3 glass rounded-[1.1rem] p-5">
          <h2 id="asistencia" className="font-semibold">Asistencia</h2>
          <QuickActions id={a.id} actions={actions} label={a.service_name} />
        </section>
      )}

      {st === "confirmed" && manage && terms && (
        <>
          <details className="glass rounded-[1.1rem] p-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Reprogramar</summary>
            <div className="mt-3">
              <RescheduleTurnForm
                id={a.id}
                professionals={pros.length > 0 ? pros : [{ id: a.professional_id, name: a.professional_name }]}
                currentProfessional={a.professional_id}
                defaultDate={ymdIn(a.starts_at, tz)}
                defaultTime={formatTime(a.starts_at, tz)}
                expected={rescheduleExpected(terms)}
                consequence={rescheduleConsequence(terms, "staff")}
                canCash={can(ctx, "cash.manage")}
              />
            </div>
          </details>
          <details className="glass rounded-[1.1rem] p-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Cancelar el turno</summary>
            <div className="mt-3">
              <CancelTurnForm
                id={a.id}
                clientConsequence={cancelConsequence(terms, "staff")}
                expectedClient={cancelExpected(terms)}
                keepsDeposit={terms.keeps_deposit}
                amountLabel={formatMoney(terms.amount_minor, terms.currency)}
                canRefund={can(ctx, "cash.manage")}
                maybeOffline={a.deposit_status === "paid_offline" || a.deposit_status === "transferred"}
              />
            </div>
          </details>
        </>
      )}

      {st === "no_show" && manage && closedRecently && a.deposit_outcome === "forfeited" && (
        <details className="glass rounded-[1.1rem] p-5">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">¿Se marcó la falta por error?</summary>
          <div className="mt-3"><CorrectNoShowForm id={a.id} /></div>
        </details>
      )}

      {st === "pending_payment" && (can(ctx, "cash.manage") || manage) && (
        <section aria-labelledby="acciones" className="flex flex-col gap-4 glass rounded-[1.1rem] p-5">
          <h2 id="acciones" className="font-semibold">Acciones</h2>
          {can(ctx, "cash.manage") && (
            <form action={markPaidOfflineAction} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={a.id} />
              <Label htmlFor="method">La clienta pagó la seña ({formatMoney(a.deposit_minor - a.credit_applied_minor, a.currency)}) por</Label>
              <div className="flex gap-2">
                <select id="method" name="method" className="h-11 flex-1 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base">
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Efectivo</option>
                </select>
                <Button type="submit" className="h-11">Marcar cobrada</Button>
              </div>
            </form>
          )}
          {manage && (
            <form action={cancelUnpaidAction} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={a.id} />
              <Label htmlFor="reason">Cancelar (sin seña cobrada)</Label>
              <div className="flex gap-2">
                <input id="reason" name="reason" maxLength={200} placeholder="Motivo (opcional)" className="h-11 flex-1 rounded-xl border border-input/80 bg-[#141010]/80 px-3 text-base" />
                <Button type="submit" variant="destructive" className="h-11">Cancelar turno</Button>
              </div>
            </form>
          )}
        </section>
      )}

      {payments.length > 0 && (
        <section aria-labelledby="pagos" className="flex flex-col gap-2">
          <h2 id="pagos" className="font-semibold text-foreground">Pagos con Mercado Pago</h2>
          <ul className="flex flex-col divide-y glass rounded-[1.1rem]">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-col p-3 text-sm">
                <span className="font-medium text-card-foreground">
                  {formatMoney(p.amount_minor, p.currency)} · {PAY_STATUS[p.status] ?? p.status}
                  {p.outcome ? ` · ${PAY_OUTCOME[p.outcome] ?? p.outcome}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {formatDateTimeLong(p.approved_at ?? p.created_at, tz)} · {paymentMethodLabel(p.payment_method, p.payment_type)}
                  {p.refunded_minor > 0 ? ` · devuelto ${formatMoney(p.refunded_minor, p.currency)}` : ""} · operación {p.provider_payment_id}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="historial" className="flex flex-col gap-2">
        <h2 id="historial" className="font-semibold text-foreground">Historial</h2>
        <ol className="flex flex-col divide-y glass rounded-[1.1rem]">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col p-3 text-sm">
              <span className="font-medium text-card-foreground">
                {EVENT_LABEL[e.event_type] ?? e.event_type}
                {typeof e.detail.payment_method === "string" ? ` (${METHOD[e.detail.payment_method] ?? e.detail.payment_method})` : ""}
                {typeof e.detail.method === "string" ? ` (${METHOD[e.detail.method] ?? e.detail.method})` : ""}
              </span>
              <span className="text-muted-foreground">
                {formatDateTimeLong(e.created_at, tz)} · {actor(e)}
                {e.detail.by === "studio" ? " · canceló el estudio" : e.detail.by === "client" ? " · canceló la clienta" : ""}
                {typeof e.detail.outcome === "string" && OUTCOME_EVENT[e.detail.outcome] ? ` · ${OUTCOME_EVENT[e.detail.outcome]}` : ""}
                {typeof e.detail.note === "string" ? ` · «${e.detail.note}»` : ""}
                {e.detail.reason === "released_by_client" ? " · la clienta liberó el horario" : ""}
                {e.detail.late === true ? " · el pago llegó después del vencimiento y el horario seguía libre" : ""}
                {typeof e.detail.payment_ref === "string" ? ` · operación ${e.detail.payment_ref}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
