-- =====================================================================
-- Fresas SaaS · Migración 0200 · Roles, permisos y membresías
-- Épica 02 (AUTH-03, AUTH-04)
--
-- Modelo:
--   permissions        catálogo fijo de permisos (código "modulo.accion")
--   roles              roles de sistema (tenant_id NULL) o propios del estudio
--   role_permissions   qué permisos tiene cada rol
--   memberships        usuaria ↔ estudio ↔ rol
--
-- Reglas que se validan en la base (no solo en la interfaz):
--   * Un rol propio de un estudio no se puede usar en otro.
--   * Nadie puede dar un rol con más permisos que los suyos.
--   * Nadie puede modificar su propio acceso.
--   * Un estudio no puede quedarse sin dueña activa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo de permisos (datos de referencia, no de demo)
-- ---------------------------------------------------------------------

create table public.permissions (
  code         text primary key,
  module       text not null,
  description  text not null,
  constraint permissions_code_format check (code ~ '^[a-z_]+\.[a-z_]+$')
);

insert into public.permissions (code, module, description) values
  ('settings.manage',     'settings',    'Editar datos, horarios y políticas del estudio'),
  ('payments.manage',     'payments',    'Conectar y desconectar la cuenta de Mercado Pago'),
  ('team.read',           'team',        'Ver el equipo del estudio'),
  ('team.manage',         'team',        'Invitar, cambiar roles y dar de baja al equipo'),
  ('team.assign_owner',   'team',        'Dar el rol de dueña'),
  ('audit.read',          'audit',       'Ver el historial de auditoría'),
  ('services.manage',     'services',    'Administrar servicios, categorías y precios'),
  ('agenda.read_all',     'agenda',      'Ver la agenda de todas las profesionales'),
  ('agenda.read_own',     'agenda',      'Ver la agenda propia'),
  ('agenda.manage',       'agenda',      'Crear, mover y cancelar turnos; bloquear horarios'),
  ('clients.read',        'clients',     'Ver fichas de clientas'),
  ('clients.manage',      'clients',     'Crear y editar fichas de clientas'),
  ('cash.read',           'cash',        'Ver caja y movimientos'),
  ('cash.manage',         'cash',        'Registrar cobros, gastos y cierres de caja'),
  ('commissions.read',    'commissions', 'Ver comisiones'),
  ('commissions.manage',  'commissions', 'Configurar reglas y liquidar comisiones'),
  ('shop.manage',         'shop',        'Administrar productos, stock y pedidos'),
  ('reports.read',        'reports',     'Ver reportes');

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants (id) on delete restrict,  -- NULL = rol de sistema
  key         text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint roles_key_format  check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint roles_name_length check (char_length(btrim(name)) between 2 and 60),
  constraint roles_unique_key  unique nulls not distinct (tenant_id, key)
);
create index roles_tenant_idx on public.roles (tenant_id);

create trigger roles_updated_at
  before update on public.roles
  for each row execute function app.set_updated_at();

create table public.role_permissions (
  role_id          uuid not null references public.roles (id) on delete cascade,
  permission_code  text not null references public.permissions (code) on delete restrict,
  primary key (role_id, permission_code)
);

-- Roles de sistema
insert into public.roles (tenant_id, key, name) values
  (null, 'owner',        'Dueña'),
  (null, 'manager',      'Encargada'),
  (null, 'receptionist', 'Recepción'),
  (null, 'professional', 'Profesional');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join public.permissions p
where r.tenant_id is null
  and (
    r.key = 'owner'
    or (r.key = 'manager' and p.code not in ('team.assign_owner', 'payments.manage'))
    or (r.key = 'receptionist' and p.code in (
          'team.read', 'agenda.read_all', 'agenda.manage', 'clients.read',
          'clients.manage', 'cash.read', 'cash.manage', 'shop.manage'))
    or (r.key = 'professional' and p.code in ('agenda.read_own', 'clients.read'))
  );

-- ---------------------------------------------------------------------
-- Membresías
-- ---------------------------------------------------------------------

create type public.membership_status as enum ('active', 'suspended', 'revoked');

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete restrict,
  status      public.membership_status not null default 'active',
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint memberships_unique_user unique (tenant_id, user_id)
);
create index memberships_user_active_idx on public.memberships (user_id) where status = 'active';

-- ---------------------------------------------------------------------
-- Funciones de autorización (usadas por las políticas RLS)
-- SECURITY DEFINER para no depender de la RLS de las tablas que leen.
-- ---------------------------------------------------------------------

create or replace function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function app.has_permission(p_tenant uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission_code = p_permission
  )
$$;

-- Un estudio suspendido o cancelado se puede consultar pero no modificar.
create or replace function app.tenant_is_writable(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenants t
    where t.id = p_tenant and t.status in ('trial', 'active', 'past_due')
  )
