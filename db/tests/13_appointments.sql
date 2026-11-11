-- =====================================================================
-- Tests de la tabla de reservas (Sprint 4 · migración 1700)
-- Inserta como superusuario para probar que la BASE sola impide la doble reserva,
-- aunque alguien se saltee todas las funciones.
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set SEMI '''31000000-0000-4000-a000-000000000001'''

:as_super
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-d000-000000000001', 'cli1@gmail.test', now(), '{"full_name": "Clienta Uno"}'),
  ('00000000-0000-4000-d000-000000000002', 'cli2@gmail.test', now(), '{"full_name": "Clienta Dos"}');
\set as_cli1 'reset role; do $x$ begin perform tests.login(''cli1@gmail.test''); end $x$; set local role authenticated;'
\set as_cli2 'reset role; do $x$ begin perform tests.login(''cli2@gmail.test''); end $x$; set local role authenticated;'
:as_cli1
select public.ensure_client_profile('fresas');
:as_cli2
select public.ensure_client_profile('fresas');
:as_super
select id as cp1 from public.client_profiles where user_id = '00000000-0000-4000-d000-000000000001' \gset
select id as cp2 from public.client_profiles where user_id = '00000000-0000-4000-d000-000000000002' \gset
select policy_version as pv from public.tenant_settings where tenant_id = :A \gset

-- Arma una reserva coherente (foto de lo acordado incluida) para los tests.
create function tests.appt(p_pro uuid, p_client uuid, p_start timestamptz, p_minutes int, p_buffer int,
                           p_status public.appointment_status, p_price bigint default 1500000, p_pct int default 50)
returns uuid language plpgsql as $$
declare v_id uuid; v_pv int;
begin
  select policy_version into v_pv from public.tenant_settings where tenant_id = '10000000-0000-4000-a000-000000000001';
  insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at,
    occupied_until, service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from,
    currency, deposit_percent, deposit_minor, policy_version, cancellation_window_hours, status, deposit_status,
    hold_expires_at, source)
  values ('10000000-0000-4000-a000-000000000001', app.generate_booking_code(), p_client, p_pro,
    '31000000-0000-4000-a000-000000000001', p_start, p_start + make_interval(mins => p_minutes),
    p_start + make_interval(mins => p_minutes + p_buffer), 'Esmaltado semipermanente', 'Pro', p_minutes, p_buffer,
    p_price, false, 'ARS', p_pct, (ceil(p_price * p_pct / 10000.0) * 100)::bigint, v_pv, 24, p_status,
    case when p_status = 'confirmed' then 'paid'::public.deposit_status else 'pending'::public.deposit_status end,
    case when p_status = 'pending_payment' then now() + interval '2 hours' end, 'staff')  -- 'staff': el límite B7 (una pendiente online) no aplica
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Doble reserva imposible (restricción de la base)
-- ---------------------------------------------------------------------
select tests.appt(:SOFI, :'cp1', '2027-01-04 17:00Z', 60, 10, 'confirmed') as a1 \gset
select tests.throws(format($$select tests.appt(%L, %L, '2027-01-04 17:30Z', 60, 0, 'pending_payment')$$, :SOFI, :'cp2'),
                    'doble reserva: superpuesta con un turno confirmado, rechazada (aun como superusuario)', 'appointments_no_overlap');
select tests.throws(format($$select tests.appt(%L, %L, '2027-01-04 18:05Z', 30, 0, 'pending_payment')$$, :SOFI, :'cp2'),
                    'doble reserva: pisar solo el tiempo extra (18:00–18:10) también se rechaza', 'appointments_no_overlap');
select tests.ok(tests.appt(:SOFI, :'cp2', '2027-01-04 18:10Z', 30, 0, 'pending_payment') is not null,
                'turno pegado al final del tiempo extra (18:10): se acepta');
select tests.ok(tests.appt(:CARO, :'cp2', '2027-01-04 17:00Z', 60, 0, 'pending_payment') is not null,
                'otra profesional a la misma hora: se acepta');

