-- =====================================================================
-- Cleo · Migración 2400 · Cobro de señas con Mercado Pago, registro y conciliación
-- Épica 06 (PAY-03 a PAY-06, PAY-08 parte) · docs/sprint-5-plan.md §3–§7
--
--   * payment_intents: cada link de pago (preferencia de Checkout Pro) de una seña.
--     Su id va como external_reference. Monto SIEMPRE copiado de la reserva.
--   * payments: espejo de cada pago que informa Mercado Pago (único por id de pago:
--     la base de la idempotencia). Lo actualiza solo svc_mp_sync_payment.
--   * payment_events: historial de cada pago (solo agregado).
--   * payment_notifications: bandeja de avisos (único por x-request-id).
--   * payment_refunds: devoluciones (una total por pago).
--   * app.apply_mp_payment: qué pasa con cada pago aprobado (§5): confirma, confirma
--     tarde si el horario sigue libre (P4) o pide la devolución automática.
--   * Corrección del Sprint 4: confirm_deposit_payment ya no acepta una reserva cuyo
--     bloqueo venció aunque pg_cron todavía no la haya marcado como vencida.
--
-- Todo lo que viene de Mercado Pago llega YA VERIFICADO contra su API por el
-- servidor (service_role). Las personas solo leen (cash.read / agenda.read_all).
-- =====================================================================

create type public.payment_intent_status as enum ('open', 'paid', 'expired', 'cancelled');

create table public.payment_intents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  appointment_id   uuid not null,
  account_id       uuid not null,
  amount_minor     bigint not null,
  currency         char(3) not null,
  mp_preference_id text,
  checkout_url     text,
  status           public.payment_intent_status not null default 'open',
  expires_at       timestamptz not null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint payment_intents_tenant_id_unique unique (tenant_id, id),
  constraint payment_intents_appointment_fk foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint payment_intents_account_fk foreign key (tenant_id, account_id)
    references public.payment_accounts (tenant_id, id) on delete restrict,
  constraint payment_intents_amount check (amount_minor > 0),
  constraint payment_intents_url check (checkout_url is null or (checkout_url ~ '^https?://' and char_length(checkout_url) <= 500)),
  constraint payment_intents_pref check (mp_preference_id is null or char_length(mp_preference_id) <= 100)
);
create unique index payment_intents_one_open on public.payment_intents (appointment_id) where status = 'open';
create index payment_intents_open_expires on public.payment_intents (expires_at) where status = 'open';
create trigger payment_intents_updated_at before update on public.payment_intents
  for each row execute function app.set_updated_at();

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  account_id          uuid not null,
  intent_id           uuid not null,
  appointment_id      uuid not null,
  provider            text not null default 'mercadopago',
  provider_payment_id text not null,
  status              text not null,
  status_detail       text,
  amount_minor        bigint not null,
  refunded_minor      bigint not null default 0,
  currency            char(3) not null,
  fee_minor           bigint,
  net_minor           bigint,
  payment_method      text,
  payment_type        text,
  installments        smallint,
  approved_at         timestamptz,
  live_mode           boolean not null,
  outcome             text,
  first_seen_via      text not null,
  last_synced_at      timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payments_tenant_id_unique unique (tenant_id, id),
  constraint payments_provider_id_unique unique (provider, provider_payment_id),
  constraint payments_account_fk foreign key (tenant_id, account_id)
    references public.payment_accounts (tenant_id, id) on delete restrict,
  constraint payments_intent_fk foreign key (tenant_id, intent_id)
    references public.payment_intents (tenant_id, id) on delete restrict,
  constraint payments_appointment_fk foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint payments_provider check (provider = 'mercadopago'),
  constraint payments_provider_id_format check (provider_payment_id ~ '^[0-9]{1,20}$'),
  constraint payments_amounts check (amount_minor >= 0 and refunded_minor >= 0 and (fee_minor is null or fee_minor >= 0)),
  constraint payments_texts check (char_length(status) <= 40 and (status_detail is null or char_length(status_detail) <= 80)
    and (payment_method is null or char_length(payment_method) <= 40) and (payment_type is null or char_length(payment_type) <= 40)),
  constraint payments_outcome check (outcome is null or outcome in (
    'applied', 'late_confirmed', 'refund_pending', 'refunded', 'refund_failed', 'needs_review', 'ignored')),
  constraint payments_seen_via check (first_seen_via in ('webhook', 'reconcile'))
);
create index payments_tenant_created on public.payments (tenant_id, created_at);
create index payments_appointment on public.payments (appointment_id);
create trigger payments_updated_at before update on public.payments
  for each row execute function app.set_updated_at();
