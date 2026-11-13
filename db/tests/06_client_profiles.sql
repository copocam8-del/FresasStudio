-- =====================================================================
-- Tests de fichas de clientas (Sprint 2 · migración 1000)
-- =====================================================================
\ir lib/setup.sql

:as_super
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-c000-000000000001', 'clienta1@gmail.test', now(), '{"full_name": "Ana Pérez"}'),
  ('00000000-0000-4000-c000-000000000002', 'clienta2@gmail.test', now(), '{"name": "Bea"}'),
  ('00000000-0000-4000-c000-000000000003', 'clienta3@gmail.test', now(), '{"full_name": "Carla Google"}'),
  ('00000000-0000-4000-c000-000000000004', 'cx@gmail.test',       now(), '{}');
\set as_c1 'reset role; do $x$ begin perform tests.login(''clienta1@gmail.test''); end $x$; set local role authenticated;'
\set as_c2 'reset role; do $x$ begin perform tests.login(''clienta2@gmail.test''); end $x$; set local role authenticated;'
\set as_c3 'reset role; do $x$ begin perform tests.login(''clienta3@gmail.test''); end $x$; set local role authenticated;'
\set as_cx 'reset role; do $x$ begin perform tests.login(''cx@gmail.test''); end $x$; set local role authenticated;'

-- ---------------------------------------------------------------------
-- Alta por login (idempotente, una ficha por estudio)
-- ---------------------------------------------------------------------
:as_c1
select public.ensure_client_profile('fresas');
select public.ensure_client_profile('fresas');
select public.ensure_client_profile(' Estudio-Prueba ');
select tests.ok((select count(*) = 2 from public.client_profiles),
                'clienta: una ficha por estudio, sin duplicar al volver a entrar');
select tests.ok((select full_name = 'Ana Pérez' and email = 'clienta1@gmail.test' and phone is null
                 from public.my_client_profile('fresas')),
                'clienta: su ficha toma nombre y email de la cuenta de Google');
select tests.ok(not exists (
                  select 1 from information_schema.parameters p
                  join information_schema.routines r on r.specific_name = p.specific_name
                  where r.routine_name = 'my_client_profile' and p.parameter_mode = 'OUT'
                    and (p.parameter_name = 'id' or p.parameter_name like '%\_id')),
                'my_client_profile no devuelve ids internos');
select tests.throws($$select public.ensure_client_profile('no-existe')$$,
                    'clienta: estudio inexistente', 'no está disponible');

:as_c2
select public.ensure_client_profile('fresas');
select tests.ok((select count(*) = 1 from public.client_profiles), 'clienta 2: ve solo su ficha (no la de clienta 1)');
select tests.ok((select full_name = 'Bea' from public.my_client_profile('fresas')), 'clienta 2: usa "name" si no hay full_name');

:as_cx
select public.ensure_client_profile('fresas');
select tests.ok((select full_name = 'cx' from public.my_client_profile('fresas')),
                'sin nombre en Google: usa la parte del email antes de la @');

-- ---------------------------------------------------------------------
-- La clienta edita solo lo suyo y solo por la RPC
-- ---------------------------------------------------------------------
:as_c1
select public.update_my_client_profile('fresas', '  Ana María Pérez ', '+54 11 5555-1234');
select tests.ok((select full_name = 'Ana María Pérez' and phone = '+54 11 5555-1234' from public.my_client_profile('fresas')),
                'clienta: actualiza su nombre y teléfono');
select tests.ok((select full_name = 'Ana Pérez' from public.my_client_profile('estudio-prueba')),
                'clienta: la ficha del otro estudio no cambia');
select tests.throws($$select public.update_my_client_profile('fresas', 'A', null)$$, 'clienta: nombre muy corto', 'Ingresá tu nombre');
select tests.throws($$select public.update_my_client_profile('fresas', 'Ana', 'llamame')$$, 'clienta: teléfono inválido', 'teléfono');
select tests.ok((select tests.affected($$update public.client_profiles set full_name = 'Hackeada'$$)) = 0,
                'clienta: no puede editar fichas directo (ni la suya)');
select tests.throws($$insert into public.client_profiles (tenant_id, full_name) values ('10000000-0000-4000-a000-000000000001', 'Falsa')$$,
                    'clienta: no puede crear fichas directo', 'row-level security');

-- ---------------------------------------------------------------------
-- Equipo: cada estudio ve solo sus fichas
-- ---------------------------------------------------------------------
:as_owner_a
select tests.ok((select count(*) = 3 from public.client_profiles), 'dueña A: ve las 3 fichas de Fresas');
select tests.ok((select count(*) = 0 from public.client_profiles where tenant_id = :B), 'dueña A: no ve fichas de B');
:as_pro_a
-- Sprint 6 (C19): la profesional ve solo las clientas con turnos con ella (acá, ninguna).
select tests.ok((select count(*) = 0 from public.client_profiles), 'profesional A (clients.read_own): no ve fichas de clientas que no atendió');
select tests.ok((select tests.affected($$update public.client_profiles set phone = '1234567'$$)) = 0,
                'profesional A (sin clients.manage): no puede editarlas');
