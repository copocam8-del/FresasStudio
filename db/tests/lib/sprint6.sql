-- =====================================================================
-- Datos comunes de los tests del Sprint 6 (cancelaciones, saldo, agenda, fichas).
-- Uso: \ir lib/setup.sql y después \ir lib/sprint6.sql
--
-- Crea dos clientas de Fresas (cli1, cli2) y una de Estudio Prueba (clib), y el
-- helper tests.appt6 que inserta una reserva coherente como superusuario.
-- =====================================================================
\set SOFI '''32000000-0000-4000-a000-000000000001'''
\set CARO '''32000000-0000-4000-a000-000000000002'''
\set SEMI '''31000000-0000-4000-a000-000000000001'''

:as_super
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-d000-000000000061', 'cli1@s6.test', now(), '{"full_name": "Clienta Uno"}'),
  ('00000000-0000-4000-d000-000000000062', 'cli2@s6.test', now(), '{"full_name": "Clienta Dos"}'),
  ('00000000-0000-4000-d000-000000000063', 'clib@s6.test', now(), '{"full_name": "Clienta Be"}');
\set as_cli1 'reset role; do $x$ begin perform tests.login(''cli1@s6.test''); end $x$; set local role authenticated;'
\set as_cli2 'reset role; do $x$ begin perform tests.login(''cli2@s6.test''); end $x$; set local role authenticated;'
\set as_clib 'reset role; do $x$ begin perform tests.login(''clib@s6.test''); end $x$; set local role authenticated;'
:as_cli1
select public.ensure_client_profile('fresas');
:as_cli2
select public.ensure_client_profile('fresas');
:as_clib
select public.ensure_client_profile('estudio-prueba');
:as_super
select id as cp1 from public.client_profiles where user_id = '00000000-0000-4000-d000-000000000061' \gset
select id as cp2 from public.client_profiles where user_id = '00000000-0000-4000-d000-000000000062' \gset
select id as cpb from public.client_profiles where user_id = '00000000-0000-4000-d000-000000000063' \gset
update public.client_profiles set phone = '+54 11 5555-0001' where id in (:'cp1', :'cp2', :'cpb');

-- Reserva coherente de Fresas (Semipermanente con Sofi por defecto).
--   p_window: ventana de cancelación guardada en la reserva (la política aceptada).
--   Las confirmadas quedan con la seña pagada en el estudio (paid_offline).
create function tests.appt6(
  p_client uuid, p_start timestamptz,
  p_status public.appointment_status default 'confirmed',
  p_window int default 24, p_pro uuid default '32000000-0000-4000-a000-000000000001',
  p_minutes int default 60, p_price bigint default 1500000, p_pct int default 50
) returns uuid language plpgsql as $$
declare v_id uuid; v_pv int;
begin
  select policy_version into v_pv from public.tenant_settings where tenant_id = '10000000-0000-4000-a000-000000000001';
  insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at,
    occupied_until, service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from,
    currency, deposit_percent, deposit_minor, policy_version, cancellation_window_hours, status, deposit_status,
    hold_expires_at, source)
  values ('10000000-0000-4000-a000-000000000001', app.generate_booking_code(), p_client, p_pro,
    '31000000-0000-4000-a000-000000000001', p_start, p_start + make_interval(mins => p_minutes),
    p_start + make_interval(mins => p_minutes), 'Esmaltado semipermanente', 'Sofi', p_minutes, 0,
    p_price, false, 'ARS', p_pct, (ceil(p_price * p_pct / 10000.0) * 100)::bigint, v_pv, p_window, p_status,
    case when p_status = 'pending_payment' then 'pending'::public.deposit_status else 'paid_offline'::public.deposit_status end,
    case when p_status = 'pending_payment' then least(now() + interval '2 hours', p_start) end, 'staff')
  returning id into v_id;
  return v_id;
end $$;
