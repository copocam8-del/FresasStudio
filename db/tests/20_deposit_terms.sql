-- =====================================================================
-- Tests de la regla de la seña (Sprint 6 · migración 2710 · POL-01)
-- app.deposit_terms: plazo en el reloj del estudio, con la ventana de la reserva.
-- A exactamente 24 h conserva; a 23:59 (y a 23:59:59) pierde.
-- =====================================================================
\ir lib/setup.sql
\ir lib/sprint6.sql

:as_super
-- Turno el miércoles 10/3/2027 a las 10:00 de Buenos Aires (13:00 UTC)
select tests.appt6(:'cp1', '2027-03-10 13:00Z') as t24 \gset

select tests.ok((select deadline from app.deposit_terms(:'t24', now())) = '2027-03-09 13:00Z',
  'plazo: el martes 9 a las 10:00 de Buenos Aires (24 h antes, hora del estudio)');
select tests.ok((select keeps_deposit from app.deposit_terms(:'t24', '2027-03-09 13:00:00Z')),
  'a exactamente 24:00:00 del turno: conserva la seña');
select tests.ok(not (select keeps_deposit from app.deposit_terms(:'t24', '2027-03-09 13:01:00Z')),
  'a 23:59 del turno: pierde la seña');
select tests.ok(not (select keeps_deposit from app.deposit_terms(:'t24', '2027-03-09 13:00:01Z')),
  'a 23:59:59 del turno: pierde la seña');
select tests.ok(not (select keeps_deposit from app.deposit_terms(:'t24', '2027-03-09 13:00:00.000001Z')),
  'un microsegundo después del plazo: pierde la seña');
select tests.ok((select keeps_deposit from app.deposit_terms(:'t24', '2027-03-09 12:59:59Z')),
  'a 24:00:01 del turno: conserva la seña');
select tests.ok((select keeps_deposit from app.deposit_terms(:'t24', '2027-03-01 12:00Z')),
  'una semana antes: conserva la seña');
select tests.ok(not (select keeps_deposit from app.deposit_terms(:'t24', '2027-03-10 13:30Z')),
  'después de la hora del turno: pierde la seña');

-- Monto: la seña entera (50% de $ 15.000 = $ 7.500)
select tests.ok((select (deposit_minor, refunded_minor, amount_minor) = (750000::bigint, 0::bigint, 750000::bigint)
                 from app.deposit_terms(:'t24', now())),
  'monto: la seña acordada, sin devoluciones');

-- La ventana es la de la política aceptada en la reserva, no la vigente (C1, POL-08)
select tests.appt6(:'cp1', '2027-03-10 16:00Z', 'confirmed', 48) as t48 \gset
select tests.ok((select deadline from app.deposit_terms(:'t48', now())) = '2027-03-08 16:00Z',
  'reserva hecha con 48 h: el plazo es 48 h antes');
update public.tenant_settings set cancellation_window_hours = 72 where tenant_id = :A;
select tests.ok((select deadline from app.deposit_terms(:'t24', now())) = '2027-03-09 13:00Z',
  'si el estudio cambia la ventana, las reservas ya hechas siguen con la suya');

-- Reloj del estudio con cambio de hora (Madrid, fin del horario de verano el 31/10/2027:
-- 03:00 → 02:00). Turno el domingo 31 a las 10:00 (UTC+1) → plazo el sábado 30 a las
-- 10:00 (UTC+2): la clienta ve "el día anterior a la misma hora" (son 25 h reales).
select tests.ok(app.deposit_deadline('2027-10-31 09:00Z', 24, 'Europe/Madrid') = '2027-10-30 08:00Z',
  'cambio de hora (Madrid): el plazo es el día anterior a la misma hora del reloj del estudio');
select tests.ok(app.deposit_deadline('2027-03-10 13:00Z', 24, 'America/Argentina/Buenos_Aires') = '2027-03-09 13:00Z',
  'Buenos Aires (sin cambio de hora): 24 h justas');

-- Las funciones de la regla no se pueden llamar desde la API
:as_owner_a
select tests.throws(format('select * from app.deposit_terms(%L, now())', :'t24'),
  'dueña: no puede llamar app.deposit_terms directo (solo dentro de las funciones)', 'permission denied');
:as_cli1
select tests.throws($$select app.deposit_deadline(now(), 24, 'UTC')$$,
  'clienta: no puede llamar app.deposit_deadline', 'permission denied');

:as_super
\ir lib/finish.sql
