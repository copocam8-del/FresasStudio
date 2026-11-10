-- =====================================================================
-- Cleo · Migración 1200 · Catálogo: categorías, servicios y profesionales
-- Épica 04 (SERV-01, SERV-02, SERV-03, parte de SERV-06)
--
--   * Integridad entre estudios con CLAVES COMPUESTAS (tenant_id, id): la base
--     hace imposible mezclar un servicio, categoría, profesional o membresía de
--     otro estudio, aunque se intente por la API.
--   * Dinero en enteros (price_minor, centavos). Duraciones en minutos, múltiplos de 5.
--   * Servicios y profesionales NO se borran: se archivan (los turnos los van a
--     referenciar y guardarán una foto de lo acordado).
--   * Seña propia opcional por servicio (N1), "precio desde" (N3), tiempo extra
--     solo después del turno (N9).
--   * Fotos en el bucket público "catalog" (PNG/JPEG/WebP, 1 MB), solo en la
--     carpeta del estudio y con services.manage.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- Para las claves compuestas hacia memberships
alter table public.memberships add constraint memberships_tenant_id_id_key unique (tenant_id, id);

-- ---------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------
create table public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint service_categories_tenant_id_id_key unique (tenant_id, id),
  constraint service_categories_name check (char_length(name) between 2 and 60),
  constraint service_categories_position check (position between 0 and 100000)
);
-- lower() con ICU: convierte igual "Ñ"/"ñ" o "É"/"é" sin importar la configuración regional
-- del servidor (en locale C, lower() solo convierte letras sin acento).
create unique index service_categories_tenant_name
  on public.service_categories (tenant_id, lower(name collate "und-x-icu"));

-- ---------------------------------------------------------------------
-- Servicios
-- ---------------------------------------------------------------------
create table public.services (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete restrict,
  category_id           uuid,
  name                  text not null,
  description           text,
  duration_minutes      integer not null,
  buffer_after_minutes  integer not null default 0,
  price_minor           bigint not null,
  price_is_from         boolean not null default false,
  deposit_percent       smallint,           -- null = usa el del estudio
  photo_path            text,
  is_active             boolean not null default true,
  show_online           boolean not null default true,
  position              integer not null default 0,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint services_tenant_id_id_key unique (tenant_id, id),
  constraint services_category_fk foreign key (tenant_id, category_id)
    references public.service_categories (tenant_id, id) on delete restrict,
  constraint services_name check (char_length(name) between 2 and 80),
  constraint services_description check (description is null or char_length(description) <= 1000),
  constraint services_duration check (duration_minutes between 5 and 600 and duration_minutes % 5 = 0),
  constraint services_buffer check (buffer_after_minutes between 0 and 240 and buffer_after_minutes % 5 = 0),
  constraint services_price check (price_minor between 0 and 10000000000),
  constraint services_deposit check (deposit_percent is null or deposit_percent between 0 and 100),
  constraint services_position check (position between 0 and 100000),
  constraint services_photo check (photo_path is null or photo_path ~ (
    '^' || tenant_id::text || '/services/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'))
);
create index services_tenant_category on public.services (tenant_id, category_id, position);

-- ---------------------------------------------------------------------
-- Profesionales (con cuenta en el panel o sin cuenta)
-- ---------------------------------------------------------------------
create table public.professionals (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id) on delete restrict,
  membership_id           uuid,               -- null: no usa el panel
  display_name            text not null,
  bio                     text,
  photo_path              text,
  is_active               boolean not null default true,
  show_online             boolean not null default true,
  accepts_online_booking  boolean not null default true,
  position                integer not null default 0,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint professionals_tenant_id_id_key unique (tenant_id, id),
  constraint professionals_membership_fk foreign key (tenant_id, membership_id)
    references public.memberships (tenant_id, id) on delete restrict,
  constraint professionals_one_per_membership unique (membership_id),
  constraint professionals_name check (char_length(display_name) between 2 and 60),
  constraint professionals_bio check (bio is null or char_length(bio) <= 500),
  constraint professionals_position check (position between 0 and 100000),
  constraint professionals_photo check (photo_path is null or photo_path ~ (
    '^' || tenant_id::text || '/professionals/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'))
);

-- ---------------------------------------------------------------------
-- Qué servicios hace cada profesional (y si cobra o tarda distinto)
-- ---------------------------------------------------------------------
create table public.professional_services (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants (id) on delete restrict,
  professional_id            uuid not null,
  service_id                 uuid not null,
  price_minor_override       bigint,
  duration_minutes_override  integer,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint professional_services_unique unique (professional_id, service_id),
  constraint professional_services_professional_fk foreign key (tenant_id, professional_id)
    references public.professionals (tenant_id, id) on delete restrict,
  constraint professional_services_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete restrict,
  constraint professional_services_price check (price_minor_override is null or price_minor_override between 0 and 10000000000),
  constraint professional_services_duration check (duration_minutes_override is null
    or (duration_minutes_override between 5 and 600 and duration_minutes_override % 5 = 0))
);
create index professional_services_service on public.professional_services (tenant_id, service_id);

-- ---------------------------------------------------------------------
-- Normalización (trigger SECURITY INVOKER)
-- ---------------------------------------------------------------------
create or replace function app.normalize_catalog_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  case tg_table_name
    when 'service_categories' then
      new.name := btrim(new.name);
    when 'services' then
      new.name := btrim(new.name);
      new.description := nullif(btrim(new.description), '');
    when 'professionals' then
      new.display_name := btrim(new.display_name);
      new.bio := nullif(btrim(new.bio), '');
    else
      null;
  end case;
  if tg_op = 'UPDATE' and new.tenant_id <> old.tenant_id then
    raise exception 'No se puede mover un registro a otro estudio' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger service_categories_normalize before insert or update on public.service_categories
  for each row execute function app.normalize_catalog_row();
