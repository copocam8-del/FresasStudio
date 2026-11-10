-- =====================================================================
-- Fresas SaaS · Migración 0300 · Auditoría
-- Épica 01 (ARC-10)
--
-- audit_logs es de SOLO AGREGADO: ni la dueña, ni Fresas Admin, ni el
-- usuario postgres pueden editar o borrar filas (lo impide un trigger).
-- Lo mismo vale para el historial de políticas.
-- =====================================================================

create table public.audit_logs (
  id             bigint generated always as identity primary key,
  tenant_id      uuid references public.tenants (id) on delete restrict,  -- NULL = evento de plataforma
  actor_user_id  uuid,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  old_data       jsonb,
  new_data       jsonb,
  created_at     timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);

create or replace function app.prevent_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es de solo agregado: no se puede modificar ni borrar', tg_table_name
    using errcode = '42501';
end $$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function app.prevent_mutation();
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function app.prevent_mutation();

create trigger tenant_policy_versions_append_only
  before update or delete on public.tenant_policy_versions
  for each row execute function app.prevent_mutation();
create trigger tenant_policy_versions_no_truncate
  before truncate on public.tenant_policy_versions
  for each statement execute function app.prevent_mutation();

-- Registro de eventos de negocio (lo usan las funciones del servidor)
create or replace function app.write_audit(
  p_tenant uuid, p_action text, p_entity_type text, p_entity_id text,
  p_old jsonb default null, p_new jsonb default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (p_tenant, auth.uid(), p_action, p_entity_type, p_entity_id, p_old, p_new)
$$;
revoke execute on function app.write_audit(uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- Trigger genérico de auditoría de filas
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_row     jsonb;
  v_tenant  uuid;
  v_id      text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old) - 'token_hash'; end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new) - 'token_hash'; end if;
  v_row := coalesce(v_new, v_old);

  v_tenant := case tg_table_name
    when 'tenants'          then (v_row ->> 'id')::uuid
    when 'role_permissions' then app.role_tenant((v_row ->> 'role_id')::uuid)
    else (v_row ->> 'tenant_id')::uuid
  end;

  v_id := case tg_table_name
    when 'tenant_settings'  then v_row ->> 'tenant_id'
    when 'platform_admins'  then v_row ->> 'user_id'
    when 'role_permissions' then (v_row ->> 'role_id') || ':' || (v_row ->> 'permission_code')
    else v_row ->> 'id'
  end;

  insert into public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, old_data, new_data)
  values (v_tenant, auth.uid(), lower(tg_op), tg_table_name, v_id, v_old, v_new);

  return null;
end $$;

create trigger audit_tenants          after insert or update or delete on public.tenants          for each row execute function app.audit_row();
create trigger audit_tenant_settings  after insert or update or delete on public.tenant_settings  for each row execute function app.audit_row();
create trigger audit_platform_admins  after insert or update or delete on public.platform_admins  for each row execute function app.audit_row();
create trigger audit_roles            after insert or update or delete on public.roles            for each row execute function app.audit_row();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions for each row execute function app.audit_row();
create trigger audit_memberships      after insert or update or delete on public.memberships      for each row execute function app.audit_row();
create trigger audit_invitations      after insert or update or delete on public.invitations      for each row execute function app.audit_row();