$$;

-- Permiso para ESCRIBIR: tener el permiso y que el estudio esté operativo.
create or replace function app.can(p_tenant uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_tenant, p_permission) and app.tenant_is_writable(p_tenant)
$$;

create or replace function app.role_belongs_to(p_role uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roles r
    where r.id = p_role and (r.tenant_id is null or r.tenant_id = p_tenant)
  )
$$;

create or replace function app.role_tenant(p_role uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.tenant_id from public.roles r where r.id = p_role
$$;

-- ¿La usuaria actual tiene TODOS los permisos de ese rol en ese estudio?
create or replace function app.holds_role_permissions(p_tenant uuid, p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role
      and not app.has_permission(p_tenant, rp.permission_code)
  )
$$;

create or replace function app.can_manage_role(p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roles r
    where r.id = p_role
      and r.tenant_id is not null
      and app.can(r.tenant_id, 'team.manage')
  )
$$;

create or replace function app.owner_role_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.roles r where r.tenant_id is null and r.key = 'owner'
$$;

-- ¿Puedo ver el perfil de esta persona? (comparte un estudio donde tengo team.read)
create or replace function app.can_see_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user
      and app.has_permission(m.tenant_id, 'team.read')
  )
$$;

create or replace function app.other_active_owners(p_tenant uuid, p_except uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.memberships m
  where m.tenant_id = p_tenant
    and m.id <> p_except
    and m.status = 'active'
    and m.role_id = app.owner_role_id()
$$;

-- ---------------------------------------------------------------------
-- Reglas de membresías (trigger SECURITY INVOKER: current_user = quien ejecuta)
-- ---------------------------------------------------------------------

create or replace function app.guard_membership() returns trigger
language plpgsql as $$
begin
  -- 1. El rol tiene que ser de sistema o del mismo estudio. Siempre.
  if not app.role_belongs_to(new.role_id, new.tenant_id) then
    raise exception 'Ese rol no pertenece a este estudio' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.user_id <> old.user_id) then
    raise exception 'Una membresía no se puede mover de estudio ni de persona' using errcode = '42501';
  end if;

  -- 2. Reglas para usuarias de la API (no para el servidor ni Fresas Admin)
  if not app.is_privileged_session() and not app.is_platform_admin() then
    if new.user_id = auth.uid() then
      raise exception 'No podés modificar tu propio acceso. Pedíselo a otra persona del estudio.'
        using errcode = '42501';
    end if;

    if (tg_op = 'INSERT' or new.role_id <> old.role_id)
       and not app.holds_role_permissions(new.tenant_id, new.role_id) then
      raise exception 'No podés asignar un rol con más permisos que el tuyo' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and not app.holds_role_permissions(old.tenant_id, old.role_id) then
      raise exception 'No podés modificar a alguien con más permisos que vos' using errcode = '42501';
    end if;
  end if;

  -- 3. Siempre tiene que quedar al menos una dueña activa
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.role_id = app.owner_role_id()
     and (new.status <> 'active' or new.role_id <> old.role_id)
     and app.other_active_owners(old.tenant_id, old.id) = 0 then
    raise exception 'El estudio tiene que tener al menos una dueña activa' using errcode = '23514';
  end if;

  return new;
end $$;

create trigger memberships_guard
  before insert or update on public.memberships
  for each row execute function app.guard_membership();

create trigger memberships_updated_at
  before update on public.memberships
  for each row execute function app.set_updated_at();

-- Los permisos que se agregan a un rol propio no pueden superar los de quien los agrega
create or replace function app.guard_role_permission() returns trigger
language plpgsql as $$
begin
  if not app.is_privileged_session() and not app.is_platform_admin()
     and not app.has_permission(app.role_tenant(new.role_id), new.permission_code) then
    raise exception 'No podés dar un permiso que no tenés: %', new.permission_code using errcode = '42501';
  end if;
  return new;
end $$;

create trigger role_permissions_guard
  before insert on public.role_permissions
  for each row execute function app.guard_role_permission();

-- ---------------------------------------------------------------------
-- Invitaciones (el token solo se guarda hasheado)
-- ---------------------------------------------------------------------

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  email        text not null,
  role_id      uuid not null references public.roles (id) on delete restrict,
  token_hash   bytea not null unique,
  invited_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint invitations_email_format check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint invitations_single_outcome check (not (accepted_at is not null and revoked_at is not null))
);
create unique index invitations_one_pending_idx
  on public.invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;

create or replace function app.guard_invitation_role() returns trigger
language plpgsql as $$
begin
  if not app.role_belongs_to(new.role_id, new.tenant_id) then
    raise exception 'Ese rol no pertenece a este estudio' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger invitations_guard_role
  before insert or update on public.invitations
  for each row execute function app.guard_invitation_role();
