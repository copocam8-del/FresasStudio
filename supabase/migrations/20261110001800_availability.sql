-- =====================================================================
-- Cleo · Migración 1800 · Disponibilidad (siempre en el servidor)
-- Épica 05 (BOOK-01 a BOOK-03)
--
-- Un horario se ofrece si:
--   * la profesional atiende (app.working_intervals: horario, descansos, bloqueos,
--     zona horaria del estudio) y el SERVICIO entra completo en esa franja (B12:
--     el tiempo extra puede pasar el cierre o el descanso);
--   * servicio + tiempo extra no pisan otra reserva activa (los bloqueos temporales
--     vencidos no cuentan);
--   * está alineado al intervalo del estudio (B2), respeta la anticipación mínima
--     (B3: 12 h) y no pasa el horizonte (60 días);
--   * el servicio se ofrece online y la profesional está activa, acepta reservas
--     online y hace ese servicio (con su duración propia si la tiene).
-- =====================================================================

-- Servicio reservable online del estudio (o null)
create or replace function app.bookable_service(p_tenant uuid, p_service uuid)
returns public.services
language sql stable security definer set search_path = '' as $$
  select s.* from public.services s
  left join public.service_categories c on c.id = s.category_id
  where s.id = p_service and s.tenant_id = p_tenant
    and s.is_active and s.show_online and s.archived_at is null
    and (s.category_id is null or c.is_active)
$$;

