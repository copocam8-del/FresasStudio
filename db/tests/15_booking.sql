-- =====================================================================
-- Tests de reservas online (Sprint 4 · migración 1900), con el seed de Fresas.
-- D = un lunes entre 8 y 14 días adelante (ver 14_availability.sql).
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set SEMI '''31000000-0000-4000-a000-000000000001'''
\set HENNA '''31000000-0000-4000-a000-000000000007'''

:as_super
update public.tenant_settings set payments_connected = true, online_booking_enabled = true where tenant_id = :A;
select (current_date + 8 + ((8 - extract(isodow from current_date + 8)::int) % 7))::date as d \gset
select policy_version as pv from public.tenant_settings where tenant_id = :A \gset
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-e000-000000000001', 'ana@gmail.test', now(), '{"full_name": "Ana"}'),
  ('00000000-0000-4000-e000-000000000002', 'bea@gmail.test', now(), '{"full_name": "Bea"}'),
  ('00000000-0000-4000-e000-000000000003', 'cata@gmail.test', now(), '{"full_name": "Cata"}');
\set as_ana  'reset role; do $x$ begin perform tests.login(''ana@gmail.test''); end $x$; set local role authenticated;'
\set as_bea  'reset role; do $x$ begin perform tests.login(''bea@gmail.test''); end $x$; set local role authenticated;'
\set as_cata 'reset role; do $x$ begin perform tests.login(''cata@gmail.test''); end $x$; set local role authenticated;'
-- Hora local de Buenos Aires del día D
create function tests.at(p_day date, p_time time) returns timestamptz
language sql immutable as $$ select (p_day + p_time) at time zone 'America/Argentina/Buenos_Aires' $$;

-- ---------------------------------------------------------------------
-- Reserva con profesional elegida: foto de lo acordado y bloqueo temporal
-- ---------------------------------------------------------------------
:as_ana
select * from public.create_online_booking('fresas', :SEMI, :SOFI, tests.at(:'d', '14:00'), :pv, '11 5555-0001', 'Primera vez') \gset ana_
:as_super
select * from public.appointments where code = :'ana_code' \gset r_
select tests.ok(:'r_status' = 'pending_payment' and :'r_deposit_status' = 'pending' and :'r_source' = 'online',
                'reserva online: queda esperando pago (B9: toda reserva lleva seña)');
select tests.ok(:'r_service_name' = 'Esmaltado semipermanente' and :'r_professional_name' = 'Sofi'
                and :r_duration_minutes = 60 and :r_buffer_minutes = 10 and :r_price_minor = 1500000
                and :r_deposit_percent = 50 and :r_deposit_minor = 750000 and :r_policy_version = :pv
                and :r_cancellation_window_hours = 24 and :'r_currency' = 'ARS',
                'foto de lo acordado: servicio, profesional, 60+10 min, $ 15.000, seña 50% = $ 7.500, política vigente y 24 h');
select tests.ok(abs(extract(epoch from (:'r_hold_expires_at'::timestamptz - now())) - 7200) < 5,
                'bloqueo temporal: vence a las 2 horas (booking_hold_minutes = 120)');
select tests.ok((select phone = '11 5555-0001' and full_name = 'Ana' from public.client_profiles where id = :'r_client_profile_id'),
                'la ficha de la clienta se crea sola y guarda su teléfono (B6)');
select tests.ok((select array_agg(event_type) = array['created'] from public.appointment_events where appointment_id = :'r_id'),
                'historial: "created"');

-- Duración y precio propios (Caro: 75 min, $ 13.000, seña $ 6.500)
:as_bea
select * from public.create_online_booking('fresas', :SEMI, :CARO, tests.at(:'d', '09:00'), :pv, '11 5555-0002') \gset bea_
:as_super
select tests.ok((select duration_minutes = 75 and price_minor = 1300000 and deposit_minor = 650000
                        and ends_at = tests.at(:'d', '10:15') and occupied_until = tests.at(:'d', '10:25')
                 from public.appointments where code = :'bea_code'),
                'con Caro: 75 min, $ 13.000, seña $ 6.500; ocupa hasta las 10:25 con el tiempo extra');

-- B4: "cualquiera" asigna a la que tenga menos turnos ese día
:as_cata
select * from public.create_online_booking('fresas', :SEMI, null, tests.at(:'d', '16:00'), :pv, '11 5555-0003') \gset cata_
select tests.ok(:'cata_professional_name' = 'Sofi',
                'B4: Sofi y Caro tenían 1 turno cada una ese día → empate, gana la primera del panel (Sofi)');
:as_super
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-e000-000000000005', 'eli@gmail.test', now());
\set as_eli 'reset role; do $x$ begin perform tests.login(''eli@gmail.test''); end $x$; set local role authenticated;'
:as_eli
select * from public.create_online_booking('fresas', :SEMI, null, tests.at(:'d', '17:30'), :pv, '11 5555-0005') \gset eli_
select tests.ok(:'eli_professional_name' = 'Caro',
                'B4: ahora Sofi tiene 2 y Caro 1 → "cualquiera" asigna a Caro');

-- ---------------------------------------------------------------------
-- Validaciones (todas en el servidor)
-- ---------------------------------------------------------------------
:as_ana
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0001')$$, :SEMI, :CARO, tests.at(:'d', '15:00'), :pv),
                    'B7: con una reserva esperando pago no puede apartar otra', 'Ya tenés una reserva esperando pago');
