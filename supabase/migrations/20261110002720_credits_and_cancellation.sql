-- =====================================================================
-- Cleo · Migración 2720 · Saldo a favor y cancelaciones con seña
-- Épica 07 (POL-02, POL-03, POL-07, POL-08) · docs/sprint-6-plan.md
--
--   * Reservas: columnas para lo que pasa al cerrar un turno (quién canceló, qué
--     pasó con la seña, asistencia, reprogramación) y transiciones nuevas.
--   * client_credit_entries: libro del saldo a favor (solo agregado). Las
--     acreditaciones son "lotes" que vencen (C10: 90 días por defecto,
--     configurable); lo que se usa sale primero de lo que vence antes.
--   * El saldo se usa solo en la seña de la próxima reserva (C9); si la reserva
--     vence o se libera, vuelve a su lote.
--   * Cancelar: la clienta con ≥ 24 h → saldo; con menos → se pierde. El estudio
--     → saldo o devolución, nunca pierde (C5, C6). Todo decide app.deposit_terms.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vencimiento del saldo: configurable por estudio y parte de la política aceptada
-- ---------------------------------------------------------------------
alter table public.tenant_settings
  add column credit_expiry_days smallint not null default 90,
  add constraint settings_credit_expiry check (credit_expiry_days between 30 and 365);
alter table public.tenant_policy_versions
  add column credit_expiry_days smallint not null default 90;
grant update (credit_expiry_days) on public.tenant_settings to authenticated;

create or replace function app.version_tenant_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.policy_version := 1;
  elsif (new.deposit_percent, new.cancellation_window_hours, new.no_show_forfeits_deposit, new.policy_text,
         new.credit_expiry_days)
        is not distinct from
        (old.deposit_percent, old.cancellation_window_hours, old.no_show_forfeits_deposit, old.policy_text,
         old.credit_expiry_days) then
    new.policy_version := old.policy_version;   -- no cambió la política
    return new;
  else
    new.policy_version := old.policy_version + 1;
  end if;

  insert into public.tenant_policy_versions
    (tenant_id, version, deposit_percent, cancellation_window_hours, no_show_forfeits_deposit, policy_text,
     credit_expiry_days, created_by)
  values
    (new.tenant_id, new.policy_version, new.deposit_percent, new.cancellation_window_hours,
     new.no_show_forfeits_deposit, new.policy_text, new.credit_expiry_days, auth.uid());

  return new;
end $$;

-- ---------------------------------------------------------------------
-- Permiso nuevo: ajustar el saldo a mano (C11). Dueña y encargada.
-- ---------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('credits.manage', 'clients', 'Cargar o quitar saldo a favor de una clienta (con motivo)')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'credits.manage' from public.roles r
where r.tenant_id is null and r.key in ('owner', 'manager')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Reservas: columnas nuevas
-- ---------------------------------------------------------------------
alter table public.appointments
  add column credit_applied_minor  bigint not null default 0,
  add column rescheduled_from      uuid,
  add column reschedule_count      smallint not null default 0,
  add column checked_in_at         timestamptz,
  add column started_at            timestamptz,
  add column finished_at           timestamptz,
  add column cancelled_by          public.cancel_party,
  add column cancel_reason         text,
  add column deposit_outcome       public.deposit_outcome,
  add column deposit_outcome_minor bigint,
  add column closed_at             timestamptz,
  add column closed_by             uuid,
  add constraint appointments_rescheduled_from_fk foreign key (tenant_id, rescheduled_from)
    references public.appointments (tenant_id, id) on delete restrict,
  add constraint appointments_rescheduled_once unique (rescheduled_from),
  add constraint appointments_credit_applied check (
    credit_applied_minor between 0 and deposit_minor
    and (deposit_status <> 'credit' or credit_applied_minor = deposit_minor)),
  add constraint appointments_reschedule_count check (reschedule_count between 0 and 1000),
  add constraint appointments_cancel_reason check (cancel_reason is null or char_length(cancel_reason) between 1 and 200),
  add constraint appointments_outcome_minor check (deposit_outcome_minor is null or deposit_outcome_minor >= 0),
  -- Un turno cerrado (atendido, faltó, reprogramado) siempre dice qué pasó con la seña;
  -- solo los turnos cerrados tienen resultado.
  add constraint appointments_outcome_when_closed check (
    (status not in ('rescheduled', 'completed', 'no_show') or deposit_outcome is not null)
    and (deposit_outcome is null or status in ('cancelled', 'rescheduled', 'completed', 'no_show'))),
  add constraint appointments_attendance_order check (
    (started_at is null or checked_in_at is null or started_at >= checked_in_at)
    and (finished_at is null or started_at is null or finished_at >= started_at));

alter table public.appointments drop constraint appointments_confirmed_paid;
alter table public.appointments add constraint appointments_confirmed_paid check (
  status <> 'confirmed' or deposit_status in ('paid', 'paid_offline', 'credit', 'transferred'));

create index appointments_closed_client on public.appointments (tenant_id, client_profile_id, status);

comment on column public.appointments.credit_applied_minor is
  'Parte de la seña cubierta con saldo a favor. Mercado Pago cobra deposit_minor − credit_applied_minor.';
comment on column public.appointments.deposit_outcome is
  'Qué pasó con la seña al cerrar el turno. Se fija una sola vez (salvo la corrección de una falta).';

-- Historial: tipos nuevos
alter table public.appointment_events drop constraint appointment_events_type;
alter table public.appointment_events add constraint appointment_events_type check (event_type in (
  'created', 'confirmed', 'cancelled', 'expired', 'rescheduled', 'completed', 'no_show',
  'deposit_paid', 'deposit_paid_offline', 'deposit_credit', 'deposit_transferred',
  'deposit_refunded', 'payment_disputed', 'refunded_offline',
  'checked_in', 'started', 'no_show_corrected', 'rescheduled_in', 'credit_returned'));

-- Devoluciones: motivo nuevo (cancela el estudio) y pago tardío sin el saldo que usaba
alter table public.payment_refunds drop constraint payment_refunds_reason;
alter table public.payment_refunds add constraint payment_refunds_reason check (reason in (
  'duplicate', 'late_slot_taken', 'late_released', 'late_past', 'studio_cancelled', 'late_credit_spent'));