-- Profesionales que pueden tomar ese servicio online (una sola si se pide una)
create or replace function app.eligible_professionals(p_tenant uuid, p_service uuid, p_professional uuid)
returns table (professional_id uuid, display_name text, photo_path text, sort_order integer,
               duration_minutes integer, price_minor bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.photo_path, p.position,
         coalesce(ps.duration_minutes_override, s.duration_minutes),
         coalesce(ps.price_minor_override, s.price_minor)
  from public.professional_services ps
  join public.professionals p on p.id = ps.professional_id
  join public.services s on s.id = ps.service_id
  where ps.tenant_id = p_tenant and ps.service_id = p_service
    and (p_professional is null or p.id = p_professional)
    and p.is_active and p.accepts_online_booking and p.archived_at is null
    and (app.bookable_service(p_tenant, p_service)).id is not null
$$;

-- Horarios libres en [p_from, p_to). p_respect_limits = false solo para el panel.
create or replace function app.free_slots(
  p_tenant uuid, p_service uuid, p_professional uuid,
  p_from timestamptz, p_to timestamptz, p_respect_limits boolean default true
) returns table (professional_id uuid, starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz        text;
  v_step      integer;
  v_notice    integer;
  v_horizon   integer;
  v_buffer    interval;
  v_earliest  timestamptz;
  v_latest    timestamptz;
  v_pro       record;
  v_dur       interval;
  v_busy      tstzmultirange;
  v_iv        tstzrange;
  v_local     timestamp;
  v_minutes   integer;
  v_start     timestamptz;
begin
  select t.timezone, s.slot_interval_minutes, s.booking_min_notice_minutes, s.booking_horizon_days
    into v_tz, v_step, v_notice, v_horizon
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.id = p_tenant;
  if v_tz is null then
    return;
  end if;

  select make_interval(mins => buffer_after_minutes) into v_buffer
  from public.services where id = p_service and tenant_id = p_tenant;

  v_earliest := p_from;
  v_latest := p_to;
  if p_respect_limits then
    v_earliest := greatest(p_from, now() + make_interval(mins => v_notice));
    v_latest := least(p_to, now() + make_interval(days => v_horizon));
  end if;
  if v_earliest >= v_latest then
    return;
  end if;

  for v_pro in select * from app.eligible_professionals(p_tenant, p_service, p_professional) loop
    v_dur := make_interval(mins => v_pro.duration_minutes);

    select coalesce(range_agg(a.occupied), '{}') into v_busy
    from public.appointments a
    where a.tenant_id = p_tenant and a.professional_id = v_pro.professional_id
      and (a.status = 'confirmed' or (a.status = 'pending_payment' and a.hold_expires_at > now()))
      and a.occupied && tstzrange(v_earliest - interval '1 day', v_latest + interval '1 day');

    for v_iv in
      select r from app.working_intervals(p_tenant, v_pro.professional_id, v_earliest, v_latest + v_dur) r
    loop
      -- Primer horario alineado al intervalo (en hora local) dentro de la franja
      v_local := greatest(lower(v_iv), v_earliest) at time zone v_tz;
      v_minutes := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int
                   + case when extract(second from v_local) > 0 then 1 else 0 end;
      v_minutes := ((v_minutes + v_step - 1) / v_step) * v_step;
      v_local := date_trunc('day', v_local) + make_interval(mins => v_minutes);

      loop
        v_start := v_local at time zone v_tz;
        exit when v_start >= v_latest or v_start + v_dur > upper(v_iv);
        if not (tstzrange(v_start, v_start + v_dur + v_buffer, '[)') && v_busy) then
          professional_id := v_pro.professional_id;
          starts_at := v_start;
          return next;
        end if;
        v_local := v_local + make_interval(mins => v_step);
      end loop;
    end loop;
  end loop;
end $$;
revoke execute on function app.free_slots(uuid, uuid, uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;

-- Estudio operativo y con reservas online prendidas (o null)
create or replace function app.online_booking_tenant(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.slug = lower(btrim(p_slug)) and t.status in ('trial', 'active', 'past_due')
    and s.online_booking_enabled
$$;

-- ---------------------------------------------------------------------
-- Funciones públicas (por slug, sin ids de estudio)
-- ---------------------------------------------------------------------

-- Lo que la pantalla necesita para reservar: reglas y política vigente.
create or replace function public.get_booking_context(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'online_booking_enabled', s.online_booking_enabled,
    'timezone', t.timezone,
    'currency', t.currency,
    'deposit_percent', s.deposit_percent,
    'cancellation_window_hours', s.cancellation_window_hours,
    'booking_hold_minutes', s.booking_hold_minutes,
    'booking_min_notice_minutes', s.booking_min_notice_minutes,
    'booking_horizon_days', s.booking_horizon_days,
    'slot_interval_minutes', s.slot_interval_minutes,
    'policy_version', s.policy_version,
    'policy_text', s.policy_text)
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
  where t.slug = lower(btrim(p_slug)) and t.status in ('trial', 'active', 'past_due')
$$;

-- Profesionales que pueden hacer el servicio online, con su precio, duración y seña.
create or replace function public.get_service_options(p_slug text, p_service uuid)
returns table (professional_id uuid, display_name text, photo_path text,
               duration_minutes integer, price_minor bigint, deposit_minor bigint)
language sql stable security definer set search_path = '' as $$
  select e.professional_id, e.display_name, e.photo_path, e.duration_minutes, e.price_minor,
         (ceil(e.price_minor * coalesce(sv.deposit_percent, st.deposit_percent) / 10000.0) * 100)::bigint
  from app.eligible_professionals(app.online_booking_tenant(p_slug), p_service, null) e
  join public.services sv on sv.id = p_service
  join public.tenant_settings st on st.tenant_id = sv.tenant_id
  order by e.sort_order, e.display_name
$$;

-- Cantidad de horarios libres por día (para el calendario). Máximo 62 días.
create or replace function public.get_available_days(
  p_slug text, p_service uuid, p_professional uuid, p_from date, p_days integer
) returns table (day date, slots integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.online_booking_tenant(p_slug);
  v_tz text;
begin
  if v_tenant is null or p_from is null or p_days is null or p_days < 1 or p_days > 62 then
    return;
  end if;
  select timezone into v_tz from public.tenants where id = v_tenant;
  return query
  with s as (
    select f.starts_at from app.free_slots(v_tenant, p_service, p_professional,
                                           p_from::timestamp at time zone v_tz,
                                           (p_from + p_days)::timestamp at time zone v_tz) f
    group by f.starts_at
  )
  select d::date, (select count(*)::int from s where (s.starts_at at time zone v_tz)::date = d::date)
  from generate_series(p_from, p_from + p_days - 1, interval '1 day') d
  order by 1;
end $$;

-- Horarios libres de un día (distintos; con "cualquiera" no dice de quién).
create or replace function public.get_available_slots(
  p_slug text, p_service uuid, p_professional uuid, p_day date
) returns table (starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.online_booking_tenant(p_slug);
  v_tz text;
begin
  if v_tenant is null or p_day is null then
    return;
  end if;
  select timezone into v_tz from public.tenants where id = v_tenant;
  return query
  select distinct f.starts_at
  from app.free_slots(v_tenant, p_service, p_professional,
                      p_day::timestamp at time zone v_tz, (p_day + 1)::timestamp at time zone v_tz) f
  order by 1;
end $$;

revoke execute on function public.get_booking_context(text) from public;
revoke execute on function public.get_service_options(text, uuid) from public;
revoke execute on function public.get_available_days(text, uuid, uuid, date, integer) from public;
revoke execute on function public.get_available_slots(text, uuid, uuid, date) from public;
grant execute on function public.get_booking_context(text) to anon, authenticated;
grant execute on function public.get_service_options(text, uuid) to anon, authenticated;
grant execute on function public.get_available_days(text, uuid, uuid, date, integer) to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, uuid, date) to anon, authenticated;
