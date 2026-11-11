#!/usr/bin/env bash
# =====================================================================
# Test de concurrencia: muchas clientas intentan el MISMO horario a la vez.
# Lo llama scripts/test-db.sh con una base propia ya migrada y con el seed,
# COMPROMETIDA (no dentro de una transacción que se descarta).
#   Uso: booking_race.sh <base> <comando psql y sus argumentos (-h, -p, -U)…>
#
# Sincronización: una sesión "árbitro" toma un candado exclusivo; cada clienta
# espera el candado compartido y, cuando el árbitro lo suelta, todas reservan a
# la vez. La base (restricción de exclusión) tiene que dejar pasar exactamente una
# por profesional.
# =====================================================================
set -uo pipefail
DB="$1"
shift
PSQL=("$@")
N=20
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
q() { "${PSQL[@]}" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

SOFI=32000000-0000-4000-a000-000000000001
SEMI=31000000-0000-4000-a000-000000000001

# Lunes entre 8 y 14 días adelante, en hora de Buenos Aires
D=$(q -c "select (current_date + 8 + ((8 - extract(isodow from current_date + 8)::int) % 7))::date")
PV=$(q -c "select policy_version from public.tenant_settings where tenant_id = '10000000-0000-4000-a000-000000000001'")

# Clientas de prueba (comprometidas)
q -c "insert into auth.users (email, email_confirmed_at)
      select 'carrera' || lpad(i::text, 2, '0') || '@gmail.test', now() from generate_series(1, 2 * $N) i" >/dev/null

race() {  # $1 = nombre, $2 = profesional ('null' o uuid), $3 = hora local, $4 = primera clienta
  local name="$1" pro="$2" time="$3" first="$4"
  local pro_sql; [ "$pro" = "null" ] && pro_sql="null" || pro_sql="'$pro'"
  # Árbitro: retiene el candado 3 segundos mientras arrancan todas
  q -c "select pg_advisory_lock(4242); select pg_sleep(3); select pg_advisory_unlock(4242);" >/dev/null &
  local referee=$!
  sleep 0.7
  for i in $(seq "$first" $((first + N - 1))); do
    email="carrera$(printf %02d "$i")@gmail.test"
    (
      "${PSQL[@]}" -d "$DB" -X -q -t -A >"$TMP/$name.$i" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true)
  from auth.users where email = '$email';
set local role authenticated;
select pg_advisory_xact_lock_shared(4242);
select 'RESERVO ' || code from public.create_online_booking('fresas', '$SEMI', $pro_sql,
  ('$D'::date + time '$time') at time zone 'America/Argentina/Buenos_Aires', $PV, '11 5555-0000');
commit;
SQL
    ) &
  done
  wait
  wait "$referee" 2>/dev/null
  local wins; wins=$(cat "$TMP/$name".* | grep -c '^RESERVO ' || true)
  local lost; lost=$(cat "$TMP/$name".* | grep -c 'se acaba de ocupar\|no está disponible' || true)
  local raced; raced=$(cat "$TMP/$name".* | grep -c 'se acaba de ocupar' || true)
  echo "info  $name: $raced perdieron contra la restricción de la base en el mismo instante (el resto, en el chequeo previo)" >&2
  echo "$wins $lost"
}

fails=0
check() { if [ "$1" = "$2" ]; then echo "ok    $3"; else echo "FAIL  $3 (esperado $2, obtenido $1)"; fails=$((fails + 1)); fi; }

read -r w1 l1 <<< "$(race sofi "$SOFI" "14:00" 1)"
check "$w1" 1 "$N clientas a la vez por Sofi el lunes 14:00: exactamente 1 reserva"
check "$l1" $((N - 1)) "las otras $((N - 1)) reciben «se acaba de ocupar» o «no está disponible»"
n1=$(q -c "select count(*) from public.appointments where professional_id = '$SOFI'
           and status in ('pending_payment', 'confirmed')
           and starts_at = ('$D'::date + time '14:00') at time zone 'America/Argentina/Buenos_Aires'")
check "$n1" 1 "en la base queda una sola reserva activa en ese horario"

read -r w2 l2 <<< "$(race cualquiera null "16:00" $((N + 1)))"
check "$w2" 2 "$N clientas a la vez con «cualquiera» el lunes 16:00 (Sofi y Caro libres): exactamente 2 reservas"
n2=$(q -c "select count(distinct professional_id) || '/' || count(*) from public.appointments
           where status in ('pending_payment', 'confirmed')
             and starts_at = ('$D'::date + time '16:00') at time zone 'America/Argentina/Buenos_Aires'")
check "$n2" "2/2" "una para cada profesional, ninguna superpuesta"

total=$(q -c "select count(*) from public.appointments a1 join public.appointments a2
              on a1.id < a2.id and a1.professional_id = a2.professional_id and a1.occupied && a2.occupied
              where a1.status in ('pending_payment', 'confirmed') and a2.status in ('pending_payment', 'confirmed')")
check "$total" 0 "control final: ninguna reserva activa superpuesta en toda la base"

if [ "$fails" -gt 0 ]; then
  echo "concurrencia: $fails fallidos"
  exit 1
fi
echo "concurrencia: todo ok"