create trigger services_normalize before insert or update on public.services
  for each row execute function app.normalize_catalog_row();
create trigger professionals_normalize before insert or update on public.professionals
  for each row execute function app.normalize_catalog_row();

create trigger service_categories_updated_at before update on public.service_categories
  for each row execute function app.set_updated_at();
create trigger services_updated_at before update on public.services
  for each row execute function app.set_updated_at();
create trigger professionals_updated_at before update on public.professionals
  for each row execute function app.set_updated_at();
create trigger professional_services_updated_at before update on public.professional_services
  for each row execute function app.set_updated_at();

-- Auditoría (con valores anteriores y nuevos: precios, duraciones, señas)
create trigger audit_service_categories after insert or update or delete on public.service_categories
  for each row execute function app.audit_row();
create trigger audit_services after insert or update or delete on public.services
  for each row execute function app.audit_row();
create trigger audit_professionals after insert or update or delete on public.professionals
  for each row execute function app.audit_row();
create trigger audit_professional_services after insert or update or delete on public.professional_services
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Privilegios y RLS
-- Ver: cualquier persona del equipo. Escribir: services.manage (y estudio operativo).
-- Borrar: solo la asignación profesional↔servicio. Cleo Admin: sin acceso.
-- ---------------------------------------------------------------------
revoke all on public.service_categories, public.services, public.professionals, public.professional_services
  from anon, authenticated;

grant select on public.service_categories, public.services, public.professionals, public.professional_services
  to authenticated;
grant insert (tenant_id, name, position, is_active) on public.service_categories to authenticated;
grant update (name, position, is_active)            on public.service_categories to authenticated;
grant insert (tenant_id, category_id, name, description, duration_minutes, buffer_after_minutes, price_minor,
              price_is_from, deposit_percent, photo_path, is_active, show_online, position)
  on public.services to authenticated;
grant update (category_id, name, description, duration_minutes, buffer_after_minutes, price_minor,
              price_is_from, deposit_percent, photo_path, is_active, show_online, position, archived_at)
  on public.services to authenticated;
grant insert (tenant_id, membership_id, display_name, bio, photo_path, is_active, show_online,
              accepts_online_booking, position)
  on public.professionals to authenticated;
grant update (membership_id, display_name, bio, photo_path, is_active, show_online,
              accepts_online_booking, position, archived_at)
  on public.professionals to authenticated;
grant insert (tenant_id, professional_id, service_id, price_minor_override, duration_minutes_override)
  on public.professional_services to authenticated;
grant update (price_minor_override, duration_minutes_override) on public.professional_services to authenticated;
grant delete on public.professional_services to authenticated;
grant all on public.service_categories, public.services, public.professionals, public.professional_services
  to service_role;

alter table public.service_categories    enable row level security;
alter table public.services              enable row level security;
alter table public.professionals         enable row level security;
alter table public.professional_services enable row level security;
alter table public.service_categories    force row level security;
alter table public.services              force row level security;
alter table public.professionals         force row level security;
alter table public.professional_services force row level security;

create policy service_categories_select on public.service_categories for select to authenticated
  using (app.is_member(tenant_id));
create policy service_categories_insert on public.service_categories for insert to authenticated
  with check (app.can(tenant_id, 'services.manage'));
create policy service_categories_update on public.service_categories for update to authenticated
  using (app.can(tenant_id, 'services.manage')) with check (app.can(tenant_id, 'services.manage'));

create policy services_select on public.services for select to authenticated
  using (app.is_member(tenant_id));
create policy services_insert on public.services for insert to authenticated
  with check (app.can(tenant_id, 'services.manage'));
create policy services_update on public.services for update to authenticated
  using (app.can(tenant_id, 'services.manage')) with check (app.can(tenant_id, 'services.manage'));

create policy professionals_select on public.professionals for select to authenticated
  using (app.is_member(tenant_id));
create policy professionals_insert on public.professionals for insert to authenticated
  with check (app.can(tenant_id, 'services.manage'));
create policy professionals_update on public.professionals for update to authenticated
  using (app.can(tenant_id, 'services.manage')) with check (app.can(tenant_id, 'services.manage'));

create policy professional_services_select on public.professional_services for select to authenticated
  using (app.is_member(tenant_id));
create policy professional_services_insert on public.professional_services for insert to authenticated
  with check (app.can(tenant_id, 'services.manage'));
create policy professional_services_update on public.professional_services for update to authenticated
  using (app.can(tenant_id, 'services.manage')) with check (app.can(tenant_id, 'services.manage'));
create policy professional_services_delete on public.professional_services for delete to authenticated
  using (app.can(tenant_id, 'services.manage'));

-- ---------------------------------------------------------------------
-- Fotos: bucket público "catalog"
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog', 'catalog', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- "<tenant_id>/(services|professionals)/<uuid>.<ext>" de un estudio con services.manage
create or replace function app.can_write_catalog_object(p_name text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(services|professionals)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      then app.can(split_part(p_name, '/', 1)::uuid, 'services.manage')
    else false
  end
$$;

create policy catalog_photo_select on storage.objects for select to authenticated
  using (bucket_id = 'catalog' and app.can_write_catalog_object(name));
create policy catalog_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog' and app.can_write_catalog_object(name));
create policy catalog_photo_update on storage.objects for update to authenticated
  using (bucket_id = 'catalog' and app.can_write_catalog_object(name))
  with check (bucket_id = 'catalog' and app.can_write_catalog_object(name));
create policy catalog_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'catalog' and app.can_write_catalog_object(name));
