#!/usr/bin/env bash
# =====================================================================
# Test de concurrencia de pagos (Sprint 5): avisos de Mercado Pago simultáneos.
# Lo llama scripts/test-db.sh con una base propia ya migrada y con el seed,
# COMPROMETIDA. Uso: payment_race.sh <base> <psql y sus argumentos…>
#
#   1. 20 conexiones registran el MISMO pago aprobado a la vez → un solo registro,
#      una sola confirmación, un solo evento "seña pagada".
#   2. 20 pagos DISTINTOS de la misma reserva a la vez → uno la confirma y los otros
#      19 quedan para devolución (nunca dos confirmaciones).
# =====================================================================
set -uo pipefail
DB="$1"
shift
PSQL=("$@")
N=20
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
q() { "${PSQL[@]}" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

A=10000000-0000-4000-a000-000000000001
ACC=40000000-0000-4000-a000-0000000000aa
CARO=32000000-0000-4000-a000-000000000002
SEMI=31000000-0000-4000-a000-000000000001

# Cuenta conectada, clienta y dos reservas esperando pago con su link (comprometidas)
q <<SQL >/dev/null
insert into public.payment_accounts (id, tenant_id, mp_user_id, site_id, live_mode, token_expires_at)
values ('$ACC', '$A', 4242, 'MLA', false, now() + interval '180 days');
insert into auth.users (email, email_confirmed_at) values ('carrerapago@gmail.test', now());
insert into public.client_profiles (tenant_id, full_name, source)
values ('$A', 'Carrera Pago', 'staff');
SQL
CP=$(q -c "select id from public.client_profiles where tenant_id = '$A' and full_name = 'Carrera Pago'")
PV=$(q -c "select policy_version from public.tenant_settings where tenant_id = '$A'")

mk() {  # $1 = inicio (UTC) → id del link de pago
  q -c "with a as (
          insert into public.appointments (tenant_id, code, client_profile_id, professional_id, service_id, starts_at, ends_at,
            occupied_until, service_name, professional_name, duration_minutes, buffer_minutes, price_minor, price_is_from,
            currency, deposit_percent, deposit_minor, policy_version, cancellation_window_hours, status, deposit_status,
            hold_expires_at, source)
          values ('$A', app.generate_booking_code(), '$CP', '$CARO', '$SEMI', '$1', timestamptz '$1' + interval '60 minutes',
            timestamptz '$1' + interval '60 minutes', 'Esmaltado semipermanente', 'Caro', 60, 0, 1500000, false, 'ARS', 50, 750000,
            $PV, 24, 'pending_payment', 'pending', now() + interval '2 hours', 'staff')
          returning id, tenant_id, deposit_minor, currency, hold_expires_at)
        insert into public.payment_intents (tenant_id, appointment_id, account_id, amount_minor, currency, expires_at)
        select tenant_id, id, '$ACC', deposit_minor, currency, hold_expires_at from a returning id" | head -1
}
I1=$(mk "2027-03-01 13:00Z")
I2=$(mk "2027-03-01 15:00Z")

race() {  # $1 = nombre, $2 = link, $3 = "same" (mismo id de pago) o "distinct"
  local name="$1" intent="$2" mode="$3"
  q -c "select pg_advisory_lock(4343); select pg_sleep(3); select pg_advisory_unlock(4343);" >/dev/null &
  local referee=$!
  sleep 0.7
  for i in $(seq 1 "$N"); do
    local pid; [ "$mode" = "same" ] && pid="900001" || pid="91$(printf %04d "$i")"
    (
      "${PSQL[@]}" -d "$DB" -X -q -t -A >"$TMP/$name.$i" 2>&1 <<SQL
begin;
set local role service_role;
select pg_advisory_xact_lock_shared(4343);
select 'RESULTADO ' || coalesce(outcome, ignored_reason) from public.svc_mp_sync_payment('$ACC',
  jsonb_build_object('provider_payment_id', '$pid', 'status', 'approved', 'amount_minor', 750000, 'refunded_minor', 0,
    'currency', 'ARS', 'external_reference', '$intent', 'collector_id', 4242, 'live_mode', false), 'webhook');
commit;
SQL
    ) &
  done
  wait
  wait "$referee" 2>/dev/null
}

fails=0
check() { if [ "$1" = "$2" ]; then echo "ok    $3"; else echo "FAIL  $3 (esperado $2, obtenido $1)"; fails=$((fails + 1)); fi; }

race mismo "$I1" same
errors=$(cat "$TMP"/mismo.* | grep -c 'ERROR' || true)
check "$errors" 0 "$N avisos del mismo pago a la vez: ninguno falla"
check "$(cat "$TMP"/mismo.* | grep -c '^RESULTADO applied$' || true)" "$N" "los $N responden «aplicado» (idempotente)"
check "$(q -c "select count(*) from public.payments where provider_payment_id = '900001'")" 1 "queda un solo registro del pago"
check "$(q -c "select count(*) from public.appointment_events e join public.payment_intents i on i.appointment_id = e.appointment_id
               where i.id = '$I1' and e.event_type = 'deposit_paid'")" 1 "una sola «seña pagada» en el historial"
check "$(q -c "select count(*) from public.payment_events e join public.payments p on p.id = e.payment_id
               where p.provider_payment_id = '900001'")" 2 "eventos del pago: visto + aplicado, sin repetidos"

race distintos "$I2" distinct
grep -h 'ERROR' "$TMP"/distintos.* | sort | uniq -c >&2 || true
check "$(cat "$TMP"/distintos.* | grep -c 'ERROR' || true)" 0 "$N pagos distintos de la misma reserva a la vez: ninguno falla"
check "$(cat "$TMP"/distintos.* | grep -c '^RESULTADO applied$' || true)" 1 "exactamente uno confirma la reserva"
check "$(cat "$TMP"/distintos.* | grep -c '^RESULTADO refund_pending$' || true)" $((N - 1)) "los otros $((N - 1)) quedan para devolución"
check "$(q -c "select count(*) from public.payment_refunds r join public.payments p on p.id = r.payment_id
               where p.intent_id = '$I2' and r.reason = 'duplicate'")" $((N - 1)) "una devolución por cada pago de más"

if [ "$fails" -gt 0 ]; then
  echo "concurrencia de pagos: $fails fallidos"
  exit 1
fi
echo "concurrencia de pagos: todo ok"
