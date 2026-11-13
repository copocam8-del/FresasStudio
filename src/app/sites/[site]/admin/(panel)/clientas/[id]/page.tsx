import { CalendarCheck2, CalendarX2, HeartPulse, MessageCircle, Percent, Star, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { appointmentTone, GlassCard, InitialsAvatar, PageTitle, StatCard, StatusPill } from "@/components/cleo/ui";
import { AdjustCreditForm, ClientContactForm, NoteForm, PreferencesForm } from "@/components/panel/client-forms";
import { whatsappLink } from "@/lib/agenda-layout";
import { OUTCOME_LABEL, STATUS_LABEL } from "@/lib/appointment-labels";
import { can, requireStaff } from "@/lib/auth";
import { formatDateTimeLong } from "@/lib/booking-format";
import { CREDIT_KIND, creditUsableUntil } from "@/lib/booking-terms";
import { loadCatalog } from "@/lib/catalog-data";
import { loadClientFile } from "@/lib/clients-data";
import { formatMoney } from "@/lib/money";
import { OUTCOME_LABEL as PAY_OUTCOME, paymentMethodLabel, STATUS_LABEL as PAY_STATUS } from "@/lib/payment-labels";
import { hideNoteAction } from "../actions";

export const metadata: Metadata = { title: "Ficha de clienta" };

export default async function ClientFilePage({ params }: PageProps<"/sites/[site]/admin/clientas/[id]">) {
  const { site, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaff(site, `/admin/clientas/${id}`);
  if (!can(ctx, "clients.read") && !can(ctx, "clients.read_own")) notFound();
  const data = await loadClientFile(id, can(ctx, "cash.read"));
  if (!data) notFound();
  const { file: f, appointments, notes, credit, payments } = data;
  const tz = ctx.studio.timezone;
  const manage = can(ctx, "clients.manage");
  const professionals = manage ? (await loadCatalog(ctx)).professionals.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.display_name })) : [];
  const rate = f.attended + f.no_shows > 0 ? Math.round((100 * f.attended) / (f.attended + f.no_shows)) : null;
  const wa = whatsappLink(f.phone, `Hola ${f.full_name.split(" ")[0]}, te escribimos de ${ctx.studio.name}.`);
  // D5: solo números reales y mayores que cero.
  const stats = [
    { icon: CalendarCheck2, value: f.attended, label: "Turnos atendidos", text: String(f.attended) },
    { icon: CalendarX2, value: f.no_shows, label: "Faltas", text: String(f.no_shows) },
    { icon: Percent, value: rate ?? 0, label: "Asistencia", text: `${rate}%`, hint: "atendidas / (atendidas + faltas)" },
    { icon: Wallet, value: f.credit_minor ?? 0, label: "Saldo a favor", text: formatMoney(f.credit_minor ?? 0) },
  ].filter((s) => s.value > 0 || (s.label === "Asistencia" && rate !== null && f.no_shows > 0));
  const liveLots = credit.filter((l) => l.remaining_minor > 0 && new Date(l.expires_at).getTime() > new Date().getTime());

  return (
    <>
      <Link href="/admin/clientas" className="text-sm text-foreground underline underline-offset-4">← Clientas</Link>
      <div className="flex flex-wrap items-center gap-4">
        <InitialsAvatar name={f.full_name} className="size-14 text-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <PageTitle title={f.full_name} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {f.is_frequent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d4b59d]/60 px-2.5 py-0.5 text-foreground">
                <Star aria-hidden className="size-3.5 text-gold" strokeWidth={1.6} /> Frecuente
              </span>
            )}
            {f.repeat_no_shows && (
              <span className="rounded-full border border-[#8d4d49] bg-status-cancel/50 px-2.5 py-0.5 text-status-cancel-foreground">
                Faltas repetidas ({f.no_shows_180} en 6 meses)
              </span>
            )}
            {f.has_account && <span className="text-muted-foreground">Tiene cuenta para reservar online</span>}
          </div>
        </div>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm text-foreground hover:bg-accent">
            <MessageCircle aria-hidden strokeWidth={1.5} className="size-4" /> WhatsApp
          </a>
        )}
      </div>

      {f.allergies && (
        <p role="note" className="flex items-start gap-3 rounded-2xl border border-[#8d4d49] bg-status-cancel/50 p-3.5 text-sm text-status-cancel-foreground">
          <HeartPulse aria-hidden strokeWidth={1.5} className="mt-0.5 size-5 shrink-0" />
          <span><strong>Alergias:</strong> {f.allergies}</span>
        </p>
      )}

      {stats.length > 0 && (
        <section aria-label="Indicadores" className="grid grid-cols-2 gap-[1.4rem] xl:grid-cols-4">
          {stats.map((s) => <StatCard key={s.label} icon={s.icon} value={s.text} label={s.label} hint={s.hint} />)}
        </section>
      )}
      {(f.late_cancels > 0 || f.timely_cancels > 0 || f.studio_cancels > 0 || f.reschedules > 0) && (
        <p className="text-sm text-muted-foreground">
          {[f.late_cancels && `${f.late_cancels} cancelación${f.late_cancels > 1 ? "es" : ""} tarde`,
            f.timely_cancels && `${f.timely_cancels} cancelación${f.timely_cancels > 1 ? "es" : ""} a tiempo`,
            f.studio_cancels && `${f.studio_cancels} cancelada${f.studio_cancels > 1 ? "s" : ""} por el estudio`,
            f.reschedules && `${f.reschedules} reprogramación${f.reschedules > 1 ? "es" : ""}`].filter(Boolean).join(" · ")}
          {" "}(turnos pasados; no cuentan como faltas)
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <GlassCard title={f.only_own ? "Sus turnos con vos" : "Turnos"}>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no tiene turnos.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[#2a2220]">
                {appointments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/turnos/${a.id}`} className="flex flex-col gap-1 rounded-xl px-1 py-3 hover:bg-white/5">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{a.service_name} · {a.professional_name}</span>
                        <StatusPill status={appointmentTone(a.status)}>
                          {STATUS_LABEL[a.status] ?? a.status}{a.cancelled_by === "studio" ? " (estudio)" : ""}
                        </StatusPill>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatDateTimeLong(a.starts_at, tz)} · {formatMoney(a.price_minor, a.currency)}
                        {a.deposit_outcome ? ` · seña ${OUTCOME_LABEL[a.deposit_outcome]}` : ""}
                      </span>
                      {a.cancel_reason && <span className="text-sm text-foreground/85">Motivo: {a.cancel_reason}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {!f.only_own && (
            <GlassCard title="Saldo a favor">
              {liveLots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tiene saldo disponible.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {liveLots.map((l) => (
                    <li key={l.lot_id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-[#1d1716]/70 p-3">
                      <span className="flex flex-col">
                        <span className="text-foreground">{formatMoney(l.remaining_minor, l.currency)} hasta el {creditUsableUntil(l.expires_at, tz)}</span>
                        <span className="text-muted-foreground">{CREDIT_KIND[l.kind] ?? l.kind}{l.appointment_code ? ` · turno ${l.appointment_code}` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {can(ctx, "credits.manage") && (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground underline underline-offset-4">Ajustar saldo</summary>
                  <div className="mt-2"><AdjustCreditForm clientId={f.id} /></div>
                </details>
              )}
            </GlassCard>
          )}

          {payments.length > 0 && (
            <GlassCard title="Pagos con Mercado Pago">
              <ul className="flex flex-col divide-y divide-[#2a2220] text-sm">
                {payments.map((p, i) => (
                  <li key={`${p.created_at}-${i}`} className="flex flex-col py-2">
                    <span className="text-foreground">
                      {formatMoney(p.amount_minor, p.currency)} · {PAY_STATUS[p.status] ?? p.status}
                      {p.outcome ? ` · ${PAY_OUTCOME[p.outcome] ?? p.outcome}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTimeLong(p.created_at, tz)} · turno {p.appointment_code} · {paymentMethodLabel(p.payment_method, p.payment_type)}
                      {p.refunded_minor > 0 ? ` · devuelto ${formatMoney(p.refunded_minor, p.currency)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <GlassCard title="Notas internas">
            <p className="text-sm text-muted-foreground">Solo las ve el equipo. No se editan: si una ya no sirve, se oculta.</p>
            <NoteForm clientId={f.id} />
            {notes.length > 0 && (
              <ul className="flex flex-col gap-2">
                {notes.map((n) => (
                  <li key={n.id} className="flex flex-col gap-1 rounded-2xl border border-border bg-[#1d1716]/70 p-3 text-sm">
                    <p className="whitespace-pre-line text-foreground">{n.body}</p>
                    <span className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                      {n.author_name} · {formatDateTimeLong(n.created_at, tz)}
                      {(n.is_mine || manage) && (
                        <form action={hideNoteAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="note" value={n.id} />
                          <button type="submit" className="min-h-11 px-2 text-foreground underline underline-offset-4">Ocultar</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          <GlassCard title="Preferencias y alergias">
            {manage ? (
              <PreferencesForm clientId={f.id} allergies={f.allergies} preferences={f.preferences}
                preferredProfessionalId={f.preferred_professional_id} professionals={professionals} />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Alergias</dt><dd>{f.allergies ?? "—"}</dd>
                <dt className="text-muted-foreground">Preferencias</dt><dd className="whitespace-pre-line">{f.preferences ?? "—"}</dd>
                <dt className="text-muted-foreground">Profesional</dt><dd>{f.preferred_professional ?? "Sin preferencia"}</dd>
              </dl>
            )}
          </GlassCard>

          <GlassCard title="Datos">
            {manage ? (
              <ClientContactForm client={{ id: f.id, full_name: f.full_name, phone: f.phone, email: f.email }} />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Teléfono</dt><dd>{f.phone ?? "—"}</dd>
                <dt className="text-muted-foreground">Email</dt><dd>{f.email ?? "—"}</dd>
              </dl>
            )}
          </GlassCard>
        </div>
      </div>
    </>
  );
}
