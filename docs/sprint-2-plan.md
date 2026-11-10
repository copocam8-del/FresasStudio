# Sprint 2 — Plan: Cleo, subdominios y acceso

> Estado: **aprobado** con las decisiones D1–D7 (10/11/2026). Se implementa por partes,
> con un commit por parte y los tests en verde en cada paso.

## Contexto y decisiones de producto

1. La plataforma se llama **Cleo**. Paneles: **Cleo Admin** (superadministración, de
   Cleo) y **Cleo Manager** (panel de cada estudio). Fresas Studio es el primer estudio
   cliente.
2. **Marca blanca:** en el sitio y en el panel de cada estudio se ve **solo el nombre y la
   marca del estudio**, nunca "Cleo".
3. **Dominio:** cada estudio en `{slug}.cleo.com.ar`; más adelante, dominios propios. El
   dominio todavía no está registrado: se trabaja en local con `*.localhost`.
4. **Acceso:** las clientas entran con Google; el equipo, con email y contraseña.

### Decisiones tomadas

| # | Decisión |
|---|---|
| D1 | El panel de cada estudio vive en **`{slug}.cleo.com.ar/admin`**. Las clientas usan `{slug}.cleo.com.ar`. Quien trabaja en dos estudios inicia sesión en cada uno por separado (la sesión es por host). |
| D2 | En toda la app se muestra el nombre del estudio. La pantalla de consentimiento de Google, única para todos, se llama **"Cleo Suite"**. |
| D3 | ~~Proyecto `cleo-dev` aparte~~ → **Actualizado:** el proyecto actual (`bitfpryusoonfbgdtxkg`) es el de **desarrollo** (migraciones + seed). Producción será un proyecto nuevo, creado antes del lanzamiento: migraciones sí, seed **nunca**. |
| D4 | La invitación genera un **link para copiar** (la dueña lo manda por WhatsApp). Email con Resend más adelante. |
| D5 | Tema por defecto de Cleo: **beige, marrón, dorado y blanco**, elegante. Cada estudio cambia sus colores y su logo desde su panel (`tenant_settings.brand`) y se aplican en su sitio y su panel. El dorado es acento, nunca texto chico. |
| D6 | Fresas Studio usa el slug **`fresas`** (se libera de la lista de reservados). |
| D7 | Una ficha cargada por el estudio se vincula sola al primer login con Google **solo si** el email coincide exacto y la ficha no tiene usuaria. |

**Alcance (backlog):** renombre · ARC-03 (entorno dev) · ARC-05 (identificación por
host) · TEN-02/03 (logo y colores) · TEN-07 (URL pública) · AUTH-01/02/03 · CRM-01
(ficha base).

**Fuera de alcance:** ABM de clientas en el panel, notas internas (CRM-03), alta real de
dominios propios en Vercel, pantallas de Cleo Admin más allá del login, email de
invitación (D4), Playwright.

**A definir sin bloquear:** renombrar el repo de GitHub, la carpeta local y el proyecto
de Supabase "Fresas". Los `.docx` de `docs/` quedan como documentos históricos.

---

## 1. Renombrar Fresas → Cleo

### Código y documentación
- `package.json`: `name` → `cleo`.
- `README.md`, `CLAUDE.md`: Cleo / Cleo Admin / Cleo Manager. Fresas Studio pasa a ser
  un estudio cliente.
- `supabase/seed.sql`: `admin@fresas.test` → `admin@cleo.test`; Fresas Studio con slug
  `fresas`.
- Tests: nombres y mensajes esperados con "Cleo Admin" y slug `fresas`.
- Las **migraciones viejas no se tocan**.

### Migración `…_cleo_rename.sql`
1. Chequeo previo: aborta si algún estudio usa un slug que se va a reservar.
2. **Reserva:** `cleo`, `cleo-admin`, `cleoadmin`, `cleo-manager`, `cleomanager`,
   `cleo-app`, `cleo-suite`, `cleosuite` y nombres de infraestructura y producto: `mail`,
   `email`, `smtp`, `imap`, `mx`, `ns1`, `ns2`, `ftp`, `cdn`, `img`, `media`, `dev`,
   `staging`, `preview`, `test`, `demo`, `sandbox`, `localhost`, `id`, `sso`, `oauth`,
   `callback`, `webhook`, `webhooks`, `panel`, `dashboard`, `cuenta`, `account`,
   `billing`, `facturacion`, `pagos`, `invitacion`, `invite`.
