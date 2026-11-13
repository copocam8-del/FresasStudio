-- =====================================================================
-- Tests del saldo a favor (Sprint 6 · migración 2720 · C9, C10, C11)
-- Libro de solo agregado, por lotes que vencen; se usa solo en la seña de la
-- próxima reserva y vuelve si esa reserva vence o se libera.
-- Semipermanente con Sofi: $ 15.000, seña 50% = $ 7.500.
-- =====================================================================
\ir lib/setup.sql
\ir lib/sprint6.sql

:as_super
-- Turno manual a las N días, a una hora fija (con "lo atiendo igual": no depende del horario)
create function tests.book(p_client uuid, p_days int, p_method text default null) returns uuid
language sql as $$
  select appointment_id from public.create_manual_booking('10000000-0000-4000-a000-000000000001', p_client, null, null,
    '31000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000001',
    date_trunc('hour', now()) + make_interval(days => p_days), true, p_method, null)
$$;
grant execute on function tests.book(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------
-- Sin saldo: todo igual que antes
-- ---------------------------------------------------------------------
:as_owner_a
select tests.book(:'cp2', 10) as b0 \gset
:as_super
select tests.ok((select status = 'pending_payment' and credit_applied_minor = 0 from public.appointments where id = :'b0'),
  'sin saldo: la reserva espera el pago de la seña entera');

-- ---------------------------------------------------------------------
-- El saldo cubre toda la seña: confirmada sin pasar por Mercado Pago
-- ---------------------------------------------------------------------
:as_owner_a
select tests.ok(public.adjust_client_credit(:'cp2', 750000, 'Compensación por la demora') = 750000,
  'dueña: carga $ 7.500 de saldo (con motivo)');
select tests.book(:'cp2', 11) as b1 \gset
:as_super
select tests.ok((select status = 'confirmed' and deposit_status = 'credit' and credit_applied_minor = 750000 and hold_expires_at is null
                 from public.appointments where id = :'b1'),
  'el saldo cubre la seña: la reserva queda confirmada al instante');
select tests.ok(tests.credit(:'cp2') = 0, 'el saldo usado ya no está disponible');
select tests.ok(exists (select 1 from public.appointment_events where appointment_id = :'b1' and event_type = 'deposit_credit'),
  'el historial del turno dice que la seña se cubrió con saldo');
select tests.ok((select sum(amount_minor) = -750000 from public.client_credit_entries where appointment_id = :'b1' and kind = 'used_in_booking'),
  'el libro registra el uso en esa reserva');

-- ---------------------------------------------------------------------
-- El saldo cubre una parte: Mercado Pago cobra la diferencia
-- ---------------------------------------------------------------------
:as_owner_a
select public.adjust_client_credit(:'cp2', 200000, 'Diferencia de precio');
select tests.book(:'cp2', 12) as b2 \gset
:as_super
select code as b2_code from public.appointments where id = :'b2' \gset
select tests.ok((select status = 'pending_payment' and credit_applied_minor = 200000 from public.appointments where id = :'b2'),
  'saldo de $ 2.000: se usa y la reserva espera el resto');
:as_cli2
select tests.ok((select amount_minor = 550000 from public.start_deposit_checkout('fresas', :'b2_code')),
  'el link de pago es por lo que falta: $ 5.500');
:as_super
select id as b2_intent from public.payment_intents where appointment_id = :'b2' and status = 'open' \gset
:as_service
select tests.ok((select outcome = 'needs_review' from public.svc_mp_sync_payment(:ACC, tests.mp6('9200001', :'b2_intent', 750000), 'webhook')),
  'un pago por la seña entera (no por lo que falta) no confirma: a revisar');
select tests.ok((select outcome = 'applied' from public.svc_mp_sync_payment(:ACC, tests.mp6('9200002', :'b2_intent', 550000), 'webhook')),
  'el pago de $ 5.500 confirma la reserva');
:as_super
select tests.ok((select status = 'confirmed' and deposit_status = 'paid' from public.appointments where id = :'b2'),
  '…confirmada, con la seña completa (saldo + Mercado Pago)');

-- ---------------------------------------------------------------------
-- Si la reserva vence o se libera, el saldo vuelve (una sola vez) a su lote
-- ---------------------------------------------------------------------
:as_owner_a
select public.adjust_client_credit(:'cp1', 300000, 'Regalo de cumpleaños');
select tests.book(:'cp1', 13) as b3 \gset
:as_super
select tests.ok(tests.credit(:'cp1') = 0, 'reserva esperando pago con $ 3.000 de saldo: el saldo queda tomado');
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'b3';
select app.expire_holds();
select tests.ok((select status = 'expired' from public.appointments where id = :'b3'), 'la reserva vence');
select tests.ok(tests.credit(:'cp1') = 300000, 'al vencer, el saldo vuelve a la clienta');
select tests.ok((select count(*) = 1 from public.client_credit_entries where appointment_id = :'b3' and kind = 'returned_from_booking'),
  'el libro registra la devolución');
select tests.ok(exists (select 1 from public.appointment_events where appointment_id = :'b3' and event_type = 'credit_returned'),
  'el historial del turno lo dice');
select tests.ok(app.return_booking_credit(:'b3') = 0 and tests.credit(:'cp1') = 300000,
  'devolver dos veces no duplica el saldo');
select tests.ok((select l.expires_at = e.expires_at
                 from public.client_credit_entries r
                 join public.client_credit_entries e on e.id = r.lot_id
                 cross join lateral (select expires_at from app.credit_lots(:A, :'cp1') where lot_id = r.lot_id) l
                 where r.appointment_id = :'b3' and r.kind = 'returned_from_booking'),
  'vuelve a su mismo lote, con su misma fecha de vencimiento');

:as_owner_a
select tests.book(:'cp1', 14) as b4 \gset
:as_super
select code as b4_code from public.appointments where id = :'b4' \gset
:as_cli1
select public.release_my_pending_booking('fresas', :'b4_code');
:as_super
select tests.ok(tests.credit(:'cp1') = 300000, 'si la clienta libera la reserva, el saldo vuelve');

-- Pago tardío de una reserva vencida que había usado saldo
:as_owner_a
select tests.book(:'cp1', 15) as b5 \gset
:as_super
select tests.intent6(:'b5') as b5_intent \gset
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'b5';
select app.expire_holds();
:as_service
select tests.ok((select outcome = 'late_confirmed' from public.svc_mp_sync_payment(:ACC, tests.mp6('9200003', :'b5_intent', 450000), 'webhook')),
  'pago tardío con el saldo todavía disponible: se confirma');
:as_super
select tests.ok(tests.credit(:'cp1') = 0, '…y el saldo se vuelve a tomar');
select tests.ok((select status = 'confirmed' from public.appointments where id = :'b5'), '…reserva confirmada');

:as_owner_a
select public.adjust_client_credit(:'cp1', 300000, 'Otro regalo');
select tests.book(:'cp1', 16) as b6 \gset
:as_super
select tests.intent6(:'b6') as b6_intent \gset
update public.appointments set hold_expires_at = now() - interval '1 minute' where id = :'b6';
select app.expire_holds();
-- La clienta usa ese saldo en otra reserva antes de que llegue el pago tardío
:as_owner_a
select tests.book(:'cp1', 17) as b7 \gset
:as_service
select tests.ok((select outcome = 'refund_pending' from public.svc_mp_sync_payment(:ACC, tests.mp6('9200004', :'b6_intent', 450000), 'webhook')),
  'pago tardío cuando el saldo ya se usó en otra reserva: se devuelve');
:as_super
select tests.ok((select reason = 'late_credit_spent' from public.payment_refunds r join public.payments p on p.id = r.payment_id
                 where p.provider_payment_id = '9200004'), '…con el motivo "el saldo ya se usó"');

-- ---------------------------------------------------------------------
-- Vencimiento (C10): lotes, orden de uso y movimiento "vencido"
-- ---------------------------------------------------------------------
:as_super
update public.tenant_settings set credit_expiry_days = 30 where tenant_id = :A;
select tests.ok((select credit_expiry_days = 30 from public.tenant_policy_versions
                 where tenant_id = :A and version = (select policy_version from public.tenant_settings where tenant_id = :A)),
  'cambiar el vencimiento crea una versión nueva de la política');
:as_owner_a
select public.adjust_client_credit(:'cp2', 100000, 'Lote a 30 días');
:as_super
update public.tenant_settings set credit_expiry_days = 90 where tenant_id = :A;
:as_owner_a
select public.adjust_client_credit(:'cp2', 100000, 'Lote a 90 días');
select public.adjust_client_credit(:'cp2', -100000, 'Corrección');
:as_super
select tests.ok((select remaining_minor = 0 from app.credit_lots(:A, :'cp2') where expires_at = app.credit_expiry(:A, 30)),
  'se usa primero lo que vence antes');
select tests.throws(format($$update public.tenant_settings set credit_expiry_days = 10 where tenant_id = %L$$, :A),
  'vencimiento fuera de rango (30 a 365 días): rechazado', 'settings_credit_expiry');

-- Un lote vencido deja de contar en el momento, aunque la tarea diaria no haya pasado
insert into public.client_credit_entries (tenant_id, client_profile_id, kind, amount_minor, currency, expires_at, reason)
values (:A, :'cp2', 'manual_credit', 500000, 'ARS', now() - interval '1 second', 'Lote viejo');
select tests.ok(tests.credit(:'cp2') = 100000, 'un lote vencido no suma al saldo disponible');
select tests.ok(app.expire_credits() = 1, 'la tarea diaria registra el vencimiento');
select tests.ok((select amount_minor = -500000 from public.client_credit_entries where client_profile_id = :'cp2' and kind = 'expired'),
  '…con un movimiento "vencido" por lo que quedaba');
select tests.ok(app.expire_credits() = 0, 'correrla de nuevo no duplica nada');
select app.credit_expiry(:A, 90) as exp90 \gset
:as_cli2
select tests.ok((select count(*) = 1 and sum(remaining_minor) = 100000 from public.my_credit('fresas')),
  'la clienta ve cuánto le queda y hasta cuándo (solo lo vigente)');
select tests.ok((select expires_at = :'exp90' from public.my_credit('fresas')),
  '…con la fecha de vencimiento del lote');
select tests.ok((select count(*) > 0 from public.my_credit_movements('fresas') where kind = 'expired'),
  'en sus movimientos figura lo vencido');

-- ---------------------------------------------------------------------
-- Ajustes manuales (C11) y permisos
-- ---------------------------------------------------------------------
:as_manager_a
select tests.ok(public.adjust_client_credit(:'cp2', 100000, 'Encargada') = 200000, 'encargada: puede ajustar el saldo');
select tests.throws(format($$select public.adjust_client_credit(%L, -900000, 'Demasiado')$$, :'cp2'),
  'no se puede dejar el saldo negativo', 'no tiene ese saldo');
select tests.throws(format($$select public.adjust_client_credit(%L, 100000, '')$$, :'cp2'),
  'el motivo es obligatorio', 'motivo');
select tests.throws(format($$select public.adjust_client_credit(%L, 10050, 'Con centavos')$$, :'cp2'),
  'el saldo se ajusta en pesos enteros', 'pesos enteros');
:as_pro_a
select tests.throws(format($$select public.adjust_client_credit(%L, 100000, 'Profesional')$$, :'cp2'),
  'profesional: no puede ajustar el saldo', 'permiso');
:as_owner_b
select tests.throws(format($$select public.adjust_client_credit(%L, 100000, 'Otro estudio')$$, :'cp2'),
  'dueña de B: no puede ajustar saldo de clientas de A', 'permiso');
select tests.ok((select count(*) = 0 from public.client_credit_entries), 'dueña de B: no ve el libro de A');
select tests.throws(format($$select * from public.client_credit(%L)$$, :'cp2'),
  'dueña de B: no ve el saldo de una clienta de A', 'No encontramos');
:as_admin
select tests.ok((select count(*) = 0 from public.client_credit_entries), 'Cleo Admin: no ve saldos');
:as_cli1
select tests.ok((select count(*) > 0 from public.client_credit_entries)
                and not exists (select 1 from public.client_credit_entries where client_profile_id = :'cp2'),
  'clienta: ve solo sus movimientos');
select tests.ok((select count(*) = 0 from public.my_credit('estudio-prueba')), 'clienta: su saldo de Fresas no aparece en otro estudio');
select tests.throws(format($$insert into public.client_credit_entries (tenant_id, client_profile_id, kind, amount_minor, currency, expires_at)
                            values (%L, %L, 'manual_credit', 100000, 'ARS', now() + interval '1 day')$$, :A, :'cp1'),
  'clienta: no puede cargarse saldo', 'permission denied');
:as_owner_a
select tests.ok((select count(*) >= 3 from public.client_credit(:'cp2')), 'dueña: ve los lotes de la clienta');
select tests.throws($$update public.client_credit_entries set amount_minor = 1$$, 'dueña: no puede editar el libro', 'permission denied');

-- Solo agregado, aun como superusuario
:as_super
select tests.throws($$update public.client_credit_entries set amount_minor = amount_minor * 2$$,
  'el libro no se edita (ni como superusuario)');
select tests.throws($$delete from public.client_credit_entries$$, 'el libro no se borra (ni como superusuario)');
select tests.throws($$truncate public.client_credit_entries$$, 'el libro no se vacía (ni como superusuario)');
select tests.throws(format($$insert into public.client_credit_entries (tenant_id, client_profile_id, kind, amount_minor, currency, lot_id)
                            select %L, %L, 'used_in_booking', -1, currency, id from public.client_credit_entries
                            where client_profile_id = %L and lot_id is null limit 1$$, :B, :'cpb', :'cp1'),
  'un movimiento no puede tomar de un lote de otra clienta (clave compuesta)');
select tests.throws(format($$insert into public.client_credit_entries (tenant_id, client_profile_id, kind, amount_minor, currency, expires_at)
                            values (%L, %L, 'manual_credit', 100000, 'ARS', now() + interval '1 day')$$, :A, :'cpb'),
  'un saldo de A no puede ser de una clienta de B (clave compuesta)');

:as_super
\ir lib/finish.sql
