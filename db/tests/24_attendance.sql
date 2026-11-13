-- =====================================================================
-- Tests de asistencia (Sprint 6 · migración 2740 · ATT-01, POL-06, CAL-05, C12–C14)
-- La profesional del seed (profesional@fresasstudio.test) es Sofi.
-- =====================================================================
\ir lib/setup.sql
\ir lib/sprint6.sql

:as_super
select tests.appt6(:'cp1', now() + interval '1 hour') as a1 \gset
select tests.appt6(:'cp2', now() + interval '1 hour', 'confirmed', 24, :CARO) as a_caro \gset
select tests.appt6(:'cp2', now() + interval '3 hours', 'confirmed', 24, :SOFI, 30) as a_early \gset

-- ---------------------------------------------------------------------
-- Llegó → empezó → terminó (la profesional, en su turno)
-- ---------------------------------------------------------------------
:as_pro_a
select tests.ok(public.mark_attendance(:'a1', 'checked_in') = 'confirmed', 'profesional: marca "llegó" en su turno');
select tests.throws(format($$select public.mark_attendance(%L, 'checked_in')$$, :'a1'), 'no se marca "llegó" dos veces', 'Ya figura');
select tests.ok(public.mark_attendance(:'a1', 'started') = 'confirmed', 'profesional: marca "empezó"');
select tests.ok(public.mark_attendance(:'a1', 'finished') = 'completed', 'profesional: marca "terminó" y el turno queda atendido');
:as_super
select tests.ok((select status = 'completed' and deposit_outcome = 'applied' and deposit_outcome_minor = 750000
                        and checked_in_at is not null and started_at >= checked_in_at and finished_at >= started_at
                        and closed_at is not null
                 from public.appointments where id = :'a1'),
  'atendida: la seña cuenta como pago del turno y quedan las horas de cada paso');
select tests.ok((select count(*) = 3 from public.appointment_events where appointment_id = :'a1'
                 and event_type in ('checked_in', 'started', 'completed')),
  'cada paso queda en el historial del turno');
:as_pro_a
select tests.throws(format($$select public.mark_attendance(%L, 'finished')$$, :'a1'),
  'un turno atendido no se vuelve a cerrar (asistencia una sola vez)', 'no está confirmado');
select tests.throws(format($$select public.mark_attendance(%L, 'checked_in')$$, :'a_caro'),
  'profesional: no marca turnos de otra profesional', 'permiso');
select tests.throws(format($$select public.mark_no_show(%L)$$, :'a1'),
  'profesional: no puede marcar faltas', 'permiso');
select tests.throws(format($$select public.mark_attendance(%L, 'checked_in')$$, :'a_early'),
  'no se marca antes de 2 h del turno', 'desde 2 horas antes');

-- Saltear pasos: "terminó" directo
:as_owner_a
select tests.ok(public.mark_attendance(:'a_caro', 'finished') = 'completed', 'recepción/dueña: puede marcar "terminó" directo');
:as_super
select tests.ok((select checked_in_at is not null and started_at is not null from public.appointments where id = :'a_caro'),
  '…y completa llegó/empezó con la misma hora');

-- ---------------------------------------------------------------------
-- Faltó (C12): desde la hora del turno, la seña se pierde
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp1', now() + interval '30 minutes', 'confirmed', 24, :SOFI, 30) as n_future \gset
select tests.appt6(:'cp1', now() - interval '45 minutes', 'confirmed', 24, :CARO, 30) as n1 \gset
select tests.appt6(:'cp2', now() - interval '3 hours', 'confirmed', 24, :SOFI, 30) as n_arrived \gset
:as_owner_a
select tests.throws(format($$select public.mark_no_show(%L)$$, :'n_future'), 'falta antes de la hora del turno: no', 'desde la hora');
select tests.ok(public.mark_no_show(:'n1') = 'forfeited', 'faltó: la seña se pierde');
:as_super
select tests.ok((select status = 'no_show' and deposit_outcome = 'forfeited' from public.appointments where id = :'n1'),
  'el turno queda como falta');
select tests.ok(tests.credit(:'cp1') = 0, 'una falta no suma saldo');
:as_owner_a
select public.mark_attendance(:'n_arrived', 'checked_in');
select tests.throws(format($$select public.mark_no_show(%L)$$, :'n_arrived'), 'si figura que llegó, no puede ser falta', 'llegó');
select tests.throws(format($$select public.mark_attendance(%L, 'finished')$$, :'n1'),
  'una falta no se puede marcar como atendida (sin corregir)', 'no está confirmado');
