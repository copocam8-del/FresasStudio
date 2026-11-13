-- =====================================================================
-- Tests de fichas, notas, preferencias, agenda e indicadores
-- (Sprint 6 · migración 2750 · CRM-01..04, CAL-01..04, ATT-02..05, C16–C21)
-- La profesional del seed es Sofi.
-- =====================================================================
\ir lib/setup.sql
\ir lib/sprint6.sql

:as_super
update public.client_profiles set full_name = 'Lucía Núñez' where id = :'cp1';
update public.client_profiles set full_name = 'Camila Pérez' where id = :'cp2';
-- cp1: 3 turnos atendidos con Sofi en los últimos 90 días → frecuente
select tests.appt6(:'cp1', date_trunc('hour', now()) - interval '10 days', 'confirmed', 24, :SOFI, 30) as h1 \gset
select tests.appt6(:'cp1', date_trunc('hour', now()) - interval '20 days', 'confirmed', 24, :SOFI, 30) as h2 \gset
select tests.appt6(:'cp1', date_trunc('hour', now()) - interval '30 days', 'confirmed', 24, :SOFI, 30) as h3 \gset
-- cp2: solo con Caro; 2 faltas y una cancelación tardía
select tests.appt6(:'cp2', date_trunc('hour', now()) - interval '5 days', 'confirmed', 24, :CARO, 30) as f1 \gset
select tests.appt6(:'cp2', date_trunc('hour', now()) - interval '15 days', 'confirmed', 24, :CARO, 30) as f2 \gset
select tests.appt6(:'cp2', now() + interval '3 hours', 'confirmed', 24, :CARO, 30) as late \gset
select tests.appt6(:'cp2', now() + interval '5 days', 'confirmed', 24, :CARO, 30) as resch \gset
select tests.appt6(:'cp1', now() - interval '2 hours', 'confirmed', 24, :SOFI, 30) as unclosed \gset
:as_owner_a
select public.mark_attendance(:'h1', 'finished');
select public.mark_attendance(:'h2', 'finished');
select public.mark_attendance(:'h3', 'finished');
select public.mark_no_show(:'f1');
select public.mark_no_show(:'f2');
select public.cancel_booking(:'late', 'client', null, null, null, 'forfeited');
select public.reschedule_booking(:'resch', :CARO, date_trunc('hour', now()) + interval '20 days', true, null, 'transferred');

-- ---------------------------------------------------------------------
-- Profesional: solo SUS clientas (C19)
-- ---------------------------------------------------------------------
:as_pro_a
select tests.ok((select count(*) = 1 from public.client_profiles), 'profesional: ve solo la clienta que atendió');
select tests.ok(exists (select 1 from public.client_profiles where id = :'cp1')
                and not exists (select 1 from public.client_profiles where id = :'cp2'),
  '…Lucía (la atendió), no Camila (solo con Caro)');
select tests.throws(format($$select public.client_file(%L)$$, :'cp2'), 'profesional: no abre la ficha de una clienta ajena', 'No encontramos');
select tests.ok((select (public.client_file(:'cp1') ->> 'only_own')::boolean and public.client_file(:'cp1') ->> 'credit_minor' is null),
  'profesional: en la ficha de su clienta no ve el saldo');
select tests.throws(format($$select * from public.client_payments(%L)$$, :'cp1'), 'profesional: no ve pagos', 'permiso');
select tests.ok((select count(*) = 1 from public.list_clients(:A)), 'profesional: el directorio muestra solo sus clientas');
select tests.ok((select count(*) = 0 from public.client_credit_entries), 'profesional: no ve saldos');

-- ---------------------------------------------------------------------
-- Notas internas (C20)
-- ---------------------------------------------------------------------
select public.add_client_note(:'cp1', 'Prefiere tonos nude') as note_pro \gset
select tests.throws(format($$select public.add_client_note(%L, 'Ajena')$$, :'cp2'),
  'profesional: no escribe notas de clientas ajenas', 'permiso');
:as_owner_a
select public.add_client_note(:'cp1', 'Pide turno siempre a la tarde') as note_owner \gset
select tests.ok((select count(*) = 2 from public.client_notes_list(:'cp1')), 'dueña: ve las notas del equipo');
select tests.throws(format($$update public.client_notes set body = 'Cambiada' where id = %L$$, :'note_pro'),
  'las notas no se editan', 'permission denied');
:as_super
select tests.throws(format($$update public.client_notes set body = 'Cambiada' where id = %L$$, :'note_pro'),
  'las notas no se editan (ni como superusuario)', 'no se puede editar');
select tests.throws(format($$delete from public.client_notes where id = %L$$, :'note_pro'),
  'las notas no se borran (ni como superusuario)', 'no se borran');
