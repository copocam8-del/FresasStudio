-- =====================================================================
-- Cleo · Migración 0700 · Renombre de la plataforma (Fresas → Cleo)
--
-- La plataforma se llama Cleo (Cleo Admin / Cleo Manager). Fresas Studio
-- pasa a ser un estudio cliente y usa el slug "fresas".
--   * Reserva los slugs de la marca Cleo y de infraestructura de subdominios.
--   * Libera "fresas".
--   * Mensajes de error con "Cleo Admin".
--   * Rechaza slugs "xn--…" (en un subdominio se leerían como punycode).
-- Las migraciones anteriores no se modifican: sus comentarios quedan como historia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Slugs reservados
-- ---------------------------------------------------------------------
do $$
declare
  v_new text[] := array[
    -- marca de la plataforma
    'cleo', 'cleo-admin', 'cleoadmin', 'cleo-manager', 'cleomanager',
    'cleo-app', 'cleo-suite', 'cleosuite',
    -- infraestructura de subdominios
    'mail', 'email', 'smtp', 'imap', 'mx', 'ns1', 'ns2', 'ftp',
    'cdn', 'img', 'media', 'dev', 'staging', 'preview', 'test',
    'demo', 'sandbox', 'localhost', 'id', 'sso', 'oauth', 'callback',
    'webhook', 'webhooks',
    -- rutas de producto
    'panel', 'dashboard', 'cuenta', 'account', 'billing', 'facturacion',
    'pagos', 'invitacion', 'invite'];
  v_taken text;
begin
  -- Si algún estudio ya usa uno de estos slugs, no seguimos: hay que resolverlo a mano.
  select string_agg(t.slug, ', ' order by t.slug) into v_taken
  from public.tenants t
  where t.slug = any (v_new);
  if v_taken is not null then
    raise exception 'Estos estudios usan slugs que se van a reservar: %', v_taken;
  end if;

  insert into app.reserved_slugs (slug)
  select unnest(v_new)
  on conflict (slug) do nothing;
end $$;

-- Fresas Studio es un estudio cliente: puede usar fresas.cleo.com.ar
delete from app.reserved_slugs where slug = 'fresas';

-- ---------------------------------------------------------------------
-- 2. Validación de estudios: mensaje con Cleo Admin + rechazo de punycode
-- ---------------------------------------------------------------------
create or replace function app.validate_tenant() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'Zona horaria inválida: %', new.timezone using errcode = '22023';
  end if;

  if exists (select 1 from app.reserved_slugs r where r.slug = new.slug) then
    raise exception 'La dirección "%" está reservada. Elegí otra.', new.slug using errcode = '22023';
  end if;

  if new.slug like 'xn--%' then
    raise exception 'La dirección "%" no puede empezar con "xn--". Elegí otra.', new.slug using errcode = '22023';
  end if;

  -- Solo Cleo Admin (o el servidor) cambia URL y estado comercial.
  if tg_op = 'UPDATE'
     and not app.is_privileged_session()
     and not app.is_platform_admin()
     and (new.id <> old.id or new.slug <> old.slug or new.status <> old.status) then
    raise exception 'Solo Cleo Admin puede cambiar la dirección o el estado del estudio'
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

-- ---------------------------------------------------------------------
-- 3. Funciones de Cleo Admin: mismos cuerpos, mensajes nuevos
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
    raise exception 'Solo Cleo Admin puede crear estudios' using errcode = '42501';
  end if;

  insert into public.tenants (slug, name, timezone, currency)
  values (lower(btrim(p_slug)), btrim(p_name), p_timezone, upper(p_currency))
  returning id into v_tenant;

  v_token := app.issue_invitation(v_tenant, p_owner_email, app.owner_role_id(), interval '14 days');

  perform app.write_audit(v_tenant, 'studio.created', 'tenants', v_tenant::text, null,
                          jsonb_build_object('slug', lower(btrim(p_slug)), 'owner_email', lower(btrim(p_owner_email))));

  return query select v_tenant, v_token;
end $$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status public.tenant_status)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Solo Cleo Admin puede cambiar el estado de un estudio' using errcode = '42501';
  end if;
  update public.tenants set status = p_status where id = p_tenant;
  if not found then
    raise exception 'Estudio inexistente' using errcode = 'P0002';
  end if;
end $$;

comment on schema app is 'Funciones y tablas internas de Cleo. No se exponen por la API.';
