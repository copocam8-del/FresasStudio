-- =====================================================================
-- Tests de la vista previa de la reserva (Sprint 4 · migración 2100)
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set SEMI '''31000000-0000-4000-a000-000000000001'''

:as_super
update public.tenant_settings set payments_connected = true, online_booking_enabled = true where tenant_id = :A;
select (current_date + 8 + ((8 - extract(isodow from current_date + 8)::int) % 7))::date as d \gset
create function tests.at(p_day date, p_time time) returns timestamptz
language sql immutable as $$ select (p_day + p_time) at time zone 'America/Argentina/Buenos_Aires' $$;

:as_anon
select tests.ok((select professional_name = 'Caro' and duration_minutes = 75 and price_minor = 1300000 and deposit_minor = 650000
                        and ends_at = tests.at(:'d', '10:15') and currency = 'ARS'
                 from public.preview_booking('fresas', :SEMI, :CARO, tests.at(:'d', '09:00'))),
                'vista previa con Caro: 75 min, $ 13.000, seña $ 6.500, termina 10:15');
select tests.ok((select professional_name = 'Caro' from public.preview_booking('fresas', :SEMI, null, tests.at(:'d', '09:00'))),
                '"cualquiera" a las 9:00: solo Caro trabaja a la mañana → Caro');
select tests.ok((select professional_name = 'Sofi' from public.preview_booking('fresas', :SEMI, null, tests.at(:'d', '14:00'))),
                '"cualquiera" a las 14:00 sin turnos: empate → la primera del panel (Sofi)');
select tests.ok((select count(*) = 0 from public.preview_booking('fresas', :SEMI, null, tests.at(:'d', '13:00'))),
                'horario en el descanso: sin vista previa (no disponible)');

:as_super
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-f000-000000000010', 'pre@gmail.test', now());
\set as_pre 'reset role; do $x$ begin perform tests.login(''pre@gmail.test''); end $x$; set local role authenticated;'
:as_pre
select code as pre_code from public.create_online_booking('fresas', :SEMI, :SOFI, tests.at(:'d', '15:00'),
  (select (public.get_booking_context('fresas') ->> 'policy_version')::int), '11 4111-0000') \gset
:as_anon
select tests.ok((select professional_name = 'Caro' from public.preview_booking('fresas', :SEMI, null, tests.at(:'d', '17:00'))),
                'B4 en la vista previa: Sofi ya tiene un turno ese día → Caro');
select tests.ok((select count(*) = 0 from public.preview_booking('fresas', :SEMI, :SOFI, tests.at(:'d', '15:30'))),
                'horario que pisa un turno: sin vista previa');

:as_super
select tests.ok((select provolatile = 's' from pg_proc where oid = 'public.preview_booking(text, uuid, uuid, timestamptz)'::regprocedure),
                'preview_booking es de solo lectura (stable)');
update public.tenant_settings set online_booking_enabled = false where tenant_id = :A;
:as_anon
select tests.ok((select count(*) = 0 from public.preview_booking('fresas', :SEMI, :CARO, tests.at(:'d', '09:00'))),
                'reservas apagadas: sin vista previa');

\ir lib/finish.sql
