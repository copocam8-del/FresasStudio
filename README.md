# Cleo — plataforma SaaS para estudios de belleza

**Cleo** es una plataforma multi-tenant y de marca blanca: cada estudio tiene su sitio
(`{slug}.cleo.com.ar`) y su panel (Cleo Manager), y la plataforma se administra desde
Cleo Admin. **Fresas Studio** (`fresas`) es el primer estudio cliente.

## Sprint 1: base de datos multi-tenant

Base de datos de la plataforma (PostgreSQL / Supabase) con aislamiento entre estudios,
roles y permisos, invitaciones, auditoría y una suite de tests que lo demuestran.
El plan del Sprint 2 está en [`docs/sprint-2-plan.md`](docs/sprint-2-plan.md).

Cubre del backlog: **ARC-05, ARC-06, ARC-07, ARC-10, AUTH-03, AUTH-04, TEN-01, TEN-05, TEN-06**
y la base de **SAAS-02** (alta y suspensión de estudios).

## Estructura

```
supabase/
  migrations/
    20261110000100_foundation.sql      estudios, configuración, políticas versionadas, perfiles, superadmins
    20261110000200_access_control.sql  permisos, roles, membresías, invitaciones + reglas anti-escalada
    20261110000300_audit.sql           auditoría de solo agregado
    20261110000400_rls.sql             privilegios por columna + Row Level Security
    20261110000500_rpc.sql             funciones de servidor (página pública, invitar, aceptar, Cleo Admin)
    20261110000600_function_search_path.sql  search_path = '' en las funciones que no lo fijaban
    20261110000700_cleo_rename.sql     renombre a Cleo: slugs reservados, "fresas" liberado, mensajes
    20261110000800_tenant_domains.sql  dominios propios (preparación): tabla, RLS, resolución y RPC de Cleo Admin
  seed.sql                             SOLO desarrollo: Fresas Studio + Estudio Prueba
db/
  local/00_supabase_shim.sql           SOLO local: imita auth.uid() y roles de Supabase
  tests/lib/setup.sql, finish.sql      framework común (transacción, asserts, atajos de sesión)
  tests/01_isolation_and_permissions.sql
  tests/02_cleo_rename.sql
  tests/03_dev_seed.sql
  tests/04_tenant_domains.sql
scripts/test-db.sh                     levanta Postgres temporal, migra, siembra y testea (Linux y Windows)
```

## Cómo correr los tests

Requiere PostgreSQL 15 o superior instalado (`initdb`, `pg_ctl`, `psql`).

```bash
./scripts/test-db.sh
# … un resumen por archivo, p. ej. «93 tests · 93 ok · 0 fallidos»
```

Corre todo dentro de una transacción que se descarta y no toca ninguna base existente.
Levanta un Postgres temporal propio en el puerto 54329 y lo borra al terminar.

### En Windows

