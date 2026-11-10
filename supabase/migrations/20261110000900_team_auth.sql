-- =====================================================================
-- Cleo · Migración 0900 · Acceso del equipo e invitaciones
-- Épica 02 (AUTH-01, AUTH-02, AUTH-03)
--
--   * get_invitation_preview: qué estudio y rol ofrece un link de invitación,
--     sin ids ni el email completo (para la página de aceptar).
--   * accept_invitation: además exige que el email de la cuenta esté confirmado.
--   * handle_new_user: copia el nombre que entrega Google (metadatos).
--   * team_members: equipo de un estudio con emails (auth.users no se expone).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vista previa de una invitación
-- status: valid · expired · used · revoked · unavailable · invalid
-- ---------------------------------------------------------------------
create or replace function public.get_invitation_preview(p_token text)
returns table (
  status        text,
  studio_slug   text,
  studio_name   text,
  role_name     text,
  email_masked  text,
  expires_at    timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv     public.invitations%rowtype;
  v_tenant  public.tenants%rowtype;
  v_status  text;
begin
  -- Un token tiene 64 caracteres hex. Cualquier otra cosa ni se busca.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select * into v_inv from public.invitations
  where token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    return query select 'invalid'::text, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select * into v_tenant from public.tenants where id = v_inv.tenant_id;

  v_status := case
    when v_inv.revoked_at is not null  then 'revoked'
    when v_inv.accepted_at is not null then 'used'
    when v_inv.expires_at <= now()     then 'expired'
    when v_tenant.status not in ('trial', 'active', 'past_due') then 'unavailable'
    else 'valid'
  end;

  return query
  select v_status,
         v_tenant.slug,
         coalesce(s.display_name, v_tenant.name),
         r.name,
         -- primera letra + *** + @dominio
         left(v_inv.email, 1) || '***' || substr(v_inv.email, strpos(v_inv.email, '@')),
         v_inv.expires_at
  from public.roles r
  left join public.tenant_settings s on s.tenant_id = v_tenant.id
  where r.id = v_inv.role_id;
end $$;
revoke execute on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Aceptar invitación: igual que antes + email confirmado obligatorio
-- ---------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_confirmed  timestamptz;
  v_inv        public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión para aceptar la invitación' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = v_uid;

  -- Sin email confirmado, cualquiera con el link podría registrarse con ese email
  -- sin ser dueña de la casilla.
  if v_confirmed is null then
    raise exception 'Confirmá tu email antes de aceptar la invitación' using errcode = '42501';
  end if;

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

-- ---------------------------------------------------------------------
-- Perfil nuevo: nombre desde los metadatos (Google entrega full_name / name)
-- ---------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                                       new.raw_user_meta_data ->> 'name', '')), '');
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(v_name, 120))
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Equipo de un estudio (con email) para quien tiene team.read
-- ---------------------------------------------------------------------
create or replace function public.team_members(p_tenant uuid)
returns table (
  membership_id  uuid,
  full_name      text,
  email          text,
  role_key       text,
  role_name      text,
  status         public.membership_status,
  is_me          boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_tenant, 'team.read') then
    raise exception 'No tenés permiso para ver el equipo de este estudio' using errcode = '42501';
  end if;

  return query
  select m.id, p.full_name, lower(u.email), r.key, r.name, m.status, m.user_id = auth.uid()
  from public.memberships m
  join auth.users u on u.id = m.user_id
  join public.roles r on r.id = m.role_id
  left join public.profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant and m.status <> 'revoked'
  order by (m.status = 'active') desc, r.key = 'owner' desc, coalesce(p.full_name, u.email);
end $$;
revoke execute on function public.team_members(uuid) from public, anon;
grant execute on function public.team_members(uuid) to authenticated;
