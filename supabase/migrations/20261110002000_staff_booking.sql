-- =====================================================================
-- Cleo · Migración 2000 · Turnos del panel y confirmación de la seña
-- Épica 05 (BOOK-07) · Épica 08 (CAL-06, parte)
--
--   * create_manual_booking (agenda.manage): turno de WhatsApp. Siempre con seña
--     (B11): ya cobrada por transferencia/efectivo (además cash.manage) → confirmado;
--     si no, esperando pago con el mismo vencimiento que una online. Puede forzarse
--     fuera de horario o sobre un bloqueo, NUNCA encima de otro turno.
--   * mark_deposit_paid_offline (cash.manage) y cancel_unpaid_booking (agenda.manage,
--     solo reservas sin seña cobrada: B13).
--   * app.confirm_deposit_payment: la ÚNICA forma de marcar una seña como pagada
--     online. Solo la llama el servidor (service_role) después de verificar el pago
--     con Mercado Pago (Sprint 5). Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Disponibilidad para el PANEL: el servicio entra completo en una franja de la
-- profesional y servicio + tiempo extra no pisan otro turno activo. Múltiplos de 5.
-- ---------------------------------------------------------------------
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
         and (a.status = 'confirmed' or (a.status = 'pending_payment' and a.hold_expires_at > now()))
         and a.occupied && tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration + p_buffer), '[)'))