select tests.appt(:SOFI, :'cp1', '2027-01-05 17:00Z', 60, 0, 'pending_payment') as a_pend \gset
update public.appointments set status = 'cancelled' where id = :'a_pend';
select tests.ok(tests.appt(:SOFI, :'cp2', '2027-01-05 17:00Z', 60, 0, 'pending_payment') is not null,
                'una reserva cancelada libera el horario');
select tests.appt(:SOFI, :'cp1', '2027-01-06 17:00Z', 60, 0, 'pending_payment') as a_exp \gset
update public.appointments set status = 'expired' where id = :'a_exp';
select tests.ok(tests.appt(:SOFI, :'cp2', '2027-01-06 17:00Z', 60, 0, 'pending_payment') is not null,
                'una reserva vencida libera el horario');

-- ---------------------------------------------------------------------
-- Coherencia de lo acordado
-- ---------------------------------------------------------------------
select tests.appt(:SOFI, :'cp1', '2027-01-07 17:00Z', 60, 0, 'pending_payment', 1250000, 50) as d1 \gset
select tests.appt(:SOFI, :'cp1', '2027-01-08 17:00Z', 60, 0, 'pending_payment', 1255500, 50) as d2 \gset
select tests.ok((select deposit_minor = 625000 from public.appointments where id = :'d1'), 'seña: 50% de $ 12.500 = $ 6.250');
select tests.ok((select deposit_minor = 627800 from public.appointments where id = :'d2'),
                'seña redondeada hacia arriba al peso: 50% de $ 12.555 = $ 6.278 (B8)');
select tests.throws(format($$update public.appointments set deposit_minor = 1 where id = %L$$, :'a1'),
                    'la seña no se puede cambiar', 'no se puede modificar');
select tests.throws(format($$update public.appointments set price_minor = 1 where id = %L$$, :'a1'),
                    'el precio acordado no se puede cambiar', 'no se puede modificar');
select tests.throws(format($$update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour', occupied_until = occupied_until + interval '1 hour' where id = %L$$, :'a1'),
                    'el horario no se cambia por update (reprogramar llega con la Épica 07)', 'no se puede modificar');
select tests.throws(format($$insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at, occupied_until,
  service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from, currency, deposit_percent, deposit_minor,
  policy_version, cancellation_window_hours, status, deposit_status, hold_expires_at, source)
  values (%L, 'ABCDEF', %L, %L, %L, '2027-02-01 17:00Z', '2027-02-01 18:30Z', '2027-02-01 18:30Z', 'X servicio', 'Pro', 60, 0, 100, false, 'ARS', 50, 100, %s, 24,
  'pending_payment', 'pending', now() + interval '1 hour', 'online')$$, :A, :'cp1', :SOFI, :SEMI, :pv),
                    'el fin tiene que coincidir con inicio + duración', 'appointments_times');
select tests.throws(format($$insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at, occupied_until,
  service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from, currency, deposit_percent, deposit_minor,
  policy_version, cancellation_window_hours, status, deposit_status, hold_expires_at, source)
  values (%L, 'ABCDEG', %L, %L, %L, '2027-02-01 17:00Z', '2027-02-01 18:00Z', '2027-02-01 18:00Z', 'X servicio', 'Pro', 60, 0, 100000, false, 'ARS', 0, 0, %s, 24,
  'pending_payment', 'pending', now() + interval '1 hour', 'online')$$, :A, :'cp1', :SOFI, :SEMI, :pv),
                    'toda reserva lleva seña (B9): 0% rechazado', 'appointments_deposit');
select tests.throws(format($$insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at, occupied_until,
  service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from, currency, deposit_percent, deposit_minor,
  policy_version, cancellation_window_hours, status, deposit_status, source)
  values (%L, 'ABCDEH', %L, %L, %L, '2027-02-01 17:00Z', '2027-02-01 18:00Z', '2027-02-01 18:00Z', 'X servicio', 'Pro', 60, 0, 100000, false, 'ARS', 50, 50000, %s, 24,
  'confirmed', 'pending', 'online')$$, :A, :'cp1', :SOFI, :SEMI, :pv),
                    'no hay confirmada sin seña pagada', 'appointments_confirmed_paid');