:as_owner_b
select tests.ok((select count(*) = 1 from public.client_profiles), 'dueña B: ve solo la ficha de su estudio');
:as_admin
select tests.ok((select count(*) = 0 from public.client_profiles), 'Cleo Admin: no ve fichas de clientas');
:as_anon
select tests.throws('select * from public.client_profiles', 'anon: no puede leer fichas', 'permission denied');
select tests.throws($$select * from public.my_client_profile('fresas')$$, 'anon: no puede usar my_client_profile', 'permission denied');

:as_manager_a
insert into public.client_profiles (tenant_id, full_name, email, phone)
values (:A, 'Carla (cargada por el estudio)', '  CLIENTA3@gmail.test ', '1155554444');
select tests.ok((select source = 'staff' and user_id is null and email = 'clienta3@gmail.test'
                 from public.client_profiles where full_name like 'Carla%'),
                'encargada A: carga una ficha (email normalizado, sin usuaria, origen staff)');
select tests.throws(format($$insert into public.client_profiles (tenant_id, full_name) values (%L, 'En B')$$, :B),
                    'encargada A: no puede cargar fichas en B', 'row-level security');
select tests.throws(format($$insert into public.client_profiles (tenant_id, full_name, user_id) values (%L, 'X', %L)$$,
                           :A, '00000000-0000-4000-c000-000000000002'),
                    'encargada A: no puede vincular una ficha a una cuenta', 'permission denied');
select tests.throws($$update public.client_profiles set tenant_id = '10000000-0000-4000-a000-000000000002'$$,
                    'encargada A: no puede mover fichas de estudio', 'permission denied');
select tests.throws($$insert into public.client_profiles (tenant_id, full_name, email) values ('10000000-0000-4000-a000-000000000001', 'Dup', 'clienta1@gmail.test')$$,
                    'encargada A: no puede duplicar un email en el mismo estudio', 'duplicate');

-- ---------------------------------------------------------------------
-- D7: vinculación por email exacto con una ficha sin usuaria
-- ---------------------------------------------------------------------
:as_c3
select public.ensure_client_profile('fresas');
select tests.ok((select count(*) = 1 from public.client_profiles where tenant_id = :A),
                'D7: la clienta queda con UNA ficha en Fresas (la del estudio)');
select tests.ok((select full_name = 'Carla (cargada por el estudio)' and phone = '1155554444'
                 from public.my_client_profile('fresas')),
                'D7: se vinculó la ficha que había cargado el estudio (conserva sus datos)');
:as_super
select tests.ok((select source = 'staff' from public.client_profiles where user_id = '00000000-0000-4000-c000-000000000003'),
                'D7: la ficha vinculada conserva el origen "staff"');

:as_manager_a
insert into public.client_profiles (tenant_id, full_name, email) values (:A, 'Otra persona', 'otra@gmail.test');
:as_c2
select public.ensure_client_profile('fresas');
:as_super
select tests.ok((select user_id is null from public.client_profiles where email = 'otra@gmail.test'),
                'D7: una ficha con otro email no se vincula');

-- ---------------------------------------------------------------------
-- Ficha archivada por el estudio: la clienta no queda trabada
-- ---------------------------------------------------------------------
:as_manager_a
update public.client_profiles set status = 'archived' where email = 'clienta2@gmail.test';
:as_c2
select public.ensure_client_profile('fresas');
select tests.ok((select count(*) = 1 from public.my_client_profile('fresas')),
                'archivada: la clienta sigue viendo su ficha y no se duplica');
select public.update_my_client_profile('fresas', 'Bea Archivada', null);
select tests.ok((select full_name = 'Bea Archivada' from public.my_client_profile('fresas')),
                'archivada: la clienta puede seguir editando sus datos');

-- ---------------------------------------------------------------------
-- Estudio suspendido y auditoría sin datos personales
-- ---------------------------------------------------------------------
:as_admin
select public.admin_set_tenant_status(:B, 'suspended');
:as_c2
select tests.throws($$select public.ensure_client_profile('estudio-prueba')$$,
                    'estudio suspendido: no se crea la ficha', 'no está disponible');
:as_c1
select tests.throws($$select public.update_my_client_profile('estudio-prueba', 'Ana', null)$$,
                    'estudio suspendido: la clienta no puede editar', 'no está disponible');
select tests.ok((select count(*) = 1 from public.my_client_profile('estudio-prueba')),
                'estudio suspendido: la clienta todavía puede ver su ficha');
:as_admin
select public.admin_set_tenant_status(:B, 'active');

:as_super
select tests.ok((select count(*) >= 6 from public.audit_logs where entity_type = 'client_profiles'),
                'auditoría: altas y cambios de fichas quedan registrados');
select tests.ok(not exists (select 1 from public.audit_logs where entity_type = 'client_profiles'
                            and (coalesce(new_data::text, '') || coalesce(old_data::text, '')) ~* '(gmail|Pérez|5555|Carla|Bea)'),
                'auditoría: no guarda nombres, emails ni teléfonos de clientas');
select tests.ok((select new_data -> 'changed_fields' ? 'phone' from public.audit_logs
                 where entity_type = 'client_profiles' and action = 'update'
                 order by id limit 1),
                'auditoría: registra qué campos cambiaron');

\ir lib/finish.sql