3. **Libera** `fresas` (D6).
4. `app.validate_tenant`: mensaje "Solo Cleo Admin…" y rechazo de slugs `xn--…`.
5. `admin_create_studio` y `admin_set_tenant_status`: mensajes con "Cleo Admin".
6. `comment on schema app`.

> ⚠️ `create or replace function` borra el `search_path` si no se repite: todas llevan
> `set search_path = ''` y el test meta lo controla.

**Aceptación:** "Fresas" ya no aparece como nombre de plataforma (solo como estudio y en
migraciones viejas). `cleo`, `mail` y `xn--abc` se rechazan como slug y `fresas` se
acepta. Los mensajes de error dicen "Cleo Admin".

---

## 2. Entorno de desarrollo (D3)

- La CLI queda **linkeada a `cleo-dev`**. Producción solo con `--remote=<ref de prod>`
  explícito, nunca con `--include-seed`.
- `.env.local` apunta a `cleo-dev`. Las variables de producción irán en Vercel.
- **Seed apto para Supabase real:**
  - Las usuarias de prueba se crean con contraseña (`crypt`), `email_confirmed_at` y su
    fila en `auth.identities`, para poder iniciar sesión en `cleo-dev`.
  - El shim local suma esas columnas y la tabla `auth.identities`.
  - Contraseña común de desarrollo, documentada en el README. Las direcciones son
    `.test`, que no existen.
- README y CLAUDE.md: qué comando va a cada entorno.

**Aceptación:**
- `cleo-dev` tiene las migraciones y el seed, y se puede iniciar sesión con la dueña de
  prueba.
- Producción tiene las migraciones y ningún dato de seed.

---

## 3. Hosts, rutas y marca blanca

### 3.1 Mapa de hosts (D1)

| Host | Qué es | Ruta interna (rewrite) |
|---|---|---|
| `cleo.com.ar`, `www.cleo.com.ar` (local: `localhost:3000`) | Sitio de Cleo | `/` |
| `admin.cleo.com.ar` (local: `admin.localhost:3000`) | **Cleo Admin** (plataforma) | `/platform/…` |
| `{slug}.cleo.com.ar` | Sitio del estudio | `/sites/{host}/…` |
| `{slug}.cleo.com.ar/admin/…` | **Cleo Manager** de ese estudio | `/sites/{host}/admin/…` |
| Dominio propio verificado (futuro) | Igual que el subdominio | `/sites/{host}/…` |
| `*.vercel.app` | Igual que el dominio raíz | `/` |

Los subdominios reservados que no son `admin` (`www`, `api`…) dan 404 en el sitio del
estudio.

### 3.2 `src/proxy.ts` (Next 16 renombró `middleware.ts` a `proxy.ts`)
1. Normaliza el host (minúsculas, sin puerto ni punto final). Si es inválido, 404.
2. Lo clasifica con `NEXT_PUBLIC_ROOT_DOMAIN` (`cleo.com.ar`; en local `localhost:3000`).
3. **Bloquea** el acceso directo a `/sites/…` y `/platform/…`: 404.
4. Hace el `rewrite` y refresca la sesión de Supabase (`@supabase/ssr`).
5. `matcher` sin `_next/static`, `_next/image`, favicon ni `public/`.
6. No consulta la base y **no autoriza nada**: cada página, Server Action y Route
   Handler verifica sesión y permisos de nuevo.

La lógica de host es una función pura en `src/lib/host.ts`, con tests unitarios.

### 3.3 Resolución del estudio (servidor)
`resolveSite(host)`:
- `{slug}.{root}` → `get_public_studio(slug)`.
- Dominio propio → `resolve_custom_domain(host)` → slug.
- No existe o está suspendido: 404 neutro, **sin marca de nadie**.

### 3.4 Marca blanca
- `generateMetadata` por host: nombre del estudio como título, en el sitio y en el panel.
- Sin "Cleo" en el sitio ni en el panel del estudio: textos, títulos, 404, errores y
  favicon. "Cleo" aparece solo en `cleo.com.ar`, en Cleo Admin y en la pantalla de
  Google ("Cleo Suite").

### 3.5 Seguridad por compartir host entre clientas y equipo
El panel y el sitio público comparten origen y cookies, así que un XSS en el sitio
afectaría al panel. Para evitarlo:
- Todo contenido del estudio se renderiza escapado (sin `dangerouslySetInnerHTML`).
- Los logos solo se aceptan en PNG, JPEG o WebP. **SVG no**, porque puede llevar
  scripts.
