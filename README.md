# Fresas SaaS — Sprint 1: base de datos multi-tenant

Base de datos de la plataforma (PostgreSQL / Supabase) con aislamiento entre estudios,
roles y permisos, invitaciones, auditoría y una suite de **92 tests** que lo demuestran.

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
    20261110000500_rpc.sql             funciones de servidor (página pública, invitar, aceptar, Fresas Admin)
  seed.sql                             SOLO desarrollo: Fresas Studio + Estudio Prueba
db/
  local/00_supabase_shim.sql           SOLO local: imita auth.uid() y roles de Supabase
  tests/01_isolation_and_permissions.sql
scripts/test-db.sh                     levanta Postgres temporal, migra, siembra y testea
```

## Cómo correr los tests

Requiere PostgreSQL 15 o superior instalado (`initdb`, `pg_ctl`, `psql`).

```bash
./scripts/test-db.sh
# … 92 tests · 92 ok · 0 fallidos
```

Corre todo dentro de una transacción que se descarta y no toca ninguna base existente.

## Cómo aplicarlo en Supabase

1. Crear el proyecto en Supabase (uno para staging y otro para producción).
2. Con la CLI: `supabase link --project-ref <ref>` y después `supabase db push`.
3. **No** aplicar `db/local/00_supabase_shim.sql`: Supabase ya trae eso.
4. `seed.sql` es solo para desarrollo local (`supabase db reset`). Nunca en producción.
5. Dar de alta a la superadministradora desde el SQL editor:
   `insert into public.platform_admins (user_id) values ('<uuid de auth.users>');`

> Las migraciones se probaron en PostgreSQL 16 puro con el shim. Todavía no se probaron
> contra un proyecto Supabase real; es lo primero que hay que validar al crear el proyecto.

## Qué garantiza la base (y está testeado)

**Aislamiento entre estudios**
- Una usuaria solo ve y modifica filas de los estudios donde tiene membresía activa.
- La dueña de A no puede leer, editar, invitar ni usar roles de B.
- Las visitantes sin sesión no pueden leer ninguna tabla. Solo ven la página pública de un
  estudio activo con `get_public_studio(slug)`, que no expone ids internos.
- Tests "meta" que fallan si alguien agrega una tabla sin RLS, da permisos a `anon` o crea
  una función `SECURITY DEFINER` sin `search_path` fijo.

**Permisos (sin escalada)**
- Roles de sistema: Dueña, Encargada, Recepción y Profesional. Además, cada estudio puede
  crear roles propios.
- Nadie puede dar un rol ni un permiso que no tenga. Por ejemplo, la encargada no puede
  nombrar dueñas ni dar acceso a Mercado Pago.
- Nadie puede modificar su propio acceso.
- Un estudio nunca queda sin dueña activa, ni siquiera por acción de Fresas Admin.
- Si se da de baja a una persona, pierde el acceso al instante.

**Invitaciones**
- El token se muestra una sola vez; en la base solo queda su hash SHA-256.
- Solo sirve para el email al que se envió: vencen a los 7 días (14 para la dueña) y son
  de un solo uso.

**Estudios y políticas**
- Solo Fresas Admin crea estudios, cambia su URL o los suspende. Suspender no borra nada:
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
| Fresas Admin y datos del estudio | Puede ver estudios, configuración y equipos (para soporte). **No** tendrá acceso por defecto a clientas, turnos ni caja cuando se agreguen. |
| Borrado | Los estudios no se borran: solo se suspenden o cancelan. |

## Pendiente (no entró en este sprint)

- **Proyecto Next.js + Tailwind (ARC-01/02):** no se pudo crear en este entorno porque no
  tiene acceso a internet para instalar paquetes. Se hace con
  `npx create-next-app@latest` apenas haya red.
- **Crear los proyectos de Supabase y GitHub (ARC-03/04):** requiere tus cuentas.
- **Pantallas de login, recuperación y aceptación de invitación (AUTH-01/02):** las provee
  Supabase Auth y se conectan cuando exista el frontend.
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