comment on table public.payments is
  'Espejo de los pagos de Mercado Pago (verificados contra su API). Cada cambio queda en payment_events.';

create table public.payment_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  payment_id    uuid not null,
  kind          text not null,
  from_status   text,
  to_status     text,
  detail        jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  created_at    timestamptz not null default now(),
  constraint payment_events_payment_fk foreign key (tenant_id, payment_id)
    references public.payments (tenant_id, id) on delete restrict,
  constraint payment_events_kind check (kind in (
    'seen', 'status_changed', 'applied', 'late_confirmed', 'needs_review', 'ignored',
    'refund_requested', 'refunded', 'refund_failed', 'refund_retried'))
);
create index payment_events_payment on public.payment_events (payment_id, id);
create trigger payment_events_append_only before update or delete on public.payment_events
  for each row execute function app.prevent_mutation();
create trigger payment_events_no_truncate before truncate on public.payment_events
  for each statement execute function app.prevent_mutation();

create table public.payment_notifications (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  account_id   uuid not null,
  request_id   text not null,
  topic        text not null,
  resource_id  text,
  attempts     integer not null default 1,
  result       text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_notifications_request_unique unique (request_id),
  constraint payment_notifications_account_fk foreign key (tenant_id, account_id)
    references public.payment_accounts (tenant_id, id) on delete restrict,
  constraint payment_notifications_texts check (char_length(request_id) between 1 and 100
    and char_length(topic) <= 40 and (resource_id is null or char_length(resource_id) <= 40)
    and (result is null or char_length(result) <= 40))
);
create index payment_notifications_received on public.payment_notifications (received_at);

create table public.payment_refunds (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  payment_id         uuid not null,
  amount_minor       bigint not null,
  reason             text not null,
  status             text not null default 'requested',
  provider_refund_id text,
  last_error         text,
  requested_by       uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payment_refunds_one_per_payment unique (payment_id),
  constraint payment_refunds_payment_fk foreign key (tenant_id, payment_id)
    references public.payments (tenant_id, id) on delete restrict,
  constraint payment_refunds_amount check (amount_minor > 0),
  constraint payment_refunds_reason check (reason in ('duplicate', 'late_slot_taken', 'late_released', 'late_past')),
  constraint payment_refunds_status check (status in ('requested', 'done', 'failed')),
  constraint payment_refunds_texts check ((provider_refund_id is null or char_length(provider_refund_id) <= 40)
    and (last_error is null or char_length(last_error) <= 60))
);
create trigger payment_refunds_updated_at before update on public.payment_refunds
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------
-- Permisos y RLS: el equipo con caja o agenda completa lee; nadie escribe directo.
-- Cleo Admin no ve nada (no tiene membresía con esos permisos). anon, nada.
-- ---------------------------------------------------------------------
revoke all on public.payment_intents, public.payments, public.payment_events,
              public.payment_notifications, public.payment_refunds from anon, authenticated;
grant select on public.payment_intents, public.payments, public.payment_events, public.payment_refunds to authenticated;

alter table public.payment_intents enable row level security;
alter table public.payment_intents force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;
alter table public.payment_notifications enable row level security;
alter table public.payment_notifications force row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_refunds force row level security;

create or replace function app.can_see_payments(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_tenant, 'cash.read') or app.has_permission(p_tenant, 'agenda.read_all')
$$;
revoke execute on function app.can_see_payments(uuid) from public, anon;
grant execute on function app.can_see_payments(uuid) to authenticated;

create policy payment_intents_select on public.payment_intents for select to authenticated
  using (app.can_see_payments(tenant_id));
create policy payments_select on public.payments for select to authenticated
  using (app.can_see_payments(tenant_id));
create policy payment_events_select on public.payment_events for select to authenticated
  using (app.can_see_payments(tenant_id));
create policy payment_refunds_select on public.payment_refunds for select to authenticated
  using (app.can_see_payments(tenant_id));
-- payment_notifications: sin políticas (solo el servidor).

-- ---------------------------------------------------------------------
-- Reservas: confirmación tardía (P4) y nuevos eventos del historial
-- ---------------------------------------------------------------------
alter table public.appointment_events drop constraint appointment_events_type;
alter table public.appointment_events add constraint appointment_events_type check (event_type in (
  'created', 'confirmed', 'cancelled', 'expired', 'deposit_paid', 'deposit_paid_offline',
  'deposit_refunded', 'payment_disputed'));

