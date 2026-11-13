-- =====================================================================
-- Tests de reprogramación (Sprint 6 · migración 2730 · POL-04, POL-05, C3, C4)
-- =====================================================================
\ir lib/setup.sql
\ir lib/sprint6.sql

:as_super
-- Horarios libres de verdad para el sitio (horario de Sofi, 12 h de anticipación, etc.)
select starts_at as slot1 from app.free_slots(:A, :SEMI, :SOFI, now() + interval '2 days', now() + interval '20 days', true)
 order by starts_at limit 1 \gset
select starts_at as slot2 from app.free_slots(:A, :SEMI, :SOFI, now() + interval '2 days', now() + interval '20 days', true)
 where starts_at >= :'slot1'::timestamptz + interval '3 hours' order by starts_at limit 1 \gset
select starts_at as slot3 from app.free_slots(:A, :SEMI, :SOFI, now() + interval '2 days', now() + interval '20 days', true)
 where starts_at >= :'slot2'::timestamptz + interval '3 hours' order by starts_at limit 1 \gset

-- ---------------------------------------------------------------------
-- Clienta, con 24 h o más: se mueve el mismo turno y la seña pasa entera
-- ---------------------------------------------------------------------
select tests.appt6(:'cp1', date_trunc('hour', now()) + interval '30 days 3 hours') as r1 \gset
select code as r1_code from public.appointments where id = :'r1' \gset
:as_cli1
select tests.ok((select can_reschedule_online and keeps_deposit from public.get_my_booking_terms('fresas', :'r1_code')),
  'clienta: puede cambiar el turno online y conserva la seña');
select code as r1_new_code from public.reschedule_my_booking('fresas', :'r1_code', :SOFI, :'slot1', 'transferred') \gset
:as_super
select id as r1_new from public.appointments where code = :'r1_new_code' and tenant_id = :A \gset
select tests.ok((select status = 'rescheduled' and deposit_outcome = 'transferred' and deposit_outcome_minor = 750000
                 from public.appointments where id = :'r1'),
  'el turno viejo queda reprogramado y su seña "pasó al turno nuevo"');
select tests.ok((select status = 'confirmed' and deposit_status = 'transferred' and starts_at = :'slot1'::timestamptz
                        and price_minor = 1500000 and deposit_minor = 750000 and rescheduled_from = :'r1' and reschedule_count = 1
                        and hold_expires_at is null
                 from public.appointments where id = :'r1_new'),
  'el turno nuevo queda confirmado con el mismo precio y la seña transferida');
select tests.ok(not exists (select 1 from public.client_credit_entries where client_profile_id = :'cp1'),
  'reprogramar a tiempo no mueve el saldo a favor');
select tests.ok(exists (select 1 from public.appointment_events where appointment_id = :'r1_new' and event_type = 'rescheduled_in')
                and exists (select 1 from public.appointment_events where appointment_id = :'r1' and event_type = 'rescheduled'),
  'los dos turnos lo registran en su historial');
:as_cli1
select tests.ok((select rescheduled_to_code = :'r1_new_code' from public.my_bookings('fresas') where code = :'r1_code'),
  '"Mis turnos" enlaza el turno viejo con el nuevo');

-- Desde el sitio, una sola vez
select tests.ok((select not can_reschedule_online from public.get_my_booking_terms('fresas', :'r1_new_code')),
  'después de cambiarlo una vez, el sitio ya no ofrece cambiarlo');
select tests.throws(format($$select * from public.reschedule_my_booking('fresas', %L, %L, %L, 'transferred')$$, :'r1_new_code', :SOFI, :'slot2'),
  'clienta: no puede cambiar online el mismo turno dos veces', 'una vez');
-- Desde el panel, sin límite (y puede cambiar de profesional: el precio no cambia)
:as_owner_a
select appointment_id as r1_third from public.reschedule_booking(:'r1_new', :CARO, :'slot2'::timestamptz + interval '1 hour', true, null, 'transferred') \gset
:as_super
select tests.ok((select professional_id = :CARO and price_minor = 1500000 and duration_minutes = 75 and reschedule_count = 2
                        and deposit_status = 'transferred'
                 from public.appointments where id = :'r1_third'),
  'panel: lo cambia de nuevo, a otra profesional; el precio acordado se mantiene (dura lo que tarda ella)');

