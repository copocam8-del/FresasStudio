-- =====================================================================
-- Cleo · Migración 1400 · Catálogo público del estudio
-- Épica 04 · sitio público
--
-- get_public_catalog(slug): lo que el sitio del estudio muestra de servicios y
-- profesionales. Solo lo activo y visible, de estudios operativos.
--   * Precio: el menor entre lo que cobran las profesionales visibles que hacen el
--     servicio (o el del servicio si nadie lo tiene asignado). "desde" si el
--     servicio es "precio desde" (N3) o si las profesionales cobran distinto (N2).
--   * Devuelve los ids de servicios y profesionales (el sprint de reservas los usa
--     para elegir); nunca membresías, cuentas, tiempo extra, seña ni archivados.
-- =====================================================================

create or replace function public.get_public_catalog(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (
    select id, currency from public.tenants
    where slug = lower(btrim(p_slug)) and status in ('trial', 'active', 'past_due')
  ),
  pros as (
    select p.* from public.professionals p join t on t.id = p.tenant_id
    where p.is_active and p.show_online and p.archived_at is null
  ),
  cats as (
    select c.* from public.service_categories c join t on t.id = c.tenant_id
    where c.is_active
  ),
  srv as (
    select s.* from public.services s join t on t.id = s.tenant_id
    where s.is_active and s.show_online and s.archived_at is null
      and (s.category_id is null or s.category_id in (select id from cats))
  ),
  offer as (  -- qué profesional visible hace qué servicio visible, con su precio efectivo
    select ps.service_id, ps.professional_id,
           coalesce(ps.price_minor_override, s.price_minor) as price_minor
    from public.professional_services ps
    join srv s on s.id = ps.service_id
    join pros p on p.id = ps.professional_id
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'currency', (select currency from t),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.position, c.name)
      from cats c where exists (select 1 from srv s where s.category_id = c.id)), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'category_id', s.category_id,
               'name', s.name,
               'description', s.description,
               'duration_minutes', s.duration_minutes,
               'price_minor', coalesce((select min(o.price_minor) from offer o where o.service_id = s.id), s.price_minor),
               'price_is_from', s.price_is_from
                 or (select count(distinct o.price_minor) > 1 from offer o where o.service_id = s.id),
               'photo_path', s.photo_path,
               'professional_ids', coalesce((select jsonb_agg(o.professional_id) from offer o where o.service_id = s.id), '[]'::jsonb)
             ) order by s.position, s.name)
      from srv s), '[]'::jsonb),
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'display_name', p.display_name,
               'bio', p.bio,
               'photo_path', p.photo_path,
               'service_ids', coalesce((select jsonb_agg(o.service_id) from offer o where o.professional_id = p.id), '[]'::jsonb)
             ) order by p.position, p.display_name)
      from pros p), '[]'::jsonb)
  ) end
$$;
revoke execute on function public.get_public_catalog(text) from public;
grant execute on function public.get_public_catalog(text) to anon, authenticated;