- Los colores de marca se validan como hexadecimales antes de inyectarlos como variables
  CSS.
- `/admin` exige sesión **y** membresía activa en *ese* estudio. Una clienta logueada
  con Google que entra a `/admin` ve 404.

### 3.6 Migración `…_tenant_domains.sql`
Tabla `tenant_domains`:
- Campos: `domain` único y validado, `status` (`pending` · `verified` · `disabled`),
  `is_primary`, `verification_token`, `verified_at`.
- No acepta dominios que terminen en `cleo.com.ar` ni en `localhost`.
- RLS: `select` con `settings.manage` o Cleo Admin. Sin escritura directa y nada para
  `anon`.

RPC:
- `resolve_custom_domain(domain)` (`anon`): devuelve el slug solo si el dominio está
  verificado y el estudio operativo.
- `admin_add_tenant_domain` y `admin_set_domain_status`: solo Cleo Admin, con auditoría.

**Aceptación:**
- `fresas.localhost:3000` muestra Fresas Studio.
- Un slug inexistente, reservado o suspendido da 404 neutro.
- `localhost:3000/sites/fresas` da 404.
- Un dominio `pending` no resuelve.
- Un estudio no ve los dominios de otro.

---

## 4. Tema por defecto y marca de cada estudio (D5)

### 4.1 Tema por defecto de Cleo (`globals.css`)
- Beige y blanco de fondo, marrón para el texto principal y los botones, dorado como
  acento.
- **Contraste:**
  - Texto ≥ 4.5:1 y bordes de campos ≥ 3:1, en modo claro y oscuro.
  - El dorado solo va en elementos no textuales (bordes, anillo de foco, detalles) o en
    texto grande ≥ 3:1.
  - Hay un token `--gold` aparte de `--primary`, para que nadie lo use como texto por
    error.
- Se mide con un script (`scripts/check-contrast.mjs`) que se corre como test.

### 4.2 Marca por estudio
- `tenant_settings.brand` (ya existe, `jsonb`), con este formato validado en la base:
  ```json
  { "primary": "#6b4f3a", "accent": "#c9a227", "background": "#faf6f0", "logo_path": "<tenant_id>/logo-<uuid>.webp" }
  ```
  - Colores en hexadecimal `#rrggbb`.
  - `logo_path` tiene que empezar con el `tenant_id` del estudio.
  - No se aceptan claves desconocidas.
- **Contraste en el servidor:**
  - Al guardar se calcula el color de texto sobre `primary` (blanco o casi negro, el que
    contraste más).
  - Se rechaza si `primary` no llega a 4.5:1 con ninguno, o si `background` no da 4.5:1
    con el texto principal.
  - `accent` solo necesita 3:1 contra `background`, porque no se usa como texto.
  - Si falla, un mensaje claro sugiere oscurecer o aclarar.
- **Aplicación:** el layout de `/sites/{host}` inyecta las variables CSS del estudio
  (`--primary`, `--primary-foreground`, `--accent`, `--background`…) sobre el tema por
  defecto. Lo que no está definido usa el valor de Cleo.
- **Logo:** bucket de Supabase Storage `brand`:
  - Lectura pública, porque el logo se muestra en el sitio.
  - Tipos PNG, JPEG o WebP, hasta 1 MB.
  - Escritura con RLS de `storage.objects`: solo en la carpeta `{tenant_id}/` y solo con
    `app.can(tenant_id, 'settings.manage')`.
  - El shim local suma un `storage` mínimo para testear esas políticas.
- **Panel:** `/admin/marca`, con selectores de color, vista previa, subida de logo y
  guardado. Requiere `settings.manage`.

**Aceptación:**
- Los colores y el logo de Fresas se ven en `fresas.localhost:3000` y en su `/admin`, y
  no en Estudio Prueba.
- Una combinación sin contraste suficiente se rechaza en el servidor, aunque se fuerce
  desde el navegador.
- Un estudio no puede subir ni pisar el logo de otro, y una Profesional (sin
  `settings.manage`) no puede cambiar la marca.

---

## 5. Equipo: acceso e invitaciones

### 5.1 Rutas en `{slug}.cleo.com.ar/admin`

