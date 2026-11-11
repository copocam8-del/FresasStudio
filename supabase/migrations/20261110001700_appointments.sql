-- =====================================================================
-- Cleo · Migración 1700 · Reservas (appointments) e historial
-- Épica 05 (BOOK-05 a BOOK-10, base de BOOK-11)
--
--   * La reserva guarda la FOTO de lo acordado (servicio, profesional, precio,
--     duración, tiempo extra, seña y versión de la política): nunca se recalcula.
--   * El bloqueo temporal es la misma reserva en "pending_payment" con
--     hold_expires_at (ver docs/sprint-4-plan.md §1).
--   * Imposible reservar dos veces: restricción de exclusión sobre el tiempo
--     ocupado (servicio + tiempo extra) de cada profesional, para las reservas
--     activas. La base deja pasar una sola aunque lleguen a la vez.
--   * Estado de la reserva separado del estado de la seña. Toda reserva lleva seña.
--   * Historial automático y de solo agregado (appointment_events).
--   * Sin escritura directa por la API: todo pasa por funciones (migraciones 1800+).
-- =====================================================================

create type public.appointment_status as enum ('pending_payment', 'confirmed', 'cancelled', 'expired');
create type public.deposit_status as enum ('pending', 'paid', 'paid_offline');
create type public.appointment_source as enum ('online', 'staff');

-- Para las claves compuestas hacia client_profiles
alter table public.client_profiles add constraint client_profiles_tenant_id_id_key unique (tenant_id, id);

create table public.appointments (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants (id) on delete restrict,
  code                       text not null,
  client_profile_id          uuid not null,
  professional_id            uuid not null,
  service_id                 uuid not null,
  starts_at                  timestamptz not null,
  ends_at                    timestamptz not null,       -- fin del servicio
  occupied_until             timestamptz not null,       -- fin + tiempo extra
  occupied                   tstzrange generated always as (tstzrange(starts_at, occupied_until, '[)')) stored,
  -- Foto de lo acordado
  service_name               text not null,
  professional_name          text not null,
  duration_minutes           integer not null,
  buffer_minutes             integer not null,
  price_minor                bigint not null,
  price_is_from              boolean not null,
  currency                   char(3) not null,
  deposit_percent            smallint not null,
  deposit_minor              bigint not null,
  policy_version             integer not null,
  cancellation_window_hours  smallint not null,
  -- Estado
  status                     public.appointment_status not null,
  deposit_status             public.deposit_status not null default 'pending',
  hold_expires_at            timestamptz,
  source                     public.appointment_source not null,
  forced_outside_hours       boolean not null default false,
  client_note                text,
  created_by                 uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint appointments_tenant_id_id_key unique (tenant_id, id),
  constraint appointments_code_unique unique (tenant_id, code),
  constraint appointments_client_fk foreign key (tenant_id, client_profile_id)
    references public.client_profiles (tenant_id, id) on delete restrict,
  constraint appointments_professional_fk foreign key (tenant_id, professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint appointments_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete restrict,
  constraint appointments_policy_fk foreign key (tenant_id, policy_version)
    references public.tenant_policy_versions (tenant_id, version) on delete restrict,

  constraint appointments_code_format check (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  constraint appointments_duration check (duration_minutes between 5 and 600 and duration_minutes % 5 = 0),
  constraint appointments_buffer check (buffer_minutes between 0 and 240 and buffer_minutes % 5 = 0),
  constraint appointments_times check (
    ends_at = starts_at + make_interval(mins => duration_minutes)
    and occupied_until = ends_at + make_interval(mins => buffer_minutes)),
  constraint appointments_price check (price_minor between 0 and 10000000000),
  constraint appointments_deposit check (
    deposit_percent between 1 and 100
    -- B8: la seña se redondea hacia arriba al peso entero
    and deposit_minor = (ceil(price_minor * deposit_percent / 10000.0) * 100)::bigint),
  constraint appointments_names check (char_length(service_name) between 2 and 80 and char_length(professional_name) between 2 and 60),
  constraint appointments_client_note check (client_note is null or char_length(client_note) <= 300),
  -- Estado de la reserva vs. estado de la seña
  constraint appointments_pending_has_hold check (status <> 'pending_payment' or (hold_expires_at is not null and deposit_status = 'pending')),
  constraint appointments_confirmed_paid check (status <> 'confirmed' or deposit_status in ('paid', 'paid_offline')),

  -- NO DOBLE RESERVA: dos reservas activas de la misma profesional no se superponen
  -- (incluye el tiempo extra). Canceladas y vencidas no cuentan.
  constraint appointments_no_overlap exclude using gist (
    tenant_id with =, professional_id with =, occupied with &&)
    where (status in ('pending_payment', 'confirmed'))
);
create index appointments_tenant_start on public.appointments (tenant_id, starts_at);
create index appointments_client on public.appointments (tenant_id, client_profile_id, starts_at);
create index appointments_pending_hold on public.appointments (hold_expires_at) where status = 'pending_payment';

comment on table public.appointments is
  'Reservas. Guardan la foto de lo acordado; el bloqueo temporal es la reserva en pending_payment.';

-- ---------------------------------------------------------------------
-- Historial (solo agregado)
-- ---------------------------------------------------------------------
create table public.appointment_events (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  appointment_id  uuid not null,
  event_type      text not null,
  from_status     public.appointment_status,
  to_status       public.appointment_status,
  actor_user_id   uuid,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint appointment_events_appointment_fk foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint appointment_events_type check (event_type in (
    'created', 'confirmed', 'cancelled', 'expired', 'deposit_paid', 'deposit_paid_offline'))
);
create index appointment_events_appointment on public.appointment_events (appointment_id, id);

create trigger appointment_events_append_only before update or delete on public.appointment_events
  for each row execute function app.prevent_mutation();
create trigger appointment_events_no_truncate before truncate on public.appointment_events
  for each statement execute function app.prevent_mutation();

-- ---------------------------------------------------------------------
-- Reglas de cambio (trigger SECURITY INVOKER)
--   * La foto de lo acordado y el horario no cambian (reprogramar = Épica 07).
--   * Transiciones válidas: pending_payment → confirmed | cancelled | expired;
--     confirmed → cancelled. cancelled y expired son finales.
-- ---------------------------------------------------------------------
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
       or (old.status = 'confirmed' and new.status = 'cancelled')) then
    raise exception 'Cambio de estado no permitido: % → %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end $$;

create trigger appointments_guard before update on public.appointments
  for each row execute function app.guard_appointment();
create trigger appointments_updated_at before update on public.appointments
  for each row execute function app.set_updated_at();

-- Historial automático. Las funciones pueden agregar un detalle con
-- set_config('app.event_detail', '{"...": ...}', true) antes de escribir.
create or replace function app.log_appointment_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_detail jsonb := coalesce(nullif(current_setting('app.event_detail', true), '')::jsonb, '{}'::jsonb);
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events (tenant_id, appointment_id, event_type, to_status, actor_user_id, detail)
    values (new.tenant_id, new.id, 'created', new.status, auth.uid(),
            v_detail || jsonb_build_object('source', new.source, 'forced_outside_hours', new.forced_outside_hours));
    if new.deposit_status <> 'pending' then
      insert into public.appointment_events (tenant_id, appointment_id, event_type, to_status, actor_user_id, detail)
      values (new.tenant_id, new.id, 'deposit_' || new.deposit_status, new.status, auth.uid(), v_detail);
    end if;
    return null;
  end if;

  if new.deposit_status is distinct from old.deposit_status and new.deposit_status <> 'pending' then
    insert into public.appointment_events (tenant_id, appointment_id, event_type, from_status, to_status, actor_user_id, detail)
    values (new.tenant_id, new.id, 'deposit_' || new.deposit_status, old.status, new.status, auth.uid(), v_detail);
  end if;
  if new.status is distinct from old.status then
    insert into public.appointment_events (tenant_id, appointment_id, event_type, from_status, to_status, actor_user_id, detail)
    values (new.tenant_id, new.id, new.status::text, old.status, new.status, auth.uid(), v_detail);
  end if;
  return null;
end $$;

create trigger appointments_log after insert or update on public.appointments
  for each row execute function app.log_appointment_event();

-- ---------------------------------------------------------------------
-- Código de reserva: 6 caracteres sin los que se confunden (0/O, 1/I/L)
-- ---------------------------------------------------------------------
create or replace function app.generate_booking_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (get_byte(b, i) % 31), 1), '' order by i)
  from (select extensions.gen_random_bytes(6) as b) r, generate_series(0, 5) i
