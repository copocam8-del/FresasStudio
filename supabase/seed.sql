-- =====================================================================
-- SEED DE DESARROLLO (nunca en producción)
-- Dos estudios para probar aislamiento: Fresas Studio y Estudio Prueba.
-- Los emails usan el dominio reservado .test (no existen).
--
-- Las usuarias se crean listas para iniciar sesión con email y contraseña en
-- un proyecto Supabase de desarrollo (cleo-dev): contraseña, email confirmado
-- y su identidad "email". Contraseña de TODAS: CleoDev-2026
-- Es pública a propósito: este seed jamás se aplica en producción.
-- Es idempotente: se puede volver a aplicar sin duplicar filas.
-- =====================================================================

with seed_users (id, email) as (values
  ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@cleo.test'),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'duena@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000003'::uuid, 'encargada@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000004'::uuid, 'profesional@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000005'::uuid, 'duena@estudioprueba.test'),
  ('00000000-0000-4000-a000-000000000006'::uuid, 'nueva@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000007'::uuid, 'externa@otro.test')
)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       extensions.crypt('CleoDev-2026', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}', '{}',
       '', '', '', '',
       now(), now()
from seed_users
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now()
from auth.users u
where u.email like '%.test'
on conflict (provider_id, provider) do nothing;

insert into public.platform_admins (user_id) values ('00000000-0000-4000-a000-000000000001')
on conflict (user_id) do nothing;

insert into public.tenants (id, slug, name, status) values
  ('10000000-0000-4000-a000-000000000001', 'fresas',         'Fresas Studio',  'active'),
  ('10000000-0000-4000-a000-000000000002', 'estudio-prueba', 'Estudio Prueba', 'trial')
on conflict (id) do nothing;

update public.tenant_settings
   set description = 'Uñas, pestañas y cejas.',
       policy_text = 'La seña se descuenta del total. Cancelando o reprogramando con 24 h o más, la seña se conserva. Con menos de 24 h se pierde.'
 where tenant_id = '10000000-0000-4000-a000-000000000001';

insert into public.memberships (tenant_id, user_id, role_id)
select v.tenant_id::uuid, v.user_id::uuid, r.id
from (values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'owner'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', 'manager'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', 'professional'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000005', 'owner')
) as v (tenant_id, user_id, role_key)
join public.roles r on r.tenant_id is null and r.key = v.role_key
on conflict (tenant_id, user_id) do nothing;

