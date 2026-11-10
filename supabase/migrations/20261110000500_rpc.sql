-- =====================================================================
-- Fresas SaaS · Migración 0500 · Funciones de servidor (RPC)
-- Épica 01 (ARC-05) · Épica 02 (AUTH-03) · Épica 14 (SAAS-02, base)
--
-- Toda operación sensible pasa por acá: valida permisos dentro de la
-- base, deja auditoría y no depende de lo que muestre la interfaz.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Página pública: datos visibles de un estudio por su dirección
-- ---------------------------------------------------------------------

create or replace function public.get_public_studio(p_slug text)
returns table (
  slug                       text,
  name                       text,
  description                text,
  timezone                   text,
  currency                   char(3),
  contact                    jsonb,
  brand                      jsonb,
  deposit_percent            smallint,
  cancellation_window_hours  smallint,
  policy_text                text,
  policy_version             integer
)
language sql stable security definer set search_path = '' as $$
  select t.slug, coalesce(s.display_name, t.name), s.description, t.timezone, t.currency,
         s.contact, s.brand, s.deposit_percent, s.cancellation_window_hours,
         s.policy_text, s.policy_version
  from public.tenants t
  join public.tenant_settings s on s.tenant_id = t.id
  where t.slug = lower(btrim(p_slug))
    and t.status in ('trial', 'active', 'past_due')
$$;
revoke execute on function public.get_public_studio(text) from public;
grant execute on function public.get_public_studio(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Emisión de invitaciones (interna). Devuelve el token en claro UNA vez;
-- en la base solo queda su hash SHA-256.
-- ---------------------------------------------------------------------

create or replace function app.issue_invitation(
  p_tenant uuid, p_email text, p_role uuid, p_valid_for interval
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text;
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El email no es válido' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = p_tenant and lower(u.email) = v_email and m.status = 'active'
  ) then
    raise exception 'Esa persona ya forma parte del estudio' using errcode = '23505';
  end if;

  -- Una sola invitación pendiente por email y estudio: la anterior se anula
  update public.invitations
     set revoked_at = now()
   where tenant_id = p_tenant and email = v_email
     and accepted_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invitations (tenant_id, email, role_id, token_hash, invited_by, expires_at)
  values (p_tenant, v_email, p_role, extensions.digest(v_token, 'sha256'), auth.uid(), now() + p_valid_for);

  return v_token;
end $$;
revoke execute on function app.issue_invitation(uuid, text, uuid, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Invitar a alguien al equipo del estudio
-- ---------------------------------------------------------------------

create or replace function public.create_invitation(p_tenant uuid, p_email text, p_role uuid)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión' using errcode = '42501';
  end if;
  if not app.can(p_tenant, 'team.manage') then
    raise exception 'No tenés permiso para invitar personas a este estudio' using errcode = '42501';
  end if;
  if not app.role_belongs_to(p_role, p_tenant) then
    raise exception 'Ese rol no pertenece a este estudio' using errcode = '42501';
  end if;
  if not app.holds_role_permissions(p_tenant, p_role) then
    raise exception 'No podés asignar un rol con más permisos que el tuyo' using errcode = '42501';
  end if;

  return app.issue_invitation(p_tenant, p_email, p_role, interval '7 days');
end $$;
revoke execute on function public.create_invitation(uuid, text, uuid) from public, anon;
grant execute on function public.create_invitation(uuid, text, uuid) to authenticated;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invitations%rowtype;
begin
  select * into v_inv from public.invitations where id = p_invitation for update;
  if not found or not (app.can(v_inv.tenant_id, 'team.manage') or app.is_platform_admin()) then
    raise exception 'Invitación inexistente' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'La invitación ya fue aceptada' using errcode = '22023';
  end if;
  update public.invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation;
end $$;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Aceptar una invitación (la persona tiene que estar logueada con el
-- MISMO email al que se la enviaron).
-- ---------------------------------------------------------------------

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_inv    public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión para aceptar la invitación' using errcode = '42501';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select * into v_inv
  from public.invitations
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
  for update;

  if not found then
    raise exception 'La invitación no es válida' using errcode = 'P0002';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'La invitación fue anulada' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'La invitación ya fue usada' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'La invitación está vencida. Pedí una nueva.' using errcode = '22023';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception 'Esta invitación es para otra dirección de email' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id = v_inv.tenant_id and t.status <> 'cancelled') then
    raise exception 'El estudio ya no está disponible' using errcode = '22023';
  end if;

  insert into public.memberships (tenant_id, user_id, role_id, status, created_by)
  values (v_inv.tenant_id, v_uid, v_inv.role_id, 'active', v_inv.invited_by)
  on conflict (tenant_id, user_id)
  do update set role_id = excluded.role_id, status = 'active';

  update public.invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  return v_inv.tenant_id;
end $$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------
-- Fresas Admin: alta de estudio + invitación a su dueña
-- ---------------------------------------------------------------------

create or replace function public.admin_create_studio(
  p_slug text, p_name text, p_owner_email text,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_currency text default 'ARS'
) returns table (tenant_id uuid, owner_invitation_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_token  text;
begin
  if not app.is_platform_admin() then
    raise exception 'Solo Fresas Admin puede crear estudios' using errcode = '42501';
  end if;

  insert into public.tenants (slug, name, timezone, currency)
  values (lower(btrim(p_slug)), btrim(p_name), p_timezone, upper(p_currency))
  returning id into v_tenant;

  v_token := app.issue_invitation(v_tenant, p_owner_email, app.owner_role_id(), interval '14 days');

  perform app.write_audit(v_tenant, 'studio.created', 'tenants', v_tenant::text, null,
                          jsonb_build_object('slug', lower(btrim(p_slug)), 'owner_email', lower(btrim(p_owner_email))));

  return query select v_tenant, v_token;
end $$;
revoke execute on function public.admin_create_studio(text, text, text, text, text) from public, anon;
grant execute on function public.admin_create_studio(text, text, text, text, text) to authenticated;

-- Fresas Admin: cambiar el estado comercial (suspender no borra nada)
create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status public.tenant_status)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Solo Fresas Admin puede cambiar el estado de un estudio' using errcode = '42501';
  end if;
  update public.tenants set status = p_status where id = p_tenant;
  if not found then
    raise exception 'Estudio inexistente' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.admin_set_tenant_status(uuid, public.tenant_status) from public, anon;
grant execute on function public.admin_set_tenant_status(uuid, public.tenant_status) to authenticated;

-- ---------------------------------------------------------------------
-- Mis estudios (para el selector de estudio de Fresas Manager)
-- ---------------------------------------------------------------------

create or replace function public.my_studios()
returns table (tenant_id uuid, slug text, name text, status public.tenant_status, role_key text, role_name text, permissions text[])
language sql stable security definer set search_path = '' as $$
  select t.id, t.slug, t.name, t.status, r.key, r.name,
         array(select rp.permission_code from public.role_permissions rp where rp.role_id = r.id order by 1)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.status = 'active'
  order by t.name
$$;
revoke execute on function public.my_studios() from public, anon;
grant execute on function public.my_studios() to authenticated;
