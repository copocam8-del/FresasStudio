-- =====================================================================
-- Tests de turnos del panel y confirmación de la seña (Sprint 4 · migración 2000)
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set SEMI '''31000000-0000-4000-a000-000000000001'''
\set HENNA '''31000000-0000-4000-a000-000000000007'''

:as_super
select (current_date + 8 + ((8 - extract(isodow from current_date + 8)::int) % 7))::date as d \gset
select (:'d'::date + 6)::date as sunday \gset
create function tests.at(p_day date, p_time time) returns timestamptz
language sql immutable as $$ select (p_day + p_time) at time zone 'America/Argentina/Buenos_Aires' $$;

-- ---------------------------------------------------------------------
-- Turno manual (la encargada tiene agenda.manage y cash.manage)
-- ---------------------------------------------------------------------
:as_manager_a
select * from public.create_manual_booking(:A, null, 'Rocío (WhatsApp)', '11 4444-1111', :SEMI, :SOFI,
  tests.at(:'d', '14:00'), false, 'transfer', 'Pagó por transferencia') \gset m1_
select tests.ok(:'m1_status' = 'confirmed', 'manual con seña cobrada por transferencia: queda confirmado (B11)');
:as_super
select tests.ok((select deposit_status = 'paid_offline' and source = 'staff' and deposit_minor = 750000
                 from public.appointments where id = :'m1_appointment_id'),
                'manual: seña "cobrada sin pago online", origen panel, foto de lo acordado igual que online');
select tests.ok((select source = 'staff' and phone = '11 4444-1111' from public.client_profiles where full_name = 'Rocío (WhatsApp)'),
                'manual: la clienta nueva queda cargada como ficha del estudio');
select tests.ok((select array_agg(event_type order by id) = array['created', 'deposit_paid_offline']
                        and bool_or(detail ->> 'payment_method' = 'transfer')
                 from public.appointment_events where appointment_id = :'m1_appointment_id'),
                'historial: creado + seña cobrada por transferencia');

:as_manager_a
select * from public.create_manual_booking(:A, null, 'Sol', '11 4444-2222', :SEMI, :CARO,
  tests.at(:'d', '09:00'), false, null) \gset m2_
select tests.ok(:'m2_status' = 'pending_payment' and abs(extract(epoch from (:'m2_hold_expires_at'::timestamptz - now())) - 7200) < 5,
                'manual sin seña cobrada: queda esperando pago con el mismo vencimiento (2 h)');
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'Sol', '11 4444-2222', %L, %L, %L, false, null)$$,
                           :A, :HENNA, :CARO, tests.at(:'d', '11:00')),
                    'manual: si la profesional no hace el servicio, lo dice claro', 'no hace ese servicio');
:as_super
insert into public.professional_services (tenant_id, professional_id, service_id) values (:A, :CARO, :HENNA);
:as_manager_a
select tests.ok((select count(*) = 1 from public.create_manual_booking(:A, null, 'Sol', '11 4444-2222', :HENNA, :CARO,
                   tests.at(:'d', '11:00'), false, null)),
                'manual: puede reservar un servicio que no se ofrece online');

-- Fuera de horario: solo con el tilde; superponerse, nunca
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'Domi', '11 4444-3333', %L, %L, %L, false, 'cash')$$,
                           :A, :SEMI, :SOFI, tests.at(:'sunday', '10:00')),
                    'manual en domingo sin el tilde: no disponible', 'no está disponible');
select * from public.create_manual_booking(:A, null, 'Domi', '11 4444-3333', :SEMI, :SOFI,
  tests.at(:'sunday', '10:00'), true, 'cash') \gset m3_
