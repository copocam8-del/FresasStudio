-- =====================================================================
-- Tests de cancelación con seña (Sprint 6 · migración 2720 · POL-02, POL-03, POL-07)
-- La clienta (sitio) y el panel aplican la MISMA regla; si cancela el estudio, la
-- clienta nunca pierde la seña.
-- =====================================================================
\ir lib/setup.sql
\ir lib/sprint6.sql

-- ---------------------------------------------------------------------
-- La clienta, desde el sitio. Dentro de la transacción now() es fijo, así que
-- "now() + 24 h" es exactamente 24:00:00 antes del turno.
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp1', now() + interval '24 hours') as t_exact \gset
select tests.appt6(:'cp1', now() + interval '24 hours' - interval '1 minute', 'confirmed', 24, :CARO) as t_late \gset
select code as t_exact_code from public.appointments where id = :'t_exact' \gset
select code as t_late_code from public.appointments where id = :'t_late' \gset

:as_cli1
select tests.ok((select keeps_deposit and can_cancel and amount_minor = 750000 from public.get_my_booking_terms('fresas', :'t_exact_code')),
  'clienta: a exactamente 24 h ve que conserva la seña ($ 7.500)');
select tests.ok((select not keeps_deposit from public.get_my_booking_terms('fresas', :'t_late_code')),
  'clienta: a 23:59 ve que pierde la seña');

select tests.ok((select outcome = 'credited' and amount_minor = 750000 from public.cancel_my_booking('fresas', :'t_exact_code', 'credited')),
  'cancelar a exactamente 24 h: la seña pasa al saldo a favor');
:as_super
select tests.ok((select status = 'cancelled' and cancelled_by = 'client' and deposit_outcome = 'credited'
                        and deposit_outcome_minor = 750000 and closed_at is not null
                 from public.appointments where id = :'t_exact'),
  'el turno queda cancelado por la clienta, con la seña acreditada');
select tests.ok(tests.credit(:'cp1') = 750000, 'saldo a favor de la clienta: $ 7.500');
select tests.ok((select expires_at = app.credit_expiry(:A, 90) and kind = 'cancellation_credit'
                 from public.client_credit_entries where appointment_id = :'t_exact'),
  'el saldo vence a los 90 días (política de la reserva), al final de ese día');

-- La consecuencia cambió entre lo que vio y lo que confirmó: no se hace nada.
:as_cli1
select tests.throws(format($$select * from public.cancel_my_booking('fresas', %L, 'credited')$$, :'t_late_code'),
  'cancelar a 23:59 esperando conservar la seña: no se hace nada y se avisa', 'Pasó el plazo');
:as_super
select tests.ok((select status = 'confirmed' from public.appointments where id = :'t_late'),
  '…y el turno sigue confirmado');
:as_cli1
select tests.ok((select outcome = 'forfeited' from public.cancel_my_booking('fresas', :'t_late_code', 'forfeited')),
  'cancelar a 23:59 aceptando perder la seña: se pierde');
:as_super
select tests.ok(tests.credit(:'cp1') = 750000, 'la seña perdida no suma saldo');
select tests.ok(not exists (select 1 from public.client_credit_entries where appointment_id = :'t_late'),
  'sin movimientos de saldo para la cancelación tardía');

:as_cli1
select tests.throws(format($$select * from public.cancel_my_booking('fresas', %L, 'credited')$$, :'t_exact_code'),
  'un turno cancelado no se vuelve a cancelar (ni acredita dos veces)', 'cerrado');
:as_cli2
select tests.throws(format($$select * from public.cancel_my_booking('fresas', %L, 'credited')$$, :'t_exact_code'),
  'otra clienta no puede cancelar (ni ver) un turno ajeno', 'No encontramos');
select tests.throws(format($$select * from public.get_my_booking_terms('fresas', %L)$$, :'t_exact_code'),
  'otra clienta no ve las condiciones de un turno ajeno', 'No encontramos');

-- Un turno que ya empezó no se cancela desde el sitio
:as_super
select tests.appt6(:'cp2', now() - interval '10 minutes', 'confirmed', 24, :SOFI, 30) as t_started \gset
select code as t_started_code from public.appointments where id = :'t_started' \gset
:as_cli2
select tests.throws(format($$select * from public.cancel_my_booking('fresas', %L, 'forfeited')$$, :'t_started_code'),
  'clienta: no puede cancelar un turno que ya empezó', 'ya empezó');

