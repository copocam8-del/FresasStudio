-- =====================================================================
-- Cleo · Migración 2760 · El saldo a favor no se usa si la seña ya se cobró en el estudio
--
-- Corrección de la 2720/2730 (encontrada con el e2e): en un turno manual (o una
-- reprogramación tardía del panel) con la seña registrada como YA COBRADA en efectivo o
-- transferencia, se aplicaba igual el saldo a favor de la clienta: se le descontaba el
-- saldo y el cobro en el estudio quedaba sin registrar. Ahora el saldo se usa solo
-- cuando la seña queda por pagar (online o turno manual "esperando pago").
-- =====================================================================

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
    -- Si el estudio registra la seña como ya cobrada (transferencia o efectivo), el saldo
    -- no se toca: se usa solo cuando la seña queda por pagar.
    v_credit := case when p_paid_offline_method is null
                     then least(app.credit_available(p_tenant, p_client_profile), v_deposit_minor) else 0 end;

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

create or replace function app.reschedule_appointment(
  p_appointment uuid, p_professional uuid, p_starts_at timestamptz, p_origin text,
  p_force_outside_hours boolean, p_paid_offline_method text, p_expected text
) returns public.appointments
language plpgsql security definer set search_path = '' as $$
declare
  v_old      public.appointments%rowtype;
  v_new      public.appointments%rowtype;
  v_tenant   public.tenants%rowtype;
  v_settings public.tenant_settings%rowtype;
  v_service  public.services%rowtype;
  v_pro      record;
  v_terms    record;
  v_outcome  public.deposit_outcome;
  v_ok       boolean;
  v_credit   bigint := 0;
  v_status   public.appointment_status;
  v_deposit  public.deposit_status;
  v_tries    integer := 0;
  v_constraint text;
