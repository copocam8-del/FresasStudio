-- =====================================================================
-- Cleo · Migración 0800 · Dominios propios de los estudios (preparación)
-- Épica 01 (ARC-05) · Épica 03 (TEN-07)
--
-- Cada estudio vive en {slug}.cleo.com.ar. Esta tabla deja preparado el uso
-- de dominios propios (p. ej. turnos.fresasstudio.com):
--   * Solo Cleo Admin da de alta y cambia el estado de un dominio (RPC).
--   * El estudio con settings.manage ve los suyos (para el panel, más adelante).
--   * Un dominio resuelve al estudio solo si está "verified" y el estudio está
--     operativo. La verificación DNS y el alta en Vercel quedan para otro sprint.
-- =====================================================================

create type public.domain_status as enum ('pending', 'verified', 'disabled');

create table public.tenant_domains (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  domain              text not null unique,
  status              public.domain_status not null default 'pending',
  is_primary          boolean not null default false,
  -- Valor para el registro TXT de verificación (público, no es un secreto)
  verification_token  text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  verified_at         timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tenant_domains_format check (
    domain = lower(domain)
    and char_length(domain) <= 253
    and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  -- Los subdominios de la plataforma ya se resuelven por slug; localhost es solo local.
  constraint tenant_domains_not_platform check (
    domain !~ '(^|\.)cleo\.com\.ar$' and domain !~ '(^|\.)localhost$'),
  constraint tenant_domains_verified_at check ((status = 'verified') = (verified_at is not null))
);
comment on table public.tenant_domains is
  'Dominios propios de cada estudio. Solo resuelven si están verificados y el estudio está operativo.';

create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id);
create unique index tenant_domains_one_primary on public.tenant_domains (tenant_id) where is_primary;

create trigger tenant_domains_updated_at
  before update on public.tenant_domains
  for each row execute function app.set_updated_at();

create trigger audit_tenant_domains
  after insert or update or delete on public.tenant_domains
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Privilegios y RLS: lectura para el estudio (settings.manage) y Cleo Admin;
-- ninguna escritura directa (solo por las RPC de abajo).
-- ---------------------------------------------------------------------
revoke all on public.tenant_domains from anon, authenticated;
grant select on public.tenant_domains to authenticated;
grant all on public.tenant_domains to service_role;

alter table public.tenant_domains enable row level security;
alter table public.tenant_domains force row level security;

create policy tenant_domains_select on public.tenant_domains for select to authenticated
  using (app.has_permission(tenant_id, 'settings.manage') or app.is_platform_admin());

-- ---------------------------------------------------------------------
-- Resolver un dominio propio → slug del estudio (lo usa el sitio público)
-- ---------------------------------------------------------------------
create or replace function public.resolve_custom_domain(p_domain text)
returns text
language sql stable security definer set search_path = '' as $$
  select t.slug
  from public.tenant_domains d
  join public.tenants t on t.id = d.tenant_id
  where d.domain = lower(rtrim(btrim(p_domain), '.'))
    and d.status = 'verified'
    and t.status in ('trial', 'active', 'past_due')
$$;
revoke execute on function public.resolve_custom_domain(text) from public;
grant execute on function public.resolve_custom_domain(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Cleo Admin: alta y cambio de estado
-- ---------------------------------------------------------------------
create or replace function public.admin_add_tenant_domain(p_tenant uuid, p_domain text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Solo Cleo Admin puede agregar dominios' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'Estudio inexistente' using errcode = 'P0002';
  end if;

  insert into public.tenant_domains (tenant_id, domain, created_by)
  values (p_tenant, lower(rtrim(btrim(p_domain), '.')), auth.uid())
  returning id into v_id;

  return v_id;
end $$;
revoke execute on function public.admin_add_tenant_domain(uuid, text) from public, anon;
grant execute on function public.admin_add_tenant_domain(uuid, text) to authenticated;

create or replace function public.admin_set_domain_status(p_domain_id uuid, p_status public.domain_status)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Solo Cleo Admin puede cambiar el estado de un dominio' using errcode = '42501';
  end if;

  update public.tenant_domains
     set status = p_status,
         verified_at = case
           when p_status = 'verified' then coalesce(verified_at, now())
           else null
         end
   where id = p_domain_id;

  if not found then
    raise exception 'Dominio inexistente' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.admin_set_domain_status(uuid, public.domain_status) from public, anon;
grant execute on function public.admin_set_domain_status(uuid, public.domain_status) to authenticated;
