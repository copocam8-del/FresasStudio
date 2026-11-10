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
       policy_text = 'La seña se descuenta del total. Cancelando o reprogramando con 48 h o más, la seña se conserva. Con menos de 48 h se pierde.'
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