-- Igual que en la 1700, más: expired → confirmed SOLO dentro de app.apply_mp_payment
-- (marca app.late_payment). La restricción anti doble reserva sigue siendo la garantía.
create or replace function app.guard_appointment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.tenant_id, new.code, new.client_profile_id, new.professional_id, new.service_id,
      new.starts_at, new.ends_at, new.occupied_until, new.service_name, new.professional_name,
      new.duration_minutes, new.buffer_minutes, new.price_minor, new.price_is_from, new.currency,
      new.deposit_percent, new.deposit_minor, new.policy_version, new.cancellation_window_hours,
      new.source, new.forced_outside_hours, new.created_by, new.created_at)
     is distinct from
     (old.tenant_id, old.code, old.client_profile_id, old.professional_id, old.service_id,
      old.starts_at, old.ends_at, old.occupied_until, old.service_name, old.professional_name,
      old.duration_minutes, old.buffer_minutes, old.price_minor, old.price_is_from, old.currency,
      old.deposit_percent, old.deposit_minor, old.policy_version, old.cancellation_window_hours,
      old.source, old.forced_outside_hours, old.created_by, old.created_at) then
    raise exception 'Lo acordado en una reserva no se puede modificar' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_payment' and new.status in ('confirmed', 'cancelled', 'expired'))
       or (old.status = 'confirmed' and new.status = 'cancelled')
       or (old.status = 'expired' and new.status = 'confirmed'
           and coalesce(current_setting('app.late_payment', true), '') = 'on')) then
    raise exception 'Cambio de estado no permitido: % → %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end $$;

-- Corrección del Sprint 4 (pago simulado de desarrollo y cualquier uso futuro): una
-- reserva con el bloqueo vencido se trata como vencida aunque el cron no haya pasado.
create or replace function app.confirm_deposit_payment(p_appointment uuid, p_payment_ref text, p_amount_minor bigint)
returns public.appointment_status
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.appointments%rowtype;
begin
  select * into v_row from public.appointments where id = p_appointment for update;
  if v_row.id is null then
    raise exception 'Reserva inexistente' using errcode = 'P0002';
  end if;
  if v_row.status = 'confirmed' and v_row.deposit_status = 'paid' then
    return v_row.status;   -- el mismo pago avisado dos veces: no hace nada
  end if;
  if v_row.status <> 'pending_payment' or v_row.hold_expires_at <= now() then
    -- Los pagos reales que llegan tarde los resuelve app.apply_mp_payment (P4).
    raise exception 'La reserva ya no está activa (%)',
      case when v_row.status = 'pending_payment' then 'expired' else v_row.status::text end using errcode = '22023';
  end if;
  if p_amount_minor is distinct from v_row.deposit_minor then
    raise exception 'El monto pagado (%) no coincide con la seña (%)', p_amount_minor, v_row.deposit_minor using errcode = '22023';
  end if;
  if p_payment_ref is null or char_length(p_payment_ref) not between 1 and 100 then
    raise exception 'Falta la referencia del pago' using errcode = '22023';
  end if;
  perform set_config('app.event_detail', jsonb_build_object('payment_ref', p_payment_ref)::text, true);
  update public.appointments set deposit_status = 'paid', status = 'confirmed' where id = p_appointment;
  perform set_config('app.event_detail', '', true);
  return 'confirmed';