-- ---------------------------------------------------------------------
-- Clienta, con menos de 24 h: la seña se pierde y el turno nuevo pide seña nueva
-- ---------------------------------------------------------------------
select tests.appt6(:'cp2', now() + interval '20 hours', 'confirmed', 24, :CARO) as r2 \gset
select code as r2_code from public.appointments where id = :'r2' \gset
:as_cli2
select tests.ok((select can_reschedule_online and not keeps_deposit from public.get_my_booking_terms('fresas', :'r2_code')),
  'clienta, a 20 h: ve que pierde la seña si lo cambia');
select tests.throws(format($$select * from public.reschedule_my_booking('fresas', %L, %L, %L, 'transferred')$$, :'r2_code', :SOFI, :'slot3'),
  'si esperaba conservar la seña: no se hace nada', 'Pasó el plazo');
:as_super
select tests.ok((select status = 'confirmed' from public.appointments where id = :'r2'), '…el turno sigue igual');
:as_cli2
select code as r2_new_code, status as r2_new_status from public.reschedule_my_booking('fresas', :'r2_code', :SOFI, :'slot3', 'forfeited') \gset
:as_super
select tests.ok(:'r2_new_status' = 'pending_payment', 'aceptando perderla: el turno nuevo espera el pago de una seña nueva');
select tests.ok((select deposit_outcome = 'forfeited' from public.appointments where id = :'r2'),
  'la seña anterior se pierde');
select tests.ok((select deposit_minor = 750000 and credit_applied_minor = 0 and hold_expires_at > now() and source = 'online'
                 from public.appointments where code = :'r2_new_code' and tenant_id = :A),
  'la seña nueva es la misma (mismo precio y %), con el tiempo normal para pagar');
select tests.ok((select count(*) = 0 from public.appointments where id = :'r2' and status in ('pending_payment', 'confirmed')),
  'el horario viejo se libera en el momento');

-- Con saldo a favor, la seña nueva la cubre el saldo
select tests.appt6(:'cp1', now() + interval '10 hours', 'confirmed', 24, :SOFI, 30) as r3 \gset
:as_owner_a
select public.adjust_client_credit(:'cp1', 750000, 'Saldo para la prueba');
select status as r3_new_status from public.reschedule_booking(:'r3', :SOFI, date_trunc('hour', now()) + interval '40 days', true, null, 'forfeited') \gset
:as_super
select tests.ok(:'r3_new_status' = 'confirmed' and tests.credit(:'cp1') = 0,
  'panel, reprogramación tardía con saldo: el saldo cubre la seña nueva');

-- Panel, tardía, cobrando la seña nueva en el estudio
select tests.appt6(:'cp2', now() + interval '5 hours', 'confirmed', 24, :CARO, 30) as r4 \gset
:as_owner_a
select status as r4_new_status from public.reschedule_booking(:'r4', :CARO, date_trunc('hour', now()) + interval '41 days', true, 'cash', 'forfeited') \gset
:as_super
select tests.ok(:'r4_new_status' = 'confirmed', 'panel, tardía: la seña nueva cobrada en efectivo deja el turno confirmado');

-- ---------------------------------------------------------------------
-- El horario nuevo tiene que estar libre; si no, no cambia nada
-- ---------------------------------------------------------------------
select tests.appt6(:'cp2', date_trunc('hour', now()) + interval '50 days') as busy \gset
select tests.appt6(:'cp1', date_trunc('hour', now()) + interval '51 days') as r5 \gset
:as_owner_a
select tests.throws(format($$select * from public.reschedule_booking(%L, %L, %L, true, null, 'transferred')$$,
                           :'r5', :SOFI, (date_trunc('hour', now()) + interval '50 days 30 minutes')::text),
  'a un horario ocupado por otro turno: rechazado', 'ocupar');
:as_super
select tests.ok((select status = 'confirmed' and deposit_outcome is null from public.appointments where id = :'r5'),
  '…y el turno original sigue confirmado, sin cambios');
