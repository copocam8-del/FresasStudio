-- =====================================================================
-- Cleo · Migración 2710 · La regla de la seña (POL-01, Épica 07)
--
-- UNA sola función decide si cancelar o reprogramar conserva la seña:
-- app.deposit_terms(reserva, momento). La usan la pantalla (para mostrar la
-- consecuencia), las acciones del sitio y las del panel.
--
--   * El plazo es "la misma hora, N horas antes" en el RELOJ DEL ESTUDIO (C1),
--     con N = la ventana guardada en la reserva (la política que aceptó la clienta),
--     no la vigente.
--   * Conserva si el momento es <= al plazo: a exactamente 24:00:00 conserva; un
--     segundo después, pierde.
--   * Monto: la seña menos lo que ya se le devolvió a la clienta (C7).
-- =====================================================================

-- Plazo: hora local del turno menos N horas, de vuelta a un instante.
create or replace function app.deposit_deadline(p_starts_at timestamptz, p_window_hours integer, p_timezone text)
returns timestamptz
language sql stable set search_path = '' as $$
  select ((p_starts_at at time zone p_timezone) - make_interval(hours => p_window_hours)) at time zone p_timezone
$$;
revoke execute on function app.deposit_deadline(timestamptz, integer, text) from public, anon, authenticated;

-- Lo que ya volvió a la clienta de los pagos de esta seña (devoluciones y contracargos).
create or replace function app.deposit_refunded_minor(p_appointment uuid)
returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when p.status = 'charged_back' then p.amount_minor
                           else least(p.refunded_minor, p.amount_minor) end), 0)::bigint
  from public.payments p
  where p.appointment_id = p_appointment and p.outcome in ('applied', 'late_confirmed')
$$;
revoke execute on function app.deposit_refunded_minor(uuid) from public, anon, authenticated;

create or replace function app.deposit_terms(p_appointment uuid, p_at timestamptz)
returns table (
  deadline        timestamptz,   -- hasta cuándo se conserva la seña
  keeps_deposit   boolean,       -- p_at <= deadline
  deposit_minor   bigint,        -- la seña acordada
  refunded_minor  bigint,        -- lo que ya volvió a la clienta
  amount_minor    bigint         -- lo que se acredita o se pierde
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_appt public.appointments%rowtype;
  v_tz   text;
  v_deadline timestamptz;
  v_refunded bigint;
begin
  select * into v_appt from public.appointments where id = p_appointment;
  if v_appt.id is null then
    raise exception 'Reserva inexistente' using errcode = 'P0002';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = v_appt.tenant_id;
  v_deadline := app.deposit_deadline(v_appt.starts_at, v_appt.cancellation_window_hours, v_tz);
  v_refunded := least(app.deposit_refunded_minor(v_appt.id), v_appt.deposit_minor);
  return query select v_deadline, p_at <= v_deadline, v_appt.deposit_minor, v_refunded,
                      v_appt.deposit_minor - v_refunded;
end $$;
revoke execute on function app.deposit_terms(uuid, timestamptz) from public, anon, authenticated;
