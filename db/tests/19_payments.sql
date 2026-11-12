-- =====================================================================
-- Tests de cobro de señas, pagos, avisos y devoluciones (Sprint 5 · migración 2400)
-- Los datos de Mercado Pago llegan "ya verificados" (así los manda el servidor).
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set ENC '''v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbb'''

:as_super
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-e000-000000000001', 'pago1@gmail.test', now(), '{"full_name": "Clienta Pago"}'),
  ('00000000-0000-4000-e000-000000000002', 'pago2@gmail.test', now(), '{"full_name": "Otra Clienta"}');
\set as_cli1 'reset role; do $x$ begin perform tests.login(''pago1@gmail.test''); end $x$; set local role authenticated;'
\set as_cli2 'reset role; do $x$ begin perform tests.login(''pago2@gmail.test''); end $x$; set local role authenticated;'
:as_cli1
select public.ensure_client_profile('fresas');
:as_cli2
select public.ensure_client_profile('fresas');

:as_super
select id as cp1 from public.client_profiles where user_id = '00000000-0000-4000-e000-000000000001' \gset
select id as cp2 from public.client_profiles where user_id = '00000000-0000-4000-e000-000000000002' \gset

-- Cuentas conectadas: A (777) y B (888)
insert into public.payment_accounts (id, tenant_id, mp_user_id, site_id, live_mode, token_expires_at)
values ('40000000-0000-4000-a000-00000000000a', :A, 777, 'MLA', false, now() + interval '180 days'),
       ('40000000-0000-4000-a000-00000000000b', :B, 888, 'MLA', false, now() + interval '180 days');
insert into public.payment_account_credentials (account_id, tenant_id, access_token_enc, refresh_token_enc, key_version, expires_at)
values ('40000000-0000-4000-a000-00000000000a', :A, :ENC, :ENC, 1, now() + interval '180 days'),
       ('40000000-0000-4000-a000-00000000000b', :B, :ENC, :ENC, 1, now() + interval '180 days');
\set ACC '''40000000-0000-4000-a000-00000000000a'''
\set ACCB '''40000000-0000-4000-a000-00000000000b'''

-- Reserva coherente (foto de lo acordado) insertada directo: seña 50% de 15.000 = 7.500
create function tests.appt(p_pro uuid, p_client uuid, p_start timestamptz, p_status public.appointment_status,
                           p_hold interval default interval '2 hours')
returns uuid language plpgsql as $$
declare v_id uuid; v_pv int;
begin
  select policy_version into v_pv from public.tenant_settings where tenant_id = '10000000-0000-4000-a000-000000000001';
  insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at,
    occupied_until, service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from,
    currency, deposit_percent, deposit_minor, policy_version, cancellation_window_hours, status, deposit_status,
    hold_expires_at, source)
  values ('10000000-0000-4000-a000-000000000001', app.generate_booking_code(), p_client, p_pro,
    '31000000-0000-4000-a000-000000000001', p_start, p_start + interval '60 minutes', p_start + interval '60 minutes',
    'Esmaltado semipermanente', 'Pro', 60, 0, 1500000, false, 'ARS', 50, 750000, v_pv, 24, p_status,
    case when p_status = 'confirmed' then 'paid_offline'::public.deposit_status else 'pending'::public.deposit_status end,
    case when p_status = 'pending_payment' then now() + p_hold end, 'staff')
  returning id into v_id;
  return v_id;
end $$;

-- Un link de pago abierto para una reserva (como lo crea start_deposit_checkout)
create function tests.intent(p_appt uuid) returns uuid language sql as $$
  insert into public.payment_intents (tenant_id, appointment_id, account_id, amount_minor, currency, expires_at)
  select tenant_id, id, '40000000-0000-4000-a000-00000000000a', deposit_minor, currency, coalesce(hold_expires_at, now())
  from public.appointments where id = p_appt
  returning id
$$;

-- Pago verificado (lo que manda el servidor después de consultar la API)
create function tests.mp(p_id text, p_ref uuid, p_status text default 'approved', p_amount bigint default 750000,
                         p_collector bigint default 777, p_refunded bigint default 0, p_currency text default 'ARS')
