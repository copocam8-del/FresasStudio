# Cleo — plataforma SaaS para estudios de belleza

**Cleo** es una plataforma multi-tenant y de **marca blanca**: cada estudio tiene su sitio
(`{slug}.cleo.com.ar`) y su panel (Cleo Manager, en `{slug}.cleo.com.ar/admin`), y la
plataforma se administra desde Cleo Admin (`admin.cleo.com.ar`). En el sitio y el panel de
un estudio se ve solo su nombre, sus colores y su logo; nunca "Cleo".
**Fresas Studio** (`fresas`) es el primer estudio cliente.

- Sprint 1: base de datos multi-tenant (estudios, roles, permisos, invitaciones, auditoría).
- Sprint 2 ([plan](docs/sprint-2-plan.md)): renombre a Cleo, subdominios, acceso del equipo,
  clientas con Google, fichas por estudio y marca de cada estudio.
- Sprint 3 ([plan](docs/sprint-3-plan.md)): servicios, categorías, profesionales (con o sin
  cuenta), horarios con descansos, bloqueos, tiempo extra, fotos y catálogo en el sitio.
- Sprint 4 ([plan](docs/sprint-4-plan.md)): motor de reservas. Disponibilidad en el servidor,
  bloqueo temporal hasta pagar la seña (2 h), doble reserva imposible (restricción de la base
  y test de concurrencia), foto de lo acordado, código, historial, turno manual y reglas.
- Sprint 5 ([plan](docs/sprint-5-plan.md)): Mercado Pago. Cada estudio conecta su cuenta por
  OAuth (tokens cifrados, renovación automática), la seña se cobra con Checkout Pro en la cuenta
  del estudio y la reserva se confirma solo con el pago verificado contra la API (webhook
  idempotente + revisión cada 10 min). Pago tardío, devoluciones automáticas y conciliación.

Hosting: **Render** (Web Service). Ver "Infraestructura" en `CLAUDE.md`.

## Estructura

```
src/
  proxy.ts                     enruta por host (subdominio → estudio) y refresca la sesión
  app/
    page.tsx                   sitio de Cleo (dominio raíz)
    platform/                  Cleo Admin (admin.<raíz>): login y acceso de superadmins
    sites/[site]/              sitio de cada estudio (rewrite desde {slug}.<raíz>)
      page.tsx                 página pública con su marca
      reservar/ reserva/[código]           reserva online (pasos 1–4) y estado de la reserva
      ingresar/ auth/callback/ mi-ficha/   clientas: Google, sus datos y "Mis turnos"
      admin/                   panel del estudio: login, recuperar, restablecer, invitación,
                               inicio, turnos (+ manual), servicios (+ categorías),
                               profesionales, horarios, bloqueos, equipo, reglas de reservas,
                               marca (colores y logo), Mercado Pago (conectar, pagos recibidos)
    api/pagos/                 Mercado Pago, en cualquier host: vuelta de OAuth, webhook, tareas internas
  lib/                         host, auth (DAL), validación, color/contraste, marca, Supabase
  lib/payments/                cifrado, firma de webhooks, cliente de Mercado Pago, cuentas y flujos (server-only)
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
    20261110000900_team_auth.sql       vista previa de invitación, email confirmado, equipo con emails
    20261110001000_client_profiles.sql fichas de clientas por estudio (vinculación por email, auditoría sin datos personales)
    20261110001100_brand.sql           marca validada en la base (contraste) + bucket de logos
    20261110001200_catalog.sql         categorías, servicios, profesionales, asignaciones (claves compuestas) + bucket de fotos
    20261110001300_schedule.sql        horarios por franjas, bloqueos y app.working_intervals
    20261110001400_public_catalog.sql  catálogo público (precio "desde", solo lo visible)
    20261110001500_schedule_rpc.sql    guardar la semana (todo o nada) y bloqueos con hora local
    20261110001600_booking_settings.sql  ventana 24 h, seña 1–100%, 2 h para pagar, reglas de reservas
    20261110001700_appointments.sql    reservas (foto de lo acordado), exclusión anti doble reserva, historial
    20261110001800_availability.sql    disponibilidad en el servidor (free_slots y funciones públicas)
    20261110001900_booking.sql         crear reservas online, vencimiento, "Mis turnos", liberar
    20261110002000_staff_booking.sql   turno manual, seña cobrada, cancelar sin seña, confirmación por pago
    20261110002100_booking_preview.sql vista previa del resumen (quién atiende y cuánto sale)
    20261110002200_expire_holds_cron.sql  limpieza de bloqueos vencidos cada minuto (pg_cron, Supabase)
    20261110002300_payment_accounts.sql   cuentas de Mercado Pago por estudio, tokens cifrados, OAuth (state)
    20261110002400_payments.sql        links de pago, pagos, eventos, avisos, devoluciones, pago tardío
    20261110002500_payments_cron.sql   revisión de pagos cada 10 min y tareas diarias (pg_cron + pg_net)
  seed.sql                             SOLO desarrollo: Fresas Studio + Estudio Prueba (idempotente)
db/
  local/00_supabase_shim.sql           SOLO local: imita auth, roles y Storage de Supabase
  tests/lib/setup.sql, finish.sql      framework común (transacción, asserts, atajos de sesión)
  tests/01…19_*.sql                    aislamiento, renombre, seed, dominios, equipo, fichas, marca,
                                       catálogo, horarios, catálogo público, RPC de horarios, reglas
                                       de reservas, reservas, disponibilidad, reserva online, panel
                                       y vista previa, cuentas de Mercado Pago y pagos
  tests/concurrency/booking_race.sh    20 clientas a la vez por el mismo horario (base comprometida)
  tests/concurrency/payment_race.sh    20 avisos del mismo pago / 20 pagos de la misma reserva a la vez
scripts/
  test-db.sh                           levanta Postgres temporal, migra, siembra y testea (Linux y Windows)
  e2e-auth.mjs, e2e-catalog.mjs,       pruebas de punta a punta contra la app y Supabase de desarrollo
  e2e-booking.mjs                      (incluye 10 envíos simultáneos al mismo horario)
  e2e-payments.mjs, fake-mercadopago.mjs  Mercado Pago de punta a punta con un Mercado Pago simulado
  e2e-lib.mjs                          helpers compartidos de los e2e
```

