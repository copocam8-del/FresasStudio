-- =====================================================================
-- Tests de set_working_hours y create_schedule_block (Sprint 3 · 1500)
-- Usa el seed: Fresas lun-vie 9-13/14-19 y sáb 9-14; Sofi lun-vie 14-19.
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''

-- ---------------------------------------------------------------------
-- set_working_hours: reemplaza la semana de una vez
-- ---------------------------------------------------------------------
:as_manager_a
select public.set_working_hours(:A, :CARO, '[{"weekday": 1, "start": 540, "end": 780}, {"weekday": 3, "start": 840, "end": 1020}]');
select tests.ok((select count(*) = 2 from public.working_hours where professional_id = :CARO),
                'horario de Caro: se guardan sus 2 franjas');
select public.set_working_hours(:A, :CARO, '[{"weekday": 2, "start": 600, "end": 720}]');
select tests.ok((select count(*) = 1 and min(weekday) = 2 from public.working_hours where professional_id = :CARO),
                'horario de Caro: guardar otra vez reemplaza todo (no suma)');

-- Si una franja es inválida no queda nada a medias
select tests.throws(format($$select public.set_working_hours(%L, %L, '[{"weekday": 4, "start": 540, "end": 600}, {"weekday": 4, "start": 480, "end": 560}]')$$, :A, :CARO),
                    'franja fuera del horario del estudio: error', 'dentro del horario del estudio');
select tests.ok((select count(*) = 1 and min(weekday) = 2 from public.working_hours where professional_id = :CARO),
                'después del error, el horario anterior sigue intacto (todo o nada)');
select tests.throws(format($$select public.set_working_hours(%L, null, '[{"weekday": 1, "start": 540, "end": 700}, {"weekday": 1, "start": 600, "end": 800}]')$$, :A),
                    'estudio: franjas superpuestas se rechazan', 'working_hours_no_overlap');
select tests.ok((select count(*) = 11 from public.working_hours where tenant_id = :A and professional_id is null),
                'después del error, el horario del estudio sigue intacto');

-- Volver a "igual al del estudio": lista vacía
select public.set_working_hours(:A, :CARO, '[]');
select tests.ok(not exists (select 1 from public.working_hours where professional_id = :CARO),
                'lista vacía: Caro vuelve a usar el horario del estudio (N4)');

-- Estudio: cambiar el sábado
select public.set_working_hours(:A, null,
  (select jsonb_agg(jsonb_build_object('weekday', weekday, 'start', start_minute, 'end', end_minute))
   from public.working_hours where tenant_id = :A and professional_id is null and weekday <> 6)
  || '[{"weekday": 6, "start": 600, "end": 900}]'::jsonb);
select tests.ok((select start_minute = 600 and end_minute = 900 from public.working_hours
                 where tenant_id = :A and professional_id is null and weekday = 6),
                'estudio: la encargada cambia el horario del sábado');

-- Permisos (corre con los permisos de quien llama)
:as_pro_a
select tests.throws(format($$select public.set_working_hours(%L, %L, '[]')$$, :A, :SOFI),
                    'N6: la profesional no puede cambiar su horario', 'No tenés permiso');
select tests.throws(format($$select public.set_working_hours(%L, null, '[]')$$, :A),
                    'la profesional no puede cambiar el horario del estudio', 'No tenés permiso');
:as_owner_b
select tests.throws(format($$select public.set_working_hours(%L, null, '[]')$$, :A),
                    'dueña B: no puede cambiar el horario de A', 'No tenés permiso');
select tests.throws(format($$select public.set_working_hours(%L, %L, '[{"weekday": 1, "start": 540, "end": 600}]')$$, :B, :CARO),
                    'dueña B: no puede cargar horarios a una profesional de A declarando su estudio', null);
:as_super
select tests.ok((select count(*) = 5 from public.working_hours where professional_id = :SOFI),
                'después de los intentos, el horario de Sofi sigue igual');
:as_anon
select tests.throws(format($$select public.set_working_hours(%L, null, '[]')$$, :A), 'anon: no puede llamar', 'permission denied');

-- ---------------------------------------------------------------------
-- create_schedule_block: fechas locales del estudio
-- ---------------------------------------------------------------------
:as_manager_a
select public.create_schedule_block(:A, :CARO, 'day_off', '2026-11-26', '2026-11-27', true, 'Trámites') as blk \gset
select tests.ok((select period = tstzrange('2026-11-26 00:00-03', '2026-11-28 00:00-03', '[)') and all_day
                 from public.schedule_blocks where id = :'blk'),
                'todo el día del 26 al 27: jueves y viernes completos en hora de Buenos Aires');
select public.create_schedule_block(:A, null, 'block', '2026-11-30 15:00', '2026-11-30 16:30', false, null) as blk2 \gset
select tests.ok((select period = tstzrange('2026-11-30 18:00Z', '2026-11-30 19:30Z', '[)')
                 from public.schedule_blocks where id = :'blk2'),
                'bloqueo de 15:00 a 16:30 locales = 18:00 a 19:30 UTC');
select tests.throws(format($$select public.create_schedule_block(%L, null, 'block', '2026-11-30 16:00', '2026-11-30 15:00', false, null)$$, :A),
                    'bloqueo al revés: error claro', 'terminar después de empezar');
:as_pro_a
select tests.throws(format($$select public.create_schedule_block(%L, %L, 'day_off', '2026-11-26', '2026-11-26', true, null)$$, :A, :SOFI),
                    'N6: la profesional no puede crear sus bloqueos', 'row-level security');
:as_owner_b
select tests.throws(format($$select public.create_schedule_block(%L, null, 'holiday', '2026-11-26', '2026-11-26', true, null)$$, :A),
                    'dueña B: no puede bloquear el estudio A (ni siquiera lo ve)', 'Estudio inexistente');

\ir lib/finish.sql