1. Instalar PostgreSQL con el instalador oficial (https://www.postgresql.org/download/windows/).
   No hace falta agregarlo al PATH: el script busca la versión más nueva en
   `C:\Program Files\PostgreSQL\<versión>\bin`.
2. Correr el script desde **Git Bash** (no desde PowerShell ni cmd):

   ```bash
   cd "/c/Fresas Studio/fresas-saas"
   ./scripts/test-db.sh
   ```

- Si PostgreSQL está en otra carpeta: `PGBIN="/c/ruta/a/PostgreSQL/17/bin" ./scripts/test-db.sh`.
- Si el puerto 54329 está ocupado: `PGPORT_TEST=54400 ./scripts/test-db.sh`.
- En Windows el Postgres temporal escucha solo en `localhost` (no hay sockets Unix) y usa la
  configuración regional `C` con codificación UTF-8, porque `C.UTF-8` no existe en Windows.
  No interfiere con el servicio de PostgreSQL que deja instalado el instalador (puerto 5432).

## Entornos de Supabase

| Entorno | Proyecto | Migraciones | Seed |
|---|---|---|---|
| Desarrollo | `cleo-dev` (la CLI queda linkeada a este) | Sí | **Sí** |
| Producción | `Fresas` (`bitfpryusoonfbgdtxkg`) | Sí, con ref explícito | **Nunca** |

Siempre con `npx supabase@3.1.0` (sin instalación global):

```bash
# Desarrollo (proyecto linkeado): migraciones + seed
npx supabase@3.1.0 db push --remote --dry-run --include-seed   # revisar primero
npx supabase@3.1.0 db push --remote --include-seed

# Producción: ref explícito y SIN --include-seed
npx supabase@3.1.0 db push --remote=bitfpryusoonfbgdtxkg --dry-run
npx supabase@3.1.0 db push --remote=bitfpryusoonfbgdtxkg
```

- **No** aplicar `db/local/00_supabase_shim.sql`: Supabase ya trae eso.
- El seed crea usuarias `.test` que pueden iniciar sesión con email y contraseña
  (contraseña de desarrollo: `CleoDev-2026`). Es pública a propósito: nunca va a producción.
- Superadministradora de producción, desde el SQL editor:
  `insert into public.platform_admins (user_id) values ('<uuid de auth.users>');`

## Qué garantiza la base (y está testeado)

**Aislamiento entre estudios**
- Una usuaria solo ve y modifica filas de los estudios donde tiene membresía activa.
- La dueña de A no puede leer, editar, invitar ni usar roles de B.
- Las visitantes sin sesión no pueden leer ninguna tabla. Solo ven la página pública de un
  estudio activo con `get_public_studio(slug)`, que no expone ids internos.
- Tests "meta" que fallan si alguien agrega una tabla sin RLS, da permisos a `anon` o crea
  una función en `public` o `app` (de cualquier tipo, incluidos triggers) sin
  `search_path = ''`.

**Permisos (sin escalada)**
- Roles de sistema: Dueña, Encargada, Recepción y Profesional. Además, cada estudio puede
  crear roles propios.
- Nadie puede dar un rol ni un permiso que no tenga. Por ejemplo, la encargada no puede
  nombrar dueñas ni dar acceso a Mercado Pago.
- Nadie puede modificar su propio acceso.
- Un estudio nunca queda sin dueña activa, ni siquiera por acción de Cleo Admin.
- Si se da de baja a una persona, pierde el acceso al instante.

**Invitaciones**
- El token se muestra una sola vez; en la base solo queda su hash SHA-256.
- Solo sirve para el email al que se envió: vencen a los 7 días (14 para la dueña) y son
  de un solo uso.

**Estudios y políticas**
- Solo Cleo Admin crea estudios, cambia su URL o los suspende. Suspender no borra nada:
  el estudio queda en solo lectura y su página pública se oculta.
- Seña 50% y ventana de 48 h por defecto, configurables por estudio.
- Cada cambio de seña o de política crea una **versión inmutable**. Así, las reservas
  (sprint 2) podrán guardar qué versión aceptó la clienta (POL-08).
- Se validan zona horaria, formato de URL, URLs reservadas y emails.

**Auditoría**
- Se registra quién hizo cada cambio en estudios, configuración, roles, membresías e
  invitaciones.
- Es de solo agregado: nadie puede editarla ni borrarla, ni siquiera el superusuario.

## Decisiones tomadas en este sprint

| Tema | Decisión |
|---|---|
| Identificación del tenant | Por `slug` en la URL pública y por membresía en el panel. La forma final del dominio (ruta, subdominio o propio) sigue pendiente, pero no cambia el esquema. |
| Operaciones sensibles | Por funciones de base de datos (RPC) que validan permisos adentro. La interfaz nunca decide. |
| Cleo Admin y datos del estudio | Puede ver estudios, configuración y equipos (para soporte). **No** tendrá acceso por defecto a clientas, turnos ni caja cuando se agreguen. |
| Borrado | Los estudios no se borran: solo se suspenden o cancelan. |

## Pendiente (no entró en este sprint)

- **Crear los proyectos de Supabase (ARC-03/04):** uno para staging y otro para producción;
  requiere tu cuenta. Después, aplicar las migraciones como indica "Cómo aplicarlo en
  Supabase" y validarlas contra un proyecto real.
- **Pantallas de login, recuperación y aceptación de invitación (AUTH-01/02):** las provee
  Supabase Auth; falta conectarlas al frontend.
- **Envío del email de invitación:** el backend recibe el token y lo envía con Resend.
- **Backups y monitoreo (ARC-09):** se configuran en Supabase (PITR) y Vercel.
- **Módulos y límites por plan (SAAS-04):** el esquema ya deja lugar para `tenant_entitlements`.

## Pendientes técnicos

- **Vulnerabilidad de `minimatch` en dependencias de desarrollo:** `npm audit` reporta
  `minimatch` < 11.0.1 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)),
  que entra por `typescript-eslint` (vía `eslint-config-next`) y por `ts-morph` (vía la CLI de
  `shadcn`). Hoy sus últimas versiones todavía piden `minimatch` 10.x, así que no hay arreglo
  posible sin forzar versiones. No afecta a producción (`npm audit --omit=dev` da 0).
  Cuando `typescript-eslint` y `ts-morph` acepten `minimatch` 11, correr `npm update`,
  confirmar con `npm audit` y verificar que `npm run lint` y `npm run build` sigan pasando.
  No usar `npm audit fix --force`: propone bajar `shadcn` a la 1.0.0.

## Decisión que conviene definir antes del sprint 2

**¿La cuenta de una clienta es una sola para todos los estudios, o cada estudio tiene su
propia ficha?** Define cómo se modelan `client_profiles` y quién ve qué. La recomendación es
una identidad global de login con una **ficha separada por estudio**. Así cada estudio ve
solo su historial y la clienta reserva en varios estudios con una sola cuenta.