returns jsonb language sql as $$
  select jsonb_build_object('provider_payment_id', p_id, 'status', p_status, 'status_detail', 'accredited',
    'amount_minor', p_amount, 'refunded_minor', p_refunded, 'currency', p_currency, 'external_reference', p_ref::text,
    'collector_id', p_collector, 'live_mode', false, 'approved_at', case when p_status = 'approved' then now() end,
    'payment_method', 'visa', 'payment_type', 'credit_card', 'installments', 1, 'fee_minor', 30000, 'net_minor', 720000)
$$;
grant execute on function tests.mp(text, uuid, text, bigint, bigint, bigint, text) to service_role;

-- =====================================================================
-- "Pagar seña" (la clienta)
-- =====================================================================
select tests.appt(:SOFI, :'cp1', '2027-02-01 13:00Z', 'pending_payment') as a1 \gset
select code as a1_code from public.appointments where id = :'a1' \gset

:as_cli1
select * from public.start_deposit_checkout('fresas', :'a1_code') \gset ck_
select tests.ok(:'ck_amount_minor'::bigint = 750000 and :'ck_currency' = 'ARS' and :'ck_account_id' = :ACC
                and :'ck_studio_name' = 'Fresas Studio',
                'pagar seña: el monto sale de la reserva (7.500) y se cobra en la cuenta del estudio');
select tests.ok((select intent_id = :'ck_intent_id' from public.start_deposit_checkout('fresas', :'a1_code')),
                'pagar seña dos veces: reutiliza el mismo link');
:as_cli2
select tests.throws(format($$select * from public.start_deposit_checkout('fresas', %L)$$, :'a1_code'),
                    'pagar seña: otra clienta no puede pagar (ni ver) una reserva ajena', 'No encontramos');
:as_anon
select tests.throws(format($$select * from public.start_deposit_checkout('fresas', %L)$$, :'a1_code'),
                    'pagar seña: sin sesión, no', 'permission denied');