-- ---------------------------------------------------------------------
-- Reglas de cambio (redefinida): lo acordado no cambia; lo registrado al cerrar
-- tampoco; transiciones válidas.
-- ---------------------------------------------------------------------
create or replace function app.guard_appointment() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_correction boolean := coalesce(current_setting('app.no_show_correction', true), '') = 'on';
begin
  if (new.tenant_id, new.code, new.client_profile_id, new.professional_id, new.service_id,
      new.starts_at, new.ends_at, new.occupied_until, new.service_name, new.professional_name,
      new.duration_minutes, new.buffer_minutes, new.price_minor, new.price_is_from, new.currency,
      new.deposit_percent, new.deposit_minor, new.policy_version, new.cancellation_window_hours,
      new.source, new.forced_outside_hours, new.created_by, new.created_at,
      new.credit_applied_minor, new.rescheduled_from, new.reschedule_count)
     is distinct from
     (old.tenant_id, old.code, old.client_profile_id, old.professional_id, old.service_id,
      old.starts_at, old.ends_at, old.occupied_until, old.service_name, old.professional_name,
      old.duration_minutes, old.buffer_minutes, old.price_minor, old.price_is_from, old.currency,
      old.deposit_percent, old.deposit_minor, old.policy_version, old.cancellation_window_hours,
      old.source, old.forced_outside_hours, old.created_by, old.created_at,
      old.credit_applied_minor, old.rescheduled_from, old.reschedule_count) then
    raise exception 'Lo acordado en una reserva no se puede modificar' using errcode = '42501';
  end if;

  -- Lo que ya quedó registrado no se reescribe.
  if (old.checked_in_at is not null and new.checked_in_at is distinct from old.checked_in_at)
     or (old.started_at is not null and new.started_at is distinct from old.started_at)
     or (old.finished_at is not null and new.finished_at is distinct from old.finished_at)
     or (old.cancelled_by is not null and new.cancelled_by is distinct from old.cancelled_by)
     or (old.cancel_reason is not null and new.cancel_reason is distinct from old.cancel_reason)
     or (not v_correction and old.deposit_outcome is not null
         and (new.deposit_outcome, new.deposit_outcome_minor) is distinct from (old.deposit_outcome, old.deposit_outcome_minor))
     or (not v_correction and old.closed_at is not null
         and (new.closed_at, new.closed_by) is distinct from (old.closed_at, old.closed_by)) then
    raise exception 'Lo registrado en este turno no se puede cambiar' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_payment' and new.status in ('confirmed', 'cancelled', 'expired'))
       or (old.status = 'confirmed' and new.status in ('cancelled', 'rescheduled', 'completed', 'no_show'))
       or (old.status = 'expired' and new.status = 'confirmed'
           and coalesce(current_setting('app.late_payment', true), '') = 'on')
       or (old.status = 'no_show' and new.status = 'completed' and v_correction)) then
    raise exception 'Cambio de estado no permitido: % → %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Libro del saldo a favor (solo agregado)
-- ---------------------------------------------------------------------
create table public.client_credit_entries (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  client_profile_id  uuid not null,
  kind               text not null,
  amount_minor       bigint not null,
  currency           char(3) not null,
  expires_at         timestamptz,       -- solo en los lotes (acreditaciones)
  lot_id             uuid,              -- en lo que resta o devuelve: de qué lote
  appointment_id     uuid,
  reason             text,
  created_by         uuid,
  created_at         timestamptz not null default now(),

  constraint client_credit_entries_key unique (tenant_id, client_profile_id, id),
  constraint client_credit_entries_client_fk foreign key (tenant_id, client_profile_id)
    references public.client_profiles (tenant_id, id) on delete restrict,
  constraint client_credit_entries_lot_fk foreign key (tenant_id, client_profile_id, lot_id)
    references public.client_credit_entries (tenant_id, client_profile_id, id) on delete restrict,
  constraint client_credit_entries_appointment_fk foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint client_credit_entries_kind check (kind in (
    'cancellation_credit', 'studio_cancellation_credit', 'manual_credit',     -- lotes (suman)
    'used_in_booking', 'manual_debit', 'expired',                              -- restan de un lote
    'returned_from_booking')),                                                 -- devuelve a un lote
  constraint client_credit_entries_shape check (
    (kind in ('cancellation_credit', 'studio_cancellation_credit', 'manual_credit')
       and amount_minor > 0 and expires_at is not null and lot_id is null)
    or (kind in ('used_in_booking', 'manual_debit', 'expired')
       and amount_minor < 0 and expires_at is null and lot_id is not null)
    or (kind = 'returned_from_booking' and amount_minor > 0 and expires_at is null and lot_id is not null)),
  constraint client_credit_entries_amount check (abs(amount_minor) <= 10000000000),
  constraint client_credit_entries_booking check (
    kind not in ('cancellation_credit', 'studio_cancellation_credit', 'used_in_booking', 'returned_from_booking')
    or appointment_id is not null),
  constraint client_credit_entries_reason check (
    (kind not in ('manual_credit', 'manual_debit') or char_length(btrim(reason)) between 3 and 200)
    and (reason is null or char_length(reason) <= 200))
);
create index client_credit_entries_client on public.client_credit_entries (tenant_id, client_profile_id, created_at);
create index client_credit_entries_lot on public.client_credit_entries (lot_id) where lot_id is not null;
create index client_credit_entries_appointment on public.client_credit_entries (appointment_id) where appointment_id is not null;
create index client_credit_entries_expiring on public.client_credit_entries (expires_at) where lot_id is null;
-- Una sola acreditación por turno cancelado (la cancelación se registra una vez).
create unique index client_credit_entries_one_credit_per_booking on public.client_credit_entries (appointment_id)
  where kind in ('cancellation_credit', 'studio_cancellation_credit');

comment on table public.client_credit_entries is
  'Saldo a favor de una clienta en UN estudio. Solo agregado: se corrige con otro movimiento.';

create trigger client_credit_entries_append_only before update or delete on public.client_credit_entries
  for each row execute function app.prevent_mutation();
create trigger client_credit_entries_no_truncate before truncate on public.client_credit_entries
  for each statement execute function app.prevent_mutation();