## Levantar la app en local

1. `npm install`
2. Copiar `.env.example` a `.env.local` y completarlo con el proyecto de **desarrollo**
   (URL, clave publishable y `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000`).
3. `npm run dev` y abrir en Chrome, Edge o Firefox:

| URL | Qué es |
|---|---|
| `http://localhost:3000` | Sitio de Cleo |
| `http://fresas.localhost:3000` | Sitio de Fresas Studio |
| `http://fresas.localhost:3000/reservar` | Reservar un turno (como clienta) |
| `http://fresas.localhost:3000/admin` | Panel de Fresas Studio (Turnos, Servicios, Profesionales, Horarios, Bloqueos, Equipo, Reservas, Marca) |
| `http://estudio-prueba.localhost:3000` | Sitio de Estudio Prueba |
| `http://admin.localhost:3000` | Cleo Admin |

Los navegadores resuelven `*.localhost` solos. Cada subdominio tiene sus propias cookies,
igual que en producción: iniciar sesión en Fresas no abre sesión en otro estudio.

En Windows, Node, `curl` y otras herramientas de terminal **no** resuelven `*.localhost`.
Para probar desde la terminal: `curl -H "Host: fresas.localhost:3000" http://localhost:3000/`
(o agregar entradas en `C:\Windows\System32\drivers\etc\hosts`).

**Usuarias de prueba** (seed, contraseña `CleoDev-2026`, solo desarrollo):

| Email | Rol |
|---|---|
| `admin@cleo.test` | Cleo Admin |
| `duena@fresasstudio.test` | Dueña de Fresas Studio |
| `encargada@fresasstudio.test` | Encargada de Fresas Studio |
| `profesional@fresasstudio.test` | Profesional de Fresas Studio |
| `duena@estudioprueba.test` | Dueña de Estudio Prueba |
| `externa@otro.test` | Sin estudio (para probar invitaciones) |
| `clienta01@e2e.test` … `clienta10@e2e.test` | Clientas con contraseña para los e2e de reservas |

Las clientas reales entran con Google. Para probar la reserva sin Google en desarrollo, el e2e
usa esas cuentas con contraseña. Con `NEXT_PUBLIC_ENABLE_SIMULATED_PAYMENTS=true` en
`.env.local`, la reserva muestra **"Simular pago aprobado (solo desarrollo)"**: confirma por el
mismo camino que el webhook real. La función que lo hace solo la crea el seed, así que en
producción no existe.

## Tests

