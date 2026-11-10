-- =====================================================================
-- Tests de horarios, bloqueos y working_intervals (Sprint 3 · 1300)
-- Fechas: lunes 16/11/2026 … domingo 22/11/2026. Fresas está en Buenos Aires (UTC-3).
-- =====================================================================
\ir lib/setup.sql

-- Franjas devueltas por working_intervals, en hora local del estudio: "16 09:00-13:00, …"
:as_super
create function tests.iv(p_tenant uuid, p_pro uuid, p_from date, p_to date) returns text
language sql as $$
  select coalesce(string_agg(
           to_char(lower(r) at time zone t.timezone, 'DD HH24:MI') || '-' ||
           to_char(upper(r) at time zone t.timezone, 'HH24:MI'), ', ' order by lower(r)), '(nada)')
  from public.tenants t,
       app.working_intervals(p_tenant, p_pro,
                             p_from::timestamp at time zone t.timezone,
                             p_to::timestamp at time zone t.timezone) r
  where t.id = p_tenant
$$;

insert into public.professionals (id, tenant_id, display_name) values
  ('20000000-0000-4000-a000-000000000001', :A, 'Pro A'),
  ('20000000-0000-4000-a000-000000000002', :A, 'Caro');
\set PRO_A '''20000000-0000-4000-a000-000000000001'''
\set CARO  '''20000000-0000-4000-a000-000000000002'''

-- ---------------------------------------------------------------------
-- Horario del estudio: lunes a sábado 9–13 y 14–19 (descanso al mediodía)
-- ---------------------------------------------------------------------
:as_owner_a
insert into public.working_hours (tenant_id, weekday, start_minute, end_minute)
select :A, d, s, e from generate_series(1, 6) d, (values (540, 780), (840, 1140)) v(s, e);
select tests.ok((select count(*) = 12 from public.working_hours where tenant_id = :A and professional_id is null),
                'estudio: 2 franjas por día de lunes a sábado');

select tests.throws(format('insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (%L, 1, 600, 660)', :A),
                    'franjas: no se pueden superponer en el mismo día', 'working_hours_no_overlap');
select tests.throws(format('insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (%L, 7, 600, 600)', :A),
                    'franjas: el inicio tiene que ser antes del fin', 'working_hours_range');
select tests.throws(format('insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (%L, 7, 601, 700)', :A),
                    'franjas: minutos múltiplos de 5', 'working_hours_range');
select tests.throws(format('insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (%L, 8, 600, 700)', :A),
                    'franjas: día de la semana entre 1 y 7', 'working_hours_weekday');
-- Franjas pegadas (13–14 entre 9–13 y 14–19) no se superponen
insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (:A, 7, 600, 720);
delete from public.working_hours where tenant_id = :A and weekday = 7;
select tests.ok(true, 'franjas: una franja nueva en un día libre se acepta y se puede borrar');

-- Horario propio de Pro A: lunes 10–12 y jueves 14–18
insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute)
values (:A, :PRO_A, 1, 600, 720), (:A, :PRO_A, 4, 840, 1080);
select tests.throws(format('insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute) values (%L, %L, 2, 480, 600)', :A, :PRO_A),
                    'N5: una profesional no puede atender fuera del horario del estudio', 'dentro del horario del estudio');
select tests.throws(format('insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute) values (%L, %L, 2, 720, 900)', :A, :PRO_A),
                    'N5: ni durante el descanso del estudio', 'dentro del horario del estudio');

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
:as_pro_a
select tests.throws(format('insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (%L, 7, 600, 700)', :A),
                    'profesional A: no puede cambiar el horario del estudio', 'row-level security');
select tests.throws(format('insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute) values (%L, %L, 2, 600, 700)', :A, :PRO_A),
                    'N6: profesional A no puede cargar su propio horario', 'row-level security');
select tests.throws(format($$insert into public.schedule_blocks (tenant_id, professional_id, kind, period) values (%L, %L, 'day_off', '[2026-11-17 12:00Z, 2026-11-17 13:00Z)')$$, :A, :PRO_A),
                    'N6: profesional A no puede cargar sus propios bloqueos', 'row-level security');
select tests.ok((select count(*) = 14 from public.working_hours), 'profesional A: ve los horarios de su estudio');

:as_owner_b
select tests.ok((select count(*) = 0 from public.working_hours where tenant_id = :A), 'dueña B: no ve horarios de A');
select tests.throws(format($$insert into public.schedule_blocks (tenant_id, kind, period) values (%L, 'holiday', '[2026-11-18 03:00Z, 2026-11-19 03:00Z)')$$, :A),
                    'dueña B: no puede bloquear el estudio A', 'row-level security');

:as_super
-- Lo frena el control N5 (trigger) o la clave compuesta: lo importante es que no entre.
select tests.throws(format($$insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute) values (%L, %L, 1, 600, 700)$$, :B, :PRO_A),
                    'integridad: un horario de B no puede ser de una profesional de A');
select tests.ok(not exists (select 1 from public.working_hours where tenant_id = :B), 'integridad: B no tiene horarios cargados');

:as_admin
select tests.ok((select count(*) = 0 from public.working_hours), 'Cleo Admin: no ve horarios');

-- ---------------------------------------------------------------------
-- Bloqueos (la encargada tiene agenda.manage)
-- ---------------------------------------------------------------------
:as_manager_a
-- Feriado el miércoles 18 (todo el día; se carga con horas cualquiera y se normaliza)
insert into public.schedule_blocks (tenant_id, kind, period, all_day, note)
values (:A, 'holiday', '[2026-11-18 15:00Z, 2026-11-18 16:00Z)', true, '  Feriado  ');
select tests.ok((select period = tstzrange('2026-11-18 00:00-03', '2026-11-19 00:00-03', '[)') and note = 'Feriado'
                 from public.schedule_blocks where kind = 'holiday'),
                'bloqueo de todo el día: se normaliza a 00:00–24:00 en la hora del estudio');