select tests.ok((select forced_outside_hours from public.appointments where id = :'m3_appointment_id'),
                'manual forzado fuera de horario: se acepta y queda marcado');
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'Otra', '11 4444-4444', %L, %L, %L, true, 'cash')$$,
                           :A, :SEMI, :SOFI, tests.at(:'d', '14:30')),
                    'manual forzado encima de otro turno: IMPOSIBLE', 'se acaba de ocupar');
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'X', '11 4444-5555', %L, %L, %L, false, 'bitcoin')$$,
                           :A, :SEMI, :SOFI, tests.at(:'d', '17:00')),
                    'medio de pago inválido', 'Medio de pago inválido');
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'Xime', 'sin tel', %L, %L, %L, false, null)$$,
                           :A, :SEMI, :SOFI, tests.at(:'d', '17:00')),
                    'clienta nueva sin teléfono válido', 'teléfono válido');

-- Permisos
:as_pro_a
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'X', '11 4444-6666', %L, %L, %L, false, null)$$,
                           :A, :SEMI, :SOFI, tests.at(:'d', '17:00')),
                    'la profesional no puede cargar turnos', 'No tenés permiso');
:as_owner_b
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'X', '11 4444-6666', %L, %L, %L, false, null)$$,
                           :A, :SEMI, :SOFI, tests.at(:'d', '17:00')),
                    'dueña B: no puede cargar turnos en A', 'No tenés permiso');
:as_super
-- Un rol con agenda.manage pero SIN cash.manage
insert into public.roles (id, tenant_id, key, name) values ('50000000-0000-4000-a000-000000000001', :A, 'agenda_solo', 'Solo agenda');
insert into public.role_permissions (role_id, permission_code) values ('50000000-0000-4000-a000-000000000001', 'agenda.manage');
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-f000-000000000001', 'agenda@fresasstudio.test', now());
insert into public.memberships (tenant_id, user_id, role_id) values (:A, '00000000-0000-4000-f000-000000000001', '50000000-0000-4000-a000-000000000001');
\set as_agenda 'reset role; do $x$ begin perform tests.login(''agenda@fresasstudio.test''); end $x$; set local role authenticated;'
:as_agenda
select tests.throws(format($$select * from public.create_manual_booking(%L, null, 'X', '11 4444-7777', %L, %L, %L, false, 'cash')$$,
                           :A, :SEMI, :SOFI, tests.at(:'d', '17:00')),
                    'sin cash.manage no puede registrar la seña como cobrada', 'registrar cobros');
select tests.ok((select count(*) = 1 from public.create_manual_booking(:A, null, 'Yani', '11 4444-8888', :SEMI, :SOFI,
                   tests.at(:'d', '17:00'), false, null)),
                'sin cash.manage sí puede cargarlo esperando pago');

-- ---------------------------------------------------------------------
-- Seña cobrada sin pago online y cancelación sin seña
-- ---------------------------------------------------------------------
:as_agenda
select tests.throws(format($$select public.mark_deposit_paid_offline(%L, 'cash')$$, :'m2_appointment_id'),
                    'sin cash.manage no puede marcar la seña cobrada', 'No tenés permiso');
:as_manager_a
select public.mark_deposit_paid_offline(:'m2_appointment_id', 'cash');
select tests.ok((select status = 'confirmed' and deposit_status = 'paid_offline' from public.appointments where id = :'m2_appointment_id'),
                'marcar seña cobrada en efectivo: el turno queda confirmado');
select tests.throws(format($$select public.mark_deposit_paid_offline(%L, 'cash')$$, :'m2_appointment_id'),
                    'no se puede marcar dos veces', 'ya no está esperando pago');
select tests.throws(format($$select public.cancel_unpaid_booking(%L, 'se arrepintió')$$, :'m2_appointment_id'),
                    'B13: un turno con seña cobrada no se cancela todavía (Épica 07)', 'Solo se puede cancelar un turno sin seña');

select * from public.create_manual_booking(:A, null, 'Vale', '11 4444-9999', :SEMI, :CARO,
  tests.at(:'d', '15:00'), false, null) \gset m4_
:as_pro_a
select tests.throws(format($$select public.cancel_unpaid_booking(%L)$$, :'m4_appointment_id'),
                    'la profesional no puede cancelar', 'No tenés permiso');
:as_manager_a
select public.cancel_unpaid_booking(:'m4_appointment_id', 'No confirmó por WhatsApp');
select tests.ok((select status = 'cancelled' from public.appointments where id = :'m4_appointment_id'),
                'cancelar un turno sin seña cobrada: queda cancelado');