:as_super
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-e000-000000000004', 'dani@gmail.test', now());
\set as_dani 'reset role; do $x$ begin perform tests.login(''dani@gmail.test''); end $x$; set local role authenticated;'
:as_dani
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0004')$$, :SEMI, :SOFI, tests.at(:'d', '14:30'), :pv),
                    'horario ocupado (pisa la reserva de Ana 14:00–15:10)', 'no está disponible');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0004')$$, :SEMI, :CARO, tests.at(:'d', '13:00'), :pv),
                    'horario en el descanso: no disponible', 'no está disponible');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0004')$$, :SEMI, :CARO, tests.at(:'d', '14:07'), :pv),
                    'horario no alineado al intervalo: no disponible', 'no está disponible');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0004')$$, :SEMI, :CARO, tests.at(:'d', '14:00'), :pv - 1),
                    'política desactualizada: hay que aceptarla de nuevo', 'La política del estudio cambió');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, 'llamame')$$, :SEMI, :CARO, tests.at(:'d', '14:00'), :pv),
                    'teléfono inválido (B6)', 'teléfono válido');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '')$$, :SEMI, :CARO, tests.at(:'d', '14:00'), :pv),
                    'teléfono vacío (B6)', 'teléfono válido');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, now() + interval '2 hours', %s, '11 5555-0004')$$, :SEMI, :CARO, :pv),
                    'menos de 12 h de anticipación: rechazado con mensaje claro (B3)', '12 horas de anticipación');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, now() + interval '70 days', %s, '11 5555-0004')$$, :SEMI, :CARO, :pv),
                    'más de 60 días: rechazado (B3)', '60 días');
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0004')$$, :HENNA, :CARO, tests.at(:'d', '14:00'), :pv),
                    'servicio no visible online: no se puede reservar', 'no se puede reservar');
:as_anon
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11')$$, :SEMI, :CARO, tests.at(:'d', '14:00'), :pv),
                    'sin sesión no se puede reservar (B1)', 'permission denied');

-- ---------------------------------------------------------------------
-- Vencimiento sin depender de pg_cron
-- ---------------------------------------------------------------------
:as_super
update public.appointments set hold_expires_at = now() - interval '1 second' where code = :'ana_code';
:as_dani
select * from public.create_online_booking('fresas', :SEMI, :SOFI, tests.at(:'d', '14:00'), :pv, '11 5555-0004') \gset dani_
:as_super
select tests.ok((select status = 'expired' from public.appointments where code = :'ana_code'),
                'el bloqueo vencido de Ana se libera al reservar encima y queda "expired"');
select tests.ok((select detail ->> 'reason' = 'hold_expired' from public.appointment_events e join public.appointments a on a.id = e.appointment_id
                 where a.code = :'ana_code' and e.event_type = 'expired'),
                'historial: "expired" con el motivo');
select tests.ok((select professional_name = 'Sofi' and status = 'pending_payment' from public.appointments where code = :'dani_code'),
                'Dani queda con el horario de las 14:00');

-- Ana puede volver a reservar (su pendiente venció)
:as_ana
select * from public.create_online_booking('fresas', :SEMI, :CARO, tests.at(:'d', '15:00'), :pv, '11 5555-0001') \gset ana2_
select tests.ok(:'ana2_code' is not null, 'después de vencer, la clienta puede apartar otro horario');

-- ---------------------------------------------------------------------
-- Mis turnos y liberar
-- ---------------------------------------------------------------------
select tests.ok((select count(*) = 2 from public.my_bookings('fresas')), 'mis turnos: Ana ve sus 2 reservas');
select tests.ok((select status = 'expired' from public.my_bookings('fresas') where code = :'ana_code'), 'mis turnos: la vencida figura como vencida');
:as_bea
select tests.ok((select count(*) = 1 from public.my_bookings('fresas')), 'mis turnos: Bea ve solo la suya');
select tests.throws(format($$select public.release_my_pending_booking('fresas', %L)$$, :'ana2_code'),
                    'Bea no puede liberar una reserva de Ana', 'No encontramos');
:as_ana
select public.release_my_pending_booking('fresas', lower(:'ana2_code'));
select tests.ok((select status = 'cancelled' from public.my_bookings('fresas') where code = :'ana2_code'),
                'liberar: la reserva queda cancelada (el código no distingue mayúsculas)');
:as_cata
select tests.ok((select count(*) = 1 from public.get_available_slots('fresas', :SEMI, :CARO, :'d') s where s.starts_at = tests.at(:'d', '15:00')),
                'liberar: el horario vuelve a estar disponible');

-- ---------------------------------------------------------------------
-- Lo acordado no cambia aunque cambien precio, duración o política
-- ---------------------------------------------------------------------
:as_owner_a
update public.services set price_minor = 9900000, duration_minutes = 120 where id = :SEMI;
update public.tenant_settings set cancellation_window_hours = 72, deposit_percent = 80 where tenant_id = :A;
:as_super
select tests.ok((select price_minor = 1500000 and duration_minutes = 60 and deposit_minor = 750000
                        and cancellation_window_hours = 24 and policy_version = :pv
                 from public.appointments where code = :'dani_code'),
                'cambiar precio, duración y política después de reservar NO cambia la reserva');

-- ---------------------------------------------------------------------
-- Reservas apagadas
-- ---------------------------------------------------------------------
update public.tenant_settings set online_booking_enabled = false where tenant_id = :A;
:as_cata
select tests.throws(format($$select * from public.create_online_booking('fresas', %L, %L, %L, %s, '11 5555-0003')$$, :SEMI, :CARO, tests.at(:'d', '11:00'), :pv),
                    'reservas online apagadas: no se puede reservar aunque se llame directo', 'no están disponibles');

\ir lib/finish.sql
