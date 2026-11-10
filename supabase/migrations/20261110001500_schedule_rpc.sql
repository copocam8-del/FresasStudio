-- =====================================================================
-- Cleo · Migración 1500 · Guardar horarios y crear bloqueos (para el panel)
--
-- Ambas funciones son SECURITY INVOKER: corren con los permisos de quien llama,
-- así que la RLS y los triggers de 1300 siguen decidiendo (settings.manage para el
-- estudio, agenda.manage para profesionales y bloqueos).
--
--   * set_working_hours: reemplaza TODAS las franjas de la semana de un horario
--     (estudio o profesional) en una sola transacción: si una franja es inválida,
--     no queda nada a medias.
--   * create_schedule_block: recibe fechas/horas LOCALES del estudio y las
--     convierte con su zona horaria (la app no hace cuentas de husos horarios).
-- =====================================================================

create or replace function public.set_working_hours(p_tenant uuid, p_professional uuid, p_ranges jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_range jsonb;
begin
  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' then
    raise exception 'Las franjas tienen que ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ranges) > 70 then
    raise exception 'Demasiadas franjas' using errcode = '22023';
  end if;
  if not app.can_edit_hours(p_tenant, p_professional) then
    raise exception 'No tenés permiso para cambiar este horario' using errcode = '42501';
  end if;

  delete from public.working_hours
  where tenant_id = p_tenant and professional_id is not distinct from p_professional;

  for v_range in select * from jsonb_array_elements(p_ranges) loop
    insert into public.working_hours (tenant_id, professional_id, weekday, start_minute, end_minute)
    values (p_tenant, p_professional,
            (v_range ->> 'weekday')::smallint,
            (v_range ->> 'start')::smallint,
            (v_range ->> 'end')::smallint);
  end loop;
end $$;
revoke execute on function public.set_working_hours(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_working_hours(uuid, uuid, jsonb) to authenticated;

create or replace function public.create_schedule_block(
  p_tenant uuid,
  p_professional uuid,
  p_kind public.schedule_block_kind,
  p_from_local timestamp,
  p_to_local timestamp,
  p_all_day boolean,
  p_note text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_tz  text;
  v_id  uuid;
  v_to  timestamp := p_to_local;
begin
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant;
  if v_tz is null then
    raise exception 'Estudio inexistente' using errcode = 'P0002';
  end if;
  if p_from_local is null or p_to_local is null then
    raise exception 'Indicá desde y hasta cuándo' using errcode = '22023';
  end if;
  -- Todo el día: "hasta" es inclusivo (del 19 al 20 = jueves y viernes completos)
  if p_all_day then
    v_to := p_to_local::date + 1;
  end if;
  if v_to <= p_from_local then
    raise exception 'El bloqueo tiene que terminar después de empezar' using errcode = '22023';
  end if;

  insert into public.schedule_blocks (tenant_id, professional_id, kind, period, all_day, note)
  values (p_tenant, p_professional, p_kind,
          tstzrange(p_from_local at time zone v_tz, v_to at time zone v_tz, '[)'),
          coalesce(p_all_day, false), p_note)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_schedule_block(uuid, uuid, public.schedule_block_kind, timestamp, timestamp, boolean, text) from public, anon;
grant execute on function public.create_schedule_block(uuid, uuid, public.schedule_block_kind, timestamp, timestamp, boolean, text) to authenticated;
