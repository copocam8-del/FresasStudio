#!/usr/bin/env bash
# =====================================================================
# Test de concurrencia del saldo a favor (Sprint 6, C9/C11): muchas reservas y
# ajustes a la vez para la MISMA clienta, que tiene saldo para una sola seña.
# Lo llama scripts/test-db.sh con una base propia, migrada, con el seed y comprometida.
#   Uso: credit_race.sh <base> <comando psql y sus argumentos (-h, -p, -U)…>
#
# Sincronización igual que booking_race.sh: un árbitro retiene un candado y todas
# las sesiones arrancan a la vez cuando lo suelta. La base (candado sobre la ficha
# de la clienta) tiene que impedir que el mismo saldo se use dos veces.
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
SOFI=32000000-0000-4000-a000-000000000001
CARO=32000000-0000-4000-a000-000000000002
SEMI=31000000-0000-4000-a000-000000000001
OWNER=$(q -c "select id from auth.users where email = 'duena@fresasstudio.test'")

# Clienta con saldo para UNA seña de semipermanente con Sofi ($ 7.500)
CP=$(q -c "insert into public.client_profiles (tenant_id, full_name, phone, source)
           values ('$A', 'Clienta Carrera Saldo', '11 5555-0000', 'staff') returning id" | head -1)
q -c "insert into public.client_credit_entries (tenant_id, client_profile_id, kind, amount_minor, currency, expires_at, reason)
      values ('$A', '$CP', 'manual_credit', 750000, 'ARS', now() + interval '90 days', 'Saldo para la carrera')" >/dev/null

session() {  # $1 = archivo de salida, $2 = SQL a correr como la dueña
  "${PSQL[@]}" -d "$DB" -X -q -t -A >"$1" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_advisory_xact_lock_shared(4343);
$2
commit;
SQL
}

fails=0
check() { if [ "$1" = "$2" ]; then echo "ok    $3"; else echo "FAIL  $3 (esperado $2, obtenido $1)"; fails=$((fails + 1)); fi; }

# --- 1) 20 turnos a la vez para la misma clienta (horarios distintos) -------------
q -c "select pg_advisory_lock(4343); select pg_sleep(3); select pg_advisory_unlock(4343);" >/dev/null &
referee=$!
sleep 0.7
for i in $(seq 1 $N); do
  pro=$SOFI; [ $((i % 2)) = 0 ] && pro=$CARO
  session "$TMP/b.$i" "select 'TURNO ' || status from public.create_manual_booking('$A', '$CP', null, null, '$SEMI', '$pro',
     date_trunc('hour', now()) + interval '20 days' + make_interval(hours => $i), true, null, null);" &
done
wait
wait "$referee" 2>/dev/null

made=$(cat "$TMP"/b.* | grep -c '^TURNO ' || true)
check "$made" "$N" "$N turnos a la vez para la misma clienta: todos se crean"
with_credit=$(q -c "select count(*) from public.appointments where client_profile_id = '$CP' and credit_applied_minor > 0")
check "$with_credit" 1 "el saldo (una seña) se usa en un solo turno"
used=$(q -c "select -coalesce(sum(amount_minor), 0) from public.client_credit_entries where client_profile_id = '$CP' and kind = 'used_in_booking'")
check "$used" 750000 "el libro registra un solo uso de \$ 7.500"

# --- 2) Ajustes manuales que restan y reservas, todo a la vez -----------------------
# Se le carga otro saldo de $ 7.500 y en paralelo 10 ajustes de -$ 7.500 y 10 reservas:
# entre todos no pueden gastar más de lo que había.
spent_sql="select -coalesce(sum(amount_minor), 0) from public.client_credit_entries
           where client_profile_id = '$CP' and kind in ('used_in_booking', 'manual_debit')"
before=$(q -c "$spent_sql")
q -c "insert into public.client_credit_entries (tenant_id, client_profile_id, kind, amount_minor, currency, expires_at, reason)
      values ('$A', '$CP', 'manual_credit', 750000, 'ARS', now() + interval '90 days', 'Segundo saldo')" >/dev/null
q -c "select pg_advisory_lock(4343); select pg_sleep(3); select pg_advisory_unlock(4343);" >/dev/null &
referee=$!
sleep 0.7
for i in $(seq 1 10); do
  session "$TMP/d.$i" "select 'AJUSTE ' || public.adjust_client_credit('$CP', -750000, 'Carrera $i');" &
  session "$TMP/r.$i" "select 'TURNO ' || status from public.create_manual_booking('$A', '$CP', null, null, '$SEMI', '$SOFI',
     date_trunc('hour', now()) + interval '40 days' + make_interval(hours => $i), true, null, null);" &
done
wait
wait "$referee" 2>/dev/null

after=$(q -c "$spent_sql")
check "$((after - before))" 750000 "ajustes y reservas a la vez: se gasta exactamente el saldo que había, ni un peso más"
denied=$(cat "$TMP"/d.* | grep -c 'no tiene ese saldo' || true)
adjusted=$(cat "$TMP"/d.* | grep -c '^AJUSTE ' || true)
echo "info  ajustes: $adjusted pasaron, $denied rechazados por falta de saldo" >&2
negative=$(q -c "select count(*) from public.client_credit_entries l
                 where l.lot_id is null and l.client_profile_id = '$CP'
                   and l.amount_minor + (select coalesce(sum(e.amount_minor), 0) from public.client_credit_entries e where e.lot_id = l.id) < 0")
check "$negative" 0 "ningún lote queda negativo"

if [ "$fails" -gt 0 ]; then
  echo "concurrencia del saldo: $fails fallidos"
  exit 1
fi
echo "concurrencia del saldo: todo ok"