:as_super
select tests.ok((select detail ->> 'note' = 'No confirmó por WhatsApp' from public.appointment_events
                 where appointment_id = :'m4_appointment_id' and event_type = 'cancelled'),
                'historial: la cancelación guarda el motivo');

-- Vencido: no se puede marcar cobrado
-- (se crea y se vence en sentencias separadas: una sentencia no ve las filas que crea)
select appointment_id as luz from public.create_manual_booking(:A, null, 'Luz', '11 4333-0000', :SEMI, :CARO, tests.at(:'d', '16:30'), false, null) \gset
update public.appointments set hold_expires_at = now() - interval '1 second' where id = :'luz';
:as_manager_a
select tests.throws(format('select public.mark_deposit_paid_offline(%L, ''cash'')', :'luz'),
                    'un turno vencido no se puede marcar cobrado', 'ya no está esperando pago');

-- ---------------------------------------------------------------------
-- Confirmación por pago verificado (solo servidor)
-- ---------------------------------------------------------------------
:as_super
select appointment_id as p5 from public.create_manual_booking(:A, null, 'Paz', '11 4333-1111', :SEMI, :CARO,
  tests.at(:'d', '17:00'), false, null) \gset
:as_owner_a
select tests.throws(format($$select app.confirm_deposit_payment(%L, 'MP-1', 650000)$$, :'p5'),
                    'nadie puede confirmar un pago desde la API (ni la dueña)', 'permission denied');
:as_super
select tests.throws(format($$select app.confirm_deposit_payment(%L, 'MP-1', 1)$$, :'p5'),
                    'pago con monto distinto a la seña: rechazado', 'no coincide con la seña');
select tests.ok(app.confirm_deposit_payment(:'p5', 'MP-1', 650000) = 'confirmed', 'pago verificado por el monto exacto: confirma');
select tests.ok(app.confirm_deposit_payment(:'p5', 'MP-1', 650000) = 'confirmed'
                and (select count(*) = 1 from public.appointment_events where appointment_id = :'p5' and event_type = 'deposit_paid'),
                'el mismo pago avisado dos veces no confirma dos veces (idempotente)');
select tests.ok((select detail ->> 'payment_ref' = 'MP-1' from public.appointment_events where appointment_id = :'p5' and event_type = 'deposit_paid'),
                'historial: guarda la referencia del pago');
select tests.throws(format($$select app.confirm_deposit_payment(%L, 'MP-2', 750000)$$, :'m4_appointment_id'),
                    'un pago de una reserva cancelada no la reactiva sola', 'ya no está activa');

-- Simulación de pago: solo en el seed de desarrollo y solo la dueña de la reserva
:as_super
update public.tenant_settings set payments_connected = true, online_booking_enabled = true where tenant_id = :A;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-f000-000000000002', 'mia@gmail.test', now()),
                                                             ('00000000-0000-4000-f000-000000000003', 'noa@gmail.test', now());
\set as_mia 'reset role; do $x$ begin perform tests.login(''mia@gmail.test''); end $x$; set local role authenticated;'
\set as_noa 'reset role; do $x$ begin perform tests.login(''noa@gmail.test''); end $x$; set local role authenticated;'
:as_mia
select code as mia_code from public.create_online_booking('fresas', :SEMI, :CARO, tests.at(:'d', '14:00'),
  (select (public.get_booking_context('fresas') ->> 'policy_version')::int), '11 4222-0000') \gset
:as_noa
select tests.throws(format($$select public.dev_simulate_deposit_payment('fresas', %L)$$, :'mia_code'),
                    'simulación: otra persona no puede "pagar" una reserva ajena', 'No encontramos');
:as_mia
select public.dev_simulate_deposit_payment('fresas', :'mia_code');
select tests.ok((select status = 'confirmed' and deposit_status = 'paid' from public.my_bookings('fresas') where code = :'mia_code'),
                'simulación (desarrollo): confirma por el mismo camino que el webhook real');

\ir lib/finish.sql