:as_service
select tests.ok(public.svc_mp_set_preference(:'ck_intent_id', 'pref-1', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1')
                like 'https://www.mercadopago.com.ar/%', 'servidor: guarda el link de pago');
select tests.ok(public.svc_mp_set_preference(:'ck_intent_id', 'pref-2', 'https://otro') like '%pref-1',
                'dos preferencias para el mismo link: gana la primera');

-- =====================================================================
-- Pago aprobado a tiempo → confirmada (una sola vez)
-- =====================================================================
select * from public.svc_mp_sync_payment(:ACC, tests.mp('1001', :'ck_intent_id'), 'webhook') \gset s1_
select tests.ok(:'s1_outcome' = 'applied', 'pago aprobado y verificado: se aplica a la reserva');
:as_super
select tests.ok((select status = 'confirmed' and deposit_status = 'paid' from public.appointments where id = :'a1'),
                'la reserva queda confirmada con la seña pagada');
select tests.ok((select status = 'paid' from public.payment_intents where id = :'ck_intent_id'), 'el link de pago queda pagado');
select tests.ok((select count(*) = 1 from public.appointment_events where appointment_id = :'a1'
                 and event_type = 'deposit_paid' and detail ->> 'payment_ref' = '1001'),
                'historial de la reserva: seña pagada con el id del pago de Mercado Pago');
select tests.ok((select fee_minor = 30000 and net_minor = 720000 and first_seen_via = 'webhook' from public.payments where provider_payment_id = '1001'),
                'registro del pago: comisión, neto y por dónde llegó');

:as_service
select * from public.svc_mp_sync_payment(:ACC, tests.mp('1001', :'ck_intent_id'), 'webhook') \gset s2_
select * from public.svc_mp_sync_payment(:ACC, tests.mp('1001', :'ck_intent_id'), 'reconcile') \gset s3_
:as_super
select tests.ok(:'s2_outcome' = 'applied' and :'s3_outcome' = 'applied'
                and (select count(*) = 1 from public.payments where provider_payment_id = '1001')
                and (select count(*) = 2 from public.payment_events e join public.payments p on p.id = e.payment_id where p.provider_payment_id = '1001')
                and (select count(*) = 1 from public.appointment_events where appointment_id = :'a1' and event_type = 'deposit_paid'),
                'el mismo pago avisado tres veces: un pago, una confirmación, sin eventos repetidos');

-- =====================================================================
-- Avisos que no corresponden
-- =====================================================================
select tests.appt(:SOFI, :'cp1', '2027-02-01 15:00Z', 'pending_payment') as a2 \gset
select tests.intent(:'a2') as i2 \gset
:as_service
select tests.ok((select ignored_reason = 'foreign' from public.svc_mp_sync_payment(:ACC, tests.mp('2001', :'i2', p_collector => 999), 'webhook')),
                'pago de otra cuenta de Mercado Pago: se ignora');
select tests.ok((select ignored_reason = 'not_ours' from public.svc_mp_sync_payment(:ACCB, tests.mp('2002', :'i2', p_collector => 888), 'webhook')),
                'pago de la cuenta de B con un link de A: se ignora (no cruza estudios)');
select tests.ok((select ignored_reason = 'not_ours' from public.svc_mp_sync_payment(:ACC, tests.mp('2003', gen_random_uuid()), 'webhook')),
                'pago con una referencia que no es nuestra: se ignora');
select tests.ok((select ignored_reason = 'not_ours' from public.svc_mp_sync_payment(:ACC,
                 tests.mp('2004', :'i2') || '{"external_reference": "x'' or 1=1"}', 'webhook')),
                'referencia con basura: se ignora');
:as_super
select tests.ok((select count(*) = 0 from public.payments where provider_payment_id in ('2001', '2002', '2003', '2004'))
                and (select status = 'pending_payment' from public.appointments where id = :'a2'),
                'nada de eso se registra ni confirma');

-- Monto distinto → a revisar, no confirma
:as_service
select tests.ok((select outcome = 'needs_review' from public.svc_mp_sync_payment(:ACC, tests.mp('2005', :'i2', p_amount => 100), 'webhook')),
                'monto distinto de la seña: queda "a revisar"');
select tests.ok((select outcome = 'needs_review' from public.svc_mp_sync_payment(:ACC, tests.mp('2006', :'i2', p_currency => 'USD'), 'webhook')),
                'moneda distinta: queda "a revisar"');
-- Rechazado → ignorado; después uno aprobado sí confirma
select tests.ok((select outcome = 'ignored' from public.svc_mp_sync_payment(:ACC, tests.mp('2007', :'i2', 'rejected'), 'webhook')),
                'pago rechazado: se registra y no hace nada');
:as_super
select tests.ok((select status = 'pending_payment' from public.appointments where id = :'a2'), 'después de esos pagos la reserva sigue esperando pago');
:as_service
select tests.ok((select outcome = 'applied' from public.svc_mp_sync_payment(:ACC, tests.mp('2008', :'i2'), 'reconcile')),
                'reintento aprobado (encontrado por la revisión): confirma');
:as_super
select tests.ok((select (detail ->> 'recovered_by_reconcile')::boolean from public.payment_events e join public.payments p on p.id = e.payment_id
                 where p.provider_payment_id = '2008' and e.kind = 'seen'),
                'el pago encontrado por la revisión queda marcado (para medir avisos perdidos)');

-- =====================================================================
-- Pagó dos veces → devolución del segundo
-- =====================================================================
:as_service
select * from public.svc_mp_sync_payment(:ACC, tests.mp('2009', :'i2'), 'webhook') \gset dup_
select tests.ok(:'dup_outcome' = 'refund_pending' and :'dup_refund_id' <> '', 'segundo pago de una reserva ya pagada: se pide la devolución');
select public.svc_mp_refund_result(:'dup_refund_id', true, '555', null);
:as_super
select tests.ok((select p.outcome = 'refunded' and r.status = 'done' and r.reason = 'duplicate'
                 from public.payments p join public.payment_refunds r on r.payment_id = p.id where p.provider_payment_id = '2009'),
                'devolución hecha: queda registrada');
select tests.ok((select count(*) = 1 from public.appointment_events where appointment_id = :'a2' and event_type = 'deposit_refunded'),
                'el historial de la reserva muestra la devolución');
select tests.ok((select status = 'confirmed' from public.appointments where id = :'a2'), 'la reserva sigue confirmada por el primer pago');

-- =====================================================================
-- Pago tardío (P4)
-- =====================================================================
-- a) bloqueo vencido pero el cron no pasó, horario libre → confirma igual
select tests.appt(:SOFI, :'cp1', '2027-02-02 13:00Z', 'pending_payment') as l1 \gset
select tests.intent(:'l1') as il1 \gset
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'l1';
:as_service
select tests.ok((select outcome = 'late_confirmed' from public.svc_mp_sync_payment(:ACC, tests.mp('3001', :'il1'), 'webhook')),
                'tardío (bloqueo vencido, horario libre): se confirma igual');
