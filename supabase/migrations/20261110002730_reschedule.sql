-- =====================================================================
-- Cleo · Migración 2730 · Reprogramar (POL-04, POL-05) · docs/sprint-6-plan.md C3, C4
--
--   * Con ≥ 24 h (reloj del estudio, política de la reserva): se mueve el mismo turno.
--     Mismo servicio y MISMO PRECIO y seña acordados; la seña pasa entera al turno
--     nuevo (deposit_status = transferred), sin pasar por el saldo.
--   * Con < 24 h: la seña anterior se pierde y el turno nuevo pide una seña nueva
--     (mismo precio y %), que puede cubrir el saldo a favor como cualquier reserva.
--   * El turno viejo queda "reprogramado" y libera su horario en la misma
--     transacción; si el horario nuevo no está libre, no cambia nada.
--   * Desde el sitio: una sola vez por reserva (la cadena cuenta). Desde el panel:
--     sin límite, con las reglas del turno manual.
-- =====================================================================

-- La cadena de una seña: el turno y los anteriores de los que vino transferida.
create or replace function app.deposit_chain(p_appointment uuid)
returns table (appointment_id uuid, deposit_status public.deposit_status)
language sql stable security definer set search_path = '' as $$
  with recursive chain as (
    select a.id, a.deposit_status, a.rescheduled_from from public.appointments a where a.id = p_appointment
    union all
    select p.id, p.deposit_status, p.rescheduled_from
    from chain c join public.appointments p on p.id = c.rescheduled_from
    where c.deposit_status = 'transferred'
  )
  select id, deposit_status from chain
$$;
revoke execute on function app.deposit_chain(uuid) from public, anon, authenticated;

-- Cómo se pagó de verdad la seña (el primer turno de la cadena que no la recibió transferida)
create or replace function app.deposit_paid_status(p_appointment uuid)
returns public.deposit_status
language sql stable security definer set search_path = '' as $$
  select c.deposit_status from app.deposit_chain(p_appointment) c where c.deposit_status <> 'transferred' limit 1
$$;
revoke execute on function app.deposit_paid_status(uuid) from public, anon, authenticated;

-- Redefinida: lo devuelto se busca en los pagos de toda la cadena.
create or replace function app.deposit_refunded_minor(p_appointment uuid)
returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when p.status = 'charged_back' then p.amount_minor
                           else least(p.refunded_minor, p.amount_minor) end), 0)::bigint
  from public.payments p
  where p.appointment_id in (select c.appointment_id from app.deposit_chain(p_appointment) c)
    and p.outcome in ('applied', 'late_confirmed')
$$;

-- Redefinida (2720): la devolución del estudio alcanza a los pagos de toda la cadena y
-- el medio de pago es el de la seña original.
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
  v_paid    public.deposit_status;
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
  v_paid := app.deposit_paid_status(v_appt.id);

  if p_by = 'client' then
    v_outcome := case when v_terms.keeps_deposit then 'credited' else 'forfeited' end;
    v_amount := v_terms.amount_minor;
  else
    if v_reason is null or char_length(v_reason) < 3 then
      raise exception 'Escribí el motivo: la clienta lo va a ver' using errcode = '22023';
    end if;
    if p_refund_mode is null or p_refund_mode not in ('credit', 'refund') then
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
    if v_paid = 'paid_offline' and coalesce(p_refund_method, '') not in ('transfer', 'cash') then
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
      where p.appointment_id in (select c.appointment_id from app.deposit_chain(v_appt.id) c)
        and p.outcome in ('applied', 'late_confirmed') and p.status = 'approved'
      for update
    loop
      perform app.request_refund(v_pay, 'studio_cancelled');
    end loop;
    if v_paid = 'paid_offline' and v_amount > 0 then
      perform app.appointment_note(v_appt.id, 'refunded_offline',
        jsonb_build_object('method', p_refund_method, 'amount_minor', v_amount));
    end if;
  end if;

  return query select v_outcome, v_amount;
end $$;
revoke execute on function app.cancel_appointment(uuid, public.cancel_party, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Núcleo: reprogramar. Quien llama ya validó permisos.
--   p_origin:   'site' (clienta: reglas públicas, una vez) | 'panel'
--   p_expected: 'transferred' (conserva la seña) | 'forfeited' (seña nueva)
-- ---------------------------------------------------------------------
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
    v_credit := least(app.credit_available(v_old.tenant_id, v_old.client_profile_id), v_old.deposit_minor);
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

-- Clienta, desde el sitio
create or replace function public.reschedule_my_booking(
  p_slug text, p_code text, p_professional uuid, p_starts_at timestamptz, p_expected text
) returns table (code text, status public.appointment_status, hold_expires_at timestamptz,
                 deposit_outcome public.deposit_outcome, professional_name text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id  uuid := app.my_appointment_id(p_slug, p_code);
  v_new public.appointments%rowtype;
begin
  if v_id is null then
    raise exception 'No encontramos una reserva tuya con ese código' using errcode = 'P0002';
  end if;
  if app.online_booking_tenant(p_slug) is null then
    raise exception 'Los cambios online no están disponibles en este estudio. Escribile para cambiar el turno.' using errcode = 'P0002';
  end if;
  v_new := app.reschedule_appointment(v_id, p_professional, p_starts_at, 'site', false, null, p_expected);
  return query select v_new.code, v_new.status, v_new.hold_expires_at,
    (select a.deposit_outcome from public.appointments a where a.id = v_id), v_new.professional_name;
end $$;
revoke execute on function public.reschedule_my_booking(text, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.reschedule_my_booking(text, text, uuid, timestamptz, text) to authenticated;

-- Panel (agenda.manage)
create or replace function public.reschedule_booking(
  p_appointment uuid, p_professional uuid, p_starts_at timestamptz, p_force_outside_hours boolean,
  p_paid_offline_method text, p_expected text
) returns table (appointment_id uuid, code text, status public.appointment_status, hold_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant uuid;
  v_new public.appointments%rowtype;
begin
  select tenant_id into v_tenant from public.appointments where id = p_appointment;
  if v_tenant is null or not app.can(v_tenant, 'agenda.manage') then
    raise exception 'No tenés permiso para cambiar este turno' using errcode = '42501';
  end if;
  v_new := app.reschedule_appointment(p_appointment, p_professional, p_starts_at, 'panel',
                                      coalesce(p_force_outside_hours, false), p_paid_offline_method, p_expected);
  return query select v_new.id, v_new.code, v_new.status, v_new.hold_expires_at;
end $$;
revoke execute on function public.reschedule_booking(uuid, uuid, timestamptz, boolean, text, text) from public, anon;
grant execute on function public.reschedule_booking(uuid, uuid, timestamptz, boolean, text, text) to authenticated;