-- Vacaciones de Caro jueves 19 y viernes 20
insert into public.schedule_blocks (tenant_id, professional_id, kind, period, all_day)
values (:A, :CARO, 'vacation', '[2026-11-19 12:00Z, 2026-11-20 12:00Z)', true);
-- Martes 17: el estudio cierra de 15 a 16
insert into public.schedule_blocks (tenant_id, kind, period) values (:A, 'block', '[2026-11-17 18:00Z, 2026-11-17 19:00Z)');
select tests.throws(format($$insert into public.schedule_blocks (tenant_id, kind, period) values (%L, 'block', '[2026-11-17 18:00Z, 2026-11-17 18:00Z)')$$, :A),
                    'bloqueo: el inicio tiene que ser antes del fin', 'schedule_blocks_period');
select tests.throws(format($$insert into public.schedule_blocks (tenant_id, kind, period) values (%L, 'vacation', '[2026-01-01 00:00Z, 2027-06-01 00:00Z)')$$, :A),
                    'bloqueo: como máximo un año', 'schedule_blocks_period');
select tests.throws(format($$insert into public.schedule_blocks (tenant_id, kind, period) values (%L, 'block', '[2026-11-17 18:00Z,)')$$, :A),
                    'bloqueo: tiene que tener fin', 'schedule_blocks_period');

-- ---------------------------------------------------------------------
-- working_intervals
-- ---------------------------------------------------------------------
:as_super
select tests.ok(tests.iv(:A, null, '2026-11-16', '2026-11-17') = '16 09:00-13:00, 16 14:00-19:00',
                'estudio lunes: 9–13 y 14–19 (el descanso no se ofrece)');
select tests.ok((select lower(r) = '2026-11-16 12:00Z' from app.working_intervals(:A, null, '2026-11-16 03:00Z', '2026-11-17 03:00Z') r limit 1),
                'zona horaria: las 9:00 de Buenos Aires son las 12:00 UTC');
select tests.ok(tests.iv(:A, :CARO, '2026-11-16', '2026-11-17') = '16 09:00-13:00, 16 14:00-19:00',
                'N4: Caro, sin horario propio, atiende en el horario del estudio');
select tests.ok(tests.iv(:A, :PRO_A, '2026-11-16', '2026-11-17') = '16 10:00-12:00',
                'Pro A lunes: su horario propio (10–12)');
select tests.ok(tests.iv(:A, :PRO_A, '2026-11-17', '2026-11-18') = '(nada)',
                'Pro A martes: no tiene franja ese día, no atiende');
select tests.ok(tests.iv(:A, null, '2026-11-17', '2026-11-18') = '17 09:00-13:00, 17 14:00-15:00, 17 16:00-19:00',
                'bloqueo puntual: el martes el estudio no atiende de 15 a 16');
select tests.ok(tests.iv(:A, :CARO, '2026-11-18', '2026-11-19') = '(nada)',
                'feriado del estudio: nadie atiende el miércoles');
select tests.ok(tests.iv(:A, :PRO_A, '2026-11-19', '2026-11-20') = '19 14:00-18:00',
                'vacaciones de Caro: Pro A atiende igual el jueves');
select tests.ok(tests.iv(:A, :CARO, '2026-11-19', '2026-11-21') = '(nada)',
                'vacaciones de Caro: Caro no atiende jueves ni viernes');
select tests.ok(tests.iv(:A, null, '2026-11-22', '2026-11-23') = '(nada)',
                'domingo: el estudio está cerrado');
select tests.ok((select count(*) = 0 from app.working_intervals(:A, null, '2026-11-17 03:00Z', '2026-11-17 03:00Z')),
                'período vacío: no devuelve nada');
select tests.ok((select array_agg(r order by lower(r))
                 from app.working_intervals(:A, null, '2026-11-16 13:00Z', '2026-11-16 18:00Z') r)
                = array[tstzrange('2026-11-16 13:00Z', '2026-11-16 16:00Z'), tstzrange('2026-11-16 17:00Z', '2026-11-16 18:00Z')],
                'recorte: solo devuelve lo que cae dentro del período pedido');

-- N5 al calcular: si el estudio achica el lunes a 11–13, Pro A queda 11–12
update public.working_hours set start_minute = 660 where tenant_id = :A and professional_id is null and weekday = 1 and start_minute = 540;
select tests.ok(tests.iv(:A, :PRO_A, '2026-11-16', '2026-11-17') = '16 11:00-12:00',
                'N5: si el estudio achica su horario, el de la profesional se recorta');

select tests.throws(format('select * from app.working_intervals(%L, %L, now(), now() + interval ''1 day'')', :B, :CARO),
                    'working_intervals: una profesional de otro estudio se rechaza', 'no es de este estudio');

-- Otra zona horaria: Estudio B en Ciudad de México (UTC-6)
update public.tenants set timezone = 'America/Mexico_City' where id = :B;
insert into public.working_hours (tenant_id, weekday, start_minute, end_minute) values (:B, 1, 540, 600);
select tests.ok((select lower(r) = '2026-11-16 15:00Z' from app.working_intervals(:B, null, '2026-11-16 00:00Z', '2026-11-17 12:00Z') r limit 1),
                'zona horaria: las 9:00 de Ciudad de México son las 15:00 UTC');

:as_owner_a
select tests.throws(format('select * from app.working_intervals(%L, null, now(), now() + interval ''1 day'')', :A),
                    'working_intervals no se puede llamar desde la API', 'permission denied');

\ir lib/finish.sql
