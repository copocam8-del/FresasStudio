-- =====================================================================
-- Cleo · Migración 2740 · Asistencia (ATT-01, POL-06, CAL-05) · plan C12–C14
--
--   * Llegó / empezó / terminó: dueña, encargada, recepción (agenda.manage) y la
--     profesional en SUS turnos (permiso nuevo agenda.mark_own). Se pueden saltear
--     pasos; "terminó" cierra el turno como atendido y la seña cuenta como pago.
--   * Faltó: solo agenda.manage, desde la hora del turno; la seña se pierde (según
--     la política aceptada: no_show_forfeits_deposit).
--   * Corregir una falta: una vez, dentro de los 7 días, con motivo.
--   * La asistencia es el estado del turno: un solo resultado por turno.
-- =====================================================================

insert into public.permissions (code, module, description) values
  ('agenda.mark_own', 'agenda', 'Marcar llegó, empezó y terminó en los turnos propios')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'agenda.mark_own' from public.roles r
where r.tenant_id is null and r.key in ('owner', 'manager', 'receptionist', 'professional')
on conflict do nothing;

-- Si la política del estudio no hace perder la seña por una falta, pasa al saldo.
alter table public.client_credit_entries drop constraint client_credit_entries_kind;
alter table public.client_credit_entries add constraint client_credit_entries_kind check (kind in (
  'cancellation_credit', 'studio_cancellation_credit', 'manual_credit', 'no_show_credit',
  'used_in_booking', 'manual_debit', 'expired',
  'returned_from_booking'));
alter table public.client_credit_entries drop constraint client_credit_entries_shape;
alter table public.client_credit_entries add constraint client_credit_entries_shape check (
  (kind in ('cancellation_credit', 'studio_cancellation_credit', 'manual_credit', 'no_show_credit')
     and amount_minor > 0 and expires_at is not null and lot_id is null)
  or (kind in ('used_in_booking', 'manual_debit', 'expired')
     and amount_minor < 0 and expires_at is null and lot_id is not null)
  or (kind = 'returned_from_booking' and amount_minor > 0 and expires_at is null and lot_id is not null));
alter table public.client_credit_entries drop constraint client_credit_entries_booking;
alter table public.client_credit_entries add constraint client_credit_entries_booking check (
  kind not in ('cancellation_credit', 'studio_cancellation_credit', 'no_show_credit', 'used_in_booking', 'returned_from_booking')
  or appointment_id is not null);
drop index public.client_credit_entries_one_credit_per_booking;
create unique index client_credit_entries_one_credit_per_booking on public.client_credit_entries (appointment_id)
  where kind in ('cancellation_credit', 'studio_cancellation_credit', 'no_show_credit');

-- Quién puede marcar la asistencia de un turno
create or replace function app.can_mark_attendance(p_appt public.appointments)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can(p_appt.tenant_id, 'agenda.manage')
      or (app.can(p_appt.tenant_id, 'agenda.mark_own')
          and p_appt.professional_id = app.my_professional_id(p_appt.tenant_id))
$$;
revoke execute on function app.can_mark_attendance(public.appointments) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Llegó / empezó / terminó
-- ---------------------------------------------------------------------
create or replace function public.mark_attendance(p_appointment uuid, p_step text)
returns public.appointment_status
language plpgsql security definer set search_path = '' as $$
declare
  v_appt  public.appointments%rowtype;
  v_terms record;
