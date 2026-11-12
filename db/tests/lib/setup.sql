-- =====================================================================
-- Arranque común de los tests de base de datos.
-- Abre UNA transacción (lib/finish.sql la descarta), crea el mini framework
-- de tests y define los atajos de sesión del seed.
-- Uso: \ir lib/setup.sql al principio y \ir lib/finish.sql al final.
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
grant usage on schema tests to anon, authenticated, service_role;

create table tests.results (n serial primary key, ok boolean not null, name text not null);
grant select, insert on tests.results to anon, authenticated, service_role;
grant usage on sequence tests.results_n_seq to anon, authenticated, service_role;

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
\set as_admin     'reset role; do $x$ begin perform tests.login(''admin@cleo.test''); end $x$; set local role authenticated;'
\set as_owner_a   'reset role; do $x$ begin perform tests.login(''duena@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_manager_a 'reset role; do $x$ begin perform tests.login(''encargada@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_pro_a     'reset role; do $x$ begin perform tests.login(''profesional@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_owner_b   'reset role; do $x$ begin perform tests.login(''duena@estudioprueba.test''); end $x$; set local role authenticated;'
\set as_nueva     'reset role; do $x$ begin perform tests.login(''nueva@fresasstudio.test''); end $x$; set local role authenticated;'
\set as_service   'reset role; do $x$ begin perform tests.login(null); end $x$; set local role service_role;'
\set as_externa   'reset role; do $x$ begin perform tests.login(''externa@otro.test''); end $x$; set local role authenticated;'

\set A '''10000000-0000-4000-a000-000000000001'''
\set B '''10000000-0000-4000-a000-000000000002'''

:as_super
select id as role_receptionist from public.roles where tenant_id is null and key = 'receptionist' \gset
select id as role_owner        from public.roles where tenant_id is null and key = 'owner' \gset
select id as uid_owner_a from auth.users where email = 'duena@fresasstudio.test' \gset
select id as uid_pro_a   from auth.users where email = 'profesional@fresasstudio.test' \gset
select id as uid_owner_b from auth.users where email = 'duena@estudioprueba.test' \gset