-- b) ya marcada como vencida, horario libre → confirma (expired → confirmed)
:as_super
select tests.appt(:SOFI, :'cp1', '2027-02-02 15:00Z', 'pending_payment') as l2 \gset
select tests.intent(:'l2') as il2 \gset
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'l2';
select app.expire_holds();
select tests.ok((select status = 'expired' from public.appointments where id = :'l2'), 'tardío: la reserva estaba vencida');
:as_service
select tests.ok((select outcome = 'late_confirmed' from public.svc_mp_sync_payment(:ACC, tests.mp('3002', :'il2'), 'webhook')),
                'tardío (vencida, horario libre): se confirma');
:as_super
select tests.ok((select status = 'confirmed' and deposit_status = 'paid' from public.appointments where id = :'l2')
                and (select bool_or((detail ->> 'late')::boolean) from public.appointment_events where appointment_id = :'l2' and event_type = 'confirmed'),
                'tardío: queda confirmada y el historial dice que el pago llegó tarde');
-- c) vencida y otra tomó el horario → devolución; la reserva sigue vencida
select tests.appt(:CARO, :'cp1', '2027-02-03 13:00Z', 'pending_payment') as l3 \gset
select tests.intent(:'l3') as il3 \gset
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'l3';
select app.expire_holds();
select tests.appt(:CARO, :'cp2', '2027-02-03 13:30Z', 'confirmed') as taken \gset
:as_service
select * from public.svc_mp_sync_payment(:ACC, tests.mp('3003', :'il3'), 'webhook') \gset l3_
:as_super
select tests.ok(:'l3_outcome' = 'refund_pending'
                and (select reason = 'late_slot_taken' from public.payment_refunds where id = :'l3_refund_id')
                and (select status = 'expired' from public.appointments where id = :'l3'),
                'tardío con el horario ocupado: devolución automática (la base impide la superposición)');
-- d) la clienta la liberó → devolución
select tests.appt(:CARO, :'cp1', '2027-02-04 13:00Z', 'pending_payment') as l4 \gset
select code as l4_code from public.appointments where id = :'l4' \gset
select tests.intent(:'l4') as il4 \gset
:as_cli1
select public.release_my_pending_booking('fresas', :'l4_code');
:as_service
select * from public.svc_mp_sync_payment(:ACC, tests.mp('3004', :'il4'), 'webhook') \gset l4_
:as_super
select tests.ok((select reason = 'late_released' from public.payment_refunds where id = :'l4_refund_id')
                and (select status = 'cancelled' from public.appointments where id = :'l4'),
                'pago de una reserva liberada: devolución, no se reactiva');
-- e) el turno ya pasó → devolución
insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at,
  occupied_until, service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from,
  currency, deposit_percent, deposit_minor, policy_version, cancellation_window_hours, status, deposit_status, source)
select :A, app.generate_booking_code(), :'cp1', :CARO, '31000000-0000-4000-a000-000000000001',
  now() - interval '2 hours', now() - interval '1 hour', now() - interval '1 hour', 'Esmaltado semipermanente', 'Pro',
  60, 0, 1500000, false, 'ARS', 50, 750000, policy_version, 24, 'expired', 'pending', 'staff'
