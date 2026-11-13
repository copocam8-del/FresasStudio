-- =====================================================================
-- Cleo · Migración 2770 · Un turno ATENDIDO sigue ocupando su horario
--
-- Corrección (encontrada con el e2e): "Terminó" se puede marcar desde 2 h antes, y al
-- pasar a "completed" el turno dejaba de contar para la restricción anti doble reserva:
-- la base aceptaba otro turno encima. Ahora ocupan su horario los turnos esperando pago,
-- confirmados y ATENDIDOS. Una FALTA libera el horario a propósito (el estudio puede
-- atender a alguien sin turno en ese hueco); si después se corrige la falta y el hueco
-- ya se usó, la corrección se rechaza con un mensaje claro.
-- =====================================================================

alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  tenant_id with =, professional_id with =, occupied with &&)
  where (status in ('pending_payment', 'confirmed', 'completed'));

-- Disponibilidad (sitio, panel y vista previa): mismas reglas que la restricción.
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
      and (a.status in ('confirmed', 'completed') or (a.status = 'pending_payment' and a.hold_expires_at > now()))
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

create or replace function app.staff_slot_ok(
  p_tenant uuid, p_professional uuid, p_starts_at timestamptz, p_duration integer, p_buffer integer
) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(epoch from p_starts_at)::bigint % 300 = 0
     and exists (
       select 1 from app.working_intervals(p_tenant, p_professional, p_starts_at - interval '1 day', p_starts_at + interval '1 day') r
       where r @> tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration), '[)'))
     and not exists (
       select 1 from public.appointments a
       where a.tenant_id = p_tenant and a.professional_id = p_professional
         and (a.status in ('confirmed', 'completed') or (a.status = 'pending_payment' and a.hold_expires_at > now()))
         and a.occupied && tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration + p_buffer), '[)'))
$$;

create or replace function public.preview_booking(p_slug text, p_service uuid, p_professional uuid, p_starts_at timestamptz)
returns table (professional_id uuid, professional_name text, duration_minutes integer, ends_at timestamptz,
               price_minor bigint, price_is_from boolean, deposit_minor bigint, currency char(3))
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant  uuid := app.online_booking_tenant(p_slug);
  v_tz      text;
  v_service public.services%rowtype;
  v_pct     smallint;
  v_cur     char(3);
  v_cand    record;
begin
  if v_tenant is null or p_starts_at is null then
    return;
  end if;
  v_service := app.bookable_service(v_tenant, p_service);
  if v_service.id is null then
    return;
  end if;
  select t.timezone, t.currency, coalesce(v_service.deposit_percent, s.deposit_percent)
    into v_tz, v_cur, v_pct
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id where t.id = v_tenant;

  for v_cand in
    select e.professional_id, e.display_name, e.duration_minutes, e.price_minor
    from app.eligible_professionals(v_tenant, p_service, p_professional) e
    order by (select count(*) from public.appointments a
              where a.professional_id = e.professional_id
                and (a.status in ('confirmed', 'completed') or (a.status = 'pending_payment' and a.hold_expires_at > now()))
                and (a.starts_at at time zone v_tz)::date = (p_starts_at at time zone v_tz)::date),
             e.sort_order, e.display_name
  loop
    if exists (select 1 from app.free_slots(v_tenant, p_service, v_cand.professional_id, p_starts_at,
                                            p_starts_at + interval '1 minute', true) f
               where f.starts_at = p_starts_at) then
      return query select v_cand.professional_id, v_cand.display_name, v_cand.duration_minutes,
                          p_starts_at + make_interval(mins => v_cand.duration_minutes),
                          v_cand.price_minor, v_service.price_is_from,
                          (ceil(v_cand.price_minor * v_pct / 10000.0) * 100)::bigint, v_cur;
      return;
    end if;
  end loop;
end $$;

create or replace function public.correct_no_show(p_appointment uuid, p_reason text)
returns public.appointment_status
language plpgsql security definer set search_path = '' as $$
declare
  v_appt   public.appointments%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_appt from public.appointments where id = p_appointment for update;
  if v_appt.id is null or not app.can(v_appt.tenant_id, 'agenda.manage') then
    raise exception 'No tenés permiso para corregir faltas' using errcode = '42501';
  end if;
  if v_appt.status <> 'no_show' then
    raise exception 'Este turno no figura como falta' using errcode = '22023';
  end if;
  if v_appt.closed_at < now() - interval '7 days' then
    raise exception 'Pasaron más de 7 días: la falta ya no se puede corregir' using errcode = '22023';
  end if;
  if v_appt.deposit_outcome <> 'forfeited' then
    raise exception 'La seña de esta falta pasó al saldo: corregilo ajustando el saldo de la clienta' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 200 then
    raise exception 'Escribí el motivo de la corrección (de 3 a 200 caracteres)' using errcode = '22023';
  end if;

  perform set_config('app.no_show_correction', 'on', true);
  perform set_config('app.event_detail', jsonb_build_object('correction', true, 'note', v_reason)::text, true);
  begin
    update public.appointments
       set status = 'completed', deposit_outcome = 'applied',
           checked_in_at = coalesce(checked_in_at, v_appt.starts_at),
           started_at = coalesce(started_at, v_appt.starts_at),
           finished_at = coalesce(finished_at, v_appt.ends_at),
           closed_at = now(), closed_by = auth.uid()
     where id = v_appt.id;
  exception when exclusion_violation then
    raise exception 'No se puede corregir: en ese horario ya se cargó otro turno de la misma profesional' using errcode = '22023';
  end;
  perform set_config('app.event_detail', '', true);
  perform set_config('app.no_show_correction', '', true);
  perform app.appointment_note(v_appt.id, 'no_show_corrected', jsonb_build_object('note', v_reason));
  return 'completed';
end $$;