```bash
npm test              # unitarios (Vitest): host, validación, contraste del tema y de marcas, contacto
npm run lint
./scripts/test-db.sh  # base de datos: un resumen por archivo («38 tests · 38 ok · 0 fallidos»)

# De punta a punta, contra la app compilada y el Supabase de DESARROLLO:
npm run build && npx next start -p 3000   # en otra terminal
npm run e2e           # e2e-auth.mjs, e2e-catalog.mjs y e2e-booking.mjs

# Mercado Pago de punta a punta (levanta su propio next start con un Mercado Pago simulado
# en localhost:4010; necesita npm run build, el puerto 3000 libre y SUPABASE_SECRET_KEY de
# DESARROLLO en .env.local):
npm run e2e:pagos
```

`e2e:pagos` conecta Mercado Pago por OAuth (con PKCE), paga señas, manda avisos firmados (y
mal firmados, repetidos y en paralelo), prueba la revisión sin webhook, la devolución de un
pago tardío, la renovación y la revocación de tokens, la conciliación y desconectar. Al final
deja Fresas como el seed (`dev_restore_seed_payments`, que solo existe en el seed).

`test-db.sh` corre todo dentro de una transacción que se descarta, en un Postgres temporal
propio (puerto 54329) que borra al terminar. Requiere PostgreSQL 15 o superior. Al final corre
el **test de concurrencia** sobre una copia con datos comprometidos: 20 conexiones intentan el
mismo horario a la vez y tiene que quedar exactamente una reserva. Sin la restricción de la base
quedaban 11: el chequeo del código no alcanza, lo garantiza la base.

`npm run e2e` crea y limpia lo que usa (invitaciones, membresía, logo, servicios y profesionales
de prueba, que se archivan), así que se puede repetir; si una corrida se corta, la siguiente
archiva lo que quedó. No prueba el login real con Google (ver el checklist manual).

### `test-db.sh` en Windows

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
| Desarrollo | `bitfpryusoonfbgdtxkg` (en el panel figura como "Fresas"; la CLI está linkeada a este) | Sí | **Sí** |
| Producción | **Pendiente:** se crea un proyecto nuevo antes del lanzamiento | Sí, con ref explícito | **Nunca** |

Siempre con `npx supabase@3.1.0` (sin instalación global):

```bash
# Desarrollo (proyecto linkeado): migraciones + seed (el seed es idempotente)
npx supabase@3.1.0 db push --remote --include-seed --dry-run   # revisar primero
npx supabase@3.1.0 db push --remote --include-seed

# Producción (cuando exista): ref explícito y SIN --include-seed
npx supabase@3.1.0 db push --remote=<ref-de-produccion> --dry-run
npx supabase@3.1.0 db push --remote=<ref-de-produccion>
```

- **Si cambia `seed.sql`:** con el seed ya registrado en el proyecto, `db push --include-seed`
  solo actualiza su huella y **no lo vuelve a ejecutar**. En desarrollo se aplica así (es
  idempotente): `npx supabase@3.1.0 db query --remote --file supabase/seed.sql --yes`.
- **No** aplicar `db/local/00_supabase_shim.sql`: Supabase ya trae eso.
- Superadministradora de producción, desde el SQL editor:
  `insert into public.platform_admins (user_id) values ('<uuid de auth.users>');`

### Mercado Pago (por entorno)

1. Crear la aplicación en Mercado Pago Developers (paso a paso en
   [docs/sprint-5-plan.md §14](docs/sprint-5-plan.md)).
2. Cargar las variables de `.env.example` (sección Mercado Pago) en `.env.local` (desarrollo) o
   en **Render → el Web Service → Environment** (producción). Ninguna lleva `NEXT_PUBLIC_`.
   `PAYMENTS_ENCRYPTION_KEY` tiene que ser distinta en cada entorno.
3. Revisión cada 10 minutos: en el **SQL editor** de Supabase, una sola vez por entorno:
   ```sql
   select vault.create_secret('https://cleo.com.ar', 'cleo_app_url');      -- URL de la app en Render
   select vault.create_secret('<el mismo CRON_SECRET de Render>', 'cleo_cron_secret');
   ```
   Sin esos secretos la tarea no hace nada (los avisos de Mercado Pago siguen funcionando).
   Para cambiar uno: `select vault.update_secret((select id from vault.secrets where name = 'cleo_app_url'), '<nuevo>');`