begin
  select * into v_appt from public.appointments where id = p_appointment for update;
  if v_appt.id is null or not app.can_mark_attendance(v_appt) then
    raise exception 'No tenés permiso para marcar este turno' using errcode = '42501';
  end if;
  if p_step is null or p_step not in ('checked_in', 'started', 'finished') then
    raise exception 'Paso inválido' using errcode = '22023';
  end if;
  if v_appt.status <> 'confirmed' then
    raise exception 'Este turno no está confirmado (%): no se puede marcar', v_appt.status using errcode = '22023';
  end if;
  if now() < v_appt.starts_at - interval '2 hours' then
    raise exception 'Todavía falta para este turno: se puede marcar desde 2 horas antes' using errcode = '22023';
  end if;

  if p_step = 'checked_in' then
    if v_appt.checked_in_at is not null then
      raise exception 'Ya figura que llegó' using errcode = '22023';
    end if;
    update public.appointments set checked_in_at = now() where id = v_appt.id;
    perform app.appointment_note(v_appt.id, 'checked_in', '{}'::jsonb);
  elsif p_step = 'started' then
    if v_appt.started_at is not null then
      raise exception 'Ya figura que empezó' using errcode = '22023';
    end if;
    update public.appointments
       set checked_in_at = coalesce(checked_in_at, now()), started_at = now()
     where id = v_appt.id;
    perform app.appointment_note(v_appt.id, 'started', '{}'::jsonb);
  else
    select * into v_terms from app.deposit_terms(v_appt.id, now());
    perform set_config('app.event_detail', jsonb_build_object('deposit_outcome', 'applied',
      'amount_minor', v_terms.amount_minor)::text, true);
    update public.appointments
       set checked_in_at = coalesce(checked_in_at, now()), started_at = coalesce(started_at, now()),
           finished_at = now(), status = 'completed',
           deposit_outcome = 'applied', deposit_outcome_minor = v_terms.amount_minor,
           closed_at = now(), closed_by = auth.uid()
     where id = v_appt.id;
    perform set_config('app.event_detail', '', true);
    return 'completed';
  end if;
  return 'confirmed';
end $$;
revoke execute on function public.mark_attendance(uuid, text) from public, anon;
grant execute on function public.mark_attendance(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Faltó (no-show): solo agenda.manage, desde la hora del turno
-- ---------------------------------------------------------------------
create or replace function public.mark_no_show(p_appointment uuid)
returns public.deposit_outcome
language plpgsql security definer set search_path = '' as $$
declare
  v_appt    public.appointments%rowtype;
  v_terms   record;
  v_forfeit boolean;
  v_days    integer;
  v_outcome public.deposit_outcome;
begin
  select * into v_appt from public.appointments where id = p_appointment for update;
  if v_appt.id is null or not app.can(v_appt.tenant_id, 'agenda.manage') then
    raise exception 'No tenés permiso para marcar faltas' using errcode = '42501';
  end if;
  if v_appt.status <> 'confirmed' then
    raise exception 'Este turno no está confirmado (%): no se puede marcar la falta', v_appt.status using errcode = '22023';
  end if;
  if now() < v_appt.starts_at then
    raise exception 'La falta se marca desde la hora del turno' using errcode = '22023';
  end if;
  if v_appt.checked_in_at is not null then
    raise exception 'Figura que la clienta llegó: no puede ser una falta' using errcode = '22023';
  end if;

  select * into v_terms from app.deposit_terms(v_appt.id, now());
  select p.no_show_forfeits_deposit, p.credit_expiry_days into v_forfeit, v_days
  from public.tenant_policy_versions p where p.tenant_id = v_appt.tenant_id and p.version = v_appt.policy_version;
  v_outcome := case when coalesce(v_forfeit, true) then 'forfeited' else 'credited' end;

  perform set_config('app.event_detail', jsonb_build_object('deposit_outcome', v_outcome,
    'amount_minor', v_terms.amount_minor)::text, true);
  update public.appointments
     set status = 'no_show', deposit_outcome = v_outcome, deposit_outcome_minor = v_terms.amount_minor,
         closed_at = now(), closed_by = auth.uid()
   where id = v_appt.id;
  perform set_config('app.event_detail', '', true);

  if v_outcome = 'credited' and v_terms.amount_minor > 0 then
    perform app.add_credit_lot(v_appt.tenant_id, v_appt.client_profile_id, 'no_show_credit',
      v_terms.amount_minor, v_appt.id, v_days, null);
  end if;
  return v_outcome;
end $$;
revoke execute on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Corregir una falta marcada por error (C13): una vez, 7 días, motivo
-- ---------------------------------------------------------------------
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
  update public.appointments
     set status = 'completed', deposit_outcome = 'applied',
         checked_in_at = coalesce(checked_in_at, v_appt.starts_at),
         started_at = coalesce(started_at, v_appt.starts_at),
         finished_at = coalesce(finished_at, v_appt.ends_at),
         closed_at = now(), closed_by = auth.uid()
   where id = v_appt.id;
  perform set_config('app.event_detail', '', true);
  perform set_config('app.no_show_correction', '', true);
  perform app.appointment_note(v_appt.id, 'no_show_corrected', jsonb_build_object('note', v_reason));
  return 'completed';
end $$;
revoke execute on function public.correct_no_show(uuid, text) from public, anon;
grant execute on function public.correct_no_show(uuid, text) to authenticated;