end $$;
revoke execute on function app.confirm_deposit_payment(uuid, text, bigint) from public, anon, authenticated;
grant execute on function app.confirm_deposit_payment(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------
-- Interno: evento de un pago y evento en el historial de la reserva
-- ---------------------------------------------------------------------
create or replace function app.payment_event(
  p_payment public.payments, p_kind text, p_from text, p_to text, p_detail jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.payment_events (tenant_id, payment_id, kind, from_status, to_status, detail, actor_user_id)
  values (p_payment.tenant_id, p_payment.id, p_kind, p_from, p_to, coalesce(p_detail, '{}'::jsonb), auth.uid())
$$;
revoke execute on function app.payment_event(public.payments, text, text, text, jsonb) from public, anon, authenticated;

create or replace function app.appointment_note(p_appointment uuid, p_type text, p_detail jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.appointment_events (tenant_id, appointment_id, event_type, from_status, to_status, actor_user_id, detail)
  select a.tenant_id, a.id, p_type, a.status, a.status, auth.uid(), p_detail
  from public.appointments a where a.id = p_appointment
$$;
revoke execute on function app.appointment_note(uuid, text, jsonb) from public, anon, authenticated;

-- Pide la devolución total de un pago (la hace el servidor contra Mercado Pago).
create or replace function app.request_refund(p_payment public.payments, p_reason text)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.payment_refunds (tenant_id, payment_id, amount_minor, reason)
  values (p_payment.tenant_id, p_payment.id, p_payment.amount_minor, p_reason)
  on conflict (payment_id) do nothing;
  update public.payments set outcome = 'refund_pending' where id = p_payment.id;
  perform app.payment_event(p_payment, 'refund_requested', p_payment.status, p_payment.status,
                            jsonb_build_object('reason', p_reason, 'amount_minor', p_payment.amount_minor));
  return 'refund_pending';
end $$;
revoke execute on function app.request_refund(public.payments, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- §5: qué pasa con un pago APROBADO (el que llama ya tiene el pago bloqueado)
-- ---------------------------------------------------------------------
create or replace function app.apply_mp_payment(p_payment uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_pay  public.payments%rowtype;
  v_appt public.appointments%rowtype;
  v_detail jsonb;
begin
  select * into v_pay from public.payments where id = p_payment;
  if v_pay.outcome is not null or v_pay.status <> 'approved' then
    return v_pay.outcome;  -- ya resuelto (aviso repetido) o no aprobado
  end if;
  select * into v_appt from public.appointments where id = v_pay.appointment_id for no key update;

  -- El monto lo fija la preferencia: si no coincide, no se confirma nada.
  if v_pay.amount_minor <> v_appt.deposit_minor or v_pay.currency <> v_appt.currency then
    update public.payments set outcome = 'needs_review' where id = v_pay.id;
    perform app.payment_event(v_pay, 'needs_review', v_pay.status, v_pay.status,
      jsonb_build_object('expected_minor', v_appt.deposit_minor, 'currency', v_appt.currency));
    return 'needs_review';
  end if;

  -- Ya pagada (otro pago o cobrada en el estudio): se devuelve este.
  if v_appt.deposit_status in ('paid', 'paid_offline') then
    return app.request_refund(v_pay, 'duplicate');
  end if;
  -- La clienta la liberó o el estudio la canceló.
  if v_appt.status = 'cancelled' then
    return app.request_refund(v_pay, 'late_released');
  end if;

  v_detail := jsonb_build_object('payment_ref', v_pay.provider_payment_id, 'provider', 'mercadopago');

  -- A tiempo
  if v_appt.status = 'pending_payment' and v_appt.hold_expires_at > now() then
    perform set_config('app.event_detail', v_detail::text, true);
    update public.appointments set deposit_status = 'paid', status = 'confirmed' where id = v_appt.id;
    perform set_config('app.event_detail', '', true);
    update public.payments set outcome = 'applied' where id = v_pay.id;
    update public.payment_intents set status = 'paid' where id = v_pay.intent_id;
    perform app.payment_event(v_pay, 'applied', v_pay.status, v_pay.status, jsonb_build_object('appointment_code', v_appt.code));
    return 'applied';
  end if;

  -- Tarde (P4): el turno ya pasó → devolución.
  if v_appt.starts_at <= now() then
    return app.request_refund(v_pay, 'late_past');
  end if;

  -- Tarde con el turno en el futuro: se confirma si el horario sigue libre. La
  -- restricción de exclusión decide; si otra lo tomó, devolución.
  begin
    perform set_config('app.late_payment', 'on', true);
    perform set_config('app.event_detail', (v_detail || '{"late": true}'::jsonb)::text, true);
    update public.appointments set deposit_status = 'paid', status = 'confirmed' where id = v_appt.id;
    perform set_config('app.late_payment', '', true);
    perform set_config('app.event_detail', '', true);
  exception when exclusion_violation then
    perform set_config('app.late_payment', '', true);
    perform set_config('app.event_detail', '', true);
    return app.request_refund(v_pay, 'late_slot_taken');
  end;
  update public.payments set outcome = 'late_confirmed' where id = v_pay.id;
  update public.payment_intents set status = 'paid' where id = v_pay.intent_id;
  perform app.payment_event(v_pay, 'late_confirmed', v_pay.status, v_pay.status, jsonb_build_object('appointment_code', v_appt.code));
  return 'late_confirmed';
end $$;
revoke execute on function app.apply_mp_payment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Servidor: registrar un pago verificado contra la API de Mercado Pago
-- p_payment: el pago normalizado (src/lib/payments/mp-api.ts → normalizePayment)
-- ---------------------------------------------------------------------
create or replace function public.svc_mp_sync_payment(p_account uuid, p_payment jsonb, p_via text)
returns table (payment_id uuid, outcome text, refund_id uuid, ignored_reason text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_acc     public.payment_accounts%rowtype;
  v_intent  public.payment_intents%rowtype;
  v_pay     public.payments%rowtype;
  v_old     public.payments%rowtype;
  v_ref     text := p_payment ->> 'external_reference';
  v_pid     text := p_payment ->> 'provider_payment_id';
  v_inserted uuid;
  v_outcome text;
begin
  if p_via not in ('webhook', 'reconcile') then
    raise exception 'Origen inválido' using errcode = '22023';
  end if;
  select * into v_acc from public.payment_accounts where id = p_account and status <> 'disconnected';
  if v_acc.id is null then
    return query select null::uuid, null::text, null::uuid, 'account'::text; return;
  end if;
  -- El pago tiene que ser de la cuenta de ESTE estudio…
  if (p_payment ->> 'collector_id') is null or (p_payment ->> 'collector_id')::bigint <> v_acc.mp_user_id then
    return query select null::uuid, null::text, null::uuid, 'foreign'::text; return;
  end if;
  -- …y de un link de pago nuestro de ESTE estudio.
  if v_ref is null or v_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return query select null::uuid, null::text, null::uuid, 'not_ours'::text; return;
  end if;
  select * into v_intent from public.payment_intents where id = v_ref::uuid and tenant_id = v_acc.tenant_id;
  if v_intent.id is null then
    return query select null::uuid, null::text, null::uuid, 'not_ours'::text; return;
  end if;
  if v_pid is null or v_pid !~ '^[0-9]{1,20}$' then
    raise exception 'Id de pago inválido' using errcode = '22023';
  end if;

  -- Todos los pagos de una misma reserva se ordenan acá (antes de insertar: la clave
  -- foránea toma un candado compartido y pedir el exclusivo después causaría deadlocks).
  perform 1 from public.appointments where id = v_intent.appointment_id for no key update;

  insert into public.payments (
    tenant_id, account_id, intent_id, appointment_id, provider_payment_id, status, status_detail,
    amount_minor, refunded_minor, currency, fee_minor, net_minor, payment_method, payment_type,
    installments, approved_at, live_mode, first_seen_via)
  values (
    v_acc.tenant_id, v_acc.id, v_intent.id, v_intent.appointment_id, v_pid,
    left(p_payment ->> 'status', 40), left(p_payment ->> 'status_detail', 80),
    (p_payment ->> 'amount_minor')::bigint, coalesce((p_payment ->> 'refunded_minor')::bigint, 0),
    upper(left(p_payment ->> 'currency', 3)),
    (p_payment ->> 'fee_minor')::bigint, (p_payment ->> 'net_minor')::bigint,
    left(p_payment ->> 'payment_method', 40), left(p_payment ->> 'payment_type', 40),
    (p_payment ->> 'installments')::smallint, (p_payment ->> 'approved_at')::timestamptz,
    coalesce((p_payment ->> 'live_mode')::boolean, false), p_via)
  on conflict (provider, provider_payment_id) do nothing
  returning id into v_inserted;

  -- Bloquea el pago: dos avisos simultáneos del mismo pago se ordenan acá.
  select * into v_old from public.payments where provider = 'mercadopago' and provider_payment_id = v_pid for update;
  if v_old.tenant_id <> v_acc.tenant_id then
    return query select null::uuid, null::text, null::uuid, 'foreign'::text; return;
  end if;

  if v_inserted is not null then
    perform app.payment_event(v_old, 'seen', null, v_old.status,
      jsonb_build_object('via', p_via, 'amount_minor', v_old.amount_minor,
                         'recovered_by_reconcile', p_via = 'reconcile'));
  elsif v_old.status is distinct from left(p_payment ->> 'status', 40)
     or v_old.refunded_minor is distinct from coalesce((p_payment ->> 'refunded_minor')::bigint, 0) then
    update public.payments
       set status = left(p_payment ->> 'status', 40),
           status_detail = left(p_payment ->> 'status_detail', 80),
           refunded_minor = coalesce((p_payment ->> 'refunded_minor')::bigint, 0),
           fee_minor = coalesce((p_payment ->> 'fee_minor')::bigint, fee_minor),
           net_minor = coalesce((p_payment ->> 'net_minor')::bigint, net_minor),
           approved_at = coalesce((p_payment ->> 'approved_at')::timestamptz, approved_at),
           last_synced_at = now()
     where id = v_old.id;
    perform app.payment_event(v_old, 'status_changed', v_old.status, left(p_payment ->> 'status', 40),
      jsonb_build_object('via', p_via, 'refunded_minor', coalesce((p_payment ->> 'refunded_minor')::bigint, 0)));
  else
    update public.payments set last_synced_at = now() where id = v_old.id;
  end if;

  select * into v_pay from public.payments where id = v_old.id;

  if v_pay.status = 'approved' and v_pay.outcome is null then
    v_outcome := app.apply_mp_payment(v_pay.id);
  elsif v_pay.status in ('rejected', 'cancelled') and v_pay.outcome is null then
    update public.payments set outcome = 'ignored' where id = v_pay.id;
    perform app.payment_event(v_pay, 'ignored', v_pay.status, v_pay.status, '{}'::jsonb);
    v_outcome := 'ignored';
  else
    v_outcome := v_pay.outcome;
  end if;

  -- Devoluciones o contracargos informados después (P8): se avisa en el turno, no se cancela.
  if v_pay.refunded_minor > v_old.refunded_minor or (v_pay.status in ('refunded', 'charged_back') and v_old.status is distinct from v_pay.status) then
    if v_pay.outcome in ('refund_pending', 'refund_failed') and v_pay.status = 'refunded' then
      -- Nuestra devolución (o una hecha a mano en Mercado Pago) ya está hecha.
      update public.payment_refunds set status = 'done', last_error = null where payment_id = v_pay.id and status <> 'done';
      update public.payments set outcome = 'refunded' where id = v_pay.id;
      perform app.payment_event(v_pay, 'refunded', v_pay.status, v_pay.status, jsonb_build_object('via', p_via));
      perform app.appointment_note(v_pay.appointment_id, 'deposit_refunded',
        jsonb_build_object('payment_ref', v_pay.provider_payment_id, 'amount_minor', v_pay.amount_minor));
      v_outcome := 'refunded';
    elsif v_pay.outcome in ('applied', 'late_confirmed') then
      perform app.appointment_note(v_pay.appointment_id,
        case when v_pay.status = 'charged_back' then 'payment_disputed' else 'deposit_refunded' end,
        jsonb_build_object('payment_ref', v_pay.provider_payment_id, 'refunded_minor', v_pay.refunded_minor,
                           'status', v_pay.status, 'source', 'mercadopago'));
    end if;
  end if;

  return query
    select v_pay.id, v_outcome,
           (select r.id from public.payment_refunds r where r.payment_id = v_pay.id and r.status = 'requested'),
           null::text;
end $$;

-- Resultado de pedirle la devolución a Mercado Pago.
create or replace function public.svc_mp_refund_result(p_refund uuid, p_ok boolean, p_provider_refund_id text, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.payment_refunds%rowtype;
  v_pay public.payments%rowtype;
begin
  select * into v_ref from public.payment_refunds where id = p_refund for update;
  if v_ref.id is null or v_ref.status = 'done' then
    return;
  end if;
  select * into v_pay from public.payments where id = v_ref.payment_id for update;
  if p_ok then
    update public.payment_refunds set status = 'done', provider_refund_id = left(p_provider_refund_id, 40), last_error = null
     where id = p_refund;
    update public.payments set outcome = 'refunded' where id = v_pay.id;
    perform app.payment_event(v_pay, 'refunded', v_pay.status, v_pay.status,
      jsonb_build_object('reason', v_ref.reason, 'provider_refund_id', left(p_provider_refund_id, 40)));
    perform app.appointment_note(v_pay.appointment_id, 'deposit_refunded',
      jsonb_build_object('payment_ref', v_pay.provider_payment_id, 'amount_minor', v_ref.amount_minor, 'reason', v_ref.reason));
  else
    update public.payment_refunds set status = 'failed', last_error = left(coalesce(p_error, 'error'), 60) where id = p_refund;
    update public.payments set outcome = 'refund_failed' where id = v_pay.id;
    perform app.payment_event(v_pay, 'refund_failed', v_pay.status, v_pay.status,
      jsonb_build_object('reason', v_ref.reason, 'error', left(coalesce(p_error, 'error'), 60)));
  end if;
end $$;

-- Devoluciones que quedaron pedidas y no se completaron (la revisión las reintenta).
create or replace function public.svc_mp_pending_refunds()
returns table (refund_id uuid, account_id uuid, provider_payment_id text)
language sql stable security definer set search_path = '' as $$
  select r.id, p.account_id, p.provider_payment_id
  from public.payment_refunds r join public.payments p on p.id = r.payment_id
  where r.status = 'requested' and r.updated_at < now() - interval '2 minutes'
$$;

-- "Reintentar devolución" desde el panel (cash.manage): vuelve a pedirla.
create or replace function public.retry_refund(p_payment uuid)
returns table (refund_id uuid, account_id uuid, provider_payment_id text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_pay public.payments%rowtype;
  v_ref public.payment_refunds%rowtype;
begin
  select * into v_pay from public.payments where id = p_payment for update;
  if v_pay.id is null or not app.can(v_pay.tenant_id, 'cash.manage') then
    raise exception 'No tenés permiso para devolver pagos' using errcode = '42501';
  end if;
  update public.payment_refunds set status = 'requested', last_error = null
   where payment_id = p_payment and status = 'failed'
  returning * into v_ref;
  if v_ref.id is null then
    raise exception 'Ese pago no tiene una devolución para reintentar' using errcode = '22023';
  end if;
  update public.payments set outcome = 'refund_pending' where id = p_payment;
  perform app.payment_event(v_pay, 'refund_retried', v_pay.status, v_pay.status, '{}'::jsonb);
  return query select v_ref.id, v_pay.account_id, v_pay.provider_payment_id;
end $$;

-- ---------------------------------------------------------------------
-- "Pagar seña" (la clienta, con su sesión)
-- ---------------------------------------------------------------------
create or replace function public.start_deposit_checkout(p_slug text, p_code text)
returns table (
  intent_id uuid, account_id uuid, checkout_url text, amount_minor bigint, currency text,
  expires_at timestamptz, service_name text, studio_name text, code text
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_appt   public.appointments%rowtype;
  v_studio text;
  v_acc    uuid;
  v_intent public.payment_intents%rowtype;
begin
  select a.* into v_appt
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  where t.slug = lower(btrim(p_slug)) and a.code = upper(btrim(p_code)) and c.user_id = auth.uid()
  for update of a;
  if v_appt.id is null then
    raise exception 'No encontramos una reserva tuya con ese código' using errcode = 'P0002';
  end if;
  if v_appt.status <> 'pending_payment' or v_appt.hold_expires_at <= now() then
    raise exception 'Esta reserva ya no está esperando pago' using errcode = '22023';
  end if;
  select t.name into v_studio from public.tenants t where t.id = v_appt.tenant_id;
  select a.id into v_acc from public.payment_accounts a where a.tenant_id = v_appt.tenant_id and a.status = 'connected';
  if v_acc is null then
    raise exception 'El estudio todavía no puede cobrar online. Escribile para pagar la seña' using errcode = '22023';
  end if;

  select * into v_intent from public.payment_intents i where i.appointment_id = v_appt.id and i.status = 'open';
  if v_intent.id is not null and (v_intent.account_id <> v_acc or v_intent.amount_minor <> v_appt.deposit_minor) then
    update public.payment_intents set status = 'cancelled' where id = v_intent.id;
    v_intent := null;
  end if;
  if v_intent.id is null then
    insert into public.payment_intents (tenant_id, appointment_id, account_id, amount_minor, currency, expires_at, created_by)
    values (v_appt.tenant_id, v_appt.id, v_acc, v_appt.deposit_minor, v_appt.currency, v_appt.hold_expires_at, auth.uid())
    returning * into v_intent;
  end if;
  return query select v_intent.id, v_intent.account_id, v_intent.checkout_url, v_intent.amount_minor,
                      v_intent.currency::text, v_intent.expires_at, v_appt.service_name, v_studio, v_appt.code;
end $$;

-- Guarda la preferencia creada (la primera gana: dos clics no crean dos links distintos).
create or replace function public.svc_mp_set_preference(p_intent uuid, p_preference_id text, p_checkout_url text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
begin
  update public.payment_intents
     set mp_preference_id = left(p_preference_id, 100), checkout_url = p_checkout_url
   where id = p_intent and status = 'open' and checkout_url is null;
  select checkout_url into v_url from public.payment_intents where id = p_intent and status = 'open';
  return v_url;
end $$;

-- Lo que ve la clienta del pago de SU reserva (sin ids internos).
create or replace function public.get_my_booking_payment(p_slug text, p_code text)
returns table (status text, outcome text, refund_status text, refund_reason text, amount_minor bigint, currency text)
language sql stable security definer set search_path = '' as $$
  select p.status, p.outcome, r.status, r.reason, p.amount_minor, p.currency::text
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  join public.payments p on p.appointment_id = a.id
  left join public.payment_refunds r on r.payment_id = p.id
  where t.slug = lower(btrim(p_slug)) and a.code = upper(btrim(p_code)) and c.user_id = auth.uid()
  order by p.created_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Bandeja de avisos (idempotencia por x-request-id)
-- ---------------------------------------------------------------------
create or replace function public.svc_mp_record_notification(p_account uuid, p_request_id text, p_topic text, p_resource_id text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_done timestamptz;
begin
  insert into public.payment_notifications (tenant_id, account_id, request_id, topic, resource_id)
  select a.tenant_id, a.id, p_request_id, left(p_topic, 40), left(p_resource_id, 40)
  from public.payment_accounts a where a.id = p_account
  on conflict (request_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return 'new';
  end if;
  select processed_at into v_done from public.payment_notifications where request_id = p_request_id for update;
  if v_done is not null then
    return 'duplicate';
  end if;
  update public.payment_notifications set attempts = attempts + 1 where request_id = p_request_id;
  return 'retry';
end $$;

create or replace function public.svc_mp_notification_done(p_request_id text, p_result text)
returns void
language sql security definer set search_path = '' as $$
  update public.payment_notifications set processed_at = now(), result = left(p_result, 40)
  where request_id = p_request_id
$$;

-- ---------------------------------------------------------------------
-- Revisión periódica (P9) y limpieza
-- ---------------------------------------------------------------------
-- Links de pago a consultar (abiertos o vencidos hace menos de 48 h) y pagos no finales.
create or replace function public.svc_mp_reconcile_targets()
returns table (kind text, account_id uuid, reference text)
language sql stable security definer set search_path = '' as $$
  select 'intent', i.account_id, i.id::text
  from public.payment_intents i join public.payment_accounts a on a.id = i.account_id
  where i.status = 'open' and i.expires_at > now() - interval '48 hours' and a.status = 'connected'
  union all
  select 'payment', p.account_id, p.provider_payment_id
  from public.payments p join public.payment_accounts a on a.id = p.account_id
  where p.status in ('pending', 'in_process', 'authorized') and p.created_at > now() - interval '7 days'
    and a.status = 'connected'
$$;

create or replace function public.svc_mp_housekeeping()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.payment_intents set status = 'expired'
   where status = 'open' and expires_at < now() - interval '48 hours';
  delete from public.payment_notifications where received_at < now() - interval '90 days';
  delete from public.payment_oauth_states where expires_at < now() - interval '1 day';
end $$;

-- ---------------------------------------------------------------------
-- Conciliación (cash.read): pagos de un período con su reserva
-- ---------------------------------------------------------------------
create or replace function public.list_payments(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  payment_id uuid, created_at timestamptz, approved_at timestamptz, provider_payment_id text,
  appointment_id uuid, appointment_code text, starts_at timestamptz, client_name text, service_name text,
  amount_minor bigint, fee_minor bigint, net_minor bigint, refunded_minor bigint, currency text,
  payment_method text, payment_type text, status text, outcome text,
  refund_status text, refund_reason text, refund_error text, live_mode boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not app.has_permission(p_tenant, 'cash.read') then
    raise exception 'No tenés permiso para ver los pagos' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Elegí un período de hasta un año' using errcode = '22023';
  end if;
  return query
  select p.id, p.created_at, p.approved_at, p.provider_payment_id,
         a.id, a.code, a.starts_at, c.full_name, a.service_name,
         p.amount_minor, p.fee_minor, p.net_minor, p.refunded_minor, p.currency::text,
         p.payment_method, p.payment_type, p.status, p.outcome,
         r.status, r.reason, r.last_error, p.live_mode
  from public.payments p
  join public.appointments a on a.id = p.appointment_id
  join public.client_profiles c on c.id = a.client_profile_id
  left join public.payment_refunds r on r.payment_id = p.id
  where p.tenant_id = p_tenant and p.created_at >= p_from and p.created_at < p_to
  order by p.created_at desc;
end $$;

-- Desconectar (redefinida, 2300): además cancela los links de pago abiertos.
create or replace function public.disconnect_mp(p_tenant uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app.can(p_tenant, 'payments.manage') then
    raise exception 'Solo la dueña puede desconectar Mercado Pago' using errcode = '42501';
  end if;
  update public.payment_accounts
     set status = 'disconnected', disconnected_at = now(), disconnected_by = auth.uid()
   where tenant_id = p_tenant and status <> 'disconnected'
  returning id into v_id;
  if v_id is null then
    raise exception 'No hay una cuenta de Mercado Pago conectada' using errcode = 'P0002';
  end if;
  delete from public.payment_account_credentials where account_id = v_id;
  update public.payment_intents set status = 'cancelled' where tenant_id = p_tenant and status = 'open';
  perform app.set_payments_connected(p_tenant, false);
  perform app.write_audit(p_tenant, 'payments.disconnected', 'payment_account', v_id::text);
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.start_deposit_checkout(text, text) from public, anon;
grant execute on function public.start_deposit_checkout(text, text) to authenticated;
revoke execute on function public.get_my_booking_payment(text, text) from public, anon;
grant execute on function public.get_my_booking_payment(text, text) to authenticated;
revoke execute on function public.retry_refund(uuid) from public, anon;
grant execute on function public.retry_refund(uuid) to authenticated;
revoke execute on function public.list_payments(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_payments(uuid, timestamptz, timestamptz) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.svc_mp_sync_payment(uuid, jsonb, text)',
    'public.svc_mp_refund_result(uuid, boolean, text, text)',
    'public.svc_mp_pending_refunds()',
    'public.svc_mp_set_preference(uuid, text, text)',
    'public.svc_mp_record_notification(uuid, text, text, text)',
    'public.svc_mp_notification_done(text, text)',
    'public.svc_mp_reconcile_targets()',
    'public.svc_mp_housekeeping()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