$$;

-- ---------------------------------------------------------------------
-- Quién ve qué
-- ---------------------------------------------------------------------
-- La profesional vinculada a la cuenta actual en ese estudio (o null)
create or replace function app.my_professional_id(p_tenant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.professionals p
  join public.memberships m on m.id = p.membership_id
  where p.tenant_id = p_tenant and m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function app.is_my_client_profile(p_client_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.client_profiles c where c.id = p_client_profile and c.user_id = auth.uid())
$$;

create or replace function app.can_see_appointment(p_tenant uuid, p_professional uuid, p_client_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_my_client_profile(p_client_profile)
      or app.has_permission(p_tenant, 'agenda.read_all')
      or (app.has_permission(p_tenant, 'agenda.read_own') and p_professional = app.my_professional_id(p_tenant))
$$;

revoke all on public.appointments, public.appointment_events from anon, authenticated;
grant select on public.appointments, public.appointment_events to authenticated;
grant all on public.appointments, public.appointment_events to service_role;

alter table public.appointments enable row level security;
alter table public.appointments force row level security;
alter table public.appointment_events enable row level security;
alter table public.appointment_events force row level security;

-- Clienta: las suyas. Equipo: todas (agenda.read_all) o las propias (agenda.read_own).
-- Cleo Admin: nada. Sin insert/update/delete directos: todo por funciones.
create policy appointments_select on public.appointments for select to authenticated
  using (app.can_see_appointment(tenant_id, professional_id, client_profile_id));

create policy appointment_events_select on public.appointment_events for select to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id));