-- Una reserva esperando pago no se "cancela con seña": se libera
:as_super
select tests.appt6(:'cp2', now() + interval '3 days', 'pending_payment') as t_pend \gset
select code as t_pend_code from public.appointments where id = :'t_pend' \gset
:as_cli2
select tests.throws(format($$select * from public.cancel_my_booking('fresas', %L, 'credited')$$, :'t_pend_code'),
  'esperando pago: no se cancela con seña (se libera)', 'libera');

-- ---------------------------------------------------------------------
-- Desde el panel, cancela la clienta (avisó por WhatsApp): misma regla
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp2', now() + interval '2 days') as p_client_ok \gset
select tests.appt6(:'cp2', now() + interval '23 hours 59 minutes', 'confirmed', 24, :CARO) as p_client_late \gset
:as_owner_a
select tests.ok((select keeps_deposit from public.get_booking_terms(:'p_client_ok')), 'panel: ve la consecuencia antes de confirmar');
select tests.ok((select outcome = 'credited' from public.cancel_booking(:'p_client_ok', 'client', null, null, null, 'credited')),
  'panel, cancela la clienta con 48 h: saldo a favor');
select tests.throws(format($$select * from public.cancel_booking(%L, 'client', null, null, null, 'credited')$$, :'p_client_late'),
  'panel, cancela la clienta a 23:59: si esperaba conservar, no hace nada', 'Pasó el plazo');
select tests.ok((select outcome = 'forfeited' from public.cancel_booking(:'p_client_late', 'client', null, null, null, 'forfeited')),
  'panel, cancela la clienta a 23:59: la seña se pierde (igual que desde el sitio)');

-- ---------------------------------------------------------------------
-- Cancela el estudio: la clienta nunca pierde (C5)
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp2', now() + interval '1 hour') as s_credit \gset
select tests.appt6(:'cp2', now() + interval '2 hours', 'confirmed', 24, :CARO) as s_cash \gset
:as_owner_a
select tests.throws(format($$select * from public.cancel_booking(%L, 'studio', null, 'credit', null, 'credited')$$, :'s_credit'),
  'estudio: el motivo es obligatorio', 'motivo');
select tests.ok((select outcome = 'credited' and amount_minor = 750000
                 from public.cancel_booking(:'s_credit', 'studio', 'Se enfermó la profesional', 'credit', null, 'credited')),
  'estudio cancela a 1 h del turno: la clienta conserva la seña como saldo');
:as_super
select tests.ok((select cancelled_by = 'studio' and cancel_reason = 'Se enfermó la profesional'
                 from public.appointments where id = :'s_credit'),
  'queda registrado que canceló el estudio y el motivo');
select tests.ok((select kind = 'studio_cancellation_credit' from public.client_credit_entries where appointment_id = :'s_credit'),
  'el saldo figura como "canceló el estudio"');
:as_owner_a
select tests.throws(format($$select * from public.cancel_booking(%L, 'studio', 'Corte de luz', 'refund', null, 'refunded')$$, :'s_cash'),
  'estudio, devolución de una seña cobrada en el estudio: pide el medio', 'transferencia o efectivo');
select tests.ok((select outcome = 'refunded' and amount_minor = 750000
                 from public.cancel_booking(:'s_cash', 'studio', 'Corte de luz', 'refund', 'cash', 'refunded')),
  'estudio, devolución en efectivo: la seña se devuelve');
:as_super
select tests.ok(exists (select 1 from public.appointment_events where appointment_id = :'s_cash' and event_type = 'refunded_offline'
                        and detail ->> 'method' = 'cash'),
  'el historial registra la devolución en efectivo');
select tests.ok(not exists (select 1 from public.client_credit_entries where appointment_id = :'s_cash'),
  'devuelta en dinero: no suma saldo');

-- Devolución por Mercado Pago: se pide automáticamente
:as_super
select tests.appt6(:'cp1', now() + interval '5 hours', 'pending_payment') as s_mp \gset
select tests.intent6(:'s_mp') as s_mp_intent \gset
:as_service
select tests.ok((select outcome = 'applied' from public.svc_mp_sync_payment(:ACC, tests.mp6('9100001', :'s_mp_intent'), 'webhook')),
  '(seña pagada con Mercado Pago)');
