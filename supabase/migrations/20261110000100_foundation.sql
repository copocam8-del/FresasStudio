-- =====================================================================
-- Fresas SaaS · Migración 0100 · Fundamentos multi-tenant
-- Épica 01 (ARC-05, ARC-07) · Épica 03 (TEN-01, TEN-05, TEN-06)
--
-- Tablas: tenants, tenant_settings, tenant_policy_versions,
--         profiles, platform_admins
-- Convenciones:
--   * Toda tabla con datos de un estudio lleva tenant_id NOT NULL.
--   * Nada se borra en cascada desde tenants: suspender ≠ eliminar.
--   * Funciones SECURITY DEFINER siempre con search_path = ''.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
comment on schema app is 'Funciones y tablas internas de Fresas. No se exponen por la API.';
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- true cuando la sentencia NO viene de un usuario de la API
-- (postgres, service_role o una función SECURITY DEFINER propia).
-- Es SECURITY INVOKER a propósito: current_user es quien ejecuta.
create or replace function app.is_privileged_session() returns boolean
language sql stable as $$
  select current_user not in ('anon', 'authenticated')
$$;

-- ---------------------------------------------------------------------
-- URLs reservadas (no pueden usarse como slug de estudio)
-- ---------------------------------------------------------------------

create table app.reserved_slugs (slug text primary key);
insert into app.reserved_slugs (slug) values
  ('admin'), ('manager'), ('api'), ('app'), ('www'), ('auth'), ('login'),
  ('signup'), ('registro'), ('fresas'), ('soporte'), ('support'), ('ayuda'),
  ('help'), ('static'), ('assets'), ('blog'), ('status'), ('legal'),
  ('terminos'), ('privacidad');
grant select on app.reserved_slugs to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Estudios (tenants)
-- ---------------------------------------------------------------------

create type public.tenant_status as enum ('trial', 'active', 'past_due', 'suspended', 'cancelled');

create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  status        public.tenant_status not null default 'trial',
  timezone      text not null default 'America/Argentina/Buenos_Aires',
  currency      char(3) not null default 'ARS',
  suspended_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  constraint tenants_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint tenants_currency_format check (currency ~ '^[A-Z]{3}$')
);
comment on table public.tenants is 'Cada estudio de belleza que usa Fresas. Nunca se borra: se suspende o cancela.';

create or replace function app.validate_tenant() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'Zona horaria inválida: %', new.timezone using errcode = '22023';
  end if;

  if exists (select 1 from app.reserved_slugs r where r.slug = new.slug) then
    raise exception 'La dirección "%" está reservada. Elegí otra.', new.slug using errcode = '22023';
  end if;

  -- Solo Fresas Admin (o el servidor) cambia URL y estado comercial.
  if tg_op = 'UPDATE'
     and not app.is_privileged_session()
     and not app.is_platform_admin()
     and (new.id <> old.id or new.slug <> old.slug or new.status <> old.status) then
    raise exception 'Solo Fresas Admin puede cambiar la dirección o el estado del estudio'
      using errcode = '42501';
  end if;

  if new.status = 'suspended' then
    if tg_op = 'INSERT' or old.status <> 'suspended' then
      new.suspended_at := now();
    end if;
  else
    new.suspended_at := null;
  end if;

  return new;
end $$;

create trigger tenants_validate
  before insert or update on public.tenants
  for each row execute function app.validate_tenant();

create trigger tenants_updated_at
  before update on public.tenants
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------
-- Configuración de cada estudio
-- ---------------------------------------------------------------------

create table public.tenant_settings (
  tenant_id                  uuid primary key references public.tenants (id) on delete restrict,
  display_name               text,
  description                text,
  contact                    jsonb not null default '{}'::jsonb,  -- dirección, whatsapp, instagram…
  brand                      jsonb not null default '{}'::jsonb,  -- colores, ruta del logo…
  deposit_percent            smallint not null default 50,
  cancellation_window_hours  smallint not null default 48,
  booking_hold_minutes       smallint not null default 15,
  no_show_forfeits_deposit   boolean  not null default true,
  policy_text                text,
  policy_version             integer  not null default 1,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid,
  constraint settings_display_name_length check (display_name is null or char_length(display_name) <= 120),
  constraint settings_description_length  check (description is null or char_length(description) <= 2000),
  constraint settings_policy_text_length  check (policy_text is null or char_length(policy_text) <= 5000),
  constraint settings_contact_object      check (jsonb_typeof(contact) = 'object'),
  constraint settings_brand_object        check (jsonb_typeof(brand) = 'object'),
  constraint settings_deposit_range       check (deposit_percent between 0 and 100),
  constraint settings_window_range        check (cancellation_window_hours between 0 and 720),
  constraint settings_hold_range          check (booking_hold_minutes between 5 and 60)
);
comment on column public.tenant_settings.policy_version is
  'Sube sola cada vez que cambian seña, ventana de cancelación, no-show o texto de políticas.';

create trigger tenant_settings_updated_at
  before update on public.tenant_settings
  for each row execute function app.set_updated_at();

-- Historial inmutable de políticas: cada reserva guardará la versión aceptada (POL-08)
create table public.tenant_policy_versions (
  tenant_id                  uuid not null references public.tenants (id) on delete restrict,
  version                    integer not null,
  deposit_percent            smallint not null,
  cancellation_window_hours  smallint not null,
  no_show_forfeits_deposit   boolean not null,
  policy_text                text,
  created_at                 timestamptz not null default now(),
  created_by                 uuid,
  primary key (tenant_id, version)
);

create or replace function app.version_tenant_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.policy_version := 1;
  elsif (new.deposit_percent, new.cancellation_window_hours, new.no_show_forfeits_deposit, new.policy_text)
        is not distinct from
        (old.deposit_percent, old.cancellation_window_hours, old.no_show_forfeits_deposit, old.policy_text) then
    new.policy_version := old.policy_version;   -- no cambió la política
    return new;
  else
    new.policy_version := old.policy_version + 1;
  end if;

  insert into public.tenant_policy_versions
    (tenant_id, version, deposit_percent, cancellation_window_hours, no_show_forfeits_deposit, policy_text, created_by)
  values
    (new.tenant_id, new.policy_version, new.deposit_percent, new.cancellation_window_hours,
     new.no_show_forfeits_deposit, new.policy_text, auth.uid());

  return new;
end $$;

create trigger tenant_settings_version_policy
  before insert or update on public.tenant_settings
  for each row execute function app.version_tenant_policy();

-- Cada estudio nuevo nace con su configuración por defecto
create or replace function app.create_tenant_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tenant_settings (tenant_id, display_name) values (new.id, new.name);
  return null;
end $$;

create trigger tenants_create_settings
  after insert on public.tenants
  for each row execute function app.create_tenant_settings();

-- ---------------------------------------------------------------------
-- Perfiles de usuario (1 a 1 con auth.users)
-- ---------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_name_length  check (full_name is null or char_length(full_name) <= 120),
  constraint profiles_phone_length check (phone is null or char_length(phone) <= 30)
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------
-- Superadministradores de la plataforma (Fresas Admin)
-- Solo se dan de alta desde el servidor (service_role) o por SQL.
-- ---------------------------------------------------------------------

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
$$;