from public.tenant_settings where tenant_id = :A
returning id as l5 \gset
select tests.intent(:'l5') as il5 \gset
:as_service
select * from public.svc_mp_sync_payment(:ACC, tests.mp('3005', :'il5'), 'webhook') \gset l5_
:as_super
select tests.ok((select reason = 'late_past' from public.payment_refunds where id = :'l5_refund_id'),
                'pago de un turno que ya pasó: devolución');

-- Devolución que falla → "a resolver" y reintento (cash.manage)
:as_service
select public.svc_mp_refund_result(:'l3_refund_id', false, null, 'insufficient_funds');
:as_super
select tests.ok((select p.outcome = 'refund_failed' and r.status = 'failed' and r.last_error = 'insufficient_funds'
                 from public.payments p join public.payment_refunds r on r.payment_id = p.id where r.id = :'l3_refund_id'),
                'devolución fallida (sin saldo): queda como pago a resolver');
select id as p3003 from public.payments where provider_payment_id = '3003' \gset
:as_pro_a
select tests.throws(format('select * from public.retry_refund(%L)', :'p3003'), 'profesional: no puede reintentar devoluciones', 'No tenés permiso');
:as_owner_b
select tests.throws(format('select * from public.retry_refund(%L)', :'p3003'), 'dueña de B: no puede tocar pagos de A', 'No tenés permiso');
:as_owner_a
select tests.ok((select refund_id = :'l3_refund_id' from public.retry_refund(:'p3003')), 'dueña: reintenta la devolución');
select tests.throws(format('select * from public.retry_refund(%L)', :'p3003'), 'reintentar una devolución ya pedida: no', 'no tiene una devolución');
:as_super
alter table public.payment_refunds disable trigger payment_refunds_updated_at;
update public.payment_refunds set updated_at = now() - interval '5 minutes' where id = :'l3_refund_id';
alter table public.payment_refunds enable trigger payment_refunds_updated_at;
:as_service
select tests.ok((select count(*) = 1 from public.svc_mp_pending_refunds() where refund_id = :'l3_refund_id'),
                'la revisión periódica ve las devoluciones pedidas sin terminar');
-- Mercado Pago informa la devolución (por ejemplo, hecha a mano): queda hecha
select tests.ok((select outcome = 'refunded' from public.svc_mp_sync_payment(:ACC, tests.mp('3003', :'il3', 'refunded', p_refunded => 750000), 'webhook')),
                'Mercado Pago informa la devolución: queda registrada como hecha');

-- =====================================================================
-- Devolución o contracargo de un pago que confirmó (P8): aviso, no cancela
-- =====================================================================
select public.svc_mp_sync_payment(:ACC, tests.mp('1001', :'ck_intent_id', 'refunded', p_refunded => 750000), 'webhook');
:as_super
select tests.ok((select status = 'confirmed' from public.appointments where id = :'a1')
                and (select count(*) = 1 from public.appointment_events where appointment_id = :'a1' and event_type = 'deposit_refunded')
                and (select status = 'refunded' from public.payments where provider_payment_id = '1001'),
                'devolución hecha desde Mercado Pago: se registra y avisa en el turno, que no se cancela solo (P8)');
:as_service
select public.svc_mp_sync_payment(:ACC, tests.mp('3002', :'il2', 'charged_back'), 'webhook');
:as_super
select tests.ok((select count(*) = 1 from public.appointment_events where appointment_id = :'l2' and event_type = 'payment_disputed'),
                'contracargo: queda en el historial del turno');

-- =====================================================================
-- Avisos (idempotencia)
-- =====================================================================
:as_service
select tests.ok(public.svc_mp_record_notification(:ACC, 'req-1', 'payment', '1001') = 'new', 'aviso nuevo');
select tests.ok(public.svc_mp_record_notification(:ACC, 'req-1', 'payment', '1001') = 'retry', 'el mismo aviso sin terminar: se reprocesa');
select public.svc_mp_notification_done('req-1', 'applied');
select tests.ok(public.svc_mp_record_notification(:ACC, 'req-1', 'payment', '1001') = 'duplicate', 'el mismo aviso ya procesado: no se hace nada');
:as_super
select tests.ok((select attempts = 2 and result = 'applied' from public.payment_notifications where request_id = 'req-1'),
                'la bandeja guarda intentos y resultado');