:as_manager_a
select tests.ok((select outcome = 'refunded' from public.cancel_booking(:'s_mp', 'studio', 'Cerramos por duelo', 'refund', null, 'refunded')),
  'estudio, devolución de una seña pagada con Mercado Pago');
:as_super
select tests.ok((select r.reason = 'studio_cancelled' and r.status = 'requested' and r.amount_minor = 750000
                 from public.payment_refunds r join public.payments p on p.id = r.payment_id
                 where p.provider_payment_id = '9100001'),
  '…se pide la devolución total a Mercado Pago (motivo: canceló el estudio)');

-- Un pago que llega después de cancelar se devuelve (no reactiva el turno)
select tests.appt6(:'cp1', now() + interval '6 days', 'pending_payment') as s_late \gset
select tests.intent6(:'s_late') as s_late_intent \gset
:as_service
select public.svc_mp_sync_payment(:ACC, tests.mp6('9100002', :'s_late_intent'), 'webhook');
:as_owner_a
select public.cancel_booking(:'s_late', 'client', null, null, null, 'credited');
:as_service
select tests.ok((select outcome = 'refund_pending' from public.svc_mp_sync_payment(:ACC, tests.mp6('9100003', :'s_late_intent'), 'webhook')),
  'un segundo pago para un turno ya cancelado se devuelve');

-- Si parte de la seña ya volvió a la clienta (devolución parcial), solo se acredita el resto (C7)
:as_super
select tests.appt6(:'cp2', now() + interval '7 days', 'pending_payment', 24, :CARO) as s_partial \gset
select tests.intent6(:'s_partial') as s_partial_intent \gset
:as_service
select public.svc_mp_sync_payment(:ACC, tests.mp6('9100004', :'s_partial_intent'), 'webhook');
select public.svc_mp_sync_payment(:ACC, tests.mp6('9100004', :'s_partial_intent', 750000, 'approved', 200000), 'reconcile');
:as_owner_a
select tests.ok((select amount_minor = 550000 from public.cancel_booking(:'s_partial', 'client', null, null, null, 'credited')),
  'seña con $ 2.000 ya devueltos por Mercado Pago: se acreditan solo $ 5.500');

-- ---------------------------------------------------------------------
-- Permisos y aislamiento
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp2', now() + interval '8 days') as perm \gset
:as_pro_a
select tests.throws(format($$select * from public.cancel_booking(%L, 'client', null, null, null, 'credited')$$, :'perm'),
  'profesional: no puede cancelar turnos', 'permiso');
:as_owner_b
select tests.throws(format($$select * from public.cancel_booking(%L, 'client', null, null, null, 'credited')$$, :'perm'),
  'dueña de B: no puede cancelar turnos de A', 'permiso');
select tests.throws(format($$select * from public.get_booking_terms(%L)$$, :'perm'),
  'dueña de B: no ve las condiciones de turnos de A', 'No encontramos');
:as_admin
select tests.throws(format($$select * from public.get_booking_terms(%L)$$, :'perm'),
  'Cleo Admin: no ve turnos', 'No encontramos');
:as_owner_a
select tests.throws(format($$select * from public.cancel_booking(%L, 'nadie', null, null, null, 'credited')$$, :'perm'),
  'quién cancela: solo clienta o estudio', 'quién cancela');

-- Lo cerrado no se reescribe (aun como superusuario)
:as_super
select tests.throws(format($$update public.appointments set deposit_outcome = 'credited' where id = %L$$, :'t_late'),
  'una seña perdida no se puede pasar a acreditada a mano', 'no se puede cambiar');
select tests.throws(format($$update public.appointments set status = 'confirmed' where id = %L$$, :'t_exact'),
  'un turno cancelado no vuelve a confirmado', 'no permitido');

-- Estudio suspendido: solo lectura
update public.tenants set status = 'suspended' where id = :A;
:as_owner_a
select tests.throws(format($$select * from public.cancel_booking(%L, 'client', null, null, null, 'credited')$$, :'perm'),
  'estudio suspendido: no se cancela desde el panel', 'permiso');
:as_cli2
select tests.throws(format($$select * from public.cancel_my_booking('fresas', (select code from public.appointments where id = %L), 'credited')$$, :'perm'),
  'estudio suspendido: no se cancela desde el sitio');

:as_super
\ir lib/finish.sql
