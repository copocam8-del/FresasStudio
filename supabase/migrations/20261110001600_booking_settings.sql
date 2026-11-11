-- =====================================================================
-- Cleo · Migración 1600 · Ajustes de negocio y configuración de reservas
-- Sprint 4 (decisiones B3, B9, B10, tiempo para pagar y ventana de 24 h)
--
--   * Ventana de cancelación/reprogramación: 24 h por defecto (antes 48 h).
--     Fresas Studio pasa a 24 h (crea una versión nueva de su política).
--   * Seña siempre mayor a 0% (1–100%) en el estudio y en cada servicio: toda
--     reserva necesita la seña pagada para quedar confirmada.
--   * Tiempo para pagar (booking_hold_minutes): 2 h por defecto, de 5 min a 24 h.
--   * Configuración de reservas online y "pagos conectados" (solo el servidor).
-- No modifica migraciones anteriores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ventana de 24 h
-- ---------------------------------------------------------------------
alter table public.tenant_settings alter column cancellation_window_hours set default 24;

update public.tenant_settings s
   set cancellation_window_hours = 24
  from public.tenants t
 where t.id = s.tenant_id and t.slug = 'fresas' and s.cancellation_window_hours <> 24;

-- ---------------------------------------------------------------------
-- 2. Seña mayor a 0%
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.tenant_settings where deposit_percent = 0)
     or exists (select 1 from public.services where deposit_percent = 0) then
    raise exception 'Hay estudios o servicios con seña 0%%: corregirlos antes de aplicar esta migración';
  end if;
end $$;

alter table public.tenant_settings drop constraint settings_deposit_range;
alter table public.tenant_settings add constraint settings_deposit_range check (deposit_percent between 1 and 100);
alter table public.services drop constraint services_deposit;
alter table public.services add constraint services_deposit check (deposit_percent is null or deposit_percent between 1 and 100);

-- ---------------------------------------------------------------------
-- 3. Tiempo para pagar: 2 h por defecto, de 5 min a 24 h
-- ---------------------------------------------------------------------
alter table public.tenant_settings drop constraint settings_hold_range;
alter table public.tenant_settings add constraint settings_hold_range check (booking_hold_minutes between 5 and 1440);
alter table public.tenant_settings alter column booking_hold_minutes set default 120;
-- Los estudios que seguían con el valor por defecto anterior (15) pasan al nuevo.
update public.tenant_settings set booking_hold_minutes = 120 where booking_hold_minutes = 15;

-- ---------------------------------------------------------------------
-- 4. Configuración de reservas online
-- ---------------------------------------------------------------------
alter table public.tenant_settings
  add column online_booking_enabled      boolean  not null default false,
  add column booking_min_notice_minutes  integer  not null default 720,
  add column booking_horizon_days        smallint not null default 60,
  add column slot_interval_minutes       smallint not null default 15,
  -- Lo pone el servidor al conectar Mercado Pago (Sprint 5). Nadie lo cambia por la API.
  add column payments_connected          boolean  not null default false,
  add constraint settings_min_notice_range check (booking_min_notice_minutes between 0 and 10080),
  add constraint settings_horizon_range    check (booking_horizon_days between 1 and 365),
  add constraint settings_slot_interval    check (slot_interval_minutes in (5, 10, 15, 20, 30, 60));

grant update (online_booking_enabled, booking_min_notice_minutes, booking_horizon_days, slot_interval_minutes)
  on public.tenant_settings to authenticated;

-- B10: las reservas online solo se prenden con pagos conectados (toda reserva lleva seña).
-- Si se desconectan los pagos, se apagan solas.
create or replace function app.check_online_booking() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.online_booking_enabled and not new.payments_connected then
    if tg_op = 'UPDATE' and old.payments_connected then
      new.online_booking_enabled := false;
    else
      raise exception 'Para activar las reservas online primero conectá Mercado Pago'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger tenant_settings_online_booking
  before insert or update on public.tenant_settings
  for each row execute function app.check_online_booking();
