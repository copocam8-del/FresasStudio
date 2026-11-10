-- =====================================================================
-- Fresas SaaS · Migración 0400 · Row Level Security y privilegios
-- Épica 01 (ARC-06) · Épica 02 (AUTH-04)
--
-- Dos capas:
--   1. GRANT por columna: qué puede tocar cada rol de PostgreSQL.
--   2. RLS: qué FILAS ve y modifica cada usuaria (por estudio y permiso).
-- Los cambios sensibles (crear estudios, invitar, cambiar estado) solo
-- se hacen con funciones del servidor (migración 0500).
--
-- CONVENCIÓN PARA TABLAS NUEVAS: enable + force RLS, revocar a anon,
-- políticas con app.is_member / app.has_permission / app.can.
-- El test "meta" falla si alguna tabla de public queda sin RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

grant select                                   on public.permissions            to authenticated;
grant select                                   on public.tenants                to authenticated;
grant update (name, timezone, currency)        on public.tenants                to authenticated;
grant select                                   on public.tenant_settings        to authenticated;
grant update (display_name, description, contact, brand, deposit_percent,
              cancellation_window_hours, booking_hold_minutes,
              no_show_forfeits_deposit, policy_text)
                                               on public.tenant_settings        to authenticated;
grant select                                   on public.tenant_policy_versions to authenticated;
grant select                                   on public.profiles               to authenticated;
grant update (full_name, phone)                on public.profiles               to authenticated;
grant select                                   on public.platform_admins        to authenticated;
grant select, delete                           on public.roles                  to authenticated;
grant insert (tenant_id, key, name)            on public.roles                  to authenticated;
grant update (name)                            on public.roles                  to authenticated;
grant select, insert, delete                   on public.role_permissions       to authenticated;
grant select                                   on public.memberships            to authenticated;
grant update (role_id, status)                 on public.memberships            to authenticated;
grant select                                   on public.invitations            to authenticated;
grant select                                   on public.audit_logs             to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------
-- Activar RLS (force: aplica también al dueño de la tabla)
-- ---------------------------------------------------------------------

alter table public.tenants                enable row level security;
alter table public.tenant_settings        enable row level security;
alter table public.tenant_policy_versions enable row level security;
alter table public.profiles               enable row level security;
alter table public.platform_admins        enable row level security;
alter table public.permissions            enable row level security;
alter table public.roles                  enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.memberships            enable row level security;
alter table public.invitations            enable row level security;
alter table public.audit_logs             enable row level security;

alter table public.tenants                force row level security;
alter table public.tenant_settings        force row level security;
alter table public.tenant_policy_versions force row level security;
alter table public.profiles               force row level security;
alter table public.platform_admins        force row level security;
alter table public.permissions            force row level security;
alter table public.roles                  force row level security;
alter table public.role_permissions       force row level security;
alter table public.memberships            force row level security;
alter table public.invitations            force row level security;
alter table public.audit_logs             force row level security;

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------

-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (app.is_member(id) or app.is_platform_admin());
create policy tenants_update on public.tenants for update to authenticated
  using (app.is_platform_admin() or app.can(id, 'settings.manage'))
  with check (app.is_platform_admin() or app.can(id, 'settings.manage'));

-- tenant_settings
create policy settings_select on public.tenant_settings for select to authenticated
  using (app.is_member(tenant_id) or app.is_platform_admin());
create policy settings_update on public.tenant_settings for update to authenticated
  using (app.is_platform_admin() or app.can(tenant_id, 'settings.manage'))
  with check (app.is_platform_admin() or app.can(tenant_id, 'settings.manage'));

-- tenant_policy_versions
create policy policy_versions_select on public.tenant_policy_versions for select to authenticated
  using (app.is_member(tenant_id) or app.is_platform_admin());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.can_see_profile(id) or app.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- platform_admins
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- permissions (catálogo público para usuarias logueadas)
create policy permissions_select on public.permissions for select to authenticated
  using (true);

-- roles: los de sistema los ve cualquiera; los propios, solo su estudio
create policy roles_select on public.roles for select to authenticated
  using (tenant_id is null or app.is_member(tenant_id) or app.is_platform_admin());
create policy roles_insert on public.roles for insert to authenticated
  with check (tenant_id is not null and app.can(tenant_id, 'team.manage'));
create policy roles_update on public.roles for update to authenticated
  using (tenant_id is not null and app.can(tenant_id, 'team.manage'))
  with check (tenant_id is not null and app.can(tenant_id, 'team.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (tenant_id is not null and app.can(tenant_id, 'team.manage'));

-- role_permissions
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (app.can_manage_role(role_id));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (app.can_manage_role(role_id));

-- memberships: cada una ve la suya; con team.read se ve todo el equipo
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.has_permission(tenant_id, 'team.read') or app.is_platform_admin());
create policy memberships_update on public.memberships for update to authenticated
  using (app.is_platform_admin() or app.can(tenant_id, 'team.manage'))
  with check (app.is_platform_admin() or app.can(tenant_id, 'team.manage'));

-- invitations: solo lectura; se crean y aceptan con funciones del servidor
create policy invitations_select on public.invitations for select to authenticated
  using (app.has_permission(tenant_id, 'team.manage') or app.is_platform_admin());

-- audit_logs
create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((tenant_id is not null and app.has_permission(tenant_id, 'audit.read')) or app.is_platform_admin());