| Ruta | Qué hace |
|---|---|
| `/admin/login` | Email y contraseña. Error genérico. Después del login exige membresía en este estudio; si no la tiene, cierra sesión y muestra el mismo error genérico. |
| `/admin/recuperar` | `resetPasswordForEmail` con redirect a este host. Siempre el mismo mensaje. |
| `/admin/auth/confirm` | Route Handler que verifica el `token_hash` del email. |
| `/admin/restablecer` | Nueva contraseña. |
| `/admin/invitacion?token=…` | Aceptar invitación (5.2). |
| `/admin` | Inicio: nombre del estudio y rol. Datos reales. |
| `/admin/equipo` | Lista del equipo e **invitar**: email y rol → muestra el link una sola vez, con botón "Copiar" (D4). Requiere `team.manage`. |
| `/admin/marca` | Sección 4.2. |
| `/admin/salir` | Cierra sesión. |

**Cleo Admin** (`admin.localhost:3000`): login y guard de `platform_admins`. Las
pantallas de administración quedan para otro sprint.

### 5.2 Flujo de invitación
1. La dueña invita desde `/admin/equipo`, obtiene
   `https://fresas.cleo.com.ar/admin/invitacion?token=…` y lo manda por WhatsApp. El
   token se muestra **una sola vez**; en la base queda solo su hash.
2. La persona abre el link. `get_invitation_preview(token)` muestra estudio, rol y email
   enmascarado, o el motivo si no sirve: vencida, usada, anulada o inválida.
3. **Sin cuenta:** la crea con el email de la invitación (fijo) y una contraseña.
   Supabase le manda el email de confirmación, que vuelve al link.
4. **Con sesión y email confirmado:** "Aceptar" → `accept_invitation(token)` →
   `/admin`.
5. **Con sesión de otro email:** lo informa y ofrece cerrar sesión.

> El email de confirmación de cuenta lo envía Supabase con su SMTP por defecto, que tiene
> un límite muy bajo y en producción solo llega a los miembros de la organización. En
> `cleo-dev` alcanza para probar. Antes de invitar a gente real hace falta SMTP propio
> (Resend), aunque las invitaciones sigan yendo por WhatsApp.

### 5.3 Migración `…_team_auth.sql`
- `get_invitation_preview(token)` (`anon`): sin ids ni email completo.
- `accept_invitation`: además exige `email_confirmed_at`.
- `app.handle_new_user`: copia `full_name` desde los metadatos (Google), con un tope de
  120 caracteres.
- `team_members()`: lista del equipo de un estudio (nombre, email, rol y estado) para
  quien tiene `team.read`. Los emails están en `auth.users`, que la API no expone.

### 5.4 Validaciones (servidor, con zod)
- Email: normalizado, hasta 254 caracteres.
- Contraseña: de 10 a 72 caracteres.
- Token: `^[0-9a-f]{64}$`.
- `next`: solo rutas relativas, sin `//`.
- Rol a invitar: tiene que pertenecer al estudio. La base lo vuelve a validar, junto con
  la regla anti-escalada.

### 5.5 Supabase Auth (por entorno)
- Confirmación de email activada, "Secure password change" y largo mínimo de 10.
- Redirect URLs:
  - `cleo-dev`: `http://*.localhost:3000/**`.
  - Producción: `https://*.cleo.com.ar/**`.
- Recomendado más adelante: CAPTCHA y MFA para Cleo Admin y dueñas.

**Aceptación:**
- Una persona invitada crea su cuenta, confirma, acepta y entra al panel.
- La invitación falla con otro email, sin confirmar, vencida, usada o anulada, con
  mensajes claros.
- Sin `team.manage` no se puede invitar.
- La recuperación responde igual para emails existentes e inexistentes.
- Una persona del equipo de Fresas no entra a `estudio-prueba.localhost:3000/admin`.
- Una clienta con Google no entra a `/admin`.

---

## 6. Clientas con Google y ficha por estudio

### 6.1 Flujo
1. En `{slug}.cleo.com.ar/ingresar`, "Continuar con Google" (la pantalla de Google dice
   "Cleo Suite").
2. `/auth/callback`: `exchangeCodeForSession` → `ensure_client_profile(slug)`.
3. Redirige a `next` (validado) o a `/mi-ficha`.

### 6.2 Migración `…_client_profiles.sql`
`client_profiles`:
- Campos: `tenant_id`; `user_id` nullable (la ficha puede cargarla el estudio);
  `full_name`, `email`, `phone`, `status` (`active` · `archived`) y `source`
  (`self_signup` · `staff`).
- Únicos `(tenant, user_id)` y `(tenant, email)`.
- Solo datos que la clienta puede ver. Las notas internas van en otra tabla, porque RLS
  filtra filas y no columnas.

