-- =====================================================================
-- SOLO PARA DESARROLLO / TESTS LOCALES.
-- Recrea lo mínimo de Supabase (roles, esquema auth, auth.uid()) para
-- poder correr las migraciones en un PostgreSQL vacío.
-- En un proyecto Supabase real esto YA EXISTE: no aplicar este archivo.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;

-- Tabla mínima equivalente a auth.users de Supabase.
-- Incluye las columnas que usa el seed para crear usuarias que pueden iniciar
-- sesión en un proyecto real (contraseña, confirmación de email, metadatos).
create table if not exists auth.users (
  id                      uuid primary key default gen_random_uuid(),
  instance_id             uuid,
  aud                     text,
  role                    text,
  email                   text unique,
  encrypted_password      text,
  email_confirmed_at      timestamptz,
  raw_app_meta_data       jsonb,
  raw_user_meta_data      jsonb,
  confirmation_token      text,
  recovery_token          text,
  email_change_token_new  text,
  email_change            text,
  last_sign_in_at         timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Equivalente mínimo de auth.identities (una fila por proveedor de login)
create table if not exists auth.identities (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  provider_id      text not null,
  provider         text not null,
  identity_data    jsonb not null,
  last_sign_in_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (provider_id, provider)
);

-- Igual que la función de Supabase: lee el "sub" del JWT de la request
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
