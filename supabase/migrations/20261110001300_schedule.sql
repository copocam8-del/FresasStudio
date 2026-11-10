-- =====================================================================
-- Cleo · Migración 1300 · Horarios, descansos y bloqueos
-- Épica 04 (SERV-04, SERV-05)
--
--   * working_hours: franjas por día de la semana (ISO: 1 = lunes … 7 = domingo),
--     en minutos del día en la hora local del estudio (540 = 9:00, 1440 = 24:00).
--     professional_id null = horario del estudio. Los descansos son los huecos
--     entre franjas. La base impide franjas superpuestas (exclusión con btree_gist).
--   * schedule_blocks: vacaciones, feriados, días libres y horarios puntuales, para
--     todo el estudio (professional_id null) o para una profesional.
--   * app.working_intervals: cuándo atiende una profesional en un período:
--       franjas propias (o las del estudio si no tiene: N4)
--       ∩ franjas del estudio (nunca fuera del horario del estudio: N5)
--       − bloqueos del estudio y de la profesional,
--     convertido a horas reales con la zona horaria del estudio.
--     El sprint de reservas le va a restar los turnos ocupados.
-- =====================================================================

create table public.working_hours (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  professional_id  uuid,
  weekday          smallint not null,
  start_minute     smallint not null,
  end_minute       smallint not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint working_hours_professional_fk foreign key (tenant_id, professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint working_hours_weekday check (weekday between 1 and 7),
  constraint working_hours_range check (
    start_minute between 0 and 1435 and end_minute between 5 and 1440
    and start_minute < end_minute and start_minute % 5 = 0 and end_minute % 5 = 0),
  constraint working_hours_no_overlap exclude using gist (
    tenant_id with =,
    (coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    weekday with =,
    (int4range(start_minute, end_minute)) with &&)
);
create index working_hours_lookup on public.working_hours (tenant_id, professional_id, weekday);

create type public.schedule_block_kind as enum ('vacation', 'holiday', 'day_off', 'block');

create table public.schedule_blocks (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  professional_id  uuid,                         -- null = todo el estudio
  kind             public.schedule_block_kind not null,
  period           tstzrange not null,
  all_day          boolean not null default false,
  note             text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint schedule_blocks_professional_fk foreign key (tenant_id, professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint schedule_blocks_period check (
    not isempty(period) and lower(period) is not null and upper(period) is not null
    and upper(period) - lower(period) <= interval '366 days'),
  constraint schedule_blocks_note check (note is null or char_length(note) <= 200)
);
create index schedule_blocks_lookup on public.schedule_blocks using gist (tenant_id, period);

-- ---------------------------------------------------------------------
-- Reglas (triggers SECURITY INVOKER)
-- ---------------------------------------------------------------------

-- N5: la franja de una profesional tiene que caer dentro de una franja del estudio.
-- (Si después se achica el horario del estudio, el cálculo recorta igual.)
create or replace function app.check_working_hours() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id
                           or new.professional_id is distinct from old.professional_id) then
    raise exception 'No se puede mover una franja a otro estudio o profesional' using errcode = '42501';
  end if;
  if new.professional_id is not null and not exists (
       select 1 from public.working_hours s
       where s.tenant_id = new.tenant_id and s.professional_id is null and s.weekday = new.weekday
         and s.start_minute <= new.start_minute and s.end_minute >= new.end_minute) then
    raise exception 'El horario de la profesional tiene que estar dentro del horario del estudio'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger working_hours_check before insert or update on public.working_hours
  for each row execute function app.check_working_hours();

-- Bloqueos: normaliza los de todo el día a días completos en la zona del estudio.
create or replace function app.check_schedule_block() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_tz text;
  v_from date;
  v_to date;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif new.tenant_id <> old.tenant_id or new.professional_id is distinct from old.professional_id then
    raise exception 'No se puede mover un bloqueo a otro estudio o profesional' using errcode = '42501';
  end if;
  new.note := nullif(btrim(new.note), '');

  if new.all_day then
    select t.timezone into v_tz from public.tenants t where t.id = new.tenant_id;
    v_from := (lower(new.period) at time zone v_tz)::date;
    v_to := ((upper(new.period) - interval '1 microsecond') at time zone v_tz)::date + 1;
    new.period := tstzrange(v_from::timestamp at time zone v_tz, v_to::timestamp at time zone v_tz, '[)');
  end if;
  return new;
end $$;

create trigger schedule_blocks_check before insert or update on public.schedule_blocks
  for each row execute function app.check_schedule_block();

create trigger working_hours_updated_at before update on public.working_hours
  for each row execute function app.set_updated_at();
create trigger schedule_blocks_updated_at before update on public.schedule_blocks
  for each row execute function app.set_updated_at();
create trigger audit_working_hours after insert or update or delete on public.working_hours
  for each row execute function app.audit_row();
create trigger audit_schedule_blocks after insert or update or delete on public.schedule_blocks
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Privilegios y RLS
--   Ver: el equipo. Horario del estudio: settings.manage.
--   Horario de profesionales y bloqueos: agenda.manage. (N6: las profesionales no.)
--   Son configuración (no historia): se pueden borrar.
-- ---------------------------------------------------------------------
revoke all on public.working_hours, public.schedule_blocks from anon, authenticated;
grant select, delete on public.working_hours, public.schedule_blocks to authenticated;
grant insert (tenant_id, professional_id, weekday, start_minute, end_minute) on public.working_hours to authenticated;
grant update (weekday, start_minute, end_minute) on public.working_hours to authenticated;
grant insert (tenant_id, professional_id, kind, period, all_day, note) on public.schedule_blocks to authenticated;
grant update (kind, period, all_day, note) on public.schedule_blocks to authenticated;
grant all on public.working_hours, public.schedule_blocks to service_role;

alter table public.working_hours   enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.working_hours   force row level security;
alter table public.schedule_blocks force row level security;

create or replace function app.can_edit_hours(p_tenant uuid, p_professional uuid) returns boolean
language sql stable set search_path = '' as $$
  select case when p_professional is null then app.can(p_tenant, 'settings.manage')
              else app.can(p_tenant, 'agenda.manage') end
$$;

create policy working_hours_select on public.working_hours for select to authenticated
  using (app.is_member(tenant_id));
create policy working_hours_insert on public.working_hours for insert to authenticated
  with check (app.can_edit_hours(tenant_id, professional_id));
create policy working_hours_update on public.working_hours for update to authenticated
  using (app.can_edit_hours(tenant_id, professional_id)) with check (app.can_edit_hours(tenant_id, professional_id));
create policy working_hours_delete on public.working_hours for delete to authenticated
  using (app.can_edit_hours(tenant_id, professional_id));

create policy schedule_blocks_select on public.schedule_blocks for select to authenticated
  using (app.is_member(tenant_id));
create policy schedule_blocks_insert on public.schedule_blocks for insert to authenticated
  with check (app.can(tenant_id, 'agenda.manage'));
create policy schedule_blocks_update on public.schedule_blocks for update to authenticated
  using (app.can(tenant_id, 'agenda.manage')) with check (app.can(tenant_id, 'agenda.manage'));
create policy schedule_blocks_delete on public.schedule_blocks for delete to authenticated
  using (app.can(tenant_id, 'agenda.manage'));

-- ---------------------------------------------------------------------
-- Cuándo atiende (sin turnos todavía). Interna: la usan las RPC de reservas.
-- p_professional null = horario del estudio.
-- ---------------------------------------------------------------------
create or replace function app.working_intervals(
  p_tenant uuid, p_professional uuid, p_from timestamptz, p_to timestamptz
) returns setof tstzrange
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz       text;
  v_days     date[];
  v_studio   tstzmultirange;
  v_own      tstzmultirange;
  v_blocks   tstzmultirange;
  v_result   tstzmultirange;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    return;
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant;
  if v_tz is null then
    raise exception 'Estudio inexistente' using errcode = 'P0002';
  end if;
  if p_professional is not null and not exists (
       select 1 from public.professionals p where p.id = p_professional and p.tenant_id = p_tenant) then
    raise exception 'La profesional no es de este estudio' using errcode = 'P0002';
  end if;

  -- Días locales que tocan el período (uno de margen por las franjas que cruzan medianoche)
  select array_agg(d::date) into v_days
  from generate_series((p_from at time zone v_tz)::date - 1, (p_to at time zone v_tz)::date, interval '1 day') d;

  select coalesce(range_agg(tstzrange(
           (d + make_interval(mins => w.start_minute)) at time zone v_tz,
           (d + make_interval(mins => w.end_minute)) at time zone v_tz, '[)')), '{}')
    into v_studio
  from unnest(v_days) d
  join public.working_hours w
    on w.tenant_id = p_tenant and w.professional_id is null and w.weekday = extract(isodow from d);

  if p_professional is not null and exists (
       select 1 from public.working_hours w where w.tenant_id = p_tenant and w.professional_id = p_professional) then
    select coalesce(range_agg(tstzrange(
             (d + make_interval(mins => w.start_minute)) at time zone v_tz,
             (d + make_interval(mins => w.end_minute)) at time zone v_tz, '[)')), '{}')
      into v_own
    from unnest(v_days) d
    join public.working_hours w
      on w.tenant_id = p_tenant and w.professional_id = p_professional and w.weekday = extract(isodow from d);
    v_result := v_own * v_studio;                     -- N5
  else
    v_result := v_studio;                             -- N4 (o el estudio)
  end if;

  select coalesce(range_agg(b.period), '{}') into v_blocks
  from public.schedule_blocks b
  where b.tenant_id = p_tenant
    and (b.professional_id is null or b.professional_id = p_professional)
    and b.period && tstzrange(p_from, p_to, '[)');

  v_result := (v_result - v_blocks) * tstzmultirange(tstzrange(p_from, p_to, '[)'));

  return query select r from unnest(v_result) r order by lower(r);
end $$;
revoke execute on function app.working_intervals(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
