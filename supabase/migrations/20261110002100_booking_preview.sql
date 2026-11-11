-- =====================================================================
-- Cleo · Migración 2100 · Vista previa de la reserva (resumen antes de confirmar)
--
-- preview_booking: con las MISMAS reglas que app.create_appointment (servicio
-- reservable, horario libre, B4 "cualquiera" = menos turnos ese día, duración y
-- precio propios, seña), devuelve quién atendería y cuánto sale, para mostrarlo en el
-- resumen ANTES de confirmar. Solo lectura: no aparta nada. Si entre la vista previa
-- y la confirmación alguien toma el horario, create_online_booking lo resuelve igual.
-- =====================================================================

create or replace function public.preview_booking(p_slug text, p_service uuid, p_professional uuid, p_starts_at timestamptz)
returns table (professional_id uuid, professional_name text, duration_minutes integer, ends_at timestamptz,
               price_minor bigint, price_is_from boolean, deposit_minor bigint, currency char(3))
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_tenant  uuid := app.online_booking_tenant(p_slug);
  v_tz      text;
  v_service public.services%rowtype;
  v_pct     smallint;
  v_cur     char(3);
  v_cand    record;
begin
  if v_tenant is null or p_starts_at is null then
    return;
  end if;
  v_service := app.bookable_service(v_tenant, p_service);
  if v_service.id is null then
    return;
  end if;
  select t.timezone, t.currency, coalesce(v_service.deposit_percent, s.deposit_percent)
    into v_tz, v_cur, v_pct
  from public.tenants t join public.tenant_settings s on s.tenant_id = t.id where t.id = v_tenant;

  for v_cand in
    select e.professional_id, e.display_name, e.duration_minutes, e.price_minor
    from app.eligible_professionals(v_tenant, p_service, p_professional) e
    order by (select count(*) from public.appointments a
              where a.professional_id = e.professional_id
                and (a.status = 'confirmed' or (a.status = 'pending_payment' and a.hold_expires_at > now()))
                and (a.starts_at at time zone v_tz)::date = (p_starts_at at time zone v_tz)::date),
             e.sort_order, e.display_name
  loop
    if exists (select 1 from app.free_slots(v_tenant, p_service, v_cand.professional_id, p_starts_at,
                                            p_starts_at + interval '1 minute', true) f
               where f.starts_at = p_starts_at) then
      return query select v_cand.professional_id, v_cand.display_name, v_cand.duration_minutes,
                          p_starts_at + make_interval(mins => v_cand.duration_minutes),
                          v_cand.price_minor, v_service.price_is_from,
                          (ceil(v_cand.price_minor * v_pct / 10000.0) * 100)::bigint, v_cur;
      return;
    end if;
  end loop;
end $$;
revoke execute on function public.preview_booking(text, uuid, uuid, timestamptz) from public;
grant execute on function public.preview_booking(text, uuid, uuid, timestamptz) to anon, authenticated;