4. **Render:** una instancia gratuita se duerme sin tráfico y el primer aviso de Mercado Pago
   puede perderse (Mercado Pago reintenta y la revisión lo levanta). En producción, instancia paga.

### Configuración de Auth (en el panel de Supabase, por entorno)

**Authentication → URL Configuration**

| | Desarrollo | Producción |
|---|---|---|
| Site URL | `http://localhost:3000` | `https://cleo.com.ar` |
| Redirect URLs | `http://*.localhost:3000/**` | `https://*.cleo.com.ar/**` (y cada dominio propio) |

Sin esto no funcionan los links de recuperación de contraseña, la confirmación de cuenta ni
la vuelta de Google.

**Authentication → Sign In / Providers**
- Email: confirmación de email **activada**, largo mínimo de contraseña 10.
- Google: activado con el cliente OAuth "Cleo Suite" (abajo).

**Emails:** el SMTP que trae Supabase tiene un límite muy bajo y solo envía a los miembros
de la organización de Supabase. Alcanza para probar con tu propio email; antes de invitar a
gente real hay que configurar SMTP propio (Resend) en **Authentication → Emails → SMTP**.

### Cliente OAuth de Google ("Cleo Suite")

La pantalla de consentimiento de Google es una sola para todos los estudios y dice
"Cleo Suite"; el resto de la app muestra el nombre de cada estudio.

1. En https://console.cloud.google.com crear un proyecto `Cleo Suite` y dejarlo seleccionado.
2. **APIs y servicios → Pantalla de consentimiento de OAuth** (o **Google Auth Platform**):
   nombre `Cleo Suite`, email de asistencia y de contacto, público **Externo**.
3. **Acceso a los datos / Permisos:** solo `openid`, `email` y `profile`.
4. En modo **Prueba** solo entran los **Usuarios de prueba** cargados. Para abrirlo a todo
   el mundo: **Publicar app**.
5. **Clientes → Crear cliente** (o **Credenciales → ID de cliente de OAuth**), tipo
   **Aplicación web**, con este **URI de redireccionamiento autorizado**:
   `https://<ref-del-proyecto>.supabase.co/auth/v1/callback`
   (desarrollo: `https://bitfpryusoonfbgdtxkg.supabase.co/auth/v1/callback`).
6. Copiar ID y secreto del cliente en Supabase → **Authentication → Sign In / Providers →
   Google** y guardar. El secreto no se comparte por chat ni se sube al repo.

Para producción, agregar en el mismo cliente el URI del proyecto de producción.

## Checklist manual (lo que el e2e no cubre)

**Sprint 5 — Mercado Pago con cuentas de prueba (ver [plan §13](docs/sprint-5-plan.md)):**
- [ ] Como dueña, en «Mercado Pago», conectar la cuenta **vendedora de prueba**: vuelve con
      «Conectado como …» y «Cuenta de prueba».
- [ ] Como clienta (celular o 375 px): reservar, «Pagar seña» → Checkout de Mercado Pago con
      el monto de la seña y el nombre del estudio → pagar con la **compradora de prueba** y
      tarjeta `APRO` → vuelve a «Estamos verificando…» → «Confirmada».
- [ ] Pagar con titular `OTHE`: «El pago no se aprobó» y la reserva sigue esperando pago.
- [ ] Reenviar un aviso desde el panel de Mercado Pago (Webhooks → simular): nada se duplica.
- [ ] Ver el pago en «Pagos» (comisión y neto) y bajar el CSV.
- [ ] Desconectar: se apagan las reservas online.

**Sprint 4 — reservas (celular real o 375 px):**
- [ ] Como clienta (Google o `clienta01@e2e.test`): Reservar → servicio → «Cualquiera
      disponible» → día y horario → resumen con precio, seña y saldo → aceptar la política →
      «Te guardamos el horario» con el tiempo para pagar.
- [ ] «Simular pago aprobado» → la reserva queda confirmada; aparece en «Mis turnos».
- [ ] Reservar otra, «Liberar el horario» y ver que el horario vuelve a estar libre.
- [ ] Como dueña: ver el turno en «Turnos», abrir el detalle con su historial.
- [ ] Turno manual de WhatsApp (clienta nueva), primero esperando pago y después «Marcar cobrada».
- [ ] En «Reglas de reservas», cambiar el tiempo para pagar y la anticipación mínima.
- [ ] Como profesional: en «Turnos» ve solo los suyos.