begin
  select * into v_old from public.appointments where id = p_appointment for update;
  if v_old.id is null then
    raise exception 'No encontramos ese turno' using errcode = 'P0002';
  end if;
  if v_old.status = 'pending_payment' then
    raise exception 'Este turno todavía espera el pago de la seña: liberalo y reservá otro horario' using errcode = '22023';
  end if;
  if v_old.status <> 'confirmed' then
    raise exception 'Este turno ya está cerrado y no se puede cambiar' using errcode = '22023';
  end if;
  if p_origin = 'site' then
    if v_old.starts_at <= now() then
      raise exception 'El turno ya empezó: escribile al estudio' using errcode = '22023';
    end if;
    if v_old.reschedule_count >= 1 then
      raise exception 'Este turno ya se cambió una vez. Para cambiarlo de nuevo, escribile al estudio.' using errcode = '22023';
    end if;
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'Elegí un horario que todavía no haya pasado' using errcode = '22023';
  end if;
  if p_starts_at = v_old.starts_at and p_professional is not distinct from v_old.professional_id then
    raise exception 'Elegí un día, horario o profesional distinto' using errcode = '22023';
  end if;
  if p_paid_offline_method is not null and p_paid_offline_method not in ('transfer', 'cash') then
    raise exception 'Medio de pago inválido' using errcode = '22023';
  end if;

  select * into v_tenant from public.tenants where id = v_old.tenant_id;
  select * into v_settings from public.tenant_settings where tenant_id = v_old.tenant_id;

  -- Servicio: el mismo. Online, solo si se sigue ofreciendo online.
  if p_origin = 'site' then
    v_service := app.bookable_service(v_old.tenant_id, v_old.service_id);
  else
    select * into v_service from public.services
    where id = v_old.service_id and tenant_id = v_old.tenant_id and is_active and archived_at is null;
  end if;
  if v_service.id is null then
    raise exception 'Ese servicio ya no se ofrece. Escribile al estudio.' using errcode = 'P0002';
  end if;

  -- Profesional: una que haga el servicio (la misma si no se elige otra).
  select p.id, p.display_name,
         coalesce(ps.duration_minutes_override, v_service.duration_minutes) as duration_minutes
    into v_pro
  from public.professional_services ps
  join public.professionals p on p.id = ps.professional_id
  where ps.tenant_id = v_old.tenant_id and ps.service_id = v_service.id
    and p.id = coalesce(p_professional, v_old.professional_id)
    and p.is_active and p.archived_at is null
    and (p_origin <> 'site' or p.accepts_online_booking);
  if v_pro.id is null then
    raise exception 'Esa profesional no hace ese servicio' using errcode = 'P0002';
  end if;

  if p_origin = 'site' then
    if p_starts_at < now() + make_interval(mins => v_settings.booking_min_notice_minutes) then
      raise exception 'Para cambiar online se necesitan al menos % de anticipación',
        case when v_settings.booking_min_notice_minutes % 60 = 0
             then (v_settings.booking_min_notice_minutes / 60) || ' horas'
             else v_settings.booking_min_notice_minutes || ' minutos' end
        using errcode = '22023';
    end if;
    if p_starts_at > now() + make_interval(days => v_settings.booking_horizon_days) then
      raise exception 'Se puede reservar online hasta % días adelante', v_settings.booking_horizon_days using errcode = '22023';
    end if;
  end if;

  -- Consecuencia (C3/C4), la misma regla que al cancelar.
  select * into v_terms from app.deposit_terms(v_old.id, now());
  v_outcome := case when v_terms.keeps_deposit then 'transferred' else 'forfeited' end;
  if p_expected is distinct from v_outcome::text then
    if v_outcome = 'forfeited' then
      raise exception 'Pasó el plazo: ahora la seña se pierde y hay que pagar una nueva. Revisá y confirmá de nuevo.' using errcode = '22023';
    end if;
    raise exception 'Cambió lo que pasa con la seña. Revisá y confirmá de nuevo.' using errcode = '22023';
  end if;
  if v_outcome = 'transferred' and p_paid_offline_method is not null then
    raise exception 'La seña pasa entera al turno nuevo: no hay que cobrar nada' using errcode = '22023';
  end if;

  -- 1) El turno viejo libera su horario (si algo falla después, se deshace todo).
  perform set_config('app.event_detail', jsonb_strip_nulls(jsonb_build_object(
    'origin', p_origin, 'outcome', v_outcome, 'amount_minor', v_terms.amount_minor,
    'deadline', v_terms.deadline, 'at', now(), 'to_starts_at', p_starts_at,
    'to_professional', v_pro.display_name))::text, true);
  update public.appointments
     set status = 'rescheduled', deposit_outcome = v_outcome, deposit_outcome_minor = v_terms.amount_minor,
         closed_at = now(), closed_by = auth.uid()
   where id = v_old.id;
  perform set_config('app.event_detail', '', true);

  -- 2) ¿Está libre el horario nuevo?
  perform app.expire_holds(v_pro.id, tstzrange(p_starts_at - interval '1 day', p_starts_at + interval '1 day'));
  if p_force_outside_hours and p_origin = 'panel' then
    v_ok := true;
  elsif p_origin = 'site' then
    v_ok := exists (select 1 from app.free_slots(v_old.tenant_id, v_service.id, v_pro.id, p_starts_at,
                                                  p_starts_at + interval '1 minute', true) f
                    where f.starts_at = p_starts_at);
  else
    v_ok := app.staff_slot_ok(v_old.tenant_id, v_pro.id, p_starts_at, v_pro.duration_minutes, v_service.buffer_after_minutes);
  end if;
  if not v_ok then
    raise exception 'Ese horario no está disponible. Elegí otro.' using errcode = '22023';
  end if;

  -- 3) El turno nuevo: misma foto de lo acordado (precio, seña, política), otro horario.
  if v_outcome = 'transferred' then
    v_status := 'confirmed';
    v_deposit := 'transferred';
    v_credit := v_old.credit_applied_minor;   -- la seña sigue compuesta igual (para devoluciones)
  else
    perform 1 from public.client_profiles where id = v_old.client_profile_id for update;
    v_credit := case when p_paid_offline_method is not null and p_origin = 'panel' then 0
                     else least(app.credit_available(v_old.tenant_id, v_old.client_profile_id), v_old.deposit_minor) end;
    if v_credit > 0 and v_credit = v_old.deposit_minor then
      v_status := 'confirmed';
      v_deposit := 'credit';
    elsif p_paid_offline_method is not null and p_origin = 'panel' then
      if not app.can(v_old.tenant_id, 'cash.manage') then
        raise exception 'No tenés permiso para registrar cobros' using errcode = '42501';
      end if;
      v_status := 'confirmed';
      v_deposit := 'paid_offline';
    else
      v_status := 'pending_payment';
      v_deposit := 'pending';
    end if;
  end if;

  loop
    begin
      perform set_config('app.event_detail', jsonb_strip_nulls(jsonb_build_object(
        'rescheduled_from', v_old.code, 'origin', p_origin,
        'payment_method', case when v_deposit = 'paid_offline' then p_paid_offline_method end,
        'credit_applied_minor', case when v_deposit <> 'transferred' then nullif(v_credit, 0) end))::text, true);
      insert into public.appointments (
        tenant_id, code, client_profile_id, professional_id, service_id,
        starts_at, ends_at, occupied_until,
        service_name, professional_name, duration_minutes, buffer_minutes,
        price_minor, price_is_from, currency, deposit_percent, deposit_minor,
        policy_version, cancellation_window_hours,
        status, deposit_status, hold_expires_at, source, forced_outside_hours, client_note, created_by,
        credit_applied_minor, rescheduled_from, reschedule_count)
      values (
        v_old.tenant_id, app.generate_booking_code(), v_old.client_profile_id, v_pro.id, v_old.service_id,
        p_starts_at, p_starts_at + make_interval(mins => v_pro.duration_minutes),
        p_starts_at + make_interval(mins => v_pro.duration_minutes + v_service.buffer_after_minutes),
        v_old.service_name, v_pro.display_name, v_pro.duration_minutes, v_service.buffer_after_minutes,
        v_old.price_minor, v_old.price_is_from, v_old.currency, v_old.deposit_percent, v_old.deposit_minor,
        v_old.policy_version, v_old.cancellation_window_hours,
        v_status, v_deposit,
        case when v_status = 'pending_payment'
             then least(now() + make_interval(mins => v_settings.booking_hold_minutes), p_starts_at) end,
        case when p_origin = 'site' then 'online'::public.appointment_source else 'staff'::public.appointment_source end,
        coalesce(p_force_outside_hours, false) and p_origin = 'panel', v_old.client_note, auth.uid(),
        v_credit, v_old.id, v_old.reschedule_count + 1)
      returning * into v_new;
      perform set_config('app.event_detail', '', true);
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'appointments_one_pending_online' then
          raise exception 'Ya tenés una reserva esperando pago. Pagala o liberala antes de cambiar este turno.' using errcode = '22023';
        end if;
        if v_constraint <> 'appointments_code_unique' then
          raise;
        end if;
        v_tries := v_tries + 1;
        if v_tries > 5 then raise; end if;
      when exclusion_violation then
        raise exception 'Ese horario se acaba de ocupar. Elegí otro.' using errcode = '23P01';
    end;
  end loop;

  if v_deposit <> 'transferred' and v_credit > 0 then
    if app.consume_credit(v_old.tenant_id, v_old.client_profile_id, v_credit, 'used_in_booking', v_new.id, null) <> v_credit then
      raise exception 'No se pudo usar el saldo a favor' using errcode = '40001';
    end if;
  end if;
  perform app.appointment_note(v_new.id, 'rescheduled_in',
    jsonb_build_object('from_code', v_old.code, 'from_starts_at', v_old.starts_at, 'outcome', v_outcome));
  return v_new;
end $$;

revoke execute on function app.reschedule_appointment(uuid, uuid, timestamptz, text, boolean, text, text) from public, anon, authenticated;