-- =====================================================================
-- Catálogo, profesionales y horarios de Fresas Studio (Sprint 3, solo desarrollo)
-- =====================================================================
insert into public.service_categories (id, tenant_id, name, position) values
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'Uñas',     1),
  ('30000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'Pestañas', 2),
  ('30000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', 'Cejas',    3)
on conflict (id) do nothing;

insert into public.services (id, tenant_id, category_id, name, description, duration_minutes,
                             buffer_after_minutes, price_minor, price_is_from, deposit_percent, show_online, position)
values
  ('31000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001',
   'Esmaltado semipermanente', 'Limado, cutículas y esmaltado que dura hasta 3 semanas.', 60, 10, 1500000, false, null, true, 1),
  ('31000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001',
   'Kapping gel', 'Capa de gel sobre la uña natural para que crezca más fuerte.', 90, 10, 2200000, false, null, true, 2),
  ('31000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001',
   'Uñas esculpidas', 'El precio final depende del largo y del diseño.', 120, 15, 3000000, true, null, true, 3),
  ('31000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002',
   'Lifting de pestañas', 'Curvatura y tinte de tus pestañas naturales.', 60, 0, 2500000, false, 30, true, 1),
  ('31000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002',
   'Extensiones pelo a pelo', null, 120, 10, 4000000, false, null, true, 2),
  ('31000000-0000-4000-a000-000000000006', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000003',
   'Perfilado de cejas', null, 30, 0, 900000, false, null, true, 1),
  ('31000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000003',
   'Diseño con henna', 'Todavía no se ofrece online.', 45, 0, 1300000, false, null, false, 2)
on conflict (id) do nothing;

-- Sofi usa el panel (cuenta profesional@fresasstudio.test); Caro no usa la app.
insert into public.professionals (id, tenant_id, membership_id, display_name, bio, position)
select '32000000-0000-4000-a000-000000000001', m.tenant_id, m.id, 'Sofi', 'Especialista en uñas.', 1
from public.memberships m
where m.tenant_id = '10000000-0000-4000-a000-000000000001' and m.user_id = '00000000-0000-4000-a000-000000000004'
on conflict (id) do nothing;
insert into public.professionals (id, tenant_id, display_name, bio, position) values
  ('32000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'Caro', 'Pestañas, cejas y uñas.', 2)
on conflict (id) do nothing;

insert into public.professional_services (tenant_id, professional_id, service_id, price_minor_override, duration_minutes_override)
values
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000001', '31000000-0000-4000-a000-000000000001', null, null),
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000001', '31000000-0000-4000-a000-000000000002', null, null),
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000001', '31000000-0000-4000-a000-000000000003', null, null),
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000001', '31000000-0000-4000-a000-000000000006', null, null),
  -- Caro cobra el semipermanente más barato y tarda un poco más
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000002', '31000000-0000-4000-a000-000000000001', 1300000, 75),
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000002', '31000000-0000-4000-a000-000000000004', null, null),
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000002', '31000000-0000-4000-a000-000000000005', null, null),
  ('10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000002', '31000000-0000-4000-a000-000000000006', null, null)
on conflict (professional_id, service_id) do nothing;

-- Estudio: lunes a viernes 9–13 y 14–19; sábados 9–14. (Las superpuestas se ignoran.)
insert into public.working_hours (tenant_id, weekday, start_minute, end_minute)
select '10000000-0000-4000-a000-000000000001'::uuid, d, s, e
from generate_series(1, 5) d, (values (540, 780), (840, 1140)) v(s, e)
union all
select '10000000-0000-4000-a000-000000000001'::uuid, 6, 540, 840
on conflict do nothing;
-- Sofi: solo a la tarde, de lunes a viernes. Caro usa el horario del estudio.
insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute)
select '10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000001', d, 840, 1140
from generate_series(1, 5) d
on conflict do nothing;

-- Feriado del 8 de diciembre (todo el estudio) y vacaciones de Caro
insert into public.schedule_blocks (id, tenant_id, professional_id, kind, period, all_day, note) values
  ('34000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', null, 'holiday',
   '[2026-12-08 03:00Z, 2026-12-09 03:00Z)', true, 'Inmaculada Concepción'),
  ('34000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', '32000000-0000-4000-a000-000000000002', 'vacation',
   '[2026-12-21 03:00Z, 2026-12-25 03:00Z)', true, null)
on conflict (id) do nothing;

-- =====================================================================
-- Reservas online en desarrollo (Sprint 4). En producción "pagos conectados" lo
-- marca el servidor al conectar Mercado Pago (Sprint 5); acá se simula para poder
-- probar el flujo completo. Nunca en producción.
-- =====================================================================
update public.tenant_settings
   set payments_connected = true, online_booking_enabled = true
 where tenant_id = '10000000-0000-4000-a000-000000000001'
   and not (payments_connected and online_booking_enabled);

-- Fresas, SIN marca propia: se ve con la marca Cleo (regla de marca, CLAUDE.md 1b).
update public.tenant_settings
   set brand = brand - 'enabled'
 where tenant_id = '10000000-0000-4000-a000-000000000001' and brand ? 'enabled';

-- =====================================================================
-- SOLO DESARROLLO: simular que Mercado Pago avisó un pago APROBADO de la seña.
-- Vive únicamente en este seed, que nunca se aplica en producción: en producción
-- esta función NO EXISTE (un test controla que ninguna migración la cree).
-- Confirma por el mismo camino real (app.confirm_deposit_payment); lo único
-- simulado es la verificación con Mercado Pago. Solo la dueña de la reserva.
-- =====================================================================
create or replace function public.dev_simulate_deposit_payment(p_slug text, p_code text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.appointments%rowtype;
begin
  select a.* into v_row
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  join public.client_profiles c on c.id = a.client_profile_id
  where t.slug = lower(btrim(p_slug)) and a.code = upper(btrim(p_code)) and c.user_id = auth.uid();
  if v_row.id is null then
    raise exception 'No encontramos una reserva tuya con ese código' using errcode = 'P0002';
  end if;
  -- Lo que falta pagar: la seña menos el saldo a favor usado (Sprint 6).
  perform app.confirm_deposit_payment(v_row.id, 'SIMULADO-' || v_row.code, v_row.deposit_minor - v_row.credit_applied_minor);
end $$;
revoke execute on function public.dev_simulate_deposit_payment(text, text) from public, anon;
grant execute on function public.dev_simulate_deposit_payment(text, text) to authenticated;

-- SOLO DESARROLLO: después del e2e de Mercado Pago (que conecta y desconecta una cuenta
-- simulada), deja el estudio como lo deja este seed: "pagos conectados" sin cuenta real,
-- para que el pago simulado de los otros e2e siga funcionando. Solo payments.manage y
-- solo si no hay una cuenta de Mercado Pago activa. En producción NO existe.
create or replace function public.dev_restore_seed_payments(p_slug text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = lower(btrim(p_slug));
  if v_tenant is null or not app.can(v_tenant, 'payments.manage') then
    raise exception 'No tenés permiso' using errcode = '42501';
  end if;
  if exists (select 1 from public.payment_accounts where tenant_id = v_tenant and status <> 'disconnected') then
    return;
  end if;
  update public.tenant_settings set payments_connected = true, online_booking_enabled = true where tenant_id = v_tenant;
end $$;
revoke execute on function public.dev_restore_seed_payments(text) from public, anon;
grant execute on function public.dev_restore_seed_payments(text) to authenticated;

-- =====================================================================
-- Clientas de prueba para el e2e de reservas (10, para la carrera simultánea).
-- Mismo formato que las usuarias del principio: pueden iniciar sesión. Solo desarrollo.
-- =====================================================================
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
select ('00000000-0000-4000-b100-0000000000' || lpad(i::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'clienta' || lpad(i::text, 2, '0') || '@e2e.test',
       extensions.crypt('CleoDev-2026', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}', jsonb_build_object('full_name', 'Clienta E2E ' || i),
       '', '', '', '', now(), now()
from generate_series(1, 10) i
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now()
from auth.users u where u.email like '%@e2e.test'
on conflict (provider_id, provider) do nothing;
