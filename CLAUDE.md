@AGENTS.md

# Cleo — reglas del proyecto

**Cleo** es una plataforma SaaS **multi-tenant** para estudios de belleza (marca Cleo por defecto
y marca propia opcional por estudio, ver regla 1b):
sitio público de cada estudio, Cleo Manager (panel del estudio) y Cleo Admin
(superadministración). Fresas Studio es el primer estudio cliente. Contexto completo en
`README.md` y en `docs/` (brief y backlog técnico con IDs como ARC-01, BOOK-05, POL-03).

## Stack

- Next.js (App Router, `src/`), React, TypeScript estricto, Tailwind CSS v4, shadcn/ui
  (`components.json`, componentes en `src/components/ui`, alias `@/*`).
- Supabase: PostgreSQL + Auth + Storage. Migraciones en `supabase/migrations/`.
- Mercado Pago (OAuth por estudio), Resend, Render (ver "Infraestructura").
- Comandos: `npm run dev`, `npm run build`, `npm run lint`, `npm test` (Vitest),
  `./scripts/test-db.sh` (tests de BD) y `npm run e2e` (contra `next start` y Supabase de desarrollo).

## Infraestructura

- **Hosting: Render** (Web Service con `next start`), **no Vercel**. Las variables de entorno y
  claves de servidor se cargan en el Web Service de Render. Dominio comodín `*.cleo.com.ar`
  (más `cleo.com.ar` y `admin.cleo.com.ar`) apuntando a Render; **el dominio todavía no está
  comprado**. La dirección `*.onrender.com` del servicio se trata como el dominio raíz.
- **Supabase de desarrollo** = el proyecto actual (`bitfpryusoonfbgdtxkg`, región Oregon).
  **Producción** = un proyecto nuevo en **São Paulo**, que se crea antes del lanzamiento.
- **Emails con Resend**, más adelante (SMTP de Auth e invitaciones).
- Tareas periódicas: `pg_cron` (+ `pg_net` para llamar a la app) en Supabase, no los cron jobs
  de Render.

## Regla 1 — Multi-tenant: ningún estudio ve datos de otro

- Toda tabla con datos de negocio lleva `tenant_id uuid not null references public.tenants(id)`.
- Las consultas del panel se resuelven siempre dentro del tenant activo de la usuaria
  (por membresía). En la página pública, el tenant sale del `slug` y solo se exponen datos
  a través de funciones como `get_public_studio(slug)`, sin ids internos.
- Nunca confiar en un `tenant_id` enviado por el navegador: el servidor lo deriva de la
  sesión/membresía y la base lo vuelve a validar con RLS.
- Cleo Admin **no** tiene acceso a clientas, turnos ni caja de los estudios. Tampoco por
  `audit_logs`: las tablas con datos personales usan auditoría sin valores (ver `client_profiles`).
- Los estudios no se borran: se suspenden o cancelan. Suspender = solo lectura.

## Regla 1b — Hosts, estudio actual y marca blanca

- El estudio sale **siempre del host** (`src/proxy.ts` + `src/lib/host.ts`): `{slug}.<raíz>` →
  `/sites/[site]/…`, `admin.<raíz>` → `/platform/…`. Las rutas internas no se piden directo.
- En Server Actions y Route Handlers, usar `currentStudio()` / `currentStaff()`
  (`src/lib/request.ts`, `src/lib/auth.ts`); nunca un slug o `tenant_id` del formulario.
- El proxy no autoriza: cada página del panel llama a `requireStaff` / `requirePermission`, y
  cada acción vuelve a verificar con `currentStaff()` + `can()`.
- **Marca (regla definitiva):** por defecto, el sitio y el panel de TODOS los estudios se ven con la
  marca Cleo (logo completo de Cleo y colores de Cleo). Solo si el estudio activa su **marca
  propia** en `/admin/marca` (`tenant_settings.brand.enabled = true`) se muestran su nombre grande, su
  logo y sus colores, con el logo de Cleo chiquito debajo ("by" + logo). Componentes:
  `src/components/cleo/brand.tsx` y `studioBrand()` (`src/lib/studio-brand.ts`). El título de la
  pestaña siempre lleva el nombre del estudio. En el seed, Fresas va sin marca propia.
- Contenido cargado por un estudio se renderiza escapado (sin `dangerouslySetInnerHTML`): el
  sitio público y el panel comparten origen y cookies.
- Colores: solo hex validados (`src/lib/brand.ts`, y `app.validate_brand` en la base). El
  contraste se controla con tests (`theme.test.ts`); el dorado/acento nunca es texto chico.

## Diseño (tema de Cleo)

- Tema único **oscuro**: negro cálido, champagne / rosado dorado, seda y vidrio, medido sobre
  `docs/diseno/ref-*.png` (ver `docs/diseno-plan.md` y `docs/diseno/diferencias.md`). Tokens en
  `src/app/globals.css`; los colores propios de un estudio se validan para fondo oscuro.
- Componentes en `src/components/cleo/`: `GlassCard`, `StatCard` (con `Sparkline`), `StatusPill`,
  `ActionTile`, `PageTitle`, `InitialsAvatar`, seda (`silk.tsx`), logo (`cleo-logo.tsx`: el original
  `docs/diseno/logo.jpeg` vectorizado; trazos en `cleo-logo-paths.ts`, no editar a mano), menú y barra
  inferior (`nav.tsx`), calendario del mes y bienvenida (`welcome.tsx`, ≤ 2 s, una vez por sesión).