**Sprint 3 — en un celular real (o el navegador en 375 px):**
- [ ] Crear un servicio con las duraciones rápidas, ver «Se muestra: $ …» mientras escribís el
      precio, subir una foto y verlo en el sitio.
- [ ] Ordenar servicios y categorías con subir/bajar; ocultar una categoría y ver que sus
      servicios salen del sitio.
- [ ] Crear una profesional sin cuenta, asignarle servicios con «cobra o tarda distinto» y ver el
      «desde» en el sitio.
- [ ] Cargar el horario del estudio con descanso al mediodía y «Copiar a martes–viernes».
- [ ] Darle a una profesional un horario propio y probar uno fuera del horario del estudio.
- [ ] Cargar un feriado de todo el estudio y vacaciones de una profesional; quitarlos.

**Sprint 2:**

- [ ] **Google:** en `fresas.localhost:3000/ingresar`, "Continuar con Google" muestra
      "Cleo Suite" y vuelve a "Mis datos" de Fresas con nombre y email de la cuenta.
- [ ] **Google en dos estudios:** la misma cuenta en `estudio-prueba.localhost:3000/ingresar`
      tiene otra ficha, independiente.
- [ ] **Vinculación (D7):** una ficha cargada por el estudio con tu Gmail (sin cuenta) se
      vincula sola en tu primer ingreso con Google.
- [ ] **Recuperar contraseña:** con un email propio miembro de la organización de Supabase,
      llega el email, el link abre "Contraseña nueva" en el mismo navegador y se puede ingresar
      con la nueva.
- [ ] **Invitación con cuenta nueva:** crear la cuenta desde el link, confirmar el email,
      aceptar y entrar al panel.
- [ ] **Marca:** cambiar colores y logo en `/admin/marca` y verlos en el sitio, el panel, las
      pantallas de ingreso y el ícono de la pestaña; ver los avisos de contraste en vivo.
- [ ] **Celular:** sitio, login, invitación y "Mis datos" se usan cómodos en 375 px de ancho.

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
- Solo sirve para el email al que se envió, con el email **confirmado**: vencen a los 7 días
  (14 para la dueña) y son de un solo uso.
- La vista previa del link muestra estudio, rol y email enmascarado; nunca ids.

**Clientas**
- Una cuenta (Google) y una ficha **por estudio**. La ve la propia clienta y el equipo con
  `clients.read`; Cleo Admin no.
- Una ficha cargada por el estudio se vincula al primer ingreso solo si el email coincide
  exacto y no tenía usuaria.
- La auditoría de fichas registra qué campos cambiaron, nunca nombres, emails ni teléfonos.

**Estudios, marca y políticas**
- Solo Cleo Admin crea estudios, cambia su URL o los suspende. Suspender no borra nada:
  el estudio queda en solo lectura y su página pública se oculta.
- Los colores de marca se validan en la base con las mismas reglas de contraste que la app
  (texto ≥ 4.5:1; botones y acentos ≥ 3:1). Los logos solo PNG/JPEG/WebP de hasta 1 MB, en
  la carpeta del propio estudio.
- Seña 50% (siempre mayor a 0%) y ventana de cancelación de 24 h por defecto, configurables
  por estudio. Cada cambio de política
  crea una **versión inmutable** para que las reservas guarden cuál aceptó la clienta.
- Se validan zona horaria, formato de URL, URLs reservadas y emails.

**Servicios, profesionales y horarios**
- Las referencias usan claves compuestas `(tenant_id, id)`: la base hace imposible asignar a una
  profesional un servicio, categoría o cuenta de otro estudio, aun sin RLS.
- Precios en centavos, duraciones y tiempo extra en múltiplos de 5. Servicios y profesionales no
  se borran (se archivan) y cada cambio de precio queda auditado con el valor anterior y el nuevo.
- Escriben servicios y profesionales quienes tienen `services.manage`; el horario del estudio,
  `settings.manage`; horarios de profesionales y bloqueos, `agenda.manage`. Las profesionales
  solo miran. Cleo Admin no ve nada de esto.
- Franjas sin superposición (restricción de exclusión) y las de una profesional siempre dentro
  del horario del estudio. `app.working_intervals` calcula cuándo atiende cada una (descansos,
  bloqueos y zona horaria del estudio): es la base de la disponibilidad de reservas.
- El catálogo público muestra solo lo activo y visible, con «desde» cuando corresponde, y no
  expone cuentas, tiempo extra ni seña.

