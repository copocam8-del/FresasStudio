-- =====================================================================
-- SEED DE DESARROLLO (nunca en producción)
-- Dos estudios para probar aislamiento: Fresas Studio y Estudio Prueba.
-- Los emails usan el dominio reservado .test
-- =====================================================================

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'admin@fresas.test'),
  ('00000000-0000-4000-a000-000000000002', 'duena@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000003', 'encargada@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000004', 'profesional@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000005', 'duena@estudioprueba.test'),
  ('00000000-0000-4000-a000-000000000006', 'nueva@fresasstudio.test'),
  ('00000000-0000-4000-a000-000000000007', 'externa@otro.test');

insert into public.platform_admins (user_id) values ('00000000-0000-4000-a000-000000000001');

insert into public.tenants (id, slug, name, status) values
  ('10000000-0000-4000-a000-000000000001', 'fresas-studio',  'Fresas Studio',  'active'),
  ('10000000-0000-4000-a000-000000000002', 'estudio-prueba', 'Estudio Prueba', 'trial');

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
join public.roles r on r.tenant_id is null and r.key = v.role_key;
