-- =====================================================================
-- Cleo · Migración 1000 · Fichas de clientas por estudio
-- Épica 09 (CRM-01, base) · Épica 02 (clienta solo ve sus datos)
--
-- Cada clienta tiene UNA identidad de login (Google) y una ficha SEPARADA por
-- estudio. Cada estudio ve solo las fichas propias; la clienta ve solo las suyas.
-- Cleo Admin no tiene acceso a las fichas.
--
-- Esta tabla solo tiene datos que la clienta puede ver. Notas internas, alergias
-- o etiquetas del estudio irán en otra tabla (RLS filtra filas, no columnas).
--
-- Vinculación (D7): si el estudio ya cargó una ficha con el mismo email y sin
-- usuaria, el primer login de la clienta la vincula en vez de crear otra.
-- =====================================================================

create type public.client_profile_status as enum ('active', 'archived');
create type public.client_profile_source as enum ('self_signup', 'staff');

create table public.client_profiles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  user_id     uuid references auth.users (id) on delete set null,  -- null: ficha cargada por el estudio
  full_name   text not null,
  email       text,
  phone       text,
  status      public.client_profile_status not null default 'active',
  source      public.client_profile_source not null default 'staff',
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint client_profiles_name  check (char_length(btrim(full_name)) between 2 and 120),
  constraint client_profiles_email check (
    email is null or (email = lower(btrim(email)) and char_length(email) <= 254
                      and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint client_profiles_phone check (phone is null or phone ~ '^\+?[0-9 ()-]{6,30}$')
);
comment on table public.client_profiles is
  'Ficha de una clienta en UN estudio. La ve la propia clienta y el equipo con clients.read.';

create unique index client_profiles_tenant_user  on public.client_profiles (tenant_id, user_id) where user_id is not null;
create unique index client_profiles_tenant_email on public.client_profiles (tenant_id, email) where email is not null;
create index client_profiles_tenant_name on public.client_profiles (tenant_id, full_name);
create index client_profiles_user on public.client_profiles (user_id) where user_id is not null;

-- ---------------------------------------------------------------------
-- Normalización y reglas (trigger SECURITY INVOKER: current_user = quien ejecuta)
-- ---------------------------------------------------------------------
create or replace function app.guard_client_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.full_name := btrim(new.full_name);
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    -- Desde la API (equipo) solo se cargan fichas sin usuaria vinculada.
    if not app.is_privileged_session() then
      new.user_id := null;
      new.source := 'staff';
    end if;
  else
    if new.tenant_id <> old.tenant_id or new.source <> old.source
       or (new.user_id is distinct from old.user_id and not app.is_privileged_session()) then
      raise exception 'No se puede cambiar el estudio, el origen ni la usuaria de una ficha'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger client_profiles_guard
  before insert or update on public.client_profiles
  for each row execute function app.guard_client_profile();

create trigger client_profiles_updated_at
  before update on public.client_profiles
  for each row execute function app.set_updated_at();

-- Auditoría SIN datos personales: audit_logs lo pueden leer la dueña y Cleo Admin, y
-- Cleo Admin no debe ver datos de clientas. Se registra quién, cuándo y QUÉ campos
-- cambiaron, nunca sus valores.
create or replace function app.audit_client_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row     public.client_profiles%rowtype := coalesce(new, old);
  v_fields  text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_fields
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('updated_at')
      and n.value is distinct from (to_jsonb(old) -> n.key);
  end if;

  insert into public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (v_row.tenant_id, auth.uid(), lower(tg_op), 'client_profiles', v_row.id::text, null,
          jsonb_build_object('source', v_row.source, 'status', v_row.status,
                             'linked', v_row.user_id is not null, 'changed_fields', to_jsonb(v_fields)));
  return null;
end $$;

create trigger audit_client_profiles
  after insert or update or delete on public.client_profiles
  for each row execute function app.audit_client_profile();

-- ---------------------------------------------------------------------
-- Privilegios y RLS
-- ---------------------------------------------------------------------
revoke all on public.client_profiles from anon, authenticated;
grant select                                         on public.client_profiles to authenticated;
grant insert (tenant_id, full_name, email, phone)    on public.client_profiles to authenticated;
grant update (full_name, email, phone, status)       on public.client_profiles to authenticated;
grant all on public.client_profiles to service_role;

alter table public.client_profiles enable row level security;
alter table public.client_profiles force row level security;

-- La propia clienta (cualquier estudio donde tenga ficha) o el equipo con clients.read.
-- Cleo Admin no: a propósito no hay "or app.is_platform_admin()".
create policy client_profiles_select on public.client_profiles for select to authenticated
  using (user_id = auth.uid() or app.has_permission(tenant_id, 'clients.read'));

-- El equipo con clients.manage (y el estudio operativo) carga y edita fichas.
-- La clienta edita lo suyo solo por update_my_client_profile.
create policy client_profiles_insert on public.client_profiles for insert to authenticated
  with check (app.can(tenant_id, 'clients.manage'));
create policy client_profiles_update on public.client_profiles for update to authenticated
  using (app.can(tenant_id, 'clients.manage'))
  with check (app.can(tenant_id, 'clients.manage'));

-- ---------------------------------------------------------------------
-- RPC de la clienta (sin ids internos)
-- ---------------------------------------------------------------------

-- Estudio operativo por slug (interno)
create or replace function app.writable_tenant_by_slug(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.tenants t
  where t.slug = lower(btrim(p_slug)) and t.status in ('trial', 'active', 'past_due')
$$;
revoke execute on function app.writable_tenant_by_slug(text) from public, anon, authenticated;

-- Al iniciar sesión en el sitio de un estudio: crea (o vincula) la ficha. Idempotente.
create or replace function public.ensure_client_profile(p_slug text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_email   text;
  v_name    text;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión' using errcode = '42501';
  end if;

  v_tenant := app.writable_tenant_by_slug(p_slug);
  if v_tenant is null then
    raise exception 'Este estudio no está disponible' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.client_profiles where tenant_id = v_tenant and user_id = v_uid) then
    return;
  end if;

  select nullif(lower(btrim(u.email)), ''),
         nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
    into v_email, v_name
  from auth.users u where u.id = v_uid;

  -- D7: ficha cargada por el estudio con el mismo email y sin usuaria → se vincula.
  if v_email is not null then
    update public.client_profiles
       set user_id = v_uid
     where tenant_id = v_tenant and user_id is null and email = v_email;
    if found then
      return;
    end if;
  end if;

  v_name := left(coalesce(v_name, split_part(v_email, '@', 1), ''), 120);
  if char_length(v_name) < 2 then
    v_name := 'Clienta';
  end if;

  insert into public.client_profiles (tenant_id, user_id, full_name, email, source)
  values (v_tenant, v_uid, v_name, v_email, 'self_signup')
  on conflict do nothing;

  -- Si el email ya está en otra ficha de este estudio (vinculada a otra cuenta),
  -- se crea la ficha sin email antes que dejar a la clienta sin ficha.
  if not exists (select 1 from public.client_profiles where tenant_id = v_tenant and user_id = v_uid) then
    insert into public.client_profiles (tenant_id, user_id, full_name, email, source)
    values (v_tenant, v_uid, v_name, null, 'self_signup')
    on conflict do nothing;
  end if;
end $$;
revoke execute on function public.ensure_client_profile(text) from public, anon;
grant execute on function public.ensure_client_profile(text) to authenticated;

-- "archived" es para ordenar el listado del estudio: la clienta sigue viendo y
-- editando sus datos (si no, quedaría trabada sin poder crear otra ficha).
create or replace function public.my_client_profile(p_slug text)
returns table (full_name text, email text, phone text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.full_name, c.email, c.phone, c.created_at
  from public.client_profiles c
  join public.tenants t on t.id = c.tenant_id
  where t.slug = lower(btrim(p_slug))
    and c.user_id = auth.uid()
$$;
revoke execute on function public.my_client_profile(text) from public, anon;
grant execute on function public.my_client_profile(text) to authenticated;

create or replace function public.update_my_client_profile(p_slug text, p_full_name text, p_phone text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión' using errcode = '42501';
  end if;
  v_tenant := app.writable_tenant_by_slug(p_slug);
  if v_tenant is null then
    raise exception 'Este estudio no está disponible' using errcode = 'P0002';
  end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 120 then
    raise exception 'Ingresá tu nombre (entre 2 y 120 caracteres)' using errcode = '22023';
  end if;
  if nullif(btrim(p_phone), '') is not null and btrim(p_phone) !~ '^\+?[0-9 ()-]{6,30}$' then
    raise exception 'Ese teléfono no parece válido' using errcode = '22023';
  end if;

  update public.client_profiles
     set full_name = btrim(p_full_name),
         phone = nullif(btrim(p_phone), '')
   where tenant_id = v_tenant and user_id = auth.uid();

  if not found then
    raise exception 'No encontramos tu ficha en este estudio' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.update_my_client_profile(text, text, text) from public, anon;
grant execute on function public.update_my_client_profile(text, text, text) to authenticated;