$$;
revoke execute on function app.staff_slot_ok(uuid, uuid, timestamptz, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- app.create_appointment (redefinida; la 1900 no se modifica): chequeo propio para
-- el panel (staff_slot_ok) y mensaje claro si la profesional no hace el servicio.
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
    v_candidates := v_candidates + 1;
    -- Libera bloqueos vencidos que tapen este horario (no depende de pg_cron).
    perform app.expire_holds(v_cand.id, tstzrange(p_starts_at - interval '1 day', p_starts_at + interval '1 day'));

    if p_force_outside_hours then
      v_ok := true;
    elsif p_source = 'online' then
      v_ok := exists (select 1 from app.free_slots(p_tenant, v_service.id, v_cand.id, p_starts_at,
                                                    p_starts_at + interval '1 minute', true) f
                      where f.starts_at = p_starts_at);
    else
      -- Panel: dentro del horario de la profesional y sin pisar otro turno (no exige que
      -- el servicio se ofrezca online ni el intervalo de horarios del sitio).
      v_ok := app.staff_slot_ok(p_tenant, v_cand.id, p_starts_at, v_cand.duration_minutes, v_service.buffer_after_minutes);
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
  if v_candidates = 0 then
    if p_professional is null then
      raise exception 'Ninguna profesional hace ese servicio' using errcode = 'P0002';
    end if;
    raise exception 'Esa profesional no hace ese servicio' using errcode = 'P0002';
  end if;
  raise exception 'Ese horario no está disponible. Elegí otro.' using errcode = '22023';
end $$;

create or replace function public.create_manual_booking(
  p_tenant uuid,
  p_client_profile uuid,        -- ficha existente, o null para cargar una nueva
  p_new_client_name text,
  p_new_client_phone text,
  p_service uuid,
  p_professional uuid,
  p_starts_at timestamptz,
  p_force_outside_hours boolean,
  p_paid_offline_method text,   -- null = esperando pago; 'transfer' | 'cash' = ya cobrada
  p_note text default null
) returns table (appointment_id uuid, code text, status public.appointment_status, hold_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_profile uuid := p_client_profile;
  v_row     public.appointments%rowtype;
begin
  if not app.can(p_tenant, 'agenda.manage') then
    raise exception 'No tenés permiso para cargar turnos' using errcode = '42501';
  end if;
  if p_paid_offline_method is not null then
    if p_paid_offline_method not in ('transfer', 'cash') then
      raise exception 'Medio de pago inválido' using errcode = '22023';
    end if;
    if not app.can(p_tenant, 'cash.manage') then
      raise exception 'No tenés permiso para registrar cobros' using errcode = '42501';
    end if;
  end if;
  if p_professional is null then
    raise exception 'Elegí la profesional' using errcode = '22023';
  end if;

  if v_profile is null then
    if p_new_client_name is null or char_length(btrim(p_new_client_name)) not between 2 and 120 then
      raise exception 'Ingresá el nombre de la clienta' using errcode = '22023';
    end if;
    if p_new_client_phone is null or btrim(p_new_client_phone) !~ '^\+?[0-9 ()-]{6,30}$' then
      raise exception 'Ingresá un teléfono válido de la clienta' using errcode = '22023';
    end if;
    insert into public.client_profiles (tenant_id, full_name, phone, source, created_by)
    values (p_tenant, btrim(p_new_client_name), btrim(p_new_client_phone), 'staff', auth.uid())
    returning id into v_profile;
  elsif not exists (select 1 from public.client_profiles where id = v_profile and tenant_id = p_tenant) then
    raise exception 'La clienta no es de este estudio' using errcode = 'P0002';
  end if;

  v_row := app.create_appointment(p_tenant, v_profile, p_service, p_professional, p_starts_at, 'staff',
                                  coalesce(p_force_outside_hours, false), p_paid_offline_method, p_note);
  return query select v_row.id, v_row.code, v_row.status, v_row.hold_expires_at;
end $$;
revoke execute on function public.create_manual_booking(uuid, uuid, text, text, uuid, uuid, timestamptz, boolean, text, text) from public, anon;
grant execute on function public.create_manual_booking(uuid, uuid, text, text, uuid, uuid, timestamptz, boolean, text, text) to authenticated;

create or replace function public.mark_deposit_paid_offline(p_appointment uuid, p_method text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.appointments%rowtype;
begin
  select * into v_row from public.appointments where id = p_appointment for update;
  if v_row.id is null or not app.can(v_row.tenant_id, 'cash.manage') then
    raise exception 'No tenés permiso para registrar cobros en este turno' using errcode = '42501';
  end if;
  if p_method is null or p_method not in ('transfer', 'cash') then
    raise exception 'Medio de pago inválido' using errcode = '22023';
  end if;
  if v_row.status <> 'pending_payment' or v_row.hold_expires_at <= now() then
    raise exception 'Este turno ya no está esperando pago' using errcode = '22023';
  end if;
  perform set_config('app.event_detail', jsonb_build_object('payment_method', p_method)::text, true);
  update public.appointments set deposit_status = 'paid_offline', status = 'confirmed' where id = p_appointment;
  perform set_config('app.event_detail', '', true);
end $$;
revoke execute on function public.mark_deposit_paid_offline(uuid, text) from public, anon;
grant execute on function public.mark_deposit_paid_offline(uuid, text) to authenticated;

create or replace function public.cancel_unpaid_booking(p_appointment uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.appointments%rowtype;
begin
  select * into v_row from public.appointments where id = p_appointment for update;
  if v_row.id is null or not app.can(v_row.tenant_id, 'agenda.manage') then
    raise exception 'No tenés permiso para cancelar este turno' using errcode = '42501';
  end if;
  if v_row.status <> 'pending_payment' then
    raise exception 'Solo se puede cancelar un turno sin seña cobrada. Las cancelaciones con seña llegan con las reglas de cancelación.'
      using errcode = '22023';
  end if;
  perform set_config('app.event_detail',
    jsonb_strip_nulls(jsonb_build_object('reason', 'cancelled_by_staff', 'note', left(nullif(btrim(p_reason), ''), 200)))::text, true);
  update public.appointments set status = 'cancelled' where id = p_appointment;
  perform set_config('app.event_detail', '', true);
end $$;
revoke execute on function public.cancel_unpaid_booking(uuid, text) from public, anon;
grant execute on function public.cancel_unpaid_booking(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Confirmación por pago verificado (solo servidor). Idempotente.
-- p_payment_ref: id del pago en el proveedor (Mercado Pago en el Sprint 5).
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
  if v_row.status <> 'pending_payment' then
    -- Pago que llegó tarde (vencida o cancelada): lo resuelve el Sprint 5 / Épica 07
    -- (devolución o crédito). Nunca reactiva una reserva sola.
    raise exception 'La reserva ya no está activa (%)', v_row.status using errcode = '22023';
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
