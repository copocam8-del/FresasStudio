-- =====================================================================
-- Cleo · Migración 2200 · Limpieza periódica de bloqueos vencidos (pg_cron)
--
-- La CORRECCIÓN no depende de esto: la disponibilidad ignora los bloqueos vencidos y
-- cada reserva vence los que la tapan antes de crearse. Esta tarea solo mantiene el
-- historial al día ("venció" a tiempo, aunque nadie reserve encima).
--
-- pg_cron existe en Supabase pero no en el PostgreSQL local de los tests: si la
-- extensión no está disponible, la migración no hace nada (y no falla).
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron no está disponible: se omite la tarea de limpieza (la corrección no depende de ella)';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  -- Idempotente: si ya existe la tarea, se reemplaza.
  if exists (select 1 from cron.job where jobname = 'cleo-expire-holds') then
    perform cron.unschedule('cleo-expire-holds');
  end if;
  perform cron.schedule('cleo-expire-holds', '* * * * *', 'select app.expire_holds()');
end $$;