:as_super
select tests.throws(format($$update public.appointments set status = 'completed' where id = %L$$, :'n1'),
  'falta → atendida solo con la corrección (aun como superusuario)', 'no permitido');
select tests.throws(format($$update public.appointments set checked_in_at = null where id = %L$$, :'n_arrived'),
  'lo registrado (llegó) no se borra', 'no se puede cambiar');

-- ---------------------------------------------------------------------
-- Corregir una falta (C13)
-- ---------------------------------------------------------------------
:as_owner_a
select tests.throws(format($$select public.correct_no_show(%L, '')$$, :'n1'), 'corregir: el motivo es obligatorio', 'motivo');
select tests.ok(public.correct_no_show(:'n1', 'Vino y nos olvidamos de marcarla') = 'completed', 'corregir una falta: pasa a atendida');
:as_super
select tests.ok((select status = 'completed' and deposit_outcome = 'applied' from public.appointments where id = :'n1'),
  '…y la seña vuelve a contar como pago del turno');
select tests.ok(exists (select 1 from public.appointment_events where appointment_id = :'n1' and event_type = 'no_show_corrected'),
  '…queda en el historial con el motivo');
:as_owner_a
select tests.throws(format($$select public.correct_no_show(%L, 'Otra vez')$$, :'n1'), 'se corrige una sola vez', 'no figura como falta');

:as_super
select tests.appt6(:'cp2', now() - interval '9 days', 'confirmed', 24, :CARO, 30) as n_old \gset
:as_owner_a
select public.mark_no_show(:'n_old');
:as_super
do $$ begin perform set_config('app.no_show_correction', 'on', true); end $$;
update public.appointments set closed_at = now() - interval '8 days' where id = :'n_old';
do $$ begin perform set_config('app.no_show_correction', '', true); end $$;
:as_owner_a
select tests.throws(format($$select public.correct_no_show(%L, 'Tarde')$$, :'n_old'), 'después de 7 días ya no se corrige', '7 días');
:as_pro_a
select tests.throws(format($$select public.correct_no_show(%L, 'Profesional')$$, :'n_old'), 'profesional: no corrige faltas', 'permiso');

-- Política del estudio: la falta NO hace perder la seña → pasa al saldo
:as_super
update public.tenant_settings set no_show_forfeits_deposit = false where tenant_id = :A;
select tests.appt6(:'cp2', now() - interval '20 minutes', 'confirmed', 24, :CARO, 30) as n_keep \gset
:as_owner_a
select tests.ok(public.mark_no_show(:'n_keep') = 'credited', 'si la política no hace perder la seña por falta, pasa al saldo');
:as_super
select tests.ok((select kind = 'no_show_credit' and amount_minor = 750000 from public.client_credit_entries where appointment_id = :'n_keep'),
  '…como saldo "por falta" de $ 7.500');
:as_owner_a
select tests.throws(format($$select public.correct_no_show(%L, 'Error')$$, :'n_keep'),
  'esa falta no se corrige a mano (el saldo ya se acreditó)', 'saldo');

-- ---------------------------------------------------------------------
-- Estados que no se marcan y aislamiento
-- ---------------------------------------------------------------------
:as_super
select tests.appt6(:'cp1', now() + interval '1 hour', 'pending_payment', 24, :CARO, 30) as p1 \gset
select tests.appt6(:'cp1', now() - interval '6 hours', 'confirmed', 24, :CARO, 30) as other \gset
:as_owner_a
select tests.throws(format($$select public.mark_attendance(%L, 'checked_in')$$, :'p1'),
  'una reserva esperando pago no se marca', 'no está confirmado');
select tests.throws(format($$select public.mark_attendance(%L, 'otra')$$, :'other'), 'paso inválido', 'inválido');
:as_owner_b
select tests.throws(format($$select public.mark_attendance(%L, 'checked_in')$$, :'other'), 'dueña de B: no marca turnos de A', 'permiso');
select tests.throws(format($$select public.mark_no_show(%L)$$, :'other'), 'dueña de B: no marca faltas en A', 'permiso');
:as_cli1
select tests.throws(format($$select public.mark_attendance(%L, 'checked_in')$$, :'other'), 'clienta: no marca su propia asistencia', 'permiso');
:as_super
update public.tenants set status = 'suspended' where id = :A;
:as_owner_a
select tests.throws(format($$select public.mark_no_show(%L)$$, :'other'), 'estudio suspendido: no se marca nada', 'permiso');

:as_super
\ir lib/finish.sql
