-- =====================================================================
-- Tests de los ajustes de negocio del Sprint 4 (migración 1600)
-- =====================================================================
\ir lib/setup.sql

:as_anon
select tests.ok((select cancellation_window_hours = 24 from public.get_public_studio('fresas')),
                'Fresas: la ventana de cancelación es de 24 h');

:as_super
select tests.ok((select cancellation_window_hours = 24 from public.tenant_policy_versions v
                 where v.tenant_id = :A order by version desc limit 1),
                'Fresas: el cambio a 24 h quedó como versión nueva de la política');
select tests.ok((select column_default = '24' from information_schema.columns
                 where table_schema = 'public' and table_name = 'tenant_settings' and column_name = 'cancellation_window_hours'),
                'valor por defecto de la ventana: 24 h');

:as_admin
select * from public.admin_create_studio('estudio-nuevo-24', 'Estudio Nuevo', 'duena@nuevo24.test') \gset nuevo_
select tests.ok((select cancellation_window_hours = 24 and deposit_percent = 50 and booking_hold_minutes = 120
                        and booking_min_notice_minutes = 720 and booking_horizon_days = 60 and slot_interval_minutes = 15
                        and not online_booking_enabled and not payments_connected
                 from public.tenant_settings where tenant_id = :'nuevo_tenant_id'),
                'estudio nuevo: 24 h, seña 50%, 2 h para pagar, 12 h de anticipación, 60 días, cada 15 min, reservas apagadas');

-- Seña mayor a 0% (B9)
:as_owner_a
select tests.throws(format('update public.tenant_settings set deposit_percent = 0 where tenant_id = %L', :A),
                    'seña 0% del estudio: rechazada', 'settings_deposit_range');
update public.tenant_settings set deposit_percent = 1 where tenant_id = :A;
select tests.ok((select deposit_percent = 1 from public.tenant_settings where tenant_id = :A), 'seña 1%: aceptada');
select tests.throws($$update public.services set deposit_percent = 0 where id = '31000000-0000-4000-a000-000000000004'$$,
                    'seña 0% de un servicio: rechazada', 'services_deposit');

-- Tiempo para pagar: 5 min a 24 h
select tests.throws(format('update public.tenant_settings set booking_hold_minutes = 4 where tenant_id = %L', :A),
                    'tiempo para pagar menor a 5 min: rechazado', 'settings_hold_range');
select tests.throws(format('update public.tenant_settings set booking_hold_minutes = 1441 where tenant_id = %L', :A),
                    'tiempo para pagar mayor a 24 h: rechazado', 'settings_hold_range');
update public.tenant_settings set booking_hold_minutes = 1440 where tenant_id = :A;
select tests.ok((select booking_hold_minutes = 1440 from public.tenant_settings where tenant_id = :A), 'tiempo para pagar de 24 h: aceptado');

-- Configuración de reservas
select tests.throws(format('update public.tenant_settings set slot_interval_minutes = 7 where tenant_id = %L', :A),
                    'intervalo de horarios inválido', 'settings_slot_interval');
select tests.throws(format('update public.tenant_settings set booking_horizon_days = 0 where tenant_id = %L', :A),
                    'horizonte de 0 días: rechazado', 'settings_horizon_range');

-- B10: sin pagos conectados no se prenden las reservas online, y nadie puede "conectar" por la API
:as_owner_b
select tests.throws(format('update public.tenant_settings set online_booking_enabled = true where tenant_id = %L', :B),
                    'sin pagos conectados no se pueden prender las reservas online', 'conectá Mercado Pago');
select tests.throws(format('update public.tenant_settings set payments_connected = true where tenant_id = %L', :B),
                    'nadie puede marcar "pagos conectados" por la API', 'permission denied');
:as_super
update public.tenant_settings set payments_connected = true where tenant_id = :B;
:as_owner_b
update public.tenant_settings set online_booking_enabled = true where tenant_id = :B;
select tests.ok((select online_booking_enabled from public.tenant_settings where tenant_id = :B),
                'con pagos conectados (servidor), la dueña prende las reservas online');
:as_super
update public.tenant_settings set payments_connected = false where tenant_id = :B;
select tests.ok((select not online_booking_enabled from public.tenant_settings where tenant_id = :B),
                'si se desconectan los pagos, las reservas online se apagan solas');

\ir lib/finish.sql