select tests.throws(format($$insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at, occupied_until,
  service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from, currency, deposit_percent, deposit_minor,
  policy_version, cancellation_window_hours, status, deposit_status, hold_expires_at, source)
  values (%L, 'ABCDEJ', %L, %L, %L, '2027-02-01 17:00Z', '2027-02-01 18:00Z', '2027-02-01 18:00Z', 'X servicio', 'Pro', 60, 0, 100000, false, 'ARS', 50, 50000, %s, 24,
  'pending_payment', 'pending', now() + interval '1 hour', 'online')$$, :B, :'cp1', :SOFI, :SEMI, :pv),
                    'integridad: una reserva de B no puede usar ficha, profesional ni servicio de A', 'appointments_');

-- ---------------------------------------------------------------------
-- Estados e historial
-- ---------------------------------------------------------------------
select tests.appt(:CARO, :'cp1', '2027-01-11 17:00Z', 60, 0, 'pending_payment') as a_flow \gset
select tests.ok((select code ~ '^[2-9A-HJKMNP-Z]{6}$' from public.appointments where id = :'a_flow'),
                'código de reserva: 6 caracteres sin 0, O, 1, I ni L');
select set_config('app.event_detail', '{"via": "test"}', true);
update public.appointments set deposit_status = 'paid', status = 'confirmed' where id = :'a_flow';
select tests.ok((select array_agg(event_type order by id) = array['created', 'deposit_paid', 'confirmed']
                 from public.appointment_events where appointment_id = :'a_flow'),
                'historial: creada → seña pagada → confirmada');
select tests.ok((select detail ->> 'via' = 'test' from public.appointment_events where appointment_id = :'a_flow' and event_type = 'confirmed'),
                'historial: guarda el detalle que indica la función');
select tests.throws(format($$update public.appointments set status = 'pending_payment', deposit_status = 'pending' where id = %L$$, :'a_flow'),
                    'estados: una confirmada no vuelve a esperando pago', 'no permitido');
update public.appointments set status = 'cancelled' where id = :'a_flow';
select tests.throws(format($$update public.appointments set status = 'confirmed' where id = %L$$, :'a_flow'),
                    'estados: una cancelada es final', 'no permitido');
select tests.throws($$delete from public.appointment_events$$, 'historial: nadie puede borrarlo', 'solo agregado');
select tests.throws($$update public.appointment_events set detail = '{}'$$, 'historial: nadie puede editarlo', 'solo agregado');

-- ---------------------------------------------------------------------
-- Quién ve qué
-- ---------------------------------------------------------------------
:as_cli1
select tests.ok((select count(*) > 0 and bool_and(client_profile_id = :'cp1') from public.appointments),
                'clienta 1: ve solo sus reservas');
select tests.ok((select count(*) = 0 from public.appointments where client_profile_id = :'cp2'), 'clienta 1: no ve las de la clienta 2');
select tests.ok((select count(*) > 0 from public.appointment_events), 'clienta 1: ve el historial de sus reservas');
select tests.throws(format($$update public.appointments set status = 'cancelled' where id = %L$$, :'a1'),
                    'clienta: no puede cambiar reservas directo', 'permission denied');
select tests.throws(format($$insert into public.appointments (tenant_id) values (%L)$$, :A),
                    'clienta: no puede crear reservas directo', 'permission denied');

:as_pro_a
select tests.ok((select count(*) > 0 and bool_and(professional_id = :SOFI) from public.appointments),
                'profesional (Sofi, agenda.read_own): ve solo sus turnos');
:as_owner_a
select tests.ok((select count(distinct professional_id) = 2 from public.appointments), 'dueña: ve los turnos de todas las profesionales');
select tests.throws(format($$update public.appointments set status = 'cancelled' where id = %L$$, :'a1'),
                    'dueña: tampoco escribe directo (todo por funciones)', 'permission denied');
:as_owner_b
select tests.ok((select count(*) = 0 from public.appointments), 'dueña B: no ve reservas de A');
:as_admin
select tests.ok((select count(*) = 0 from public.appointments), 'Cleo Admin: no ve reservas');
:as_anon
select tests.throws('select * from public.appointments', 'anon: no puede leer reservas', 'permission denied');

\ir lib/finish.sql
