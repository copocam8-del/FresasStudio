-- =====================================================================
-- Cleo · Migración 2500 · Revisión de pagos cada 10 minutos y tareas diarias
-- docs/sprint-5-plan.md §7 (P9)
--
-- pg_cron + pg_net de Supabase llaman a la app (Web Service de Render):
--   */10 * * * *  POST <url>/api/pagos/interno/revisar              (revisión, P9)
--   15 6 * * *    POST <url>/api/pagos/interno/revisar?tarea=diaria  (renovar tokens, limpiar)
--
-- La URL y la clave NO están acá: se leen del Vault de Supabase (secretos
-- 'cleo_app_url' y 'cleo_cron_secret', ver README). Si faltan, la tarea no hace nada.
-- En el PostgreSQL local de los tests no hay pg_cron ni pg_net: se omite sin fallar.
-- =====================================================================

create or replace function app.call_payments_task(p_daily boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regproc('net.http_post') is null then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'cleo_app_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'cleo_cron_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 55000)$q$
    using rtrim(v_url, '/') || '/api/pagos/interno/revisar' || case when p_daily then '?tarea=diaria' else '' end,
          jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json');
end $$;
revoke execute on function app.call_payments_task(boolean) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron o pg_net no están disponibles: se omiten las tareas de pagos';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  if exists (select 1 from cron.job where jobname = 'cleo-payments-reconcile') then
    perform cron.unschedule('cleo-payments-reconcile');
  end if;
  if exists (select 1 from cron.job where jobname = 'cleo-payments-daily') then
    perform cron.unschedule('cleo-payments-daily');
  end if;
  perform cron.schedule('cleo-payments-reconcile', '*/10 * * * *', 'select app.call_payments_task(false)');
  perform cron.schedule('cleo-payments-daily', '15 6 * * *', 'select app.call_payments_task(true)');
end $$;
