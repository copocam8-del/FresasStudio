-- =====================================================================
-- Cleo · Migración 1900 · Crear reservas, vencer bloqueos y "Mis turnos"
-- Épica 05 (BOOK-04 a BOOK-10)
--
-- Toda reserva se crea con app.create_appointment, que recalcula todo en el
-- servidor (nunca confía en lo que mandó la pantalla), arma la foto de lo
-- acordado y deja que la restricción de exclusión decida ante choques.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vencer bloqueos temporales (reservas pending_payment cuyo plazo pasó)
-- ---------------------------------------------------------------------
create or replace function app.expire_holds(p_professional uuid default null, p_range tstzrange default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform set_config('app.event_detail', '{"reason": "hold_expired"}', true);
  update public.appointments
     set status = 'expired'
   where status = 'pending_payment' and hold_expires_at <= now()
     and (p_professional is null or professional_id = p_professional)
     and (p_range is null or occupied && p_range);
  get diagnostics v_count = row_count;
  perform set_config('app.event_detail', '', true);
  return v_count;
end $$;
revoke execute on function app.expire_holds(uuid, tstzrange) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Núcleo: crea la reserva (online o del panel)
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
  v_status     public.appointment_status;
  v_deposit    public.deposit_status;
  v_tries      integer;
  v_conflict   boolean := false;
  v_constraint text;
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

  -- Servicio: online, solo los que se ofrecen online; panel, cualquiera activo.
  if p_source = 'online' then
    v_service := app.bookable_service(p_tenant, p_service);
  else
    select * into v_service from public.services
    where id = p_service and tenant_id = p_tenant and is_active and archived_at is null;
  end if;
  if v_service.id is null then
    raise exception 'Ese servicio no se puede reservar' using errcode = 'P0002';
  end if;

  -- Candidatas: la elegida, o (B4) las disponibles ordenadas por menos turnos ese día.
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
    -- Libera bloqueos vencidos que tapen este horario (no depende de pg_cron).
    perform app.expire_holds(v_cand.id, tstzrange(p_starts_at - interval '1 day', p_starts_at + interval '1 day'));

    if p_force_outside_hours then
      v_ok := true;
    else
      v_ok := exists (select 1 from app.free_slots(p_tenant, v_service.id, v_cand.id, p_starts_at,
                                                    p_starts_at + interval '1 minute', p_source = 'online') f
                      where f.starts_at = p_starts_at);
    end if;
    continue when not v_ok;

    v_dur := v_cand.duration_minutes;
    v_price := v_cand.price_minor;
    v_pct := coalesce(v_service.deposit_percent, v_settings.deposit_percent);
    if p_paid_offline_method is null then
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
          jsonb_strip_nulls(jsonb_build_object('payment_method', p_paid_offline_method,
                                               'any_professional', p_professional is null))::text, true);
        insert into public.appointments (
          tenant_id, code, client_profile_id, professional_id, service_id,
          starts_at, ends_at, occupied_until,
          service_name, professional_name, duration_minutes, buffer_minutes,
          price_minor, price_is_from, currency, deposit_percent, deposit_minor,
          policy_version, cancellation_window_hours,
          status, deposit_status, hold_expires_at, source, forced_outside_hours, client_note, created_by)
        values (
          p_tenant, app.generate_booking_code(), p_client_profile, v_cand.id, v_service.id,
          p_starts_at, p_starts_at + make_interval(mins => v_dur),
          p_starts_at + make_interval(mins => v_dur + v_service.buffer_after_minutes),
          v_service.name, v_cand.display_name, v_dur, v_service.buffer_after_minutes,
          v_price, v_service.price_is_from, v_tenant.currency, v_pct,
          (ceil(v_price * v_pct / 10000.0) * 100)::bigint,
          v_settings.policy_version, v_settings.cancellation_window_hours,
          v_status, v_deposit,
          case when v_status = 'pending_payment'
               then least(now() + make_interval(mins => v_settings.booking_hold_minutes), p_starts_at) end,
          p_source, coalesce(p_force_outside_hours, false), nullif(btrim(p_client_note), ''), auth.uid())
        returning * into v_row;
        perform set_config('app.event_detail', '', true);
        return v_row;
      exception
        when unique_violation then
          -- Solo se reintenta si se repitió el código (muy improbable).
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint <> 'appointments_code_unique' then
            raise;
          end if;
          v_tries := v_tries + 1;
          if v_tries > 5 then raise; end if;
        when exclusion_violation then
          -- Otra persona tomó el horario en el mismo instante: probar la siguiente
          -- candidata (solo con "cualquiera").
          v_conflict := true;
          exit;
      end;
    end loop;
  end loop;

  if v_conflict then
    raise exception 'Ese horario se acaba de ocupar. Elegí otro.' using errcode = '23P01';
  end if;
  raise exception 'Ese horario no está disponible. Elegí otro.' using errcode = '22023';
end $$;
revoke execute on function app.create_appointment(uuid, uuid, uuid, uuid, timestamptz, public.appointment_source, boolean, text, text)
  from public, anon, authenticated;