revoke all on public.client_credit_entries from anon, authenticated;
grant select on public.client_credit_entries to authenticated;
grant all on public.client_credit_entries to service_role;

alter table public.client_credit_entries enable row level security;
alter table public.client_credit_entries force row level security;

-- La clienta ve los suyos; el equipo con clients.read, los del estudio. Sin escritura
-- directa (todo por funciones). Cleo Admin, nada.
create policy client_credit_entries_select on public.client_credit_entries for select to authenticated
  using (app.is_my_client_profile(client_profile_id) or app.has_permission(tenant_id, 'clients.read'));

-- ---------------------------------------------------------------------
-- Funciones internas del saldo
-- ---------------------------------------------------------------------
-- Lotes de una clienta con lo que les queda
create or replace function app.credit_lots(p_tenant uuid, p_client uuid)
returns table (lot_id uuid, kind text, original_minor bigint, remaining_minor bigint, currency char(3),
               expires_at timestamptz, created_at timestamptz, appointment_id uuid)
language sql stable security definer set search_path = '' as $$
  select l.id, l.kind, l.amount_minor, (l.amount_minor + coalesce(sum(e.amount_minor), 0))::bigint,
         l.currency, l.expires_at, l.created_at, l.appointment_id
  from public.client_credit_entries l
  left join public.client_credit_entries e on e.lot_id = l.id
  where l.tenant_id = p_tenant and l.client_profile_id = p_client and l.lot_id is null
  group by l.id
$$;
revoke execute on function app.credit_lots(uuid, uuid) from public, anon, authenticated;

-- Saldo disponible ahora (lotes sin vencer). Un lote vencido deja de contar en el
-- momento, aunque la tarea diaria todavía no haya escrito su "vencido".
create or replace function app.credit_available(p_tenant uuid, p_client uuid)
returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(remaining_minor), 0)::bigint
  from app.credit_lots(p_tenant, p_client)
  where expires_at > now() and remaining_minor > 0
$$;
revoke execute on function app.credit_available(uuid, uuid) from public, anon, authenticated;

-- Vencimiento: fin del día local "hoy + N días" (se puede usar todo ese día).
create or replace function app.credit_expiry(p_tenant uuid, p_days integer)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (((now() at time zone t.timezone)::date + p_days + 1)::timestamp) at time zone t.timezone
  from public.tenants t where t.id = p_tenant
$$;
revoke execute on function app.credit_expiry(uuid, integer) from public, anon, authenticated;

