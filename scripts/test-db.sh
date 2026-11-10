#!/usr/bin/env bash
# Levanta un PostgreSQL temporal, aplica migraciones + seed y corre los tests.
# Uso: ./scripts/test-db.sh
# Requiere PostgreSQL 15+ instalado localmente (initdb, pg_ctl, psql).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
PORT="${PGPORT_TEST:-54329}"
TMP="$(mktemp -d)"
chmod 755 "$TMP"

# initdb no corre como root: si somos root, usamos el usuario postgres
RUN=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$TMP"
  RUN=(runuser -u postgres --)
fi

cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -A trust -U postgres --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -w \
  -o "-k $TMP -p $PORT -c listen_addresses=''" start >/dev/null

PSQL=("$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database fresas_test" >/dev/null

echo "→ Shim local de Supabase"
"${PSQL[@]}" -d fresas_test -f "$ROOT/db/local/00_supabase_shim.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ Migración $(basename "$f")"
  "${PSQL[@]}" -d fresas_test -f "$f" >/dev/null
done

echo "→ Seed de desarrollo"
"${PSQL[@]}" -d fresas_test -f "$ROOT/supabase/seed.sql" >/dev/null

for f in "$ROOT"/db/tests/*.sql; do
  echo "→ Tests $(basename "$f")"
  "${PSQL[@]}" -d fresas_test -f "$f"
done
