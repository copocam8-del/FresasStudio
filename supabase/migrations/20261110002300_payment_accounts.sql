-- =====================================================================
-- Cleo · Migración 2300 · Cuentas de Mercado Pago por estudio (OAuth)
-- Épica 06 (PAY-01, PAY-02) · docs/sprint-5-plan.md §2–§3
--
--   * payment_accounts: la cuenta conectada (sin secretos). La ven payments.manage
--     y settings.manage del estudio. Sin escritura directa.
--   * payment_account_credentials: tokens CIFRADOS en el servidor de Next (AES-GCM,
--     clave fuera de la base). RLS sin políticas y sin grants: nadie la lee por la API,
--     ni la dueña ni Cleo Admin. Solo las funciones svc_mp_* (service_role).
--   * payment_oauth_states: conexiones en curso (hash del state, 10 minutos, un uso,
--     atadas a la usuaria y al estudio que empezaron).
--   * Conectar / desconectar: solo payments.manage (P5). payments_connected lo ponen
--     solo estas funciones; al pasar a false se apagan las reservas online (P6, P7).
-- =====================================================================

create type public.payment_account_status as enum ('connected', 'needs_reconnect', 'disconnected');

create table public.payment_accounts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  provider           text not null default 'mercadopago',
  mp_user_id         bigint not null,
  mp_nickname        text,
  site_id            text not null,
  live_mode          boolean not null,
  status             public.payment_account_status not null default 'connected',
  token_expires_at   timestamptz not null,
  last_refreshed_at  timestamptz,
  last_error         text,
  connected_by       uuid references auth.users (id) on delete set null,
  connected_at       timestamptz not null default now(),
  disconnected_by    uuid references auth.users (id) on delete set null,
  disconnected_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payment_accounts_tenant_id_unique unique (tenant_id, id),
  constraint payment_accounts_provider check (provider = 'mercadopago'),
  constraint payment_accounts_site check (site_id = 'MLA'),
  constraint payment_accounts_nickname check (mp_nickname is null or char_length(mp_nickname) <= 100),
  constraint payment_accounts_error check (last_error is null or char_length(last_error) <= 60),
  constraint payment_accounts_disconnected check ((status = 'disconnected') = (disconnected_at is not null))
);
-- Una sola cuenta activa por estudio, y una cuenta de Mercado Pago en un solo estudio.
create unique index payment_accounts_one_active on public.payment_accounts (tenant_id) where status <> 'disconnected';
create unique index payment_accounts_mp_user_active on public.payment_accounts (mp_user_id, live_mode) where status <> 'disconnected';
create trigger payment_accounts_updated_at before update on public.payment_accounts
  for each row execute function app.set_updated_at();

