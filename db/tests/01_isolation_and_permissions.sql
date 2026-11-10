-- =====================================================================
-- Tests de aislamiento multi-tenant y permisos (Sprint 1)
-- Se ejecutan dentro de UNA transacción que al final se descarta.
-- Cada usuaria se simula igual que en Supabase: rol "authenticated"
-- + request.jwt.claims con su id.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
\o /dev/null

begin;

-- ---------------------------------------------------------------------
-- Mini framework de tests
-- ---------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create table tests.results (n serial primary key, ok boolean not null, name text not null);
grant select, insert on tests.results to anon, authenticated;
grant usage on sequence tests.results_n_seq to anon, authenticated;

create function tests.login(p_email text) returns void
language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_email is null then
    perform set_config('request.jwt.claims', '', true);
    return;
  end if;
  select id into v_id from auth.users where email = p_email;
  if v_id is null then raise exception 'Usuario de test inexistente: %', p_email; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'email', p_email, 'role', 'authenticated')::text, true);
end $$;
grant execute on function tests.login(text) to anon, authenticated;

create function tests.ok(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  insert into tests.results (ok, name) values (coalesce(p_cond, false), p_name);
  raise notice '%  %', case when coalesce(p_cond, false) then 'ok  ' else 'FAIL' end, p_name;
end $$;

-- Ejecuta SQL y espera un error (opcionalmente con un texto en el mensaje)
create function tests.throws(p_sql text, p_name text, p_like text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform tests.ok(p_like is null or sqlerrm ilike '%' || p_like || '%',
                     p_name || case when p_like is not null and sqlerrm not ilike '%' || p_like || '%'
                                    then ' [error inesperado: ' || sqlerrm || ']' else '' end);
    return;
  end;
  perform tests.ok(false, p_name || ' [no dio error]');
end $$;

-- Ejecuta SQL y devuelve cuántas filas afectó
create function tests.affected(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Atajos de sesión
\set as_super     'reset role;'
\set as_anon      'reset role; do $x$ begin perform tests.login(null); end $x$; set local role anon;'
\set as_admin     'reset role; do $x$ begin perform tests.login(''admin@fresas.test''); end $x$; set local role authenticated;'
\set as_owner_a   'reset role; do $x$ begin perform tests.login(''duena@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_manager_a 'reset role; do $x$ begin perform tests.login(''encargada@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_pro_a     'reset role; do $x$ begin perform tests.login(''profesional@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_owner_b   'reset role; do $x$ begin perform tests.login(''duena@estudioprueba.test''); end $x$; set local role authenticated;'
\set as_nueva     'reset role; do $x$ begin perform tests.login(''nueva@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_externa   'reset role; do $x$ begin perform tests.login(''externa@otro.test''); end $x$; set local role authenticated;'

\set A '''10000000-0000-4000-a000-000000000001'''
\set B '''10000000-0000-4000-a000-000000000002'''

:as_super
select id as role_receptionist from public.roles where tenant_id is null and key = 'receptionist' \gset
select id as role_owner        from public.roles where tenant_id is null and key = 'owner' \gset
select id as uid_owner_a from auth.users where email = 'duena@fresasstudio.test' \gset
select id as uid_pro_a   from auth.users where email = 'profesional@fresasstudio.test' \gset
select id as uid_owner_b from auth.users where email = 'duena@estudioprueba.test' \gset

-- =====================================================================
-- 1. Visitante sin sesión (página pública)
-- =====================================================================
:as_anon
select tests.throws('select * from public.tenants', 'anon: no puede leer la tabla de estudios', 'permission denied');
select tests.throws('select * from public.memberships', 'anon: no puede leer membresías', 'permission denied');
select tests.ok((select count(*) = 1 from public.get_public_studio('fresas-studio')), 'anon: ve la página pública de Fresas Studio');
select tests.ok((select deposit_percent = 50 and cancellation_window_hours = 48 from public.get_public_studio('Fresas-Studio ')),
                'anon: la página pública muestra seña 50% y 48 h (y normaliza la URL)');
select tests.ok((select count(*) = 0 from public.get_public_studio('no-existe')), 'anon: URL inexistente no devuelve nada');
select tests.throws($$select public.accept_invitation('x')$$, 'anon: no puede aceptar invitaciones', 'permission denied');

-- =====================================================================
-- 2. Dueña del estudio B prepara un rol propio (se usa en tests de A)
-- =====================================================================
:as_owner_b
insert into public.roles (tenant_id, key, name) values (:B, 'recepcion_b', 'Recepción B') returning id as role_b \gset
select tests.ok(:'role_b' is not null, 'dueña B: puede crear un rol propio en su estudio');

-- =====================================================================
-- 3. Dueña del estudio A: no ve ni toca nada de B
-- =====================================================================
:as_owner_a
select tests.ok((select count(*) = 1 from public.tenants), 'dueña A: ve exactamente 1 estudio');
select tests.ok((select bool_and(id = :A) from public.tenants), 'dueña A: ese estudio es el suyo');
select tests.ok((select count(*) = 1 from public.tenant_settings), 'dueña A: ve solo su configuración');
select tests.ok((select count(*) = 0 from public.memberships where tenant_id = :B), 'dueña A: no ve el equipo de B');
select tests.ok((select count(*) = 0 from public.audit_logs where tenant_id = :B), 'dueña A: no ve la auditoría de B');
select tests.ok((select count(*) = 0 from public.roles where id = :'role_b'), 'dueña A: no ve los roles propios de B');
select tests.ok((select count(*) = 0 from public.profiles where id = :'uid_owner_b'), 'dueña A: no ve el perfil de la dueña de B');
select tests.ok(tests.affected(format('update public.tenant_settings set deposit_percent = 10 where tenant_id = %L', :B)) = 0,
                'dueña A: no puede modificar la configuración de B');
select tests.ok(tests.affected(format('update public.tenants set name = %L where id = %L', 'Hackeado', :B)) = 0,
                'dueña A: no puede renombrar el estudio B');
select tests.ok(tests.affected(format('update public.memberships set status = %L where tenant_id = %L', 'revoked', :B)) = 0,
                'dueña A: no puede dar de baja al equipo de B');
select tests.throws(format('select public.create_invitation(%L, %L, %L)', :B, 'intrusa@x.test', :'role_receptionist'),
                    'dueña A: no puede invitar gente al estudio B', 'No tenés permiso');
select tests.throws(format('select public.create_invitation(%L, %L, %L)', :A, 'alguien@x.test', :'role_b'),
                    'dueña A: no puede usar en A un rol propio de B', 'no pertenece');
-- Lo frena el trigger o la RLS (lo que corra primero); importa que falle
select tests.throws(format('insert into public.role_permissions values (%L, %L)', :'role_b', 'agenda.manage'),
                    'dueña A: no puede agregar permisos a un rol de B', null);
select tests.ok((select count(*) = 0 from public.role_permissions where role_id = :'role_b'),
                'dueña A: no ve los permisos de un rol de B');
select tests.throws(format('update public.tenants set status = %L where id = %L', 'active', :A),
                    'dueña A: no puede cambiar el estado comercial de su estudio', 'permission denied');
select tests.throws($$insert into public.tenants (slug, name) values ('otro-estudio', 'Otro')$$,
                    'dueña A: no puede crear estudios', 'permission denied');
select tests.throws($$select * from public.admin_create_studio('otro-estudio', 'Otro', 'x@x.test')$$,
                    'dueña A: no puede usar la función de Fresas Admin', 'Solo Fresas Admin');
select tests.throws(format('select public.admin_set_tenant_status(%L, %L)', :B, 'suspended'),
                    'dueña A: no puede suspender otro estudio', 'Solo Fresas Admin');
select tests.ok((select count(*) = 3 from public.profiles), 'dueña A: ve los perfiles de su equipo (3)');
select tests.ok((select count(*) = 1 and bool_and(role_key = 'owner') from public.my_studios()), 'dueña A: my_studios() devuelve su estudio con rol dueña');

-- Políticas versionadas
select policy_version as v_before from public.tenant_settings where tenant_id = :A \gset
select tests.ok(tests.affected(format('update public.tenant_settings set deposit_percent = 40 where tenant_id = %L', :A)) = 1,
                'dueña A: puede cambiar el % de seña de su estudio');
select tests.ok((select policy_version = :v_before + 1 from public.tenant_settings where tenant_id = :A),
                'al cambiar la seña, la política sube una versión');
select tests.ok((select count(*) = :v_before + 1 and max(version) = :v_before + 1 and min(version) = 1
                 from public.tenant_policy_versions where tenant_id = :A),
                'quedan guardadas todas las versiones anteriores');
select tests.ok((select deposit_percent = 50 from public.tenant_policy_versions where tenant_id = :A and version = :v_before),
                'la versión anterior conserva la seña de 50% (las reservas viejas no cambian)');
select tests.ok(tests.affected(format('update public.tenant_settings set description = %L where tenant_id = %L', 'Nuevo texto', :A)) = 1
                and (select policy_version = :v_before + 1 from public.tenant_settings where tenant_id = :A),
                'cambiar solo la descripción NO crea versión de política');
select tests.throws(format('update public.tenant_settings set policy_version = 99 where tenant_id = %L', :A),
                    'dueña A: no puede manipular el número de versión', 'permission denied');
select tests.ok((select count(*) >= 2 and bool_and(actor_user_id = :'uid_owner_a') from public.audit_logs
                 where tenant_id = :A and entity_type = 'tenant_settings' and action = 'update'),
                'auditoría: los cambios de configuración quedan registrados con su autora');
select tests.throws('delete from public.audit_logs', 'dueña A: no puede borrar la auditoría', 'permission denied');

-- =====================================================================
-- 4. Encargada del estudio A: gestiona el equipo pero sin escalar
-- =====================================================================
:as_manager_a
select tests.ok((select count(*) = 3 from public.memberships), 'encargada A: ve el equipo completo de su estudio');
select tests.throws(format('select public.create_invitation(%L, %L, %L)', :A, 'otra@x.test', :'role_owner'),
                    'encargada A: no puede invitar a alguien como dueña', 'más permisos');
select tests.throws(format('update public.memberships set role_id = %L where user_id = %L', :'role_receptionist', :'uid_owner_a'),
                    'encargada A: no puede bajar de rol a la dueña', 'más permisos que vos');
select tests.throws(format('update public.memberships set role_id = %L where user_id = auth.uid()', :'role_owner'),
                    'encargada A: no puede auto-ascenderse a dueña', 'propio acceso');
insert into public.roles (tenant_id, key, name) values (:A, 'recepcion_plus', 'Recepción plus') returning id as role_plus \gset
select tests.ok(tests.affected(format('insert into public.role_permissions values (%L, %L)', :'role_plus', 'agenda.manage')) = 1,
                'encargada A: puede armar un rol propio con permisos que ella tiene');
select tests.throws(format('insert into public.role_permissions values (%L, %L)', :'role_plus', 'payments.manage'),
                    'encargada A: no puede dar permisos que no tiene (Mercado Pago)', 'no tenés');
select tests.ok(tests.affected(format('update public.roles set name = %L where tenant_id is null and key = %L', 'Jefa', 'owner')) = 0,
                'encargada A: los roles de sistema no se pueden editar');
select tests.ok(tests.affected($$delete from public.role_permissions rp using public.roles r
                                 where r.id = rp.role_id and r.tenant_id is null$$) = 0,
                'encargada A: no puede quitar permisos a los roles de sistema');
select public.create_invitation(:A, '  Nueva@FresasStudio.test ', :'role_receptionist') as tok_nueva \gset
select tests.ok(length(:'tok_nueva') = 64, 'encargada A: puede invitar a una recepcionista (token de 64 caracteres)');
select tests.ok((select count(*) = 1 from public.invitations where email = 'nueva@fresasstudio.test' and accepted_at is null),
                'la invitación queda pendiente y con el email normalizado');
select tests.ok((select count(*) = 0 from public.invitations where encode(token_hash, 'hex') = :'tok_nueva'),
                'el token NO se guarda en claro en la base');

-- =====================================================================
-- 5. Profesional del estudio A: acceso mínimo
-- =====================================================================
:as_pro_a
select tests.ok((select count(*) = 1 from public.tenants), 'profesional A: ve su estudio');
select tests.ok((select count(*) = 1 from public.memberships), 'profesional A: ve solo su propia membresía');
select tests.ok((select count(*) = 1 from public.profiles), 'profesional A: ve solo su propio perfil');
select tests.ok((select count(*) = 0 from public.audit_logs), 'profesional A: no ve la auditoría');
select tests.ok((select count(*) = 0 from public.invitations), 'profesional A: no ve invitaciones');
select tests.ok(tests.affected(format('update public.tenant_settings set deposit_percent = 0 where tenant_id = %L', :A)) = 0,
                'profesional A: no puede cambiar la configuración');
select tests.throws(format('select public.create_invitation(%L, %L, %L)', :A, 'amiga@x.test', :'role_receptionist'),
                    'profesional A: no puede invitar', 'No tenés permiso');
select tests.ok(tests.affected($$update public.profiles set full_name = 'Profe A' where id = auth.uid()$$) = 1,
                'profesional A: puede editar su propio perfil');
select tests.ok(tests.affected(format('update public.profiles set full_name = %L where id = %L', 'X', :'uid_owner_a')) = 0,
                'profesional A: no puede editar el perfil de otra persona');

-- =====================================================================
-- 6. Invitaciones
-- =====================================================================
:as_externa
select tests.throws(format('select public.accept_invitation(%L)', :'tok_nueva'),
                    'invitación: otra persona no puede usar el link ajeno', 'otra dirección');
select tests.ok((select count(*) = 0 from public.tenants), 'invitación: tras el intento fallido, la externa sigue sin acceso');

:as_nueva
select tests.ok(public.accept_invitation(:'tok_nueva') = :A, 'invitación: la destinataria la acepta');
select tests.ok((select count(*) = 1 and bool_and(role_key = 'receptionist') from public.my_studios()),
                'invitación: queda en el estudio A con rol recepción');
select tests.ok((select count(*) = 0 from public.tenants where id = :B), 'invitación: no obtiene acceso a B');
select tests.throws(format('select public.accept_invitation(%L)', :'tok_nueva'), 'invitación: no se puede reutilizar', 'ya fue usada');
select tests.throws($$select public.accept_invitation('token-inventado')$$, 'invitación: un token inventado no sirve', 'no es válida');

:as_super
select app.issue_invitation(:A, 'externa@otro.test', :'role_receptionist', interval '1 day') as tok_exp \gset
update public.invitations set expires_at = now() - interval '1 minute'
 where email = 'externa@otro.test' and accepted_at is null and revoked_at is null;
:as_externa
select tests.throws(format('select public.accept_invitation(%L)', :'tok_exp'), 'invitación: una vencida no se puede aceptar', 'vencida');

-- =====================================================================
-- 7. Bajas y dueña obligatoria
-- =====================================================================
:as_owner_a
select tests.ok(tests.affected(format('update public.memberships set status = %L where user_id = %L', 'revoked', :'uid_pro_a')) = 1,
                'dueña A: puede dar de baja a una profesional');
select tests.throws(format('update public.memberships set status = %L where user_id = auth.uid()', 'revoked'),
                    'dueña A: no puede darse de baja a sí misma', 'propio acceso');
:as_pro_a
select tests.ok((select count(*) = 0 from public.tenants), 'profesional dada de baja: pierde el acceso al instante');
select tests.ok((select count(*) = 0 from public.my_studios()), 'profesional dada de baja: my_studios() vacío');
:as_admin
select tests.throws(format('update public.memberships set status = %L where user_id = %L', 'revoked', :'uid_owner_a'),
                    'ni Fresas Admin puede dejar un estudio sin dueña', 'al menos una dueña');

-- =====================================================================
-- 8. Fresas Admin
-- =====================================================================
:as_admin
select tests.ok((select count(*) = 2 from public.tenants), 'Fresas Admin: ve todos los estudios');
select * from public.admin_create_studio('nuevo-estudio', 'Nuevo Estudio', 'Duena@Nuevo.test') \gset new_
select tests.ok(:'new_tenant_id' is not null and length(:'new_owner_invitation_token') = 64,
                'Fresas Admin: crea un estudio y recibe el link de invitación de la dueña');
select tests.ok((select deposit_percent = 50 and cancellation_window_hours = 48 and policy_version = 1
                 from public.tenant_settings where tenant_id = :'new_tenant_id'),
                'estudio nuevo: nace con seña 50% y regla de 48 h');
select tests.ok((select count(*) = 1 from public.invitations i join public.roles r on r.id = i.role_id
                 where i.tenant_id = :'new_tenant_id' and i.email = 'duena@nuevo.test' and r.key = 'owner'),
                'estudio nuevo: la invitación de la dueña tiene rol dueña');
select tests.throws($$select * from public.admin_create_studio('admin', 'X', 'x@x.test')$$, 'URL reservada rechazada', 'reservada');
select tests.throws($$select * from public.admin_create_studio('Mi Estudio', 'X', 'x@x.test')$$, 'URL con espacios/mayúsculas rechazada', null);
select tests.throws($$select * from public.admin_create_studio('ok-estudio', 'X', 'x@x.test', 'Marte/Olympus')$$, 'zona horaria inválida rechazada', 'Zona horaria');
select tests.throws($$select * from public.admin_create_studio('fresas-studio', 'Copia', 'x@x.test')$$, 'URL duplicada rechazada', 'duplicate');
select tests.throws($$select * from public.admin_create_studio('otro-ok', 'Otro', 'no-es-un-email')$$, 'email inválido rechazado', 'email');
select public.admin_set_tenant_status(:B, 'suspended');
select tests.ok((select status = 'suspended' and suspended_at is not null from public.tenants where id = :B),
                'Fresas Admin: suspende el estudio B y queda registrada la fecha');

:as_owner_b
select tests.ok((select count(*) = 1 from public.tenant_settings), 'estudio suspendido: la dueña todavía puede consultar sus datos');
select tests.ok(tests.affected(format('update public.tenant_settings set deposit_percent = 30 where tenant_id = %L', :B)) = 0,
                'estudio suspendido: no se puede modificar nada');
select tests.throws(format('insert into public.roles (tenant_id, key, name) values (%L, %L, %L)', :B, 'otro_rol', 'Otro'),
                    'estudio suspendido: no se pueden crear roles', 'row-level security');
:as_anon
select tests.ok((select count(*) = 0 from public.get_public_studio('estudio-prueba')), 'estudio suspendido: su página pública no se muestra');

-- =====================================================================
-- 9. Auditoría inmutable (incluso para el superusuario)
-- =====================================================================
:as_super
select tests.throws($$update public.audit_logs set action = 'borrado'$$, 'auditoría: nadie puede editarla', 'solo agregado');
select tests.throws($$delete from public.audit_logs$$, 'auditoría: nadie puede borrarla', 'solo agregado');
select tests.throws($$delete from public.tenant_policy_versions$$, 'historial de políticas: nadie puede borrarlo', 'solo agregado');
select tests.ok((select count(*) >= 1 from public.audit_logs where action = 'studio.created' and tenant_id = :'new_tenant_id'),
                'auditoría: el alta de estudio quedó registrada');
select tests.ok((select count(*) = 0 from public.audit_logs where entity_type = 'invitations' and (new_data ? 'token_hash' or old_data ? 'token_hash')),
                'auditoría: nunca guarda el hash del token de invitación');

-- =====================================================================
-- 10. Tests "meta": protegen las tablas que se agreguen en el futuro
-- =====================================================================
select tests.ok((select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'r'
                   and not (c.relrowsecurity and c.relforcerowsecurity)),
                'meta: TODAS las tablas de public tienen RLS activada y forzada');
select tests.ok((select count(*) = 0 from information_schema.role_table_grants
                 where grantee = 'anon' and table_schema = 'public'),
                'meta: anon no tiene privilegios sobre ninguna tabla');
select tests.ok((select count(*) = 0 from information_schema.column_privileges
                 where grantee = 'anon' and table_schema = 'public'),
                'meta: anon no tiene privilegios sobre ninguna columna');
-- Todas las funciones propias (SECURITY DEFINER o INVOKER, incluidos triggers) fijan
-- search_path = '' y nombran cada objeto con su esquema. Se excluyen las que pertenecen
-- a extensiones, que no controlamos. Si falla, la lista de funciones queda en el nombre.
create view tests.unpinned_functions as
  select n.nspname || '.' || p.proname as fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and not ('search_path=""' = any (coalesce(p.proconfig, '{}')));

select tests.ok(
  not exists (select 1 from tests.unpinned_functions),
  'meta: toda función de public y app fija search_path = ''''' ||
  coalesce(' (sin fijar: ' || (select string_agg(fn, ', ' order by fn) from tests.unpinned_functions) || ')', ''));
select tests.ok((select count(*) >= 30 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'app')),
                'meta: el chequeo de search_path realmente ve las funciones de public y app');
select tests.ok((select count(*) = 0 from information_schema.columns c
                 join pg_class t on t.relname = c.table_name
                 join pg_namespace n on n.oid = t.relnamespace and n.nspname = c.table_schema
                 where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.is_nullable = 'YES'
                   and c.table_name not in ('roles', 'audit_logs')),
                'meta: tenant_id es obligatorio en toda tabla de negocio');

-- ---------------------------------------------------------------------
-- Resumen
-- ---------------------------------------------------------------------
\o
\pset tuples_only on
select format('%s tests · %s ok · %s fallidos',
              count(*), count(*) filter (where ok), count(*) filter (where not ok))
from tests.results;
select '  FALLÓ: ' || name from tests.results where not ok order by n;

do $$
begin
  if exists (select 1 from tests.results where not ok) then
    raise exception 'Hay tests fallidos';
  end if;
end $$;

rollback;
