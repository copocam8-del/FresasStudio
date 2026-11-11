-- =====================================================================
-- Tests de disponibilidad (Sprint 4 · migración 1800), con el seed de Fresas:
--   estudio lun–vie 9–13 y 14–19, sáb 9–14 · Sofi lun–vie 14–19 · Caro = estudio
--   semipermanente 60 min + 10 extra, $ 15.000 · Caro: 75 min, $ 13.000
-- Fechas relativas a hoy: D = un lunes entre 8 y 14 días adelante.
-- =====================================================================
\ir lib/setup.sql
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set SEMI '''31000000-0000-4000-a000-000000000001'''
\set HENNA '''31000000-0000-4000-a000-000000000007'''

:as_super
update public.tenant_settings set payments_connected = true, online_booking_enabled = true where tenant_id = :A;
select (current_date + 8 + ((8 - extract(isodow from current_date + 8)::int) % 7))::date as d \gset
select (:'d'::date + 6)::date as sunday \gset

-- Horarios de un día en hora local: "14:00, 14:15, …"
create function tests.slots(p_pro uuid, p_day date, p_service uuid default '31000000-0000-4000-a000-000000000001') returns text
language sql as $$
  select coalesce(string_agg(to_char(s.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI'), ', ' order by s.starts_at), '(nada)')
  from public.get_available_slots('fresas', p_service, p_pro, p_day) s
$$;
create function tests.nslots(p_pro uuid, p_day date) returns int
language sql as $$ select count(*)::int from public.get_available_slots('fresas', '31000000-0000-4000-a000-000000000001', p_pro, p_day) $$;

select tests.ok(extract(isodow from :'d'::date) = 1, 'el día de prueba es lunes');

-- ---------------------------------------------------------------------
-- Horarios por profesional
-- ---------------------------------------------------------------------
:as_anon
select tests.ok(tests.slots(:SOFI, :'d') = '14:00, 14:15, 14:30, 14:45, 15:00, 15:15, 15:30, 15:45, 16:00, 16:15, 16:30, 16:45, 17:00, 17:15, 17:30, 17:45, 18:00',
                'Sofi (solo tardes): de 14:00 a 18:00 cada 15 min; el servicio de 60 min termina antes de las 19 (B12)');
select tests.ok(tests.nslots(:CARO, :'d') = 28 and tests.slots(:CARO, :'d') like '09:00, %, 11:45, 14:00, %, 17:45',
                'Caro (75 min propios): 9:00–11:45 y 14:00–17:45; nada que pise el descanso de 13 a 14');
select tests.ok(tests.slots(:CARO, :'d') not like '%12:00%' and tests.slots(:CARO, :'d') not like '%13:%',
                'descanso: no se ofrece ni 12:00 (no entra) ni 13:xx');
select tests.ok(tests.nslots(null, :'d') = 29, '"cualquiera disponible": la unión de los horarios (29 distintos)');
select tests.ok(tests.slots(null, :'sunday') = '(nada)', 'domingo: no hay horarios');

-- Días con lugar
select tests.ok((select slots = 29 from public.get_available_days('fresas', :SEMI, null, :'d', 7) where day = :'d'),
                'calendario: el lunes muestra la misma cantidad que los horarios');
select tests.ok((select slots = 0 from public.get_available_days('fresas', :SEMI, null, :'d', 7) where day = :'sunday'),
                'calendario: el domingo, 0');
select tests.ok((select count(*) = 0 from public.get_available_days('fresas', :SEMI, null, :'d', 63)),
                'calendario: más de 62 días de una vez se rechaza (vacío)');

-- Opciones del servicio
select tests.ok((select array_agg(display_name || ':' || duration_minutes || ':' || price_minor || ':' || deposit_minor order by display_name)
                 = array['Caro:75:1300000:650000', 'Sofi:60:1500000:750000']
                 from public.get_service_options('fresas', :SEMI)),
                'opciones: cada profesional con su duración, precio y seña (50%)');
select tests.ok((select bool_and(deposit_minor = 750000) from public.get_service_options('fresas', '31000000-0000-4000-a000-000000000004')),
                'opciones: el lifting usa su seña propia (30% de $ 25.000 = $ 7.500)');

-- ---------------------------------------------------------------------
-- Turnos existentes y bloqueos temporales
-- ---------------------------------------------------------------------
:as_super
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-d000-000000000009', 'cli9@gmail.test', now());
insert into public.client_profiles (id, tenant_id, user_id, full_name, email, source)
values ('40000000-0000-4000-a000-000000000009', :A, '00000000-0000-4000-d000-000000000009', 'Clienta Nueve', 'cli9@gmail.test', 'self_signup');
create function tests.put(p_pro uuid, p_local timestamp, p_status public.appointment_status, p_hold interval default interval '2 hours')
returns uuid language plpgsql as $$
declare v_id uuid; v_start timestamptz := p_local at time zone 'America/Argentina/Buenos_Aires';
begin
  insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at, occupied_until,
    service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from, currency, deposit_percent, deposit_minor,
    policy_version, cancellation_window_hours, status, deposit_status, hold_expires_at, source)
  values ('10000000-0000-4000-a000-000000000001', app.generate_booking_code(), '40000000-0000-4000-a000-000000000009', p_pro,
    '31000000-0000-4000-a000-000000000001', v_start, v_start + interval '60 minutes', v_start + interval '70 minutes',
    'Esmaltado semipermanente', 'Pro', 60, 10, 1500000, false, 'ARS', 50, 750000,
    (select policy_version from public.tenant_settings where tenant_id = '10000000-0000-4000-a000-000000000001'), 24,
    p_status, case when p_status = 'confirmed' then 'paid'::public.deposit_status else 'pending'::public.deposit_status end,
    case when p_status = 'pending_payment' then now() + p_hold end, 'staff')  -- 'staff': el límite B7 (una pendiente online) no aplica
  returning id into v_id;
  return v_id;
end $$;
select tests.put(:SOFI, :'d'::date + time '15:00', 'confirmed');

:as_anon
select tests.ok(tests.slots(:SOFI, :'d') = '16:15, 16:30, 16:45, 17:00, 17:15, 17:30, 17:45, 18:00',
                'turno de Sofi 15:00–16:00 (+10 extra): no se ofrece nada que lo pise; libre desde 16:15');

:as_super
-- Un bloqueo temporal ACTIVO ocupa; uno VENCIDO no.
select tests.put(:CARO, :'d'::date + time '09:00', 'pending_payment') as hold_ok \gset
select tests.put(:CARO, :'d'::date + time '16:00', 'pending_payment', interval '-1 minute') as hold_exp \gset
:as_anon
select tests.ok(tests.slots(:CARO, :'d') not like '09:%' and tests.slots(:CARO, :'d') like '10:15, %',
                'bloqueo temporal activo (Caro 9:00): ocupa el horario');
select tests.ok(tests.slots(:CARO, :'d') like '%, 16:00, %',
                'bloqueo temporal VENCIDO (Caro 16:00): ya no ocupa, aunque nadie lo haya limpiado');

-- ---------------------------------------------------------------------
-- Reglas del estudio
-- ---------------------------------------------------------------------
:as_super
update public.tenant_settings set slot_interval_minutes = 30 where tenant_id = :A;
:as_anon
select tests.ok(tests.slots(:SOFI, :'d') = '16:30, 17:00, 17:30, 18:00', 'intervalo de 30 min: horarios cada media hora');
:as_super
update public.tenant_settings set slot_interval_minutes = 15, booking_horizon_days = 3 where tenant_id = :A;
:as_anon
select tests.ok(tests.nslots(null, :'d') = 0, 'horizonte de 3 días: el lunes de dentro de más de una semana no se ofrece');
:as_super
update public.tenant_settings set booking_horizon_days = 60 where tenant_id = :A;
-- Anticipación mínima: con 7 días, mañana no se ofrece; con 0, sí (si mañana es día hábil)
select (select d::date from generate_series(current_date + 1, current_date + 5, interval '1 day') d
        where extract(isodow from d) between 1 and 5 limit 1) as soon \gset
update public.tenant_settings set booking_min_notice_minutes = 10080 where tenant_id = :A;
:as_anon
select tests.ok(tests.nslots(null, :'soon') = 0, 'anticipación mínima de 7 días: un día hábil cercano no se ofrece');
:as_super
update public.tenant_settings set booking_min_notice_minutes = 0 where tenant_id = :A;
:as_anon
select tests.ok(tests.nslots(null, :'soon') > 0, 'anticipación 0: ese día sí se ofrece');
:as_super
update public.tenant_settings set booking_min_notice_minutes = 720 where tenant_id = :A;

-- Feriado y vacaciones (seed: 8/12 feriado; Caro de vacaciones 21–24/12/2026)
:as_anon
select tests.ok(tests.nslots(null, '2026-12-08') = 0 or current_date > '2026-12-08', 'feriado del 8/12: no se ofrece nada');

-- Servicio o profesional no reservables
select tests.ok(tests.slots(null, :'d', :HENNA) = '(nada)', 'un servicio "no visible en el sitio" no se puede reservar online');
:as_super
update public.professionals set accepts_online_booking = false where id = :CARO;
:as_anon
select tests.ok(tests.nslots(:CARO, :'d') = 0 and tests.nslots(null, :'d') = 8,
                'profesional que no acepta reservas online: no se ofrece ni entra en "cualquiera"');
:as_super
update public.professionals set accepts_online_booking = true where id = :CARO;
update public.tenant_settings set online_booking_enabled = false where tenant_id = :A;
:as_anon
select tests.ok(tests.nslots(null, :'d') = 0 and (select count(*) = 0 from public.get_service_options('fresas', :SEMI)),
                'reservas online apagadas: no hay horarios ni opciones');
select tests.ok((select (public.get_booking_context('fresas') ->> 'online_booking_enabled')::boolean = false
                        and (public.get_booking_context('fresas') ->> 'cancellation_window_hours')::int = 24),
                'contexto: indica que están apagadas y la ventana de 24 h');
select tests.ok(tests.nslots(:SOFI, :'d') = 0, 'reservas apagadas: tampoco por profesional');

:as_owner_b
select tests.ok((select count(*) = 0 from public.get_available_slots('estudio-prueba', :SEMI, :SOFI, :'d')),
                'otro estudio: no puede consultar servicios ni profesionales de Fresas');
:as_anon
select tests.throws(format($$select * from app.free_slots(%L, %L, null, now(), now() + interval '1 day')$$, :A, :SEMI),
                    'la función interna no se puede llamar desde la API', 'permission denied');

\ir lib/finish.sql
