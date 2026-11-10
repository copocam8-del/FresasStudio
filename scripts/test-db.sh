#!/usr/bin/env bash
# Levanta un PostgreSQL temporal, aplica migraciones + seed y corre los tests.
# Uso: ./scripts/test-db.sh
# Requiere PostgreSQL 15+ instalado localmente (initdb, pg_ctl, psql).
#
# Funciona en Linux y en Windows (Git Bash). En Windows usa la instalación oficial
# de PostgreSQL (C:\Program Files\PostgreSQL\<versión>\bin) aunque no esté en el PATH.
# Para usar otra instalación: PGBIN="/ruta/a/bin" ./scripts/test-db.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PGPORT_TEST:-54329}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) WINDOWS=1 ;;
  *)                    WINDOWS=0 ;;
esac

if [ -z "${PGBIN:-}" ]; then
  if command -v pg_config >/dev/null 2>&1; then
    PGBIN="$(pg_config --bindir)"
  elif [ "$WINDOWS" = 1 ]; then
    # La versión más nueva instalada en Program Files
    PGBIN="$(ls -d "/c/Program Files/PostgreSQL/"*/bin 2>/dev/null | sort -V | tail -1 || true)"
  else
    PGBIN=/usr/lib/postgresql/16/bin
  fi
fi
if [ -z "$PGBIN" ] || { [ ! -e "$PGBIN/initdb" ] && [ ! -e "$PGBIN/initdb.exe" ]; }; then
  echo "No encontré PostgreSQL (initdb). Instalalo o indicá la carpeta bin con PGBIN=..." >&2
  exit 1
fi

TMP="$(mktemp -d)"
chmod 755 "$TMP"

# initdb no corre como root: si somos root, usamos el usuario postgres
RUN=()
if [ "$WINDOWS" = 0 ] && [ "$(id -u)" = "0" ]; then
  chown postgres "$TMP"
  RUN=(runuser -u postgres --)
fi

cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

if [ "$WINDOWS" = 1 ]; then
  # Windows no tiene la configuración regional C.UTF-8 ni sockets Unix en psql:
  # se usa locale C con codificación UTF8 y conexión TCP solo a localhost.
  export PGCLIENTENCODING=UTF8
  "$PGBIN/initdb" -D "$TMP/data" -A trust -U postgres --locale=C -E UTF8 >/dev/null
  "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -w \
    -o "-p $PORT -c listen_addresses=localhost" start >/dev/null
  PSQL=("$PGBIN/psql" -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
else
  "${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -A trust -U postgres --locale=C.UTF-8 >/dev/null
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -w \
    -o "-k $TMP -p $PORT -c listen_addresses=''" start >/dev/null
  PSQL=("$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
fi

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