**Reservas**
- **Doble reserva imposible:** restricción de exclusión de la base sobre el tiempo ocupado
  (servicio + tiempo extra) de cada profesional, para reservas activas. Probado con 20
  conexiones simultáneas y con 10 envíos simultáneos a la app.
- La disponibilidad se calcula siempre en el servidor (horarios, descansos, bloqueos, duración
  propia, tiempo extra, anticipación de 12 h, 60 días, zona horaria del estudio). Al reservar se
  recalcula todo: la pantalla no decide nada.
- El bloqueo temporal es la misma reserva "esperando pago" y vence a las 2 h (configurable),
  sin depender de un reloj externo; pg_cron solo actualiza el historial.
- Cada reserva guarda la foto de lo acordado (servicio, profesional, precio, duración, tiempo
  extra, seña redondeada al peso y versión de la política), que no cambia aunque cambien los
  precios. Código de 6 caracteres, estado de la reserva separado del de la seña, historial de
  solo agregado.
- Toda reserva lleva seña (1–100%). Se confirma solo con el pago verificado por el servidor
  (`app.confirm_deposit_payment`, solo `service_role`) o con la seña cobrada en el estudio
  (permiso de caja), que queda registrada.
- La clienta ve solo sus reservas; la profesional, solo sus turnos; Cleo Admin, ninguna.

**Pagos (Mercado Pago)**
- Cada estudio cobra en **su** cuenta: la conecta solo la dueña (`payments.manage`) por OAuth con
  PKCE y un `state` de un solo uso, atado a ella y al estudio. Una cuenta de Mercado Pago no se
  puede conectar a dos estudios.
- Los tokens se cifran en el servidor (AES-256-GCM, clave en Render, atados al estudio) y la
  tabla no tiene políticas ni grants: ni la dueña ni Cleo Admin la leen. Se renuevan solos (una
  renovación a la vez); si Mercado Pago revoca el acceso, el estudio queda «volver a conectar» y
  se apagan las reservas online.
- Una reserva se confirma solo cuando el servidor consulta el pago a la API de Mercado Pago y
  coinciden cuenta, link de pago del mismo estudio, monto y moneda. Volver de Mercado Pago no
  confirma nada.
- Idempotencia: un pago existe una sola vez (`provider_payment_id` único) y cada aviso se
  guarda una vez (`x-request-id`). Probado con 20 avisos iguales a la vez y 20 pagos distintos
  de la misma reserva a la vez (uno confirma, los demás se devuelven).
- Pago tardío: si el horario sigue libre, confirma; si no, se devuelve el 100% solo. La base
  sigue impidiendo la superposición.
- El registro de pagos y su historial (solo agregado) lo ven quienes tienen caja o la agenda
  completa. La profesional, la clienta (salvo el resultado de su reserva) y Cleo Admin, no.

**Auditoría**
- Se registra quién hizo cada cambio en estudios, configuración, roles, membresías,
  invitaciones, dominios, fichas, servicios, profesionales, horarios y bloqueos. Las reservas
  tienen su propio historial.
- Es de solo agregado: nadie puede editarla ni borrarla, ni siquiera el superusuario.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Identificación del estudio | Por host: `{slug}.cleo.com.ar` (y más adelante dominios propios en `tenant_domains`). El estudio siempre sale del host, nunca de un dato del formulario. |
| Panel del estudio | En `{slug}.cleo.com.ar/admin`. Quien trabaja en dos estudios inicia sesión en cada uno. |
| Cuentas de clientas | Una identidad de login (Google) con una ficha separada por estudio. |
| Operaciones sensibles | Por funciones de base de datos (RPC) que validan permisos adentro. La interfaz nunca decide. |
| Cleo Admin y datos del estudio | Puede ver estudios, configuración y equipos (para soporte). **No** tiene acceso a clientas, turnos ni caja. |
| Borrado | Los estudios no se borran: solo se suspenden o cancelan. Las fichas se archivan. |

## Pendiente

- **Proyecto Supabase de producción:** el proyecto actual (`bitfpryusoonfbgdtxkg`) es el de
  desarrollo. Antes de lanzar hay que crear uno nuevo, aplicarle las migraciones **sin seed**,
  configurar Auth (URLs, Google, SMTP) y cargar sus variables en el Web Service de Render. Conviene renombrar el
  actual a `cleo-dev` en el panel de Supabase.