- Los degradados SVG compartidos se definen UNA vez (`svg-defs.tsx`): un id repetido dentro de un
  elemento oculto hace que no se pinte en ningún lado.
- Nada de números ni gráficos inventados: tarjetas, curvas, calendario y actividad salen de la base
  y no se muestran si no hay datos. Menús solo con secciones que existen.
- La decoración (seda, reflejos) nunca pasa por debajo de un texto.
- Capturas para comparar con las referencias: `node scripts/screenshots.mjs p-` (y `cmp-`).

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
- Referencias entre tablas de un estudio con **claves compuestas** `(tenant_id, x_id) →
  (tenant_id, id)`: la base impide mezclar estudios aunque falle la RLS.
- Lo que un turno pueda referenciar (servicios, profesionales) **no se borra: se archiva**.
- Comparaciones de texto sin mayúsculas con `lower(x collate "und-x-icu")` (en locale C,
  `lower()` no convierte letras con acento ni la Ñ).
- Escrituras de varias filas que tienen que ser "todo o nada" (por ejemplo, la semana de un
  horario): función `SECURITY INVOKER` (la RLS sigue aplicando), no varias llamadas sueltas.
- No modificar migraciones ya aplicadas: crear una nueva con timestamp posterior.
- Entornos: el proyecto linkeado (`bitfpryusoonfbgdtxkg`) es **desarrollo**: migraciones y
  seed (si `seed.sql` cambia, aplicarlo con `db query --remote --file supabase/seed.sql`). Producción será un proyecto nuevo (pendiente) y se le aplica solo con
  `--remote=<ref de producción>` explícito. `seed.sql` **nunca** va a producción.
- La `service_role` key solo se usa en el servidor y nunca para saltear RLS en flujos de
  usuaria; jamás en código cliente ni en variables `NEXT_PUBLIC_*`.
- Auditar los cambios relevantes en `audit_logs` (es de solo agregado).

## Regla 3 — Nada de reglas financieras solo en el frontend

El frontend **muestra** importes y consecuencias; el servidor/base **decide**.

- Precios, totales, seña, saldos, créditos, comisiones, cierres de caja, stock y la regla de
  24 h (cancelación/reprogramación, `cancellation_window_hours`) se calculan en el servidor (RPC de Postgres o código
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
  (exactamente 24 h = conserva; 23:59 = pierde). Toda reserva lleva seña (1–100%).
- Módulos y límites del plan se validan en el backend, no solo ocultando botones.
- Tokens OAuth de Mercado Pago cifrados y solo en servidor; nunca llegan al navegador.
- Sin conexión (PWA) no se confirman pagos ni reservas.

## Regla 4 — Reservas

- Nunca escribir `appointments` directo (no hay grants): crear con las RPC, que pasan por
  `app.create_appointment` (recalcula disponibilidad, precio, seña y política, y arma la foto de
  lo acordado). La restricción `appointments_no_overlap` es la garantía final contra la doble
  reserva; el chequeo previo del código no alcanza.
- Lo acordado en una reserva no se modifica (trigger). Reprogramar será una operación propia.
- Una seña se marca pagada solo por `app.confirm_deposit_payment` (servidor, pago verificado) o
  como cobrada en el estudio (`mark_deposit_paid_offline`, permiso de caja). Ninguna migración
  puede crear simulaciones de pago (`no-fake-payments.test.ts`); la de desarrollo vive en el seed.
- Fechas y horas siempre en la zona del estudio (`src/lib/booking-format.ts`).
- Cambios en reservas: correr también el test de concurrencia (`./scripts/test-db.sh` lo incluye).

## Regla 5 — Mercado Pago

- Cada estudio cobra en **su** cuenta (OAuth). Los tokens se cifran en el servidor
  (`src/lib/payments/crypto.ts`) y solo se leen con las funciones `svc_mp_*` (únicamente
  `service_role`, vía `src/lib/payments/service-client.ts`). Nunca en logs ni respuestas.
- Un pago se registra SOLO después de consultarlo a la API de Mercado Pago con el token del
  estudio (`processPayment` → `svc_mp_sync_payment`); la base decide con `app.apply_mp_payment`.
  Ni el aviso ni la vuelta del Checkout confirman nada.
- `tenant_settings.payments_connected` solo lo cambian las funciones de conexión. Con
  `MP_API_BASE_URL` solo se puede apuntar a `localhost` (Mercado Pago simulado de los e2e).
- Cambios en pagos: `./scripts/test-db.sh` (incluye `payment_race.sh`) y `npm run e2e:pagos`.

## Convenciones de código

- Server Components por defecto; `"use client"` solo cuando hace falta interactividad.
- Operaciones sensibles en Server Actions / Route Handlers que llaman RPC; marcar módulos
  con `import "server-only"` cuando manejen secretos o lógica de dinero.
- Validar toda entrada en el servidor (p. ej. con zod) aunque la UI ya valide. Redirecciones
  con `safeNext()`. Mostrar al usuario solo mensajes de error escritos por nosotros.
- Next 16: `middleware` se llama `proxy`; `cacheComponents` está desactivado a propósito.
  Antes de usar APIs de Next, leer `node_modules/next/dist/docs/`.
- Nada de pantallas de demostración con datos ficticios presentadas como funcionales: cada
  botón y formulario se conecta a una operación real.
- UI mobile-first, en español rioplatense, mensajes de error comprensibles.
- Antes de cada módulo, definir: modelo de datos, backend, endpoints, permisos, interfaz,
  validaciones, criterios de aceptación y pruebas.