-- =====================================================================
-- Quién ve qué
-- =====================================================================
:as_owner_a
select tests.ok((select count(*) >= 10 from public.payments), 'dueña: ve los pagos del estudio');
select tests.ok((select count(*) >= 10 from public.list_payments(:A, now() - interval '1 day', now() + interval '1 day')),
                'dueña: conciliación del período');
select tests.throws('select * from public.payment_notifications', 'dueña: no ve la bandeja de avisos', 'permission denied');
select tests.throws(format($$update public.payments set outcome = 'applied' where tenant_id = %L$$, :A), 'dueña: no puede cambiar pagos', 'permission denied');
select tests.throws(format($$insert into public.payment_refunds (tenant_id, payment_id, amount_minor, reason) values (%L, %L, 1, 'duplicate')$$, :A, :'p3003'),
                    'dueña: no puede crear devoluciones directo', 'permission denied');
:as_manager_a
select tests.ok((select count(*) >= 10 from public.payments), 'encargada: ve los pagos (caja)');
:as_pro_a
select tests.ok((select count(*) = 0 from public.payments), 'profesional: no ve los pagos');
select tests.throws(format('select * from public.list_payments(%L, now() - interval ''1 day'', now())', :A), 'profesional: sin conciliación', 'No tenés permiso');
:as_owner_b
select tests.ok((select count(*) = 0 from public.payments) and (select count(*) = 0 from public.payment_intents),
                'dueña de B: no ve pagos ni links de A');
:as_admin
select tests.ok((select count(*) = 0 from public.payments), 'Cleo Admin: no ve pagos');
:as_cli1
select tests.ok((select count(*) = 0 from public.payments), 'clienta: no lee la tabla de pagos');
select tests.ok((select outcome = 'applied' and amount_minor = 750000 from public.get_my_booking_payment('fresas', :'a1_code'))
                is not false, 'clienta: ve el resultado del pago de SU reserva');
:as_cli2
select tests.ok((select count(*) = 0 from public.get_my_booking_payment('fresas', :'a1_code')), 'otra clienta: no ve ese pago');

-- =====================================================================
-- Reglas de la base
-- =====================================================================
:as_super
select tests.throws($$update public.payment_events set kind = 'seen'$$, 'payment_events es de solo agregado (aun como superusuario)', 'solo agregado');
select tests.appt(:SOFI, :'cp1', '2027-02-05 13:00Z', 'pending_payment') as g1 \gset
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'g1';
select tests.throws(format($$select app.confirm_deposit_payment(%L, 'SIM', 750000)$$, :'g1'),
                    'corrección Sprint 4: confirm_deposit_payment no acepta una reserva con el bloqueo vencido', 'ya no está activa');
select app.expire_holds();
select tests.throws(format($$update public.appointments set status = 'confirmed', deposit_status = 'paid' where id = %L$$, :'g1'),
                    'vencida → confirmada solo por un pago tardío verificado (no a mano)', 'no permitido');

-- Revisión y limpieza
select tests.appt(:SOFI, :'cp1', '2027-02-06 13:00Z', 'pending_payment') as r1 \gset
select tests.intent(:'r1') as ir1 \gset
:as_service
select tests.ok((select count(*) = 1 from public.svc_mp_reconcile_targets() where kind = 'intent' and reference = :'ir1'),
                'revisión: consulta los links abiertos');
select public.svc_mp_housekeeping();
-- Desconectar cancela los links abiertos
:as_owner_a
select public.disconnect_mp(:A);
:as_super
select tests.ok((select status = 'cancelled' from public.payment_intents where id = :'ir1'), 'desconectar: cancela los links de pago abiertos');
:as_cli1
select code as r1_code from public.appointments where id = :'r1' \gset
select tests.throws(format($$select * from public.start_deposit_checkout('fresas', %L)$$, :'r1_code'),
                    'sin Mercado Pago conectado no se puede pagar online', 'todavía no puede cobrar');

\ir lib/finish.sql