| Operación | Quién |
|---|---|
| Ver | La propia clienta (`user_id = auth.uid()`) o el equipo con `clients.read` |
| Crear y editar | El equipo con `clients.manage` (grants por columna); la clienta, solo por RPC |
| Borrar | Nadie: se archiva |
| Cleo Admin, `anon` | Sin acceso |

- Trigger guard: `tenant_id`, `user_id` y `source` son inmutables. También auditoría y
  `updated_at`.

RPC:
- `ensure_client_profile(slug)`: idempotente. Vincula por email según D7 o crea la
  ficha.
- `my_client_profile(slug)` y `update_my_client_profile(slug, nombre, teléfono)`: sin
  ids internos.

### 6.3 Rutas del sitio

| Ruta | Qué hace |
|---|---|
| `/` | Página pública con datos reales y la marca del estudio. |
| `/ingresar` | Botón de Google. |
| `/auth/callback` | Intercambio del código y alta de la ficha. |
| `/mi-ficha` | Ver y editar nombre y teléfono. |
| `/salir` | Cierra sesión. |

### 6.4 Configuración
- Google Cloud: consentimiento "Cleo Suite" y cliente OAuth web con el redirect de
  Supabase de **cada** entorno.
- Supabase: activar el proveedor Google en `cleo-dev` y en producción.

**Aceptación:**
- Una ficha por estudio: no se duplica y es independiente entre A y B.
- La clienta ve y edita solo la suya.
- El equipo de A ve las de A y no las de B.
- Cleo Admin no las ve.
- En un estudio suspendido no se crea la ficha.

---

## 7. Tests

**Base de datos** (`db/tests/02_*.sql`, corre con `./scripts/test-db.sh`):
- **Renombre:** slugs rechazados y aceptados, mensajes y `search_path`.
- **`tenant_domains`:** aislamiento y resolución.
- **Marca:**
  - Formato de `brand` y `logo_path` de otro estudio.
  - Políticas de Storage: subir al propio, al de otro y sin permiso.
- **Invitaciones:** preview sin datos sensibles, aceptar sin email confirmado y
  `team_members()` solo con `team.read`.
- **Fichas:** todos los criterios de 6.x, incluida la vinculación de D7.

**Unitarios (Vitest):**
- `host.ts`.
- Esquemas zod.
- Contraste de la marca: colores límite, rechazos y cálculo del color de texto.
- Contraste del tema por defecto.

**Manuales** (checklist en el README):
- Google en dos estudios.
- Recuperación de contraseña.
- Invitación de punta a punta.
- Cambio de marca.
- Rutas internas bloqueadas.

---

## 8. Cómo probar subdominios en local

- `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000`.
- Chrome, Edge y Firefox resuelven `*.localhost` solos:
  - `http://fresas.localhost:3000` (sitio) y `http://fresas.localhost:3000/admin`
    (panel).
  - `http://estudio-prueba.localhost:3000`.
  - `http://admin.localhost:3000` (Cleo Admin).
  - `http://localhost:3000` (sitio de Cleo).
- Next 16 ya acepta los subdominios de `localhost` en desarrollo.
- En Windows, Node y las herramientas de línea de comandos **no** resuelven
  `*.localhost` (probado: `ENOTFOUND`). Usar
  `curl -H "Host: fresas.localhost:3000" http://localhost:3000/` o el archivo `hosts`.
- Cookies separadas por subdominio, como en producción.
- Google en local: la Redirect URL `http://*.localhost:3000/**` en `cleo-dev`.

## 9. Orden de implementación (un commit por paso)

1. Renombre, slugs y seed con `fresas`, con tests.
2. Entorno `cleo-dev`: link, shim y seed con usuarias que pueden iniciar sesión.
3. Tema por defecto de Cleo y chequeo de contraste.
4. Vitest, `host.ts` y `proxy.ts`, con rutas internas y página pública mínima.
5. `tenant_domains`, con tests.
6. Cliente Supabase SSR, login del equipo, recuperación e invitación (migración
   `team_auth`).
7. `/admin/equipo`: invitar con link copiable.
8. `client_profiles`, Google y `/mi-ficha`.
9. Marca por estudio: validación, Storage, `/admin/marca` y aplicación en el sitio.
10. README, CLAUDE.md y checklist manual.

Cada paso: lint, build, Vitest (desde el paso 4) y `./scripts/test-db.sh` en verde. Las
migraciones van a `cleo-dev`. A producción, solo cuando se pida.