:as_pro_a
select tests.throws(format($$select public.hide_client_note(%L)$$, :'note_owner'),
  'profesional: no oculta notas de otras', 'autora');
select public.hide_client_note(:'note_pro');
select tests.ok((select count(*) = 1 from public.client_notes_list(:'cp1')), 'la autora oculta su nota (deja de verse)');
select tests.ok((select count(*) = 2 from public.client_notes_list(:'cp1', true)), '…pero sigue en el historial');
:as_cli1
select tests.ok((select count(*) = 0 from public.client_notes), 'clienta: NUNCA ve las notas internas (ni las suyas)');
select tests.throws(format($$select * from public.client_notes_list(%L)$$, :'cp1'), 'clienta: no puede pedir sus notas', 'No encontramos');
:as_super
select tests.ok((select count(*) = 0 from public.audit_logs where entity_type = 'client_notes' and new_data::text like '%nude%'),
  'la auditoría de notas no guarda el texto');

-- ---------------------------------------------------------------------
-- Preferencias y alergias (C21)
-- ---------------------------------------------------------------------
:as_pro_a
select tests.throws(format($$select public.set_client_preferences(%L, 'Látex', null, null)$$, :'cp1'),
  'profesional: no edita preferencias', 'permiso');
:as_owner_a
select public.set_client_preferences(:'cp1', 'Alergia al látex', 'Música baja', :SOFI);
:as_pro_a
select tests.ok((select allergies = 'Alergia al látex' from public.client_preferences where client_profile_id = :'cp1'),
  'profesional: ve las alergias de su clienta');
select tests.ok((select has_allergies from public.agenda_range(:A, now() - interval '3 hours', now() + interval '1 hour') where id = :'unclosed'),
  'la agenda marca los turnos de clientas con alergias');
:as_cli1
select tests.ok((select count(*) = 0 from public.client_preferences), 'clienta: no ve sus preferencias ni alergias (por ahora)');
:as_super
select tests.ok((select bool_and(new_data::text not like '%látex%' and new_data::text not like '%Música%')
                 from public.audit_logs where entity_type = 'client_preferences'),
  'la auditoría guarda qué campos cambiaron, nunca las alergias');
select tests.ok((select new_data -> 'changed_fields' ? 'allergies' from public.audit_logs where entity_type = 'client_preferences' limit 1),
  '…con los nombres de los campos');
select tests.throws(format($$delete from public.client_preferences where client_profile_id = %L$$, :'cp1'),
  'las preferencias no se borran');
:as_owner_a
select tests.throws(format($$select public.set_client_preferences(%L, null, null, %L)$$, :'cp1', '32000000-0000-4000-a000-0000000000ff'),
  'profesional preferida de otro estudio: rechazada', 'no es de este estudio');

-- ---------------------------------------------------------------------
-- Directorio y ficha
-- ---------------------------------------------------------------------
select tests.ok((select count(*) = 1 from public.list_clients(:A, 'nunez')), 'buscar "nunez" encuentra a "Lucía Núñez"');
select tests.ok((select count(*) = 1 from public.list_clients(:A, 'LUCÍA')), 'buscar sin importar mayúsculas y acentos');
select tests.ok((select count(*) >= 2 from public.list_clients(:A, '5555')), 'buscar por parte del teléfono');
select tests.ok((select bool_and(is_frequent) and count(*) = 1 from public.list_clients(:A, null, 'frequent')),
  'filtro frecuentes: Lucía (3 atendidas en 90 días)');
select tests.ok((select bool_and(repeat_no_shows) and count(*) = 1 from public.list_clients(:A, null, 'no_shows')),
  'filtro con faltas: Camila (2 faltas)');
select tests.throws(format($$select * from public.list_clients(%L, null, 'otro')$$, :A), 'filtro inválido', 'inválido');
select tests.ok((select (f ->> 'attended')::int = 3 and (f ->> 'is_frequent')::boolean and f ->> 'allergies' = 'Alergia al látex'
                 from (select public.client_file(:'cp1') f) x), 'ficha: atendidas, etiqueta y alergias');
select tests.ok((select (f ->> 'no_shows')::int = 2 and (f ->> 'late_cancels')::int = 0 and (f ->> 'reschedules')::int = 0
                 and (f ->> 'repeat_no_shows')::boolean
                 from (select public.client_file(:'cp2') f) x),
  'ficha: 2 faltas; la cancelación y la reprogramación de turnos a futuro todavía no cuentan');
select tests.ok((select count(*) = 5 from public.client_appointments(:'cp2')),
  'historial: todos los turnos, también los cancelados y reprogramados');
