-- =====================================================================
-- Cleo · Migración 2600 · Marca propia opcional y tema oscuro
-- docs/diseno-plan.md (D1, D2, D4)
--
--   * tenant_settings.brand.enabled (boolean): por defecto todos los estudios se ven
--     con la marca Cleo. Solo con enabled = true se muestran el nombre, el logo y los
--     colores propios del estudio (con el logo de Cleo chiquito).
--   * El tema de Cleo pasa a ser oscuro: los colores propios se validan contra el texto
--     claro (el fondo propio tiene que ser oscuro). Ningún estudio tenía colores
--     guardados al aplicar esta migración, así que no se invalida nada.
-- =====================================================================

-- Colores del tema (src/app/globals.css → src/lib/brand.ts THEME)
create or replace function app.theme_hex(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case p_name
    when 'background'       then '#0e0b0c'
    when 'foreground'       then '#f7efe8'
    when 'muted_foreground' then '#cfc2b9'
    when 'destructive'      then '#f2948c'
  end
$$;

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
    elsif v_key = 'enabled' then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'La marca propia se activa con sí o no' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_val);
    else
      raise exception 'Dato de marca desconocido: %', v_key using errcode = '22023';
    end if;
  end loop;

  v_bg := coalesce(v_out ->> 'background', app.theme_hex('background'));

  if v_out ? 'background' and least(
       app.contrast_ratio(app.theme_hex('foreground'), v_bg),
       app.contrast_ratio(app.theme_hex('muted_foreground'), v_bg),
       app.contrast_ratio(app.theme_hex('destructive'), v_bg)) < 4.5 then
    raise exception 'El fondo es demasiado claro o intenso para leer el texto. Elegí un tono más oscuro.'
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
