@AGENTS.md

# Cleo — reglas del proyecto

**Cleo** es una plataforma SaaS **multi-tenant** y de **marca blanca** para estudios de belleza:
sitio público de cada estudio, Cleo Manager (panel del estudio) y Cleo Admin
(superadministración). Fresas Studio es el primer estudio cliente. Contexto completo en
`README.md` y en `docs/` (brief y backlog técnico con IDs como ARC-01, BOOK-05, POL-03).

## Stack

- Next.js (App Router, `src/`), React, TypeScript estricto, Tailwind CSS v4, shadcn/ui
  (`components.json`, componentes en `src/components/ui`, alias `@/*`).
- Supabase: PostgreSQL + Auth + Storage. Migraciones en `supabase/migrations/`.
- Mercado Pago (OAuth por estudio), Resend, Vercel.
- Comandos: `npm run dev`, `npm run build`, `npm run lint`, `./scripts/test-db.sh` (tests de BD).

## Regla 1 — Multi-tenant: ningún estudio ve datos de otro

- Toda tabla con datos de negocio lleva `tenant_id uuid not null references public.tenants(id)`.
- Las consultas del panel se resuelven siempre dentro del tenant activo de la usuaria
  (por membresía). En la página pública, el tenant sale del `slug` y solo se exponen datos
  a través de funciones como `get_public_studio(slug)`, sin ids internos.
- Nunca confiar en un `tenant_id` enviado por el navegador: el servidor lo deriva de la
  sesión/membresía y la base lo vuelve a validar con RLS.
- Cleo Admin **no** tiene acceso por defecto a clientas, turnos ni caja de los estudios.
- Los estudios no se borran: se suspenden o cancelan. Suspender = solo lectura.

## Regla 2 — RLS obligatoria en cada tabla nueva

Cada migración que cree una tabla debe, en la misma migración:

1. `alter table ... enable row level security;`
2. Definir políticas explícitas por operación usando los helpers existentes del esquema
   `app` (`app.is_member`, `app.has_permission` / `app.can`, `app.tenant_is_writable`,
   `app.is_platform_admin`). No reinventar chequeos.
3. No otorgar nada a `anon`. Lo público se expone solo vía RPC.
4. Toda función `SECURITY DEFINER` lleva `set search_path` fijo y valida permisos adentro.
5. Agregar tests en `db/tests/` que prueben que el estudio A no lee ni modifica filas de B,
   y correr `./scripts/test-db.sh`. Los tests "meta" fallan si una tabla queda sin RLS.

Además:
- No modificar migraciones ya aplicadas: crear una nueva con timestamp posterior.
- Entornos: las migraciones van primero a `cleo-dev` (proyecto linkeado) y a producción solo
  con `--remote=<ref de producción>` explícito. `seed.sql` **nunca** se aplica en producción
  (nada de `--include-seed` con el ref de producción).
- La `service_role` key solo se usa en el servidor y nunca para saltear RLS en flujos de
  usuaria; jamás en código cliente ni en variables `NEXT_PUBLIC_*`.
- Auditar los cambios relevantes en `audit_logs` (es de solo agregado).

## Regla 3 — Nada de reglas financieras solo en el frontend

El frontend **muestra** importes y consecuencias; el servidor/base **decide**.

- Precios, totales, seña, saldos, créditos, comisiones, cierres de caja, stock y la regla de
  48 h (cancelación/reprogramación) se calculan en el servidor (RPC de Postgres o código
  server-only de Next) y se revalidan aunque el cliente mande valores.
- La disponibilidad y el anti doble-reserva se garantizan en PostgreSQL (transacciones,
  restricciones, holds con expiración), no en la UI.
- Una reserva se confirma solo por pago verificado desde el servidor (webhook idempotente
  de Mercado Pago o consulta a su API), nunca por volver de la pantalla de pago.
- Dinero en unidades mínimas enteras (`bigint`), con moneda por tenant. Nada de `float`.
- Movimientos financieros inmutables: se corrigen con ajustes o reversas, nunca con
  `update`/`delete`.
- Guardar snapshot de precio, duración, servicio y versión de política aceptada en cada
  reserva. La anticipación se calcula con la zona horaria del estudio
  (exactamente 48 h = conserva; 47:59 = pierde).
- Módulos y límites del plan se validan en el backend, no solo ocultando botones.
- Tokens OAuth de Mercado Pago cifrados y solo en servidor; nunca llegan al navegador.
- Sin conexión (PWA) no se confirman pagos ni reservas.

## Convenciones de código

- Server Components por defecto; `"use client"` solo cuando hace falta interactividad.
- Operaciones sensibles en Server Actions / Route Handlers que llaman RPC; marcar módulos
  con `import "server-only"` cuando manejen secretos o lógica de dinero.
- Validar toda entrada en el servidor (p. ej. con zod) aunque la UI ya valide.
- Nada de pantallas de demostración con datos ficticios presentadas como funcionales: cada
  botón y formulario se conecta a una operación real.
- UI mobile-first, en español rioplatense, mensajes de error comprensibles.
- Antes de cada módulo, definir: modelo de datos, backend, endpoints, permisos, interfaz,
  validaciones, criterios de aceptación y pruebas.
