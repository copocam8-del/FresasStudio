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

-- Mercado Pago de Fresas conectado (cuenta 777), para pagar señas "verificadas".
insert into public.payment_accounts (id, tenant_id, mp_user_id, site_id, live_mode, token_expires_at)
values ('40000000-0000-4000-a000-00000000006a', :A, 777, 'MLA', false, now() + interval '180 days');
\set ACC '''40000000-0000-4000-a000-00000000006a'''

-- Link de pago por lo que falta pagar de la seña (como start_deposit_checkout)
create function tests.intent6(p_appt uuid) returns uuid language sql as $$
  insert into public.payment_intents (tenant_id, appointment_id, account_id, amount_minor, currency, expires_at)
  select tenant_id, id, '40000000-0000-4000-a000-00000000006a', deposit_minor - credit_applied_minor, currency,
         coalesce(hold_expires_at, now())
  from public.appointments where id = p_appt
  returning id
$$;

-- Pago aprobado verificado (lo que manda el servidor después de consultar la API)
create function tests.mp6(p_id text, p_ref uuid, p_amount bigint default 750000, p_status text default 'approved',
                          p_refunded bigint default 0)
returns jsonb language sql as $$
  select jsonb_build_object('provider_payment_id', p_id, 'status', p_status, 'status_detail', 'accredited',
    'amount_minor', p_amount, 'refunded_minor', p_refunded, 'currency', 'ARS', 'external_reference', p_ref::text,
    'collector_id', 777, 'live_mode', false, 'approved_at', now(),
    'payment_method', 'visa', 'payment_type', 'credit_card', 'installments', 1, 'fee_minor', 30000, 'net_minor', 720000)
$$;
grant execute on function tests.mp6(text, uuid, bigint, text, bigint) to service_role;

-- Saldo disponible de una clienta (atajo para los tests)
create function tests.credit(p_client uuid) returns bigint language sql as $$
  select app.credit_available('10000000-0000-4000-a000-000000000001', p_client)
$$;