create table public.payment_account_credentials (
  account_id         uuid primary key,
  tenant_id          uuid not null,
  access_token_enc   text not null,
  refresh_token_enc  text not null,
  key_version        smallint not null,
  expires_at         timestamptz not null,
  refresh_lock_until timestamptz,
  updated_at         timestamptz not null default now(),
  constraint payment_account_credentials_account_fk foreign key (tenant_id, account_id)
    references public.payment_accounts (tenant_id, id) on delete cascade,
  constraint payment_account_credentials_format check (
    access_token_enc ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    and refresh_token_enc ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
comment on table public.payment_account_credentials is
  'Tokens de Mercado Pago cifrados en el servidor (AES-GCM). Nunca en texto plano; nadie los lee por la API.';

create table public.payment_oauth_states (
  state_hash         text primary key,
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  user_id            uuid not null references auth.users (id) on delete cascade,
  code_verifier_enc  text not null,
  expires_at         timestamptz not null,
  claimed_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  constraint payment_oauth_states_hash check (state_hash ~ '^[0-9a-f]{64}$')
);
create index payment_oauth_states_expires on public.payment_oauth_states (expires_at);

-- ---------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------
revoke all on public.payment_accounts, public.payment_account_credentials, public.payment_oauth_states
  from anon, authenticated;
grant select on public.payment_accounts to authenticated;

alter table public.payment_accounts enable row level security;
alter table public.payment_accounts force row level security;
alter table public.payment_account_credentials enable row level security;
alter table public.payment_account_credentials force row level security;
alter table public.payment_oauth_states enable row level security;
alter table public.payment_oauth_states force row level security;

create policy payment_accounts_select on public.payment_accounts for select to authenticated
  using (app.has_permission(tenant_id, 'payments.manage') or app.has_permission(tenant_id, 'settings.manage'));
-- payment_account_credentials y payment_oauth_states: SIN políticas (todo cerrado).

-- ---------------------------------------------------------------------
-- Interno: dejar el estudio sin pagos (apaga las reservas online por trigger).
-- ---------------------------------------------------------------------
create or replace function app.set_payments_connected(p_tenant uuid, p_connected boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tenant_settings set payments_connected = p_connected
   where tenant_id = p_tenant and payments_connected is distinct from p_connected;
end $$;
revoke execute on function app.set_payments_connected(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Conectar (dueña, con su sesión). 1) empezar  2) reclamar el state  3) guardar.
-- El servidor de Next cifra y descifra; la base valida quién, dónde y cuándo.
-- ---------------------------------------------------------------------
create or replace function public.begin_mp_connection(p_tenant uuid, p_state_hash text, p_code_verifier_enc text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can(p_tenant, 'payments.manage') then
    raise exception 'Solo la dueña puede conectar Mercado Pago' using errcode = '42501';
  end if;
  if (select currency from public.tenants where id = p_tenant) <> 'ARS' then
    raise exception 'Mercado Pago solo está disponible para estudios que cobran en pesos' using errcode = '22023';
  end if;
  delete from public.payment_oauth_states where expires_at < now() - interval '1 day';
  if (select count(*) from public.payment_oauth_states
       where tenant_id = p_tenant and expires_at > now() and claimed_at is null) >= 5 then
    raise exception 'Hay demasiadas conexiones empezadas. Esperá unos minutos y probá de nuevo' using errcode = '22023';
  end if;
  insert into public.payment_oauth_states (state_hash, tenant_id, user_id, code_verifier_enc, expires_at)
  values (p_state_hash, p_tenant, auth.uid(), p_code_verifier_enc, now() + interval '10 minutes');
end $$;

-- Marca el state como usado (un solo uso) y devuelve el verificador PKCE cifrado.
create or replace function public.claim_mp_connection(p_tenant uuid, p_state_hash text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.payment_oauth_states%rowtype;
begin
  if not app.can(p_tenant, 'payments.manage') then
    raise exception 'Solo la dueña puede conectar Mercado Pago' using errcode = '42501';
  end if;
  update public.payment_oauth_states
     set claimed_at = now()
   where state_hash = p_state_hash and tenant_id = p_tenant and user_id = auth.uid()
     and claimed_at is null and expires_at > now()
  returning * into v_row;
  if v_row.state_hash is null then
    raise exception 'La conexión venció o ya se usó. Probá de nuevo' using errcode = '22023';
  end if;
  return v_row.code_verifier_enc;
end $$;

create or replace function public.save_mp_connection(
  p_tenant uuid,
  p_state_hash text,
  p_mp_user_id bigint,
  p_nickname text,
  p_site_id text,
  p_live_mode boolean,
  p_access_enc text,
  p_refresh_enc text,
  p_key_version smallint,
  p_expires_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_state   public.payment_oauth_states%rowtype;
  v_current public.payment_accounts%rowtype;
  v_id      uuid;
begin
  if not app.can(p_tenant, 'payments.manage') then
    raise exception 'Solo la dueña puede conectar Mercado Pago' using errcode = '42501';
  end if;
  -- Tiene que venir de un state que ESTA usuaria reclamó para ESTE estudio hace poco.
  update public.payment_oauth_states set completed_at = now()
   where state_hash = p_state_hash and tenant_id = p_tenant and user_id = auth.uid()
     and claimed_at is not null and completed_at is null and claimed_at > now() - interval '10 minutes'
  returning * into v_state;
  if v_state.state_hash is null then
    raise exception 'La conexión venció o ya se usó. Probá de nuevo' using errcode = '22023';
  end if;
  if p_site_id is distinct from 'MLA' then
    raise exception 'La cuenta de Mercado Pago tiene que ser de Argentina' using errcode = '22023';
  end if;
  if p_mp_user_id is null or p_mp_user_id <= 0 or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Mercado Pago devolvió datos inválidos. Probá de nuevo' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_accounts
             where mp_user_id = p_mp_user_id and live_mode = p_live_mode
               and status <> 'disconnected' and tenant_id <> p_tenant) then
    raise exception 'Esa cuenta de Mercado Pago ya está conectada a otro estudio' using errcode = '22023';
  end if;

  select * into v_current from public.payment_accounts
   where tenant_id = p_tenant and status <> 'disconnected' for update;

  if v_current.id is not null and v_current.mp_user_id = p_mp_user_id and v_current.live_mode = p_live_mode then
    -- Reconectar la misma cuenta: tokens nuevos.
    v_id := v_current.id;
    update public.payment_accounts
       set status = 'connected', mp_nickname = left(p_nickname, 100), token_expires_at = p_expires_at,
           last_refreshed_at = now(), last_error = null, connected_by = auth.uid(), connected_at = now()
     where id = v_id;
  else
    if v_current.id is not null then
      update public.payment_accounts
         set status = 'disconnected', disconnected_at = now(), disconnected_by = auth.uid()
       where id = v_current.id;
      delete from public.payment_account_credentials where account_id = v_current.id;
    end if;
    insert into public.payment_accounts (tenant_id, mp_user_id, mp_nickname, site_id, live_mode,
                                         token_expires_at, last_refreshed_at, connected_by)
    values (p_tenant, p_mp_user_id, left(p_nickname, 100), p_site_id, p_live_mode, p_expires_at, now(), auth.uid())
    returning id into v_id;
  end if;

  insert into public.payment_account_credentials (account_id, tenant_id, access_token_enc, refresh_token_enc, key_version, expires_at)
  values (v_id, p_tenant, p_access_enc, p_refresh_enc, p_key_version, p_expires_at)
  on conflict (account_id) do update
    set access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
        key_version = excluded.key_version, expires_at = excluded.expires_at,
        refresh_lock_until = null, updated_at = now();

  perform app.set_payments_connected(p_tenant, true);
  perform app.write_audit(p_tenant, 'payments.connected', 'payment_account', v_id::text, null,
    jsonb_build_object('mp_user_id', p_mp_user_id, 'nickname', left(p_nickname, 100), 'live_mode', p_live_mode));
end $$;

create or replace function public.disconnect_mp(p_tenant uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app.can(p_tenant, 'payments.manage') then
    raise exception 'Solo la dueña puede desconectar Mercado Pago' using errcode = '42501';
  end if;
  update public.payment_accounts
     set status = 'disconnected', disconnected_at = now(), disconnected_by = auth.uid()
   where tenant_id = p_tenant and status <> 'disconnected'
  returning id into v_id;
  if v_id is null then
    raise exception 'No hay una cuenta de Mercado Pago conectada' using errcode = 'P0002';
  end if;
  delete from public.payment_account_credentials where account_id = v_id;
  perform app.set_payments_connected(p_tenant, false);
  perform app.write_audit(p_tenant, 'payments.disconnected', 'payment_account', v_id::text);
end $$;

-- Estado para la pantalla del panel (sin secretos).
create or replace function public.get_payments_status(p_tenant uuid)
returns table (
  status public.payment_account_status, mp_nickname text, live_mode boolean,
  connected_at timestamptz, connected_by_name text, token_expires_at timestamptz,
  last_error text, pending_online integer, online_booking_enabled boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_tenant, 'payments.manage') or app.has_permission(p_tenant, 'settings.manage')) then
    raise exception 'No tenés permiso para ver los pagos del estudio' using errcode = '42501';
  end if;
  return query
  select a.status, a.mp_nickname, a.live_mode, a.connected_at,
         (select coalesce(nullif(pr.full_name, ''), 'Alguien del equipo') from public.profiles pr where pr.id = a.connected_by),
         a.token_expires_at, a.last_error,
         (select count(*)::integer from public.appointments ap
           where ap.tenant_id = p_tenant and ap.source = 'online'
             and ap.status = 'pending_payment' and ap.hold_expires_at > now()),
         s.online_booking_enabled
  from public.tenant_settings s
  left join public.payment_accounts a on a.tenant_id = s.tenant_id and a.status <> 'disconnected'
  where s.tenant_id = p_tenant;
end $$;

revoke execute on function public.begin_mp_connection(uuid, text, text) from public, anon;
revoke execute on function public.claim_mp_connection(uuid, text) from public, anon;
revoke execute on function public.save_mp_connection(uuid, text, bigint, text, text, boolean, text, text, smallint, timestamptz) from public, anon;
revoke execute on function public.disconnect_mp(uuid) from public, anon;
revoke execute on function public.get_payments_status(uuid) from public, anon;
grant execute on function public.begin_mp_connection(uuid, text, text) to authenticated;
grant execute on function public.claim_mp_connection(uuid, text) to authenticated;
grant execute on function public.save_mp_connection(uuid, text, bigint, text, text, boolean, text, text, smallint, timestamptz) to authenticated;
grant execute on function public.disconnect_mp(uuid) to authenticated;
grant execute on function public.get_payments_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Servidor (service_role): leer y rotar tokens. Nadie más puede ejecutarlas.
-- ---------------------------------------------------------------------
create or replace function public.svc_mp_account_by_user(p_mp_user_id bigint, p_live_mode boolean)
returns table (account_id uuid, tenant_id uuid, status public.payment_account_status)
language sql stable security definer set search_path = '' as $$
  select a.id, a.tenant_id, a.status from public.payment_accounts a
  where a.mp_user_id = p_mp_user_id and a.live_mode = p_live_mode and a.status <> 'disconnected'
$$;

create or replace function public.svc_mp_account_of_tenant(p_tenant uuid)
returns table (account_id uuid, status public.payment_account_status)
language sql stable security definer set search_path = '' as $$
  select a.id, a.status from public.payment_accounts a
  where a.tenant_id = p_tenant and a.status <> 'disconnected'
$$;

create or replace function public.svc_mp_credentials(p_account uuid)
returns table (
  tenant_id uuid, mp_user_id bigint, live_mode boolean, status public.payment_account_status,
  access_token_enc text, refresh_token_enc text, key_version smallint, expires_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.tenant_id, a.mp_user_id, a.live_mode, a.status,
         c.access_token_enc, c.refresh_token_enc, c.key_version, c.expires_at
  from public.payment_accounts a
  join public.payment_account_credentials c on c.account_id = a.id
  where a.id = p_account and a.status = 'connected'
$$;

-- Una sola renovación a la vez por cuenta: si dos procesos renuevan juntos, el
-- segundo usaría un refresh_token ya rotado y rompería la conexión.
create or replace function public.svc_mp_begin_refresh(p_account uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.payment_account_credentials
     set refresh_lock_until = now() + interval '2 minutes'
   where account_id = p_account and (refresh_lock_until is null or refresh_lock_until < now());
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

create or replace function public.svc_mp_store_refresh(
  p_account uuid, p_access_enc text, p_refresh_enc text, p_key_version smallint, p_expires_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.payment_account_credentials
     set access_token_enc = p_access_enc, refresh_token_enc = p_refresh_enc, key_version = p_key_version,
         expires_at = p_expires_at, refresh_lock_until = null, updated_at = now()
   where account_id = p_account;
  if not found then
    raise exception 'La cuenta ya no está conectada' using errcode = 'P0002';
  end if;
  update public.payment_accounts
     set token_expires_at = p_expires_at, last_refreshed_at = now(), last_error = null
   where id = p_account and status = 'connected';
end $$;

-- Falla de renovación: revocada → "Hay que volver a conectar" (P7); temporal → se anota.
create or replace function public.svc_mp_refresh_failed(p_account uuid, p_revoked boolean, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  update public.payment_account_credentials set refresh_lock_until = null where account_id = p_account;
  update public.payment_accounts
     set last_error = left(p_error, 60),
         status = case when p_revoked then 'needs_reconnect'::public.payment_account_status else status end
   where id = p_account and status <> 'disconnected'
  returning tenant_id into v_tenant;
  if p_revoked and v_tenant is not null then
    perform app.set_payments_connected(v_tenant, false);
    perform app.write_audit(v_tenant, 'payments.needs_reconnect', 'payment_account', p_account::text,
                            null, jsonb_build_object('error', left(p_error, 60)));
  end if;
end $$;

-- Cuentas cuyo token vence antes de p_before (renovación diaria).
create or replace function public.svc_mp_accounts_to_refresh(p_before timestamptz)
returns table (account_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.id from public.payment_accounts a
  join public.payment_account_credentials c on c.account_id = a.id
  where a.status = 'connected' and c.expires_at < p_before
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.svc_mp_account_by_user(bigint, boolean)',
    'public.svc_mp_account_of_tenant(uuid)',
    'public.svc_mp_credentials(uuid)',
    'public.svc_mp_begin_refresh(uuid)',
    'public.svc_mp_store_refresh(uuid, text, text, smallint, timestamptz)',
    'public.svc_mp_refresh_failed(uuid, boolean, text)',
    'public.svc_mp_accounts_to_refresh(timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
