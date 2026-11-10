-- =====================================================================
-- Cleo · Migración 1100 · Marca de cada estudio (colores y logo)
-- Épica 03 (TEN-02, TEN-03)
--
-- tenant_settings.brand (jsonb) se valida en la base con las MISMAS reglas que
-- src/lib/brand.ts, para que no se puedan saltear llamando a la API directo:
--   { "primary": "#rrggbb", "accent": "#rrggbb", "background": "#rrggbb",
--     "logo_path": "<tenant_id>/logo-<uuid>.<png|jpg|webp>" }
--   * Texto del tema sobre el fondo >= 4.5:1 (normal, secundario y de error).
--   * Texto (blanco o negro) sobre el color principal >= 4.5:1.
--   * Principal y acento contra el fondo >= 3:1 (no son texto chico).
-- Logos: bucket público "brand" (PNG/JPEG/WebP, máx. 1 MB). Solo quien tiene
-- settings.manage escribe, y solo en la carpeta de su estudio. SVG no: puede
-- llevar scripts y el sitio comparte origen con el panel.
-- =====================================================================

-- Colores del tema por defecto (src/app/globals.css → src/lib/brand.ts THEME)
create or replace function app.theme_hex(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case p_name
    when 'background'       then '#faf6ee'
    when 'foreground'       then '#34251a'
    when 'muted_foreground' then '#68574a'
    when 'destructive'      then '#b63325'
  end
$$;

-- Luminancia relativa WCAG de un color #rrggbb
create or replace function app.hex_luminance(p_hex text) returns double precision
language plpgsql immutable set search_path = '' as $$
declare
  c   double precision[] := array[]::double precision[];
  v   double precision;
  i   int;
begin
  for i in 0..2 loop
    v := ('x' || substr(p_hex, 2 + i * 2, 2))::bit(8)::int / 255.0;
    c := c || case when v <= 0.04045 then v / 12.92 else ((v + 0.055) / 1.055) ^ 2.4 end;
  end loop;
  return 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3];
end $$;

create or replace function app.contrast_ratio(p_a text, p_b text) returns double precision
language sql immutable set search_path = '' as $$
  select (greatest(app.hex_luminance(p_a), app.hex_luminance(p_b)) + 0.05)
       / (least(app.hex_luminance(p_a), app.hex_luminance(p_b)) + 0.05)
$$;

-- Valida y normaliza (hex en minúsculas) la marca de un estudio
create or replace function app.validate_brand(p_tenant uuid, p_brand jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_out    jsonb := '{}'::jsonb;
  v_key    text;
  v_val    jsonb;
  v_bg     text;
  v_uuid   constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if p_brand is null or jsonb_typeof(p_brand) <> 'object' then
    raise exception 'La marca tiene que ser un objeto' using errcode = '22023';
  end if;

  for v_key, v_val in select * from jsonb_each(p_brand) loop
    if v_key in ('primary', 'accent', 'background') then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then
        raise exception 'El color "%" tiene que tener el formato #rrggbb', v_key using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_key, lower(v_val #>> '{}'));
    elsif v_key = 'logo_path' then
      if jsonb_typeof(v_val) <> 'string'
         or (v_val #>> '{}') !~ ('^' || p_tenant::text || '/logo-' || v_uuid || '\.(png|jpg|webp)$') then
        raise exception 'El logo no es válido para este estudio' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val #>> '{}');
    else
      raise exception 'Dato de marca desconocido: %', v_key using errcode = '22023';
    end if;
  end loop;

  v_bg := coalesce(v_out ->> 'background', app.theme_hex('background'));

  if v_out ? 'background' and least(
       app.contrast_ratio(app.theme_hex('foreground'), v_bg),
       app.contrast_ratio(app.theme_hex('muted_foreground'), v_bg),
       app.contrast_ratio(app.theme_hex('destructive'), v_bg)) < 4.5 then
    raise exception 'El fondo es demasiado oscuro o intenso para leer el texto. Elegí un tono más claro.'
      using errcode = '22023';
  end if;

  if v_out ? 'primary' then
    if greatest(app.contrast_ratio(v_out ->> 'primary', '#ffffff'),
                app.contrast_ratio(v_out ->> 'primary', '#000000')) < 4.5 then
      raise exception 'Con ese color principal no se lee bien el texto de los botones. Probá un tono más oscuro o más claro.'
        using errcode = '22023';
    end if;
    if app.contrast_ratio(v_out ->> 'primary', v_bg) < 3 then
      raise exception 'Los botones casi no se distinguen del fondo. Elegí un color principal con más diferencia.'
        using errcode = '22023';
    end if;
  end if;

  if v_out ? 'accent' and app.contrast_ratio(v_out ->> 'accent', v_bg) < 3 then
    raise exception 'El color de acento casi no se ve sobre el fondo. Elegí uno con más diferencia.'
      using errcode = '22023';
  end if;

  return v_out;
end $$;

create or replace function app.check_tenant_brand() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.brand is distinct from old.brand then
    new.brand := app.validate_brand(new.tenant_id, new.brand);
  end if;
  return new;
end $$;

create trigger tenant_settings_brand
  before insert or update on public.tenant_settings
  for each row execute function app.check_tenant_brand();

-- ---------------------------------------------------------------------
-- Logos en Storage
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ¿Puede la usuaria actual escribir este objeto del bucket "brand"?
-- Solo "<tenant_id>/logo-<uuid>.<ext>" de un estudio donde tiene settings.manage.
create or replace function app.can_write_brand_object(p_name text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
      then app.can(split_part(p_name, '/', 1)::uuid, 'settings.manage')
    else false
  end
$$;

-- Postgres (y Storage) exigen poder VER la fila para borrarla o reemplazarla. El
-- logo es público por su URL; listar el bucket por la API queda limitado a quien
-- administra la marca de ese estudio.
create policy brand_logo_select on storage.objects for select to authenticated
  using (bucket_id = 'brand' and app.can_write_brand_object(name));
create policy brand_logo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'brand' and app.can_write_brand_object(name));
create policy brand_logo_update on storage.objects for update to authenticated
  using (bucket_id = 'brand' and app.can_write_brand_object(name))
  with check (bucket_id = 'brand' and app.can_write_brand_object(name));
create policy brand_logo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'brand' and app.can_write_brand_object(name));