:as_owner_a
select tests.ok((select status = 'confirmed' from public.reschedule_booking(:'r5', :SOFI,
                   date_trunc('hour', now()) + interval '51 days 30 minutes', true, null, 'transferred')),
  'moverlo media hora (se superpone con su propio horario viejo): se puede');

-- ---------------------------------------------------------------------
-- La seña transferida sigue siendo la misma: si después cancela el estudio y la
-- devuelve, se devuelve el pago original de Mercado Pago
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp2', now() + interval '6 days', 'pending_payment') as r6 \gset
select tests.intent6(:'r6') as r6_intent \gset
:as_service
select public.svc_mp_sync_payment(:ACC, tests.mp6('9300001', :'r6_intent'), 'webhook');
:as_owner_a
select appointment_id as r6_new from public.reschedule_booking(:'r6', :SOFI, date_trunc('hour', now()) + interval '52 days', true, null, 'transferred') \gset
select tests.ok((select outcome = 'refunded' from public.cancel_booking(:'r6_new', 'studio', 'Cierre por obra', 'refund', null, 'refunded')),
  'turno reprogramado y después cancelado por el estudio con devolución');
:as_super
select tests.ok(exists (select 1 from public.payment_refunds r join public.payments p on p.id = r.payment_id
                        where p.provider_payment_id = '9300001' and r.reason = 'studio_cancelled'),
  '…se devuelve el pago original de Mercado Pago');

-- Un pago para el turno viejo (ya reprogramado) se devuelve
select tests.intent6(:'r6') as r6_intent2 \gset
:as_service
select tests.ok((select outcome = 'refund_pending' from public.svc_mp_sync_payment(:ACC, tests.mp6('9300002', :'r6_intent2'), 'webhook')),
  'un pago que llega para el turno viejo se devuelve');

-- ---------------------------------------------------------------------
-- Reglas y permisos
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp1', now() + interval '9 days', 'pending_payment') as pend \gset
select tests.appt6(:'cp1', date_trunc('hour', now()) + interval '53 days') as perm \gset
select code as perm_code from public.appointments where id = :'perm' \gset
:as_owner_a
select tests.throws(format($$select * from public.reschedule_booking(%L, null, now() + interval '20 days', true, null, 'transferred')$$, :'pend'),
  'una reserva esperando pago no se reprograma (se libera)', 'liberalo');
select tests.throws(format($$select * from public.reschedule_booking(%L, %L, now() - interval '1 hour', true, null, 'transferred')$$, :'perm', :SOFI),
  'no se reprograma a un horario que ya pasó', 'no haya pasado');
select tests.throws(format($$select * from public.reschedule_booking(%L, %L, now() + interval '20 days', true, 'cash', 'transferred')$$, :'perm', :SOFI),
  'a tiempo no hay nada que cobrar', 'no hay que cobrar');
:as_pro_a
select tests.throws(format($$select * from public.reschedule_booking(%L, null, now() + interval '20 days', true, null, 'transferred')$$, :'perm'),
  'profesional: no puede reprogramar', 'permiso');
:as_owner_b
select tests.throws(format($$select * from public.reschedule_booking(%L, null, now() + interval '20 days', true, null, 'transferred')$$, :'perm'),
  'dueña de B: no puede reprogramar turnos de A', 'permiso');
:as_cli2
select tests.throws(format($$select * from public.reschedule_my_booking('fresas', %L, null, %L, 'transferred')$$, :'perm_code', :'slot2'),
  'otra clienta: no puede cambiar un turno ajeno', 'No encontramos');
:as_cli1
select tests.throws(format($$select * from public.reschedule_my_booking('fresas', %L, null, now() + interval '1 hour', 'transferred')$$, :'perm_code'),
  'clienta: el horario nuevo respeta la anticipación mínima', 'anticipación');
select tests.throws(format($$select * from public.reschedule_my_booking('fresas', %L, null, %L::timestamptz + interval '7 minutes', 'transferred')$$, :'perm_code', :'slot2'),
  'clienta: solo horarios que ofrece el sitio', 'no está disponible');

:as_super
\ir lib/finish.sql