- **Dominio `cleo.com.ar`:** registrarlo y agregar en Render `cleo.com.ar`, `*.cleo.com.ar`
  (comodín) y verificar los registros DNS que Render indique.
- **SMTP propio (Resend)** para los emails de Auth, y envío del email de invitación (hoy la
  invitación es un link que la dueña manda por WhatsApp).
- **Dominios propios de estudios:** la tabla y la resolución ya existen; falta la
  verificación DNS, el alta en Render y las pantallas de Cleo Admin.
- **Pantallas de Cleo Admin** (estudios, planes, módulos) y **límites por plan (SAAS-04)**.
- **Backups y monitoreo (ARC-09):** se configuran en Supabase (PITR) y Render.
- **Rol Profesional:** hoy tiene `clients.read` y ve todas las clientas del estudio; con la
  agenda conviene limitarlo a sus propias clientas.
- **Antes del lanzamiento — prueba con el Mercado Pago real (sandbox):** hasta ahora los pagos
  se probaron de punta a punta contra un Mercado Pago **simulado** (`npm run e2e:pagos`). Falta
  la prueba con Mercado Pago de verdad, con cuentas de prueba:
  1. Crear la aplicación "Cleo Suite" en Mercado Pago Developers con la cuenta de Cleo
     ([plan §14](docs/sprint-5-plan.md)) y las cuentas de prueba vendedora y compradora.
  2. Abrir un túnel HTTPS (`npx cloudflared tunnel --url http://localhost:3000`) y registrar en
     la aplicación la URL de vuelta (`/api/pagos/mp/vuelta`, con PKCE y renovación) y la de
     webhooks (`/api/pagos/mp/webhook`, evento Pagos).
  3. Cargar las variables de Mercado Pago en `.env.local` (ver `.env.example`).
  4. Recorrer el checklist manual del Sprint 5 (más arriba, sección "Checklist manual").
  Hay que confirmar en esa prueba tres cosas que la documentación de Mercado Pago no deja del
  todo claras: que los avisos de pagos hechos con el token de un estudio conectado por OAuth
  llegan a la URL de webhooks de la aplicación con su `user_id` y firmados; que el canje del
  código funciona con las credenciales de la aplicación sin `test_token`; y qué formato tiene
  el `scope` de los tokens (`offline_access`). Si algo difiere, se ajusta antes de lanzar.
- **Mercado Pago en producción:** credenciales de producción de la aplicación (pide datos del
  negocio), URL de vuelta y de webhooks con `cleo.com.ar`, variables en Render y secretos del
  Vault (ver "Mercado Pago (por entorno)").
- **Cobro del saldo y caja** (PAY-07, Épica 09): el registro de pagos ya queda listo para la caja.
- **Cancelar y reprogramar con seña** (ventana de 24 h, crédito o pérdida): Épica 07.
- **Agenda visual** por día y semana: Épica 08. Al bloquear un día que ya tiene turnos, avisar.
- **Estudio Prueba** sigue con ventana de 48 h: la migración cambió el valor por defecto y
  Fresas; los estudios existentes conservan su configuración.

## Pendientes técnicos

- **`cacheComponents` desactivado** (`next.config.ts`): el sitio y el panel de cada estudio
  dependen del host, la base y la sesión, y así los 404 y las redirecciones de login son HTTP
  reales. Next anuncia que en su próxima versión mayor la opción deja de existir: al
  actualizar habrá que adaptar esas rutas (Suspense / `use cache: private`).
- **Caché del CDN de Storage:** al quitar un logo, su URL pública puede seguir respondiendo un
  rato. Cada logo nuevo usa un nombre único, así que nunca se muestra uno viejo en su lugar.
- **Vulnerabilidad de `minimatch` en dependencias de desarrollo:** `npm audit` reporta
  `minimatch` < 11.0.1 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)),
  que entra por `typescript-eslint` (vía `eslint-config-next`) y por `ts-morph` (vía la CLI de
  `shadcn`). Hoy sus últimas versiones todavía piden `minimatch` 10.x, así que no hay arreglo
  posible sin forzar versiones. No afecta a producción (`npm audit --omit=dev` da 0).
  Cuando `typescript-eslint` y `ts-morph` acepten `minimatch` 11, correr `npm update`,
  confirmar con `npm audit` y verificar que `npm run lint` y `npm run build` sigan pasando.
  No usar `npm audit fix --force`: propone bajar `shadcn` a la 1.0.0.