select public.create_client(:A, 'Ñandú Gómez', '11 4444-0000', 'nandu@test.ar') as cnew \gset
select tests.ok((select count(*) = 1 from public.list_clients(:A, 'ñandu')), 'alta de clienta y búsqueda con Ñ');
select tests.throws(format($$select public.create_client(%L, 'Otra', null, 'nandu@test.ar')$$, :A), 'email repetido: rechazado', 'Ya hay');
select tests.throws(format($$select public.create_client(%L, 'Sin contacto', null, null)$$, :A), 'sin teléfono ni email: rechazado', 'teléfono o un email');
:as_pro_a
select tests.throws(format($$select public.create_client(%L, 'Nueva', '11 4444-1111', null)$$, :A), 'profesional: no da de alta clientas', 'permiso');

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------
:as_owner_a
select tests.ok((select count(*) >= 2 from public.agenda_range(:A, date_trunc('day', now()) - interval '1 day', date_trunc('day', now()) + interval '2 days')),
  'dueña: ve los turnos de todas en el rango');
select tests.ok((select unclosed and can_mark from public.agenda_range(:A, now() - interval '3 hours', now()) where id = :'unclosed'),
  'turno que ya terminó sin marcar: "sin cerrar"');
select tests.ok((select unclosed = 1 from public.agenda_alerts(:A)), 'aviso: 1 turno sin cerrar');
select tests.ok((select no_shows_month >= 0 from public.agenda_alerts(:A)), 'aviso: faltas del mes');
select tests.ok((select count(distinct professional_id) = 2 from public.agenda_hours(:A, date_trunc('week', now()), date_trunc('week', now()) + interval '7 days')),
  'horarios de la semana: las dos profesionales');
select tests.throws(format($$select * from public.agenda_range(%L, now(), now() + interval '60 days')$$, :A), 'rango de más de 35 días: rechazado', 'Rango');
:as_pro_a
select tests.ok((select bool_and(professional_id = :SOFI) from public.agenda_range(:A, now() - interval '33 days', now() + interval '1 day')),
  'profesional: en la agenda ve solo sus turnos');
select tests.ok((select count(distinct professional_id) = 1 from public.agenda_hours(:A, date_trunc('week', now()), date_trunc('week', now()) + interval '7 days')),
  'profesional: solo su horario');
:as_owner_b
select tests.throws(format($$select * from public.agenda_range(%L, now() - interval '30 days', now() + interval '1 day')$$, :A),
  'dueña de B: no ve la agenda de A', 'permiso');
select tests.throws(format($$select public.client_file(%L)$$, :'cp1'), 'dueña de B: no abre fichas de A', 'No encontramos');
select tests.throws(format($$select * from public.list_clients(%L)$$, :A), 'dueña de B: no ve el directorio de A', 'permiso');
:as_admin
select tests.throws(format($$select * from public.agenda_range(%L, now(), now() + interval '1 day')$$, :A), 'Cleo Admin: sin agenda', 'permiso');
select tests.throws(format($$select * from public.list_clients(%L)$$, :A), 'Cleo Admin: sin clientas', 'permiso');

-- ---------------------------------------------------------------------
-- Indicadores de asistencia (C17, C18)
-- ---------------------------------------------------------------------
:as_owner_a
select public.attendance_stats(:A, now() - interval '90 days', now()) as st \gset
select tests.ok((:'st'::jsonb ->> 'attended')::int = 3 and (:'st'::jsonb ->> 'no_shows')::int = 2,
  'indicadores: 3 atendidas y 2 faltas en 90 días');
select tests.ok((:'st'::jsonb ->> 'late_cancels')::int = 0,
  'una cancelación de un turno a futuro todavía no cuenta (solo turnos pasados)');
select tests.ok((:'st'::jsonb ->> 'rate')::numeric = 60.0, 'tasa de asistencia: 3 / (3 + 2) = 60%');
select tests.ok(jsonb_array_length(:'st'::jsonb -> 'frequent') = 1 and jsonb_array_length(:'st'::jsonb -> 'repeat_no_shows') = 1,
  'rankings: una frecuente y una con faltas repetidas');
select tests.ok((public.attendance_stats(:A, now() - interval '90 days', now(), :SOFI) ->> 'no_shows')::int = 0,
  'filtro por profesional: Sofi no tiene faltas');
:as_pro_a
select tests.throws(format($$select public.attendance_stats(%L, now() - interval '30 days', now())$$, :A),
  'profesional: no ve los indicadores del estudio', 'permiso');
:as_owner_b
select tests.throws(format($$select public.attendance_stats(%L, now() - interval '30 days', now())$$, :A),
  'dueña de B: no ve indicadores de A', 'permiso');

:as_super
\ir lib/finish.sql