-- B7 en la base: una sola reserva online esperando pago por clienta y estudio
create unique index appointments_one_pending_online
  on public.appointments (tenant_id, client_profile_id)
  where status = 'pending_payment' and source = 'online';

-- ---------------------------------------------------------------------
-- Reserva online de la clienta
-- ---------------------------------------------------------------------
create or replace function public.create_online_booking(
  p_slug text,
  p_service uuid,
  p_professional uuid,
  p_starts_at timestamptz,
  p_accepted_policy_version integer,
  p_phone text,
  p_client_note text default null
) returns table (code text, hold_expires_at timestamptz, professional_name text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant  uuid;
  v_profile uuid;
  v_phone   text := nullif(btrim(p_phone), '');
  v_row     public.appointments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Iniciá sesión para reservar' using errcode = '42501';
  end if;
  v_tenant := app.online_booking_tenant(p_slug);
  if v_tenant is null then
    raise exception 'Las reservas online no están disponibles en este estudio' using errcode = 'P0002';
  end if;
  if p_accepted_policy_version is distinct from (select policy_version from public.tenant_settings where tenant_id = v_tenant) then
    raise exception 'La política del estudio cambió. Revisala y aceptala de nuevo.' using errcode = '22023';
  end if;
  if v_phone is null or v_phone !~ '^\+?[0-9 ()-]{6,30}$' then
    raise exception 'Ingresá un teléfono válido para que el estudio pueda avisarte' using errcode = '22023';
  end if;

  perform public.ensure_client_profile(p_slug);
  select id into v_profile from public.client_profiles where tenant_id = v_tenant and user_id = auth.uid();
  update public.client_profiles set phone = v_phone where id = v_profile and phone is distinct from v_phone;

  -- B7: una sola reserva esperando pago por clienta y estudio (también garantizado por
  -- el índice único appointments_one_pending_online). Primero se vencen las suyas viejas.
  perform set_config('app.event_detail', '{"reason": "hold_expired"}', true);
  update public.appointments set status = 'expired'
   where tenant_id = v_tenant and client_profile_id = v_profile
     and status = 'pending_payment' and hold_expires_at <= now();
  perform set_config('app.event_detail', '', true);
  if exists (select 1 from public.appointments a
             where a.tenant_id = v_tenant and a.client_profile_id = v_profile
               and a.status = 'pending_payment' and a.hold_expires_at > now()) then
    raise exception 'Ya tenés una reserva esperando pago. Pagala o liberala antes de reservar otra.' using errcode = '22023';
  end if;

  v_row := app.create_appointment(v_tenant, v_profile, p_service, p_professional, p_starts_at,
                                  'online', false, null, p_client_note);
  return query select v_row.code, v_row.hold_expires_at, v_row.professional_name;
end $$;
revoke execute on function public.create_online_booking(text, uuid, uuid, timestamptz, integer, text, text) from public, anon;
grant execute on function public.create_online_booking(text, uuid, uuid, timestamptz, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Mis turnos (solo los propios). Un bloqueo vencido se informa como "expired"
-- aunque todavía no lo haya limpiado nadie.
-- ---------------------------------------------------------------------
create or replace function public.my_bookings(p_slug text)
returns table (
  code text, service_name text, professional_name text, starts_at timestamptz, ends_at timestamptz,
  duration_minutes integer, status public.appointment_status, deposit_status public.deposit_status,
  price_minor bigint, price_is_from boolean, deposit_minor bigint, currency char(3),
  hold_expires_at timestamptz, cancellation_window_hours smallint, policy_version integer, client_note text
)
language sql stable security definer set search_path = '' as $$
  select a.code, a.service_name, a.professional_name, a.starts_at, a.ends_at, a.duration_minutes,
         case when a.status = 'pending_payment' and a.hold_expires_at <= now()
              then 'expired'::public.appointment_status else a.status end,
         a.deposit_status, a.price_minor, a.price_is_from, a.deposit_minor, a.currency,
         a.hold_expires_at, a.cancellation_window_hours, a.policy_version, a.client_note
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  where t.slug = lower(btrim(p_slug)) and c.user_id = auth.uid()
  order by a.starts_at desc
$$;
revoke execute on function public.my_bookings(text) from public, anon;
grant execute on function public.my_bookings(text) to authenticated;

-- Liberar un horario que apartó y no va a pagar (B13)
create or replace function public.release_my_pending_booking(p_slug text, p_code text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select a.id into v_id
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  where t.slug = lower(btrim(p_slug)) and a.code = upper(btrim(p_code)) and c.user_id = auth.uid()
    and a.status = 'pending_payment'
  for update of a;
  if v_id is null then
    raise exception 'No encontramos una reserva tuya esperando pago con ese código' using errcode = 'P0002';
  end if;
  perform set_config('app.event_detail', '{"reason": "released_by_client"}', true);
  update public.appointments set status = 'cancelled' where id = v_id;
  perform set_config('app.event_detail', '', true);
end $$;
revoke execute on function public.release_my_pending_booking(text, text) from public, anon;
grant execute on function public.release_my_pending_booking(text, text) to authenticated;