-- Acredita un lote. p_days: los de la política aceptada (o los vigentes en un ajuste).
create or replace function app.add_credit_lot(
  p_tenant uuid, p_client uuid, p_kind text, p_amount bigint, p_appointment uuid, p_days integer, p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.client_credit_entries
    (tenant_id, client_profile_id, kind, amount_minor, currency, expires_at, appointment_id, reason, created_by)
  select p_tenant, p_client, p_kind, p_amount, t.currency, app.credit_expiry(p_tenant, p_days),
         p_appointment, nullif(btrim(p_reason), ''), auth.uid()
  from public.tenants t where t.id = p_tenant
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.add_credit_lot(uuid, uuid, text, bigint, uuid, integer, text) from public, anon, authenticated;

-- Resta saldo (uso en una reserva o ajuste manual), primero de lo que vence antes.
-- Bloquea la ficha de la clienta: dos reservas simultáneas no gastan el mismo saldo.
-- Devuelve cuánto pudo restar (<= p_amount).
create or replace function app.consume_credit(
  p_tenant uuid, p_client uuid, p_amount bigint, p_kind text, p_appointment uuid, p_reason text
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_left bigint := p_amount;
  v_take bigint;
  v_lot  record;
begin
  if p_amount <= 0 then return 0; end if;
  perform 1 from public.client_profiles where id = p_client and tenant_id = p_tenant for update;
  for v_lot in
    select l.lot_id, l.remaining_minor, l.currency from app.credit_lots(p_tenant, p_client) l
    where l.expires_at > now() and l.remaining_minor > 0
    order by l.expires_at, l.created_at, l.lot_id
  loop
    v_take := least(v_lot.remaining_minor, v_left);
    insert into public.client_credit_entries
      (tenant_id, client_profile_id, kind, amount_minor, currency, lot_id, appointment_id, reason, created_by)
    values (p_tenant, p_client, p_kind, -v_take, v_lot.currency, v_lot.lot_id, p_appointment,
            nullif(btrim(p_reason), ''), auth.uid());
    v_left := v_left - v_take;
    exit when v_left = 0;
  end loop;
  return p_amount - v_left;
end $$;
revoke execute on function app.consume_credit(uuid, uuid, bigint, text, uuid, text) from public, anon, authenticated;

-- Si una reserva que usó saldo vence o se libera, el saldo vuelve a SU lote (con su
-- misma fecha de vencimiento). Idempotente: devuelve solo lo que falta devolver.
create or replace function app.return_booking_credit(p_appointment uuid)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint := 0;
  v_row record;
begin
  for v_row in
    select e.tenant_id, e.client_profile_id, e.lot_id, e.currency, -sum(e.amount_minor) as pending
    from public.client_credit_entries e
    where e.appointment_id = p_appointment and e.kind in ('used_in_booking', 'returned_from_booking')
    group by e.tenant_id, e.client_profile_id, e.lot_id, e.currency
    having -sum(e.amount_minor) > 0
  loop
    insert into public.client_credit_entries
      (tenant_id, client_profile_id, kind, amount_minor, currency, lot_id, appointment_id, created_by)
    values (v_row.tenant_id, v_row.client_profile_id, 'returned_from_booking', v_row.pending, v_row.currency,
            v_row.lot_id, p_appointment, auth.uid());
    v_total := v_total + v_row.pending;
  end loop;
  return v_total;
end $$;
revoke execute on function app.return_booking_credit(uuid) from public, anon, authenticated;

create or replace function app.return_credit_on_release() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_back bigint;
begin
  v_back := app.return_booking_credit(new.id);
  if v_back > 0 then
    perform app.appointment_note(new.id, 'credit_returned', jsonb_build_object('amount_minor', v_back));
  end if;
  return null;
end $$;

create trigger appointments_return_credit after update of status on public.appointments
  for each row
  when (old.status = 'pending_payment' and new.status in ('expired', 'cancelled') and new.credit_applied_minor > 0)
  execute function app.return_credit_on_release();

-- Escribe el "vencido" de los lotes que vencieron con saldo (tarea diaria). Bloquea la
-- ficha de cada clienta para no cruzarse con un uso simultáneo.
create or replace function app.expire_credits()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_cli record;
  v_lot record;
begin
  for v_cli in
    select distinct l.tenant_id, l.client_profile_id
    from public.client_credit_entries l
    where l.lot_id is null and l.expires_at <= now()
  loop
    perform 1 from public.client_profiles where id = v_cli.client_profile_id for update;
    for v_lot in
      select c.lot_id, c.remaining_minor, c.currency from app.credit_lots(v_cli.tenant_id, v_cli.client_profile_id) c
      where c.expires_at <= now() and c.remaining_minor > 0
    loop
      insert into public.client_credit_entries
        (tenant_id, client_profile_id, kind, amount_minor, currency, lot_id)
      values (v_cli.tenant_id, v_cli.client_profile_id, 'expired', -v_lot.remaining_minor, v_lot.currency, v_lot.lot_id);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;
revoke execute on function app.expire_credits() from public, anon, authenticated;

-- Lo que falta pagar de la seña (lo cobra Mercado Pago o el estudio)
create or replace function app.deposit_due_minor(p_appt public.appointments)
returns bigint
language sql immutable set search_path = '' as $$
  select p_appt.deposit_minor - p_appt.credit_applied_minor
$$;
revoke execute on function app.deposit_due_minor(public.appointments) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- app.create_appointment (redefinida): usa el saldo a favor automáticamente (C9).
-- Si cubre toda la seña, la reserva queda confirmada sin pasar por Mercado Pago.
-- ---------------------------------------------------------------------
create or replace function app.create_appointment(
  p_tenant uuid,
  p_client_profile uuid,
  p_service uuid,
  p_professional uuid,            -- null = "cualquiera disponible" (B4)
  p_starts_at timestamptz,
  p_source public.appointment_source,
  p_force_outside_hours boolean,  -- solo panel (B11): saltea horario y bloqueos, nunca la superposición
  p_paid_offline_method text,     -- null = esperando pago; 'transfer' | 'cash' = seña ya cobrada (panel)
  p_client_note text
) returns public.appointments
language plpgsql security definer set search_path = '' as $$
declare
  v_settings   public.tenant_settings%rowtype;
  v_tenant     public.tenants%rowtype;
  v_service    public.services%rowtype;
  v_cand       record;
  v_row        public.appointments%rowtype;
  v_ok         boolean;
  v_dur        integer;
  v_price      bigint;
  v_pct        smallint;
  v_deposit_minor bigint;
  v_credit     bigint;
  v_status     public.appointment_status;
  v_deposit    public.deposit_status;
  v_tries      integer;
  v_conflict   boolean := false;
  v_constraint text;
  v_candidates integer := 0;
begin
  select * into v_tenant from public.tenants where id = p_tenant;
  select * into v_settings from public.tenant_settings where tenant_id = p_tenant;
  if v_tenant.id is null or v_tenant.status not in ('trial', 'active', 'past_due') then
    raise exception 'Este estudio no está disponible' using errcode = 'P0002';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'Elegí un horario que todavía no haya pasado' using errcode = '22023';
  end if;
  if p_source = 'online' then
    if p_starts_at < now() + make_interval(mins => v_settings.booking_min_notice_minutes) then
      raise exception 'Para reservar online se necesitan al menos % de anticipación',
        case when v_settings.booking_min_notice_minutes % 60 = 0
             then (v_settings.booking_min_notice_minutes / 60) || ' horas'
             else v_settings.booking_min_notice_minutes || ' minutos' end
        using errcode = '22023';
    end if;
    if p_starts_at > now() + make_interval(days => v_settings.booking_horizon_days) then
      raise exception 'Se puede reservar online hasta % días adelante', v_settings.booking_horizon_days using errcode = '22023';
    end if;
  end if;
  if p_client_note is not null and char_length(p_client_note) > 300 then
    raise exception 'La nota puede tener hasta 300 caracteres' using errcode = '22023';
  end if;

  if p_source = 'online' then
    v_service := app.bookable_service(p_tenant, p_service);
  else
    select * into v_service from public.services
    where id = p_service and tenant_id = p_tenant and is_active and archived_at is null;
  end if;
  if v_service.id is null then
    raise exception 'Ese servicio no se puede reservar' using errcode = 'P0002';
  end if;

  for v_cand in
    select p.id, p.display_name,
           coalesce(ps.duration_minutes_override, v_service.duration_minutes) as duration_minutes,
           coalesce(ps.price_minor_override, v_service.price_minor) as price_minor
    from public.professional_services ps
    join public.professionals p on p.id = ps.professional_id
    where ps.tenant_id = p_tenant and ps.service_id = v_service.id
      and (p_professional is null or p.id = p_professional)
      and p.is_active and p.archived_at is null
      and (p_source = 'staff' or p.accepts_online_booking)
    order by (select count(*) from public.appointments a
              where a.professional_id = p.id and a.status in ('pending_payment', 'confirmed')
                and (a.starts_at at time zone v_tenant.timezone)::date = (p_starts_at at time zone v_tenant.timezone)::date),
             p.position, p.display_name
  loop
    v_candidates := v_candidates + 1;
    perform app.expire_holds(v_cand.id, tstzrange(p_starts_at - interval '1 day', p_starts_at + interval '1 day'));

    if p_force_outside_hours then
      v_ok := true;
    elsif p_source = 'online' then
      v_ok := exists (select 1 from app.free_slots(p_tenant, v_service.id, v_cand.id, p_starts_at,
                                                    p_starts_at + interval '1 minute', true) f
                      where f.starts_at = p_starts_at);
    else
      v_ok := app.staff_slot_ok(p_tenant, v_cand.id, p_starts_at, v_cand.duration_minutes, v_service.buffer_after_minutes);
    end if;
    continue when not v_ok;

    v_dur := v_cand.duration_minutes;
    v_price := v_cand.price_minor;
    v_pct := coalesce(v_service.deposit_percent, v_settings.deposit_percent);
    v_deposit_minor := (ceil(v_price * v_pct / 10000.0) * 100)::bigint;

    -- Saldo a favor: bloquea la ficha (dos reservas a la vez no usan el mismo saldo).
    perform 1 from public.client_profiles where id = p_client_profile and tenant_id = p_tenant for update;
    v_credit := least(app.credit_available(p_tenant, p_client_profile), v_deposit_minor);

    if v_credit > 0 and v_credit = v_deposit_minor then
      v_status := 'confirmed';
      v_deposit := 'credit';
    elsif p_paid_offline_method is null then
      v_status := 'pending_payment';
      v_deposit := 'pending';
    else
      v_status := 'confirmed';
      v_deposit := 'paid_offline';
    end if;

    v_tries := 0;
    loop
      begin
        perform set_config('app.event_detail',
          jsonb_strip_nulls(jsonb_build_object(
            'payment_method', case when v_deposit = 'paid_offline' then p_paid_offline_method end,
            'any_professional', p_professional is null,
            'credit_applied_minor', nullif(v_credit, 0)))::text, true);
        insert into public.appointments (
          tenant_id, code, client_profile_id, professional_id, service_id,
          starts_at, ends_at, occupied_until,
          service_name, professional_name, duration_minutes, buffer_minutes,
          price_minor, price_is_from, currency, deposit_percent, deposit_minor,
          policy_version, cancellation_window_hours,
          status, deposit_status, hold_expires_at, source, forced_outside_hours, client_note, created_by,
          credit_applied_minor)
        values (
          p_tenant, app.generate_booking_code(), p_client_profile, v_cand.id, v_service.id,
          p_starts_at, p_starts_at + make_interval(mins => v_dur),
          p_starts_at + make_interval(mins => v_dur + v_service.buffer_after_minutes),
          v_service.name, v_cand.display_name, v_dur, v_service.buffer_after_minutes,
          v_price, v_service.price_is_from, v_tenant.currency, v_pct, v_deposit_minor,
          v_settings.policy_version, v_settings.cancellation_window_hours,
          v_status, v_deposit,
          case when v_status = 'pending_payment'
               then least(now() + make_interval(mins => v_settings.booking_hold_minutes), p_starts_at) end,
          p_source, coalesce(p_force_outside_hours, false), nullif(btrim(p_client_note), ''), auth.uid(),
          v_credit)
        returning * into v_row;
        perform set_config('app.event_detail', '', true);
        if v_credit > 0 and app.consume_credit(p_tenant, p_client_profile, v_credit, 'used_in_booking', v_row.id, null) <> v_credit then
          raise exception 'No se pudo usar el saldo a favor' using errcode = '40001';
        end if;
        return v_row;
      exception
        when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint <> 'appointments_code_unique' then
            raise;
          end if;
          v_tries := v_tries + 1;
          if v_tries > 5 then raise; end if;
        when exclusion_violation then
          v_conflict := true;
          exit;
      end;
    end loop;
  end loop;

  if v_conflict then
    raise exception 'Ese horario se acaba de ocupar. Elegí otro.' using errcode = '23P01';
  end if;
  if v_candidates = 0 then
    if p_professional is null then
      raise exception 'Ninguna profesional hace ese servicio' using errcode = 'P0002';
    end if;
    raise exception 'Esa profesional no hace ese servicio' using errcode = 'P0002';
  end if;
  raise exception 'Ese horario no está disponible. Elegí otro.' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------
-- Mercado Pago: se cobra y se verifica solo lo que falta (seña − saldo usado)
-- ---------------------------------------------------------------------
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
    raise exception 'La reserva ya no está activa (%)',
      case when v_row.status = 'pending_payment' then 'expired' else v_row.status::text end using errcode = '22023';
  end if;
  if p_amount_minor is distinct from app.deposit_due_minor(v_row) then
    raise exception 'El monto pagado (%) no coincide con la seña (%)', p_amount_minor, app.deposit_due_minor(v_row) using errcode = '22023';
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

  -- El monto lo fija la preferencia (seña − saldo usado): si no coincide, no se confirma nada.
  if v_pay.amount_minor <> app.deposit_due_minor(v_appt) or v_pay.currency <> v_appt.currency then
    update public.payments set outcome = 'needs_review' where id = v_pay.id;
    perform app.payment_event(v_pay, 'needs_review', v_pay.status, v_pay.status,
      jsonb_build_object('expected_minor', app.deposit_due_minor(v_appt), 'currency', v_appt.currency));
    return 'needs_review';
  end if;

  -- Ya pagada (otro pago, cobrada en el estudio o con saldo): se devuelve este.
  if v_appt.deposit_status in ('paid', 'paid_offline', 'credit', 'transferred') then
    return app.request_refund(v_pay, 'duplicate');
  end if;
  -- La clienta la liberó, el estudio la canceló o ya no está activa.
  if v_appt.status in ('cancelled', 'rescheduled', 'completed', 'no_show') then
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

  -- Tarde con saldo usado: al vencer, el saldo volvió a la clienta. Se vuelve a tomar;
  -- si ya no lo tiene (lo usó o venció), no se puede confirmar → devolución.
  if v_appt.credit_applied_minor > 0 then
    perform 1 from public.client_profiles where id = v_appt.client_profile_id for update;
    if app.credit_available(v_appt.tenant_id, v_appt.client_profile_id) < v_appt.credit_applied_minor then
      return app.request_refund(v_pay, 'late_credit_spent');
    end if;
  end if;

  -- Tarde con el turno en el futuro: se confirma si el horario sigue libre.
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
  if v_appt.credit_applied_minor > 0 then
    perform app.consume_credit(v_appt.tenant_id, v_appt.client_profile_id, v_appt.credit_applied_minor,
                               'used_in_booking', v_appt.id, null);
  end if;
  update public.payments set outcome = 'late_confirmed' where id = v_pay.id;
  update public.payment_intents set status = 'paid' where id = v_pay.intent_id;
  perform app.payment_event(v_pay, 'late_confirmed', v_pay.status, v_pay.status, jsonb_build_object('appointment_code', v_appt.code));
  return 'late_confirmed';
end $$;
revoke execute on function app.apply_mp_payment(uuid) from public, anon, authenticated;

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
  v_due    bigint;
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
  v_due := app.deposit_due_minor(v_appt);
  select t.name into v_studio from public.tenants t where t.id = v_appt.tenant_id;
  select a.id into v_acc from public.payment_accounts a where a.tenant_id = v_appt.tenant_id and a.status = 'connected';
  if v_acc is null then
    raise exception 'El estudio todavía no puede cobrar online. Escribile para pagar la seña' using errcode = '22023';
  end if;

  select * into v_intent from public.payment_intents i where i.appointment_id = v_appt.id and i.status = 'open';
  if v_intent.id is not null and (v_intent.account_id <> v_acc or v_intent.amount_minor <> v_due) then
    update public.payment_intents set status = 'cancelled' where id = v_intent.id;
    v_intent := null;
  end if;
  if v_intent.id is null then
    insert into public.payment_intents (tenant_id, appointment_id, account_id, amount_minor, currency, expires_at, created_by)
    values (v_appt.tenant_id, v_appt.id, v_acc, v_due, v_appt.currency, v_appt.hold_expires_at, auth.uid())
    returning * into v_intent;
  end if;
  return query select v_intent.id, v_intent.account_id, v_intent.checkout_url, v_intent.amount_minor,
                      v_intent.currency::text, v_intent.expires_at, v_appt.service_name, v_studio, v_appt.code;
end $$;

-- ---------------------------------------------------------------------
-- Cancelar con seña (núcleo). Quien llama ya validó permisos y bloqueó nada:
-- acá se bloquea la reserva y se decide con app.deposit_terms.
--   p_by:          'client' (regla de 24 h) | 'studio' (C5: nunca pierde)
--   p_refund_mode: solo si cancela el estudio: 'credit' | 'refund'
--   p_expected:    la consecuencia que vio la pantalla ('credited' | 'forfeited' | 'refunded').
--                  Si ya no coincide, no se hace nada (C1, §1 del plan).
-- ---------------------------------------------------------------------
create or replace function app.cancel_appointment(
  p_appointment uuid, p_by public.cancel_party, p_reason text, p_refund_mode text,
  p_refund_method text, p_expected text, p_origin text
) returns table (outcome public.deposit_outcome, amount_minor bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_appt    public.appointments%rowtype;
  v_terms   record;
  v_outcome public.deposit_outcome;
  v_amount  bigint;
  v_days    integer;
  v_pay     public.payments%rowtype;
  v_reason  text := nullif(btrim(p_reason), '');
begin
  select * into v_appt from public.appointments where id = p_appointment for update;
  if v_appt.id is null then
    raise exception 'No encontramos ese turno' using errcode = 'P0002';
  end if;
  if v_appt.status = 'pending_payment' then
    raise exception 'Este turno todavía espera el pago de la seña: se libera sin consecuencias' using errcode = '22023';
  end if;
  if v_appt.status <> 'confirmed' then
    raise exception 'Este turno ya está cerrado y no se puede cancelar' using errcode = '22023';
  end if;
  if p_origin = 'site' and v_appt.starts_at <= now() then
    raise exception 'El turno ya empezó: escribile al estudio' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'El motivo puede tener hasta 200 caracteres' using errcode = '22023';
  end if;

  select * into v_terms from app.deposit_terms(v_appt.id, now());

  if p_by = 'client' then
    v_outcome := case when v_terms.keeps_deposit then 'credited' else 'forfeited' end;
    v_amount := v_terms.amount_minor;
  else
    if v_reason is null or char_length(v_reason) < 3 then
      raise exception 'Escribí el motivo: la clienta lo va a ver' using errcode = '22023';
    end if;
    if p_refund_mode not in ('credit', 'refund') then
      raise exception 'Elegí si la clienta prefiere saldo a favor o la devolución' using errcode = '22023';
    end if;
    v_outcome := case when p_refund_mode = 'refund' then 'refunded' else 'credited' end;
    v_amount := v_terms.amount_minor;
  end if;

  if p_expected is distinct from v_outcome::text then
    if v_outcome = 'forfeited' then
      raise exception 'Pasó el plazo: ahora la seña se pierde. Revisá y confirmá de nuevo.' using errcode = '22023';
    end if;
    raise exception 'Cambió lo que pasa con la seña. Revisá y confirmá de nuevo.' using errcode = '22023';
  end if;

  if v_outcome = 'refunded' then
    -- Solo vuelve como dinero lo que se pagó en dinero; lo que se había cubierto con
    -- saldo vuelve como saldo (más abajo).
    if v_appt.deposit_status = 'paid_offline' and coalesce(p_refund_method, '') not in ('transfer', 'cash') then
      raise exception 'Indicá cómo le devolviste la seña (transferencia o efectivo)' using errcode = '22023';
    end if;
    v_amount := greatest(v_terms.amount_minor - v_appt.credit_applied_minor, 0);
  end if;

  perform set_config('app.event_detail', jsonb_strip_nulls(jsonb_build_object(
    'by', p_by, 'origin', p_origin, 'outcome', v_outcome, 'amount_minor', v_amount,
    'deadline', v_terms.deadline, 'at', now(), 'note', v_reason))::text, true);
  update public.appointments
     set status = 'cancelled', cancelled_by = p_by, cancel_reason = v_reason,
         deposit_outcome = v_outcome, deposit_outcome_minor = v_amount,
         closed_at = now(), closed_by = auth.uid()
   where id = v_appt.id;
  perform set_config('app.event_detail', '', true);

  select p.credit_expiry_days into v_days
  from public.tenant_policy_versions p where p.tenant_id = v_appt.tenant_id and p.version = v_appt.policy_version;

  if v_outcome = 'credited' and v_amount > 0 then
    perform app.add_credit_lot(v_appt.tenant_id, v_appt.client_profile_id,
      case when p_by = 'studio' then 'studio_cancellation_credit' else 'cancellation_credit' end,
      v_amount, v_appt.id, v_days, null);
  elsif v_outcome = 'refunded' then
    if v_appt.credit_applied_minor > 0 then
      perform app.add_credit_lot(v_appt.tenant_id, v_appt.client_profile_id, 'studio_cancellation_credit',
        v_appt.credit_applied_minor, v_appt.id, v_days, null);
    end if;
    for v_pay in
      select * from public.payments p
      where p.appointment_id = v_appt.id and p.outcome in ('applied', 'late_confirmed') and p.status = 'approved'
      for update
    loop
      perform app.request_refund(v_pay, 'studio_cancelled');
    end loop;
    if v_appt.deposit_status = 'paid_offline' and v_amount > 0 then
      perform app.appointment_note(v_appt.id, 'refunded_offline',
        jsonb_build_object('method', p_refund_method, 'amount_minor', v_amount));
    end if;
  end if;

  return query select v_outcome, v_amount;
end $$;
revoke execute on function app.cancel_appointment(uuid, public.cancel_party, text, text, text, text, text) from public, anon, authenticated;

-- Lo que la reserva permite (para mostrar ANTES de confirmar). Base común.
create or replace function app.booking_terms(p_appointment uuid)
returns table (
  status public.appointment_status, starts_at timestamptz, deadline timestamptz, keeps_deposit boolean,
  deposit_minor bigint, amount_minor bigint, currency text, cancellation_window_hours smallint,
  can_cancel boolean, can_reschedule_online boolean, reschedule_count smallint
)
language sql stable security definer set search_path = '' as $$
  select a.status, a.starts_at, t.deadline, t.keeps_deposit, t.deposit_minor, t.amount_minor, a.currency::text,
         a.cancellation_window_hours,
         a.status = 'confirmed' and a.starts_at > now(),
         a.status = 'confirmed' and a.starts_at > now() and a.reschedule_count < 1,
         a.reschedule_count
  from public.appointments a, app.deposit_terms(a.id, now()) t
  where a.id = p_appointment
$$;
revoke execute on function app.booking_terms(uuid) from public, anon, authenticated;

-- Clienta: una reserva suya por código, en el estudio del host.
create or replace function app.my_appointment_id(p_slug text, p_code text)
returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  where t.slug = lower(btrim(p_slug)) and a.code = upper(btrim(p_code)) and c.user_id = auth.uid()
$$;
revoke execute on function app.my_appointment_id(text, text) from public, anon, authenticated;

create or replace function public.get_my_booking_terms(p_slug text, p_code text)
returns table (
  status public.appointment_status, starts_at timestamptz, deadline timestamptz, keeps_deposit boolean,
  deposit_minor bigint, amount_minor bigint, currency text, cancellation_window_hours smallint,
  can_cancel boolean, can_reschedule_online boolean, reschedule_count smallint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := app.my_appointment_id(p_slug, p_code);
begin
  if v_id is null then
    raise exception 'No encontramos una reserva tuya con ese código' using errcode = 'P0002';
  end if;
  return query select * from app.booking_terms(v_id);
end $$;
revoke execute on function public.get_my_booking_terms(text, text) from public, anon;
grant execute on function public.get_my_booking_terms(text, text) to authenticated;

create or replace function public.cancel_my_booking(p_slug text, p_code text, p_expected text)
returns table (outcome public.deposit_outcome, amount_minor bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := app.my_appointment_id(p_slug, p_code);
  v_tenant uuid;
begin
  if v_id is null then
    raise exception 'No encontramos una reserva tuya con ese código' using errcode = 'P0002';
  end if;
  select tenant_id into v_tenant from public.appointments where id = v_id;
  if not app.tenant_is_writable(v_tenant) then
    raise exception 'Este estudio no está disponible' using errcode = 'P0002';
  end if;
  return query select * from app.cancel_appointment(v_id, 'client', null, null, null, p_expected, 'site');
end $$;
revoke execute on function public.cancel_my_booking(text, text, text) from public, anon;
grant execute on function public.cancel_my_booking(text, text, text) to authenticated;

-- Panel
create or replace function public.get_booking_terms(p_appointment uuid)
returns table (
  status public.appointment_status, starts_at timestamptz, deadline timestamptz, keeps_deposit boolean,
  deposit_minor bigint, amount_minor bigint, currency text, cancellation_window_hours smallint,
  can_cancel boolean, can_reschedule_online boolean, reschedule_count smallint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_appt public.appointments%rowtype;
begin
  select * into v_appt from public.appointments where id = p_appointment;
  if v_appt.id is null or not (app.has_permission(v_appt.tenant_id, 'agenda.read_all')
       or (app.has_permission(v_appt.tenant_id, 'agenda.read_own')
           and v_appt.professional_id = app.my_professional_id(v_appt.tenant_id))) then
    raise exception 'No encontramos ese turno' using errcode = 'P0002';
  end if;
  return query select * from app.booking_terms(p_appointment);
end $$;
revoke execute on function public.get_booking_terms(uuid) from public, anon;
grant execute on function public.get_booking_terms(uuid) to authenticated;

create or replace function public.cancel_booking(
  p_appointment uuid, p_by text, p_reason text, p_refund_mode text, p_refund_method text, p_expected text
) returns table (outcome public.deposit_outcome, amount_minor bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.appointments where id = p_appointment;
  if v_tenant is null or not app.can(v_tenant, 'agenda.manage') then
    raise exception 'No tenés permiso para cancelar este turno' using errcode = '42501';
  end if;
  if p_by is null or p_by not in ('client', 'studio') then
    raise exception 'Indicá quién cancela' using errcode = '22023';
  end if;
  if p_by = 'studio' and p_refund_mode = 'refund' and not app.can(v_tenant, 'cash.manage') then
    raise exception 'Para devolver el dinero hace falta permiso de caja. Elegí saldo a favor.' using errcode = '42501';
  end if;
  return query select * from app.cancel_appointment(p_appointment, p_by::public.cancel_party, p_reason,
                                                    p_refund_mode, p_refund_method, p_expected, 'panel');
end $$;
revoke execute on function public.cancel_booking(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Saldo a favor: lo que ve la clienta y el equipo
-- ---------------------------------------------------------------------
-- Clienta: lo que le queda, por fecha de vencimiento (C10)
create or replace function public.my_credit(p_slug text)
returns table (remaining_minor bigint, original_minor bigint, currency text, expires_at timestamptz,
               kind text, appointment_code text)
language sql stable security definer set search_path = '' as $$
  select l.remaining_minor, l.original_minor, l.currency::text, l.expires_at, l.kind, a.code
  from public.tenants t
  join public.client_profiles c on c.tenant_id = t.id and c.user_id = auth.uid()
  cross join lateral app.credit_lots(t.id, c.id) l
  left join public.appointments a on a.id = l.appointment_id
  where t.slug = lower(btrim(p_slug)) and l.remaining_minor > 0 and l.expires_at > now()
  order by l.expires_at, l.created_at
$$;
revoke execute on function public.my_credit(text) from public, anon;
grant execute on function public.my_credit(text) to authenticated;

create or replace function public.my_credit_movements(p_slug text)
returns table (created_at timestamptz, kind text, amount_minor bigint, currency text, expires_at timestamptz,
               appointment_code text)
language sql stable security definer set search_path = '' as $$
  select e.created_at, e.kind, e.amount_minor, e.currency::text,
         coalesce(e.expires_at, l.expires_at), a.code
  from public.tenants t
  join public.client_profiles c on c.tenant_id = t.id and c.user_id = auth.uid()
  join public.client_credit_entries e on e.tenant_id = t.id and e.client_profile_id = c.id
  left join public.client_credit_entries l on l.id = e.lot_id
  left join public.appointments a on a.id = e.appointment_id
  where t.slug = lower(btrim(p_slug))
  order by e.created_at desc, e.id
  limit 200
$$;
revoke execute on function public.my_credit_movements(text) from public, anon;
grant execute on function public.my_credit_movements(text) to authenticated;

-- Equipo (clients.read): lotes y movimientos de una clienta del estudio
create or replace function public.client_credit(p_client uuid)
returns table (lot_id uuid, kind text, original_minor bigint, remaining_minor bigint, currency text,
               expires_at timestamptz, created_at timestamptz, appointment_code text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.has_permission(v_tenant, 'clients.read') then
    raise exception 'No encontramos esa clienta' using errcode = 'P0002';
  end if;
  return query
    select l.lot_id, l.kind, l.original_minor, l.remaining_minor, l.currency::text, l.expires_at, l.created_at, a.code
    from app.credit_lots(v_tenant, p_client) l
    left join public.appointments a on a.id = l.appointment_id
    order by l.expires_at desc;
end $$;
revoke execute on function public.client_credit(uuid) from public, anon;
grant execute on function public.client_credit(uuid) to authenticated;

create or replace function public.adjust_client_credit(p_client uuid, p_amount_minor bigint, p_reason text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_days   integer;
begin
  select tenant_id into v_tenant from public.client_profiles where id = p_client;
  if v_tenant is null or not app.can(v_tenant, 'credits.manage') then
    raise exception 'No tenés permiso para ajustar el saldo' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor = 0 or abs(p_amount_minor) > 100000000 then
    raise exception 'Ingresá un monto válido' using errcode = '22023';
  end if;
  if p_amount_minor % 100 <> 0 then
    raise exception 'El saldo se ajusta en pesos enteros' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'Escribí el motivo del ajuste (de 3 a 200 caracteres)' using errcode = '22023';
  end if;

  perform 1 from public.client_profiles where id = p_client for update;
  if p_amount_minor > 0 then
    select credit_expiry_days into v_days from public.tenant_settings where tenant_id = v_tenant;
    perform app.add_credit_lot(v_tenant, p_client, 'manual_credit', p_amount_minor, null, v_days, p_reason);
  else
    if app.credit_available(v_tenant, p_client) < -p_amount_minor then
      raise exception 'La clienta no tiene ese saldo disponible' using errcode = '22023';
    end if;
    perform app.consume_credit(v_tenant, p_client, -p_amount_minor, 'manual_debit', null, p_reason);
  end if;
  return app.credit_available(v_tenant, p_client);
end $$;
revoke execute on function public.adjust_client_credit(uuid, bigint, text) from public, anon;
grant execute on function public.adjust_client_credit(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Mis turnos (redefinida: más columnas). Cambia el tipo de resultado → drop.
-- ---------------------------------------------------------------------
drop function public.my_bookings(text);
create function public.my_bookings(p_slug text)
returns table (
  code text, service_name text, professional_name text, starts_at timestamptz, ends_at timestamptz,
  duration_minutes integer, status public.appointment_status, deposit_status public.deposit_status,
  price_minor bigint, price_is_from boolean, deposit_minor bigint, currency char(3),
  hold_expires_at timestamptz, cancellation_window_hours smallint, policy_version integer, client_note text,
  credit_applied_minor bigint, deposit_outcome public.deposit_outcome, deposit_outcome_minor bigint,
  cancelled_by public.cancel_party, cancel_reason text, rescheduled_to_code text, rescheduled_from_code text
)
language sql stable security definer set search_path = '' as $$
  select a.code, a.service_name, a.professional_name, a.starts_at, a.ends_at, a.duration_minutes,
         case when a.status = 'pending_payment' and a.hold_expires_at <= now()
              then 'expired'::public.appointment_status else a.status end,
         a.deposit_status, a.price_minor, a.price_is_from, a.deposit_minor, a.currency,
         a.hold_expires_at, a.cancellation_window_hours, a.policy_version, a.client_note,
         a.credit_applied_minor, a.deposit_outcome, a.deposit_outcome_minor, a.cancelled_by, a.cancel_reason,
         (select n.code from public.appointments n where n.rescheduled_from = a.id),
         (select o.code from public.appointments o where o.id = a.rescheduled_from)
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  where t.slug = lower(btrim(p_slug)) and c.user_id = auth.uid()
  order by a.starts_at desc
$$;
revoke execute on function public.my_bookings(text) from public, anon;
grant execute on function public.my_bookings(text) to authenticated;

-- ---------------------------------------------------------------------
-- Tarea diaria: registrar el saldo vencido (pg_cron). La corrección no depende de
-- ella: un lote vencido no cuenta desde el momento en que vence.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron no está disponible: se omite el vencimiento diario del saldo (la corrección no depende de él)';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  if exists (select 1 from cron.job where jobname = 'cleo-expire-credits') then
    perform cron.unschedule('cleo-expire-credits');
  end if;
  perform cron.schedule('cleo-expire-credits', '20 3 * * *', 'select app.expire_credits()');
end $$;
