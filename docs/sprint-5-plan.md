# Sprint 5 — Plan: Mercado Pago y pagos (Épica 06)

> Estado: **implementado** (pasos 0 a 8), migraciones aplicadas en desarrollo y e2e con Mercado
> Pago simulado en verde (`npm run e2e:pagos`). Pendiente **antes del lanzamiento**: la prueba con
> el Mercado Pago real y cuentas de prueba (§13, §14), anotada en el README.
> Hosting: **Render** (Web Service), no Vercel. Las variables de entorno van en Render.
>
> **Render y los webhooks:** Mercado Pago espera la respuesta en 22 segundos. Una instancia
> gratuita de Render se duerme tras 15 minutos sin tráfico y tarda en despertar, así que el
> primer aviso podría perderse. Mercado Pago reintenta y la revisión cada 10 minutos (P9) lo
> levanta igual, pero en producción conviene una instancia paga (que no se duerme).
>
> **Cambios de implementación respecto del plan:**
> - **Webhook:** se configura una sola URL en la aplicación (Webhooks → Configurar
>   notificaciones), sin `notification_url` por preferencia ni `?c=<cuenta>`. El estudio sale del
>   `user_id` del aviso (la cuenta conectada por OAuth). La firma no se rechaza por antigüedad
>   del `ts` (los reintentos llegan tarde y repetir no tiene efecto).
> - **Modo prueba:** se detecta por la cuenta (`/users/me` con la etiqueta `test_user`), no por
>   el `live_mode` de cada pago.
> - **Cifrado:** el "dato asociado" ata cada token al estudio (y al tipo de token).
> - **Devolución por pago duplicado** (`duplicate`): si la seña ya estaba pagada (otro pago o
>   cobrada en el estudio), el pago de más se devuelve solo.
> - **Concurrencia:** los pagos de una misma reserva se ordenan bloqueando la reserva al
>   principio (el test de 20 pagos simultáneos encontró un deadlock con el orden original).
> - **Desarrollo:** el seed suma `dev_restore_seed_payments` para que el e2e de pagos deje
>   Fresas como el seed (pagos "conectados" para el pago simulado de los otros e2e).

Backlog: PAY-01 a PAY-06 completos, la parte de PAY-08 que hace falta para los pagos tardíos
(devolución automática y desconexión) y QA-03 (pruebas de pagos y webhooks). PAY-07 (saldos
cobrados en el estudio) queda para la Épica 09 (caja), salvo lo que ya existe
(`mark_deposit_paid_offline`).

**Criterios de la épica (backlog):**
- Cada estudio cobra en su cuenta.
- Una notificación duplicada no duplica operaciones.
- Las credenciales nunca llegan al navegador.

**Fuera de alcance:**
- Cancelar o reprogramar con seña, créditos y pérdida de seña (Épica 07).
- Caja, libro financiero, cierres y comisiones (Épica 09). Este sprint deja el registro de pagos
  listo para que la caja lo lea.
- Cobrar el saldo del turno por Mercado Pago (Épica 09).
- Suscripción de los estudios a Cleo (SAAS).
- Otros países y monedas: solo Mercado Pago Argentina y pesos (ARS).

---

## 0. Decisiones de negocio que necesito

Si estás de acuerdo con todas, alcanza con un "OK".

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| P1 | **¿Cleo se queda con una comisión de cada seña?** (Mercado Pago lo permite: `marketplace_fee`) | **No, por ahora.** Cleo cobra su abono mensual (SAAS) y la seña llega entera a la cuenta del estudio, menos la comisión de Mercado Pago, que paga el estudio como en cualquier cobro. Cobrar por transacción complica la facturación y es más difícil de explicar a la dueña. Si más adelante se quiere, se agrega sin cambiar el modelo. |
| P2 | **¿Qué medios de pago se aceptan?** | **Tarjeta de crédito, de débito, prepaga y dinero en cuenta de Mercado Pago. Sin Rapipago ni Pago Fácil** (ni otros pagos en efectivo). Esos tardan horas o días en acreditarse y el horario se guarda 2 h: la clienta pagaría y perdería el turno. Además se usa el **modo binario**: el pago se aprueba o se rechaza en el momento, nunca queda "en revisión". |
| P3 | **¿En cuántas cuotas?** | **Una sola.** Es una seña chica; con cuotas, el estudio paga el interés o la clienta ve un monto distinto del que le mostramos. |
| P4 | **Pago que llega cuando la reserva ya venció** (la clienta pagó justo al límite, o Mercado Pago avisó tarde) | **Si el horario sigue libre y el turno todavía no pasó: se confirma igual.** Es lo que la clienta quería y el estudio no pierde nada; la base vuelve a garantizar que no haya superposición. **Si el horario ya lo tomó otra, si la clienta había liberado la reserva o si el turno ya pasó: se le devuelve el 100% automáticamente por Mercado Pago** y queda registrado. Si la devolución falla (por ejemplo, la cuenta del estudio no tiene saldo), el pago aparece en el panel como **"Pago a resolver"** con un botón para reintentar. **No lo convertimos en crédito todavía**: los créditos llegan con la Épica 07 y una devolución es lo más claro para la clienta (y lo que pide Defensa del Consumidor cuando no se presta el servicio). Para que casi nunca pase, el link de pago vence junto con la reserva y solo se aceptan medios instantáneos (P2). |
| P5 | **¿Quién conecta Mercado Pago?** | **Solo la dueña** (permiso `payments.manage`, que ya existe y que la encargada no tiene). La dueña conecta la cuenta **del estudio**: el dinero va a esa cuenta. |
| P6 | **¿Qué pasa al desconectar?** | **Se apagan las reservas online en el momento** (sin pagos no hay reservas, regla de B10). Las reservas que estaban esperando pago se quedan sin link para pagar y vencen solas. Antes de desconectar se muestra cuántas hay. Los tokens se borran de la base. Recomendamos además quitar el permiso desde Mercado Pago (le explicamos dónde). |
| P7 | **Si Mercado Pago revoca el acceso** (la dueña lo quitó desde su cuenta o venció la renovación) | **Se marca "Hay que volver a conectar"**, se apagan las reservas online y se avisa en el inicio del panel. Nada se cobra en una cuenta sin acceso verificado. |
| P8 | **¿Qué pasa si la clienta o el estudio devuelve el pago desde Mercado Pago, o hay un contracargo?** | **Se registra y se avisa en el detalle del turno, pero el turno no se cancela solo.** Cancelar tiene consecuencias (Épica 07) y lo decide el estudio. |
| P9 | **¿Se confirma solo por el webhook?** Los avisos de Mercado Pago a veces no llegan. | **Por el webhook y, como respaldo, por una revisión automática cada 10 minutos** que consulta a Mercado Pago los pagos de las reservas esperando pago. Las dos usan **exactamente el mismo camino**: consultar el pago a la API de Mercado Pago con las credenciales del estudio y verificar todo. Lo que nunca confirma es que la clienta vuelva de la pantalla de pago, ni nada que mande el navegador. |
| P10 | **¿Qué ve la clienta en su resumen de Mercado Pago?** | **El nombre del estudio** (`statement_descriptor`, recortado a lo que permite Mercado Pago). Nunca "Cleo" (marca blanca). |

---

## 1. Cómo funciona, en una página

```
Dueña ── "Conectar Mercado Pago" ──► Mercado Pago (autoriza) ──► Cleo guarda los tokens cifrados
                                                                       │
Clienta ── reserva (Sprint 4) ── "Pagar seña" ──► servidor crea preferencia EN LA CUENTA DEL ESTUDIO
                                                     (monto de la base, vence con la reserva)
          paga en Mercado Pago ──► vuelve al sitio: "Estamos verificando tu pago" (no confirma nada)
                                                                       │
Mercado Pago ── webhook ──► servidor: guarda el aviso (sin duplicar) ──► CONSULTA EL PAGO A LA API
   (y cada 10 min la revisión automática hace la misma consulta)          │
                                     aprobado + monto + moneda + cuenta + reserva coinciden
                                                                       ▼
                                          app.apply_mp_payment → confirma la reserva (una sola vez)
```

### Por qué es seguro
- **El aviso no se cree.** El webhook solo dice "mirá el pago N". El servidor lo pide a Mercado
  Pago con las credenciales del estudio. Un aviso inventado no puede producir un pago aprobado.
- **El pago tiene que ser de esa cuenta y de esa reserva.** Se compara `collector_id` con la
  cuenta del estudio, `external_reference` con nuestro intento de pago (que pertenece a una
  reserva de ese mismo estudio), el monto con la seña guardada en la base y la moneda con ARS.
- **Idempotente en dos niveles:** cada aviso se guarda una sola vez (clave única), y cada pago de
  Mercado Pago existe una sola vez en `payments` (clave única por id de pago). Aplicar un pago a
  una reserva ya confirmada por ese mismo pago no hace nada. Cien avisos iguales = un pago, una
  confirmación, un evento.

---

## 2. Conexión OAuth (PAY-01, PAY-02)

### Una sola URL de vuelta para todos los estudios

Mercado Pago exige que la URL de vuelta esté registrada y coincida exacta, y no acepta
comodines. Por eso:

1. La dueña toca "Conectar" en `fresas.cleo.com.ar/admin/pagos`. La acción (con su sesión y
   `payments.manage`) crea un **`state`** aleatorio (32 bytes), guarda su hash con el estudio, la
   usuaria, el `code_verifier` de PKCE y un vencimiento de 10 minutos, y la manda a Mercado Pago.
2. Mercado Pago vuelve a **una única URL registrada**: `https://cleo.com.ar/api/pagos/mp/vuelta`
   (sin nombre de estudio; la clienta nunca la ve, solo la dueña por un instante).
3. Esa ruta **no hace nada con el código**: busca el estudio por el `state` y redirige a
   `https://fresas.cleo.com.ar/admin/pagos/vuelta?code=…&state=…`.
4. Ahí, **con la sesión de la dueña** (que vive en el subdominio), el servidor verifica que el
   `state` exista, no esté usado ni vencido, sea de este estudio y de esta misma usuaria, y que
   siga teniendo `payments.manage`. Recién entonces cambia el código por los tokens (con PKCE y
   el secreto de la aplicación), lee la cuenta (`/users/me`: id, apodo, país) y la guarda.

Así nadie puede "pegar" su cuenta de Mercado Pago en otro estudio ni completar una conexión que
no empezó.

**Validaciones al conectar:** cuenta de Argentina (`site_id = MLA`), estudio en ARS, la
autorización incluye `offline_access` (sin eso no se puede renovar), y la misma cuenta de
Mercado Pago no puede estar conectada a dos estudios a la vez (evita que un estudio cobre en la
cuenta de otro por error).

### Tokens cifrados y solo en el servidor

- Se cifran **en el servidor de Next** con AES-256-GCM antes de llegar a la base. La clave
  (`PAYMENTS_ENCRYPTION_KEY`, 32 bytes) vive solo en las variables de entorno de Render, nunca en la base ni con prefijo
  `NEXT_PUBLIC_`. Si se filtra un backup de la base, los tokens no sirven.
- Como "dato asociado" del cifrado va el id del estudio y de la cuenta: un token cifrado no se
  puede mover a otro estudio.
- Columna `key_version` para poder rotar la clave sin desconectar a nadie.
- La tabla de credenciales tiene RLS sin ninguna política y sin grants para `anon` ni
  `authenticated`: ninguna usuaria (ni la dueña, ni Cleo Admin) puede leerla. Solo el código
  `server-only` con la clave de servidor, a través de funciones puntuales.
- El token **nunca** se devuelve a ninguna pantalla. La `public_key` tampoco hace falta: Checkout
  Pro solo necesita el link de pago.

### Renovación automática

- El token de Mercado Pago dura **180 días** y cada renovación entrega un `refresh_token` nuevo,
  que hay que guardar.
- **Todos los días** se renuevan los que vencen en menos de 30 días. También se renueva en el
  momento si Mercado Pago responde 401.
- **Una sola renovación a la vez por cuenta** (bloqueo en la base con vencimiento corto): si dos
  procesos renuevan juntos, el segundo usaría un `refresh_token` viejo y podría romper la
  conexión.
- Si la renovación falla con "permiso revocado" → P7. Si falla por un error temporal, se
  reintenta al día siguiente (hay 30 días de margen) y se registra.

---

## 3. Modelo de datos

Todas las tablas con `tenant_id not null`, claves compuestas `(tenant_id, x_id)`, RLS en la misma
migración y nada para `anon`. Dinero en `bigint` (centavos) con su moneda.

### `payment_accounts` — la cuenta conectada (sin secretos)

| Campo | Notas |
|---|---|
| `id`, `tenant_id` | |
| `provider` | `mercadopago` |
| `mp_user_id` (`bigint`), `mp_nickname`, `site_id` | De `/users/me`. Único entre cuentas activas (§2, validaciones) |
| `live_mode` | `false` en desarrollo con cuentas de prueba |
| `status` | `connected` · `needs_reconnect` · `disconnected` |
| `connected_by`, `connected_at`, `disconnected_by`, `disconnected_at` | |
| `token_expires_at`, `last_refreshed_at`, `last_error` (código nuestro, sin detalles de Mercado Pago) | |

Una sola cuenta `connected` o `needs_reconnect` por estudio (índice único parcial). Al
desconectar la fila queda como historia.

**RLS:** lectura con `payments.manage` o `settings.manage` (para ver el estado). Sin escritura
directa: todo por funciones. Cleo Admin ve **solo** si el estudio tiene pagos conectados (para
soporte, a través de su RPC), no los pagos.

### `payment_account_credentials` — los tokens cifrados

`account_id` (PK), `tenant_id`, `access_token_enc`, `refresh_token_enc`, `key_version`,
`expires_at`, `refresh_lock_until`, `updated_at`. RLS activada **sin políticas**; solo
`service_role`. Se borra la fila al desconectar.

### `payment_oauth_states` — conexiones en curso

`state_hash` (PK), `tenant_id`, `user_id`, `code_verifier_enc`, `expires_at` (10 min),
`used_at`. Solo funciones. Las vencidas se limpian con `pg_cron`.

### `payment_intents` — cada link de pago de una seña (preferencia de Checkout Pro)

| Campo | Notas |
|---|---|
| `id` | Va como `external_reference` en Mercado Pago (opaco, no dice nada) |
| `tenant_id`, `appointment_id` (compuesta), `account_id` (compuesta) | |
| `amount_minor`, `currency` | Copiados de la reserva (`deposit_minor`), nunca de la pantalla |
| `mp_preference_id`, `checkout_url` | |
| `status` | `open` · `paid` · `expired` · `cancelled` |
| `expires_at` | = `hold_expires_at` de la reserva |

Una sola intención `open` por reserva: tocar "Pagar seña" dos veces reutiliza el mismo link.

### `payments` — cada pago que informa Mercado Pago (PAY-04, PAY-06)

| Campo | Notas |
|---|---|
| `id`, `tenant_id`, `account_id`, `intent_id`, `appointment_id` | |
| `provider_payment_id` | **Único** con `provider`: la clave de la idempotencia |
| `status`, `status_detail` | Tal como los informa Mercado Pago: `approved`, `rejected`, `refunded`, `charged_back`… |
| `amount_minor`, `currency`, `refunded_minor` | |
| `fee_minor`, `net_minor` | Comisión de Mercado Pago y neto que recibe el estudio (para conciliar) |
| `payment_method`, `payment_type`, `installments` | Para mostrar "Visa crédito" |
| `approved_at`, `live_mode` | |
| `outcome` | Qué hicimos con él: `applied` (confirmó la reserva) · `late_confirmed` (P4, horario libre) · `refund_pending` · `refunded` · `needs_review` (monto o moneda no coinciden) · `ignored` (rechazado) |
| `last_synced_at` | Última vez que lo consultamos a Mercado Pago |

No guardamos datos de la tarjeta ni el email del pagador (no los necesitamos y son datos
personales). **RLS:** lectura con `cash.read` o `agenda.read_all` del propio estudio; la
profesional ve el estado de la seña en sus turnos (ya lo tiene en `appointments`), no la tabla.
Cleo Admin, nada.

`payments` es el **espejo** del estado en Mercado Pago, actualizado solo por
`app.sync_mp_payment`. Cada cambio queda en `payment_events`, que es de solo agregado: así se
cumple la regla de movimientos inmutables (el libro financiero de la Épica 09 se alimenta de
esos eventos, nunca de un `update`).

### `payment_events` — historial de cada pago (solo agregado)

`payment_id`, `kind` (`seen`, `status_changed`, `applied`, `late_confirmed`, `refund_requested`,
`refunded`, `refund_failed`, `needs_review`), estado anterior y nuevo, montos, `detail jsonb`,
`actor` (usuaria o "sistema"), `created_at`. Nadie lo edita ni borra (igual que `audit_logs`).

### `payment_notifications` — la bandeja de avisos (PAY-05)

`id`, `tenant_id`, `account_id`, `request_id` (**único**, el `x-request-id` de Mercado Pago),
`topic`, `resource_id`, `signature_ok`, `received_at`, `processed_at`, `result`, `attempts`.
Sin políticas: solo el servidor. Se purgan a los 90 días con `pg_cron`.

### `payment_refunds` (PAY-08, lo necesario para P4)

`id`, `tenant_id`, `payment_id`, `amount_minor`, `reason` (`late_slot_taken`,
`late_released`, `late_past`, `manual`), `status` (`requested` · `done` · `failed`),
`provider_refund_id`, `requested_by`, timestamps. Una devolución total por pago (índice único).

### Cambios en tablas existentes

- `tenant_settings.payments_connected`: lo cambian solo las funciones de conexión y
  desconexión. Ya existe el trigger que impide reservas online sin pagos conectados; se agrega
  que **al pasar a `false` apaga las reservas online** (P6, P7).
- `appointments`: nueva transición **`expired → confirmed`**, permitida solo dentro de
  `app.apply_mp_payment` cuando el horario sigue libre (P4). La restricción anti doble reserva
  sigue siendo la garantía final: si otra tomó el horario, la base lo rechaza y se pasa a
  devolución.
- `app.confirm_deposit_payment`: hoy acepta una reserva `pending_payment` aunque su bloqueo ya
  haya vencido y el cron todavía no la haya marcado. Se corrige para que trate ese caso igual
  que una vencida (P4), así no depende de cuándo corrió el cron.
- `appointment_events`: nuevos tipos `deposit_paid_late`, `deposit_refunded`, `payment_disputed`.

---

## 4. Funciones (base y servidor)

### Base de datos

| Función | Quién la usa | Qué hace |
|---|---|---|
| `begin_mp_connection(code_verifier_enc)` | Dueña (sesión, `payments.manage`) | Crea el `state` y lo devuelve una vez |
| `complete_mp_connection(state, cuenta, tokens cifrados…)` | Dueña (sesión) | Valida `state` (suyo, de su estudio, sin usar, sin vencer), guarda cuenta y credenciales, `payments_connected = true`, auditoría |
| `disconnect_mp(confirm_pending_count)` | Dueña (sesión) | Desconecta, borra credenciales, apaga reservas online, cancela intenciones abiertas, auditoría |
| `get_payments_status()` | `payments.manage` / `settings.manage` | Estado para la pantalla (apodo, desde cuándo, modo prueba, pendientes, errores) |
| `start_deposit_checkout(slug, code)` | Clienta (sesión) | Verifica que la reserva sea suya, esté esperando pago y sin vencer; devuelve la intención abierta o los datos para crear una (monto **de la base**) |
| `app.get_mp_credentials(account)` / `app.store_mp_tokens(…)` / `app.lock_mp_refresh(account)` | Solo `service_role` | Leer y rotar tokens cifrados |
| `app.record_mp_notification(…)` | Solo `service_role` | Guarda el aviso; si el `request_id` ya existe, devuelve "duplicado" |
| `app.sync_mp_payment(account, datos del pago verificados)` | Solo `service_role` | Upsert en `payments` por id de Mercado Pago, eventos, y si está aprobado llama a `app.apply_mp_payment` |
| `app.apply_mp_payment(payment)` | Interna | Reglas de §5: confirma, confirma tarde o marca para devolución. Bloquea la reserva (`for update`) |
| `app.mark_refund(…)`, `list_payments(desde, hasta)`, `retry_refund(payment)` | Servidor / `cash.manage` | Devoluciones y conciliación |

Todas `SECURITY DEFINER` con `search_path = ''` y permisos validados adentro. Las de
`service_role` sin `grant` a `anon` ni `authenticated` (test meta).

### Next (todo `server-only`)

| Módulo / ruta | Qué hace |
|---|---|
| `src/lib/payments/crypto.ts` | Cifrar/descifrar AES-256-GCM con versión de clave |
| `src/lib/payments/mercadopago.ts` | Cliente HTTP mínimo (OAuth, `/users/me`, preferencias, pagos, búsqueda, devoluciones) con timeouts y errores traducidos. Sin SDK para controlar qué se manda y qué se loguea |
| `src/lib/payments/service-client.ts` | Cliente de Supabase con `SUPABASE_SECRET_KEY`, **solo** para las funciones `app.*` de pagos (webhook, cron, credenciales) |
| `admin/pagos` (acciones) | Conectar, vuelta de OAuth, desconectar, reintentar devolución |
| `reserva/[code]` (acción "Pagar seña") | `start_deposit_checkout` → crea la preferencia con el token del estudio → redirige a Mercado Pago |
| `POST /api/pagos/mp/webhook?c=<id de cuenta>` | Bandeja de avisos (§6) |
| `GET /api/pagos/mp/vuelta` | Solo redirige al subdominio del estudio (§2) |
| `POST /api/pagos/interno/revisar` | Revisión cada 10 min y renovación diaria; protegido con `CRON_SECRET` |

Las rutas `/api/pagos/…` responden en el dominio raíz (no dependen del host del estudio) y el
proxy las deja pasar sin reescribir.

### La preferencia de Checkout Pro

- Ítem: "Seña — {servicio}" × 1, `unit_price` = `deposit_minor / 100` (la seña siempre es en
  pesos enteros, B8), `currency_id` ARS.
- `external_reference` = id de la intención. `notification_url` = webhook con la cuenta.
- `expires: true`, `expiration_date_to` = vencimiento de la reserva.
- `binary_mode: true`, sin pagos en efectivo, 1 cuota (P2, P3).
- `back_urls` a `https://{slug}.cleo.com.ar/reserva/{código}` (éxito, error y pendiente);
  `auto_return: approved`.
- `statement_descriptor` con el nombre del estudio (P10). Sin `marketplace_fee` (P1).

---

## 5. Qué pasa con cada pago aprobado (`app.apply_mp_payment`)

Se ejecuta con la reserva bloqueada, así dos avisos simultáneos del mismo pago no se pisan.

| Situación de la reserva | Monto y moneda | Resultado |
|---|---|---|
| Esperando pago, sin vencer | Coinciden | **Confirmada.** Evento `deposit_paid` con el id del pago. `outcome = applied` |
| Ya confirmada **por este mismo pago** | — | Nada (aviso repetido) |
| Ya confirmada por **otro** pago (pagó dos veces) o cobrada en el estudio | — | **Devolución automática** del pago nuevo |
| Vencida (o esperando pago con el bloqueo vencido), turno en el futuro, horario libre | Coinciden | **Confirmada tarde** (P4). Evento `deposit_paid_late`. `outcome = late_confirmed` |
| Vencida, horario ocupado por otra (la base rechaza la superposición) | — | **Devolución automática** (`late_slot_taken`) |
| Liberada por la clienta o cancelada | — | **Devolución automática** (`late_released`) |
| El turno ya pasó | — | **Devolución automática** (`late_past`) |
| Cualquiera | **No coinciden** | No confirma. `needs_review` y aviso en el panel (no debería pasar nunca: el monto lo fija la preferencia) |

Pagos rechazados: se registran (`ignored`) y la clienta puede volver a intentar mientras la
reserva no venza. Devueltos o contracargos informados después: se registran y se avisa (P8).

La devolución la pide el servidor a Mercado Pago (`POST /v1/payments/{id}/refunds`, total).
Hay 180 días para hacerlo y el estudio necesita saldo; si falla queda **"Pago a resolver"** con
reintento (P4).

---

## 6. Webhook idempotente (PAY-05)

1. **Llega el aviso** (`POST /api/pagos/mp/webhook?c=<cuenta>`).
   - Si la cuenta no existe o no está conectada: 200 y nada más (no le damos pistas a nadie).
   - Se verifica la firma `x-signature` con el secreto de webhooks de la aplicación
     (`MP_WEBHOOK_SECRET`) y se rechazan las de más de 5 minutos. La validación exacta del
     "manifiesto" se toma del validador oficial de Mercado Pago (la documentación remite a sus
     SDK) y se cubre con tests usando ejemplos de ellos. **La firma es un filtro, no la fuente de
     verdad:** aun con firma válida, todo se verifica consultando la API.
   - Solo interesan los avisos de tipo `payment` (y el formato viejo `topic=payment&id=`);
     el resto se registra y se ignora.
2. **Se guarda** en `payment_notifications`. Si el `request_id` ya estaba: responde 200 sin
   hacer nada.
3. **Se consulta el pago** `GET /v1/payments/{id}` con el token del estudio. Se exige que
   `collector_id` sea la cuenta del estudio y que `external_reference` sea una intención de ese
   mismo estudio.
4. **`app.sync_mp_payment`** con los datos verificados → §5.
5. **Responde 200** en menos de 22 segundos (si no, Mercado Pago reintenta cada 15 minutos). Si
   algo falla a mitad de camino (Mercado Pago caído, por ejemplo), responde 500 para que
   reintente; reprocesar es seguro porque todo es idempotente, y además la revisión cada 10
   minutos lo levanta.

**Logs:** nunca se loguean tokens, encabezados de autorización ni el cuerpo completo de Mercado
Pago; solo ids y estados.

---

## 7. Conciliación (PAY-06)

- **Revisión automática cada 10 minutos** (P9): `pg_cron` + `pg_net` de Supabase llaman a
  `/api/pagos/interno/revisar` con `CRON_SECRET` (no depende de los cron jobs de Render, que son un servicio aparte y pago). Busca en
  Mercado Pago (`/v1/payments/search?external_reference=…`) los pagos de las intenciones abiertas
  o vencidas en las últimas 48 h, y los pagos registrados como no finales, y los pasa por
  `app.sync_mp_payment`. Si encuentra un pago que no había llegado por webhook, lo marca en el
  evento ("recuperado por revisión"), para saber cuántos avisos se pierden.
- **Una vez al día:** renovación de tokens y limpieza de `state` vencidos.
- **Pantalla "Pagos" del panel** (`cash.read`): lista por fechas con reserva, clienta, monto, comisión
  de Mercado Pago, neto, medio, estado y resultado. Arriba, los **"Pagos a resolver"** (devoluciones
  fallidas, montos que no coinciden, contracargos). Totales del período (cobrado, comisiones,
  neto, devuelto). Exportar CSV para cruzarlo con el resumen de Mercado Pago.
- Cada reserva muestra en su detalle los pagos y devoluciones asociados.

---

## 8. Pantallas

### Panel del estudio

| Ruta | Quién | Qué ve |
|---|---|---|
| `/admin/pagos` | `payments.manage` (y `settings.manage` solo mira) | **Sin conectar:** qué significa conectar, que la plata va a su cuenta y la comisión de Mercado Pago la paga el estudio; botón "Conectar Mercado Pago". **Conectado:** cuenta (apodo), desde cuándo y quién la conectó, "modo prueba" si corresponde, próxima renovación, botón "Desconectar" con la confirmación de P6. **Hay que volver a conectar:** aviso en rojo y botón. |
| `/admin/pagos/vuelta` | — | Pantalla de paso: "Conectando…" y vuelve a `/admin/pagos` con el resultado o un error comprensible ("La conexión venció, probá de nuevo", "Esa cuenta ya está conectada a otro estudio", "La cuenta no es de Argentina"). |
| `/admin/pagos/movimientos` | `cash.read` | Conciliación (§7). |
| `/admin/reservas` | `settings.manage` | El interruptor de reservas online explica "Primero conectá Mercado Pago" con link, si falta. |
| `/admin/turnos/[id]` | Equipo | Pagos de la reserva (medio, monto, estado, devoluciones). |
| Inicio del panel | Dueña | Aviso si hay que volver a conectar o hay pagos a resolver. |

### Sitio (clienta)

| Ruta | Qué cambia |
|---|---|
| `/reserva/[código]` esperando pago | Botón **"Pagar seña $ X con Mercado Pago"** (reemplaza al simulado en producción). Lleva directo a Checkout Pro. |
| `/reserva/[código]` al volver | Sin importar lo que diga la URL: **"Estamos verificando tu pago…"** con actualización automática cada pocos segundos (consulta la base, no a Mercado Pago). Cuando se confirma: "¡Listo! Tu turno está confirmado". Si pasan 2 minutos: "Tu pago puede tardar unos minutos; te avisamos acá y en Mis turnos". Si la pantalla dice rechazado: "El pago no se aprobó, podés intentar de nuevo" (mientras no venza). |
| `/reserva/[código]` confirmada tarde / devuelta | "Tu pago llegó cuando la reserva ya había vencido y el horario estaba tomado. Te devolvimos $ X a tu medio de pago." |

Todo con el nombre y los colores del estudio, sin "Cleo".

---

## 9. Permisos

| Acción | Permiso |
|---|---|
| Conectar / desconectar Mercado Pago | `payments.manage` (solo dueña, P5) |
| Ver el estado de la conexión | `payments.manage` o `settings.manage` |
| Ver pagos y conciliación | `cash.read` |
| Reintentar una devolución | `cash.manage` |
| Pagar una seña | La clienta dueña de la reserva (sesión) |
| Webhook, revisión, renovación | Servidor (`service_role`), nunca una usuaria |
| Cleo Admin | Solo "pagos conectados: sí/no" del estudio. Ni pagos, ni montos, ni tokens |

---

## 10. Validaciones

- El monto de la preferencia sale de `appointments.deposit_minor`; la pantalla no manda montos.
- No se crea preferencia si la reserva no es de la clienta, no está esperando pago, venció, o el
  estudio no tiene la cuenta `connected`.
- Webhook: cuenta conectada, firma, `collector_id`, `external_reference` del mismo estudio,
  monto, moneda, `live_mode` igual al de la cuenta (un pago de prueba nunca confirma en
  producción).
- OAuth: `state` de un solo uso, 10 minutos, misma usuaria y estudio; PKCE; cuenta MLA; ARS;
  `offline_access`; cuenta no conectada a otro estudio.
- Variables obligatorias al arrancar (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`,
  `PAYMENTS_ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `MP_OAUTH_REDIRECT_URI`);
  ninguna con `NEXT_PUBLIC_`. Un test falla si alguna aparece en código cliente.
- Entradas con zod; errores de Mercado Pago traducidos a mensajes nuestros.

---

## 11. Criterios de aceptación

1. La dueña conecta su cuenta de Mercado Pago desde el celular y ve "Conectado como …". La
   encargada no ve el botón y, si llama a la acción, recibe "No tenés permiso".
2. Los tokens no aparecen en ninguna respuesta al navegador, ni en logs, y en la base están
   cifrados; ninguna usuaria (ni Cleo Admin) puede leer la tabla.
3. Un `state` usado, vencido, de otra usuaria o de otro estudio no conecta nada.
4. La clienta paga la seña con una tarjeta de prueba y la plata llega a la cuenta **del estudio**
   (se ve en la cuenta vendedora de prueba).
5. La reserva se confirma solo cuando el webhook (o la revisión) verifica el pago contra la API.
   Volver de Mercado Pago con `?status=approved` inventado no confirma nada.
6. El mismo aviso enviado 2, 10 o 100 veces (también en paralelo) produce un solo registro de
   pago, una confirmación y un evento.
7. Un aviso inventado (id de pago de otra cuenta, de otro estudio, rechazado o con otro monto) no
   confirma nada.
8. Pago tardío con horario libre → confirmada; con horario ocupado, liberada o turno pasado →
   devolución automática y la clienta lo ve explicado.
9. Si el webhook no llega, la revisión confirma la reserva en menos de 10 minutos.
10. La renovación funciona sin intervención; si Mercado Pago revoca el acceso, el estudio queda
    "Hay que volver a conectar" y las reservas online se apagan.
11. Desconectar apaga las reservas online y borra los tokens.
12. La pantalla de pagos muestra monto, comisión y neto, y los totales coinciden con la suma de
    los pagos del período.
13. El sitio del estudio no muestra "Cleo" en ningún paso del pago (incluido el resumen de la
    tarjeta).
14. Estudio B no ve cuentas, pagos ni avisos de A.

---

## 12. Tests

**Base de datos** (`db/tests/18_payments_*.sql`):
- RLS: A no lee ni modifica cuentas, pagos, eventos ni devoluciones de B; la encargada no
  conecta; nadie (ni la dueña) lee credenciales, `state` ni avisos; Cleo Admin no ve pagos.
- Meta: las funciones `app.*` de pagos no se pueden ejecutar desde la API; `payment_events` es
  de solo agregado.
- OAuth: `state` vencido, usado, de otra usuaria o de otro estudio; cuenta ya conectada a otro
  estudio; una sola cuenta activa por estudio; desconectar apaga reservas online.
- `sync_mp_payment` / `apply_mp_payment`: cada fila de la tabla de §5, incluido "esperando pago
  pero con bloqueo vencido"; mismo pago dos veces; monto distinto; moneda distinta.
- Confirmación tardía que choca con otra reserva → la restricción la rechaza y queda para
  devolución.
- Idempotencia: `record_mp_notification` con el mismo `request_id` dos veces.
- **Concurrencia** (nuevo, en `test-db.sh`): 20 conexiones aplican el mismo pago a la vez →
  exactamente un registro, una confirmación, un evento. Y dos pagos distintos para la misma
  reserva a la vez → uno confirma, el otro queda para devolución.

**Unitarios (Vitest):**
- Cifrado: ida y vuelta, rechaza texto alterado, rechaza un token cifrado para otro estudio,
  rotación de versión.
- Firma del webhook: válida, alterada, vencida, sin encabezado (con los ejemplos de Mercado
  Pago).
- Armado de la preferencia: monto en pesos desde centavos, vencimiento, exclusiones, URLs del
  estudio, `statement_descriptor` sin "Cleo".
- Cliente de Mercado Pago con `fetch` simulado: renovación ante 401, errores traducidos, sin
  tokens en los mensajes de error.
- Ninguna variable secreta en código cliente ni con `NEXT_PUBLIC_`.

**E2E con Mercado Pago simulado** (`scripts/e2e-payments.mjs`, en CI y en local): un servidor
falso de Mercado Pago (`MP_API_BASE_URL` apunta a él **solo en desarrollo**; en producción la
URL es fija y la variable se ignora) para probar el flujo completo, avisos duplicados y en
paralelo, avisos inventados, pago tardío y revisión sin webhook, contra la app real.

**Sandbox real de Mercado Pago (manual, checklist del README):** §13.

---

## 13. Cómo se prueba con cuentas de prueba de Mercado Pago

En Mercado Pago no se puede mezclar: **la cuenta vendedora y la compradora tienen que ser las
dos de prueba**, del mismo país.

1. Crear (ver §14) dos cuentas de prueba: **"Vendedora Fresas"** y **"Compradora"**.
2. Dejar corriendo la app con un túnel público HTTPS (Mercado Pago necesita llegar al webhook y
   volver a la URL registrada): `npx cloudflared tunnel --url http://localhost:3000`. La URL del
   túnel se carga como URL de vuelta y de webhooks en la aplicación de prueba.
3. En una **ventana de incógnito**, ingresar a Mercado Pago con la **Vendedora Fresas**. En
   otra pestaña de esa misma ventana, entrar como dueña a `fresas.localhost:3000/admin/pagos`
   y tocar "Conectar". Mercado Pago pide autorizar con la cuenta vendedora de prueba.
4. En **otra ventana de incógnito**, reservar como clienta y tocar "Pagar seña". En Mercado
   Pago, entrar con la **Compradora** y pagar con una tarjeta de prueba:
   - Mastercard `5031 7557 3453 0604`, CVV `123`, vencimiento `11/30`.
   - Visa `4509 9535 6623 3704`, CVV `123`, vencimiento `11/30`.
   - **Nombre del titular = el resultado que querés**: `APRO` (aprobado), `OTHE` (rechazado),
     `FUND` (sin fondos). Documento: DNI `12345678`.
5. Ver la reserva confirmada (la pantalla pasa de "verificando" a "confirmado"), el pago en
   "Pagos" del panel y la plata en la cuenta de la Vendedora.
6. Repetir con `OTHE` (no confirma), con una reserva que se deja vencer antes de pagar, y
   reenviando el aviso desde el panel de Mercado Pago (Webhooks → simular) para ver que no
   duplica nada.

Lo que no se puede forzar en el sandbox (pago tardío exacto, aviso perdido, 100 avisos
iguales) lo cubre el e2e con Mercado Pago simulado.

---

## 14. Paso a paso: crear la aplicación en Mercado Pago Developers

Para alguien que nunca lo usó. Lo hacés vos una vez; Cleo usa **una sola aplicación** para
todos los estudios (cada estudio la autoriza con su propia cuenta).

**Antes de empezar:** una cuenta de Mercado Pago **de Cleo** (no la personal ni la de
Fresas), con identidad validada. Esa cuenta es la "dueña" de la integración, no recibe la plata
de las señas.

1. **Entrar al panel.** Ir a https://www.mercadopago.com.ar/developers e iniciar sesión con la
   cuenta de Cleo. Arriba a la derecha: **"Tus integraciones"**.
2. **Crear la aplicación.** Botón **"Crear aplicación"** (o "Panel de integración").
   - Nombre: `Cleo Suite` (la dueña del estudio lo ve al autorizar; mismo nombre que en Google).
   - Tipo de solución: **Pagos online**. Producto: **Checkout Pro**.
   - Si pregunta por plataforma de e-commerce: **No** (es desarrollo propio).
   - Si pregunta modelo de integración: **Marketplace / cobrar en nombre de terceros**, o la
     opción que mencione **OAuth**. (Los nombres de las opciones cambian seguido; si dudás, me
     pasás una captura y lo elegimos juntos.)
   - Aceptar los términos y crear. Al crearla, Mercado Pago genera solo las **credenciales de
     prueba** y una cuenta de prueba.
3. **Datos de la aplicación (Editar).** Abrí la aplicación → **"Editar"** o "Detalles de la
   aplicación":
   - **URL de redireccionamiento (OAuth):** en producción
     `https://cleo.com.ar/api/pagos/mp/vuelta`. Para probar, la del túnel
     (`https://<lo-que-te-dé-cloudflared>/api/pagos/mp/vuelta`). Tiene que coincidir exacto.
   - **PKCE:** activado.
   - Si aparece la opción de **"permiso de renovación" / `offline_access`**, activarla (sin eso
     no podemos renovar los tokens cada 180 días).
4. **Webhooks.** En la aplicación → **"Webhooks" → "Configurar notificaciones"**:
   - URL de producción: `https://cleo.com.ar/api/pagos/mp/webhook`. URL de prueba: la del túnel.
   - Evento: solo **"Pagos"**.
   - Guardar. Aparece una **clave secreta** (la firma de los avisos). Esa es `MP_WEBHOOK_SECRET`.
5. **Credenciales.** En **"Credenciales de producción"** (y de prueba) vas a ver **Client ID**
   (o "App ID") y **Client Secret**. Son `MP_CLIENT_ID` y `MP_CLIENT_SECRET`.
   - **No las pegues en el chat ni en el repo.** Van en `.env.local` (desarrollo) y en las
     variables de entorno del Web Service en Render (producción). Yo dejo el `.env.example` con los nombres.
   - Las de producción pueden pedir completar datos del negocio o "activar credenciales";
     eso lo hacemos recién antes del lanzamiento.
6. **Cuentas de prueba.** En **"Cuentas de prueba"** → **"Crear cuenta de prueba"**:
   - País: **Argentina** (no se puede cambiar después).
   - Una de tipo **Vendedor** ("Vendedora Fresas") y una de tipo **Comprador** ("Compradora").
     Si pide saldo ficticio, ponele algo a la compradora (por ejemplo $ 50.000).
   - Anotá en tu gestor de contraseñas el usuario y la contraseña de cada una. Al ingresar,
     Mercado Pago puede pedir un código: está en esa misma pantalla (código de verificación).
7. **Contame cuando esté** (sin pasarme secretos): que ya tenés Client ID, Client Secret y
   clave de webhooks cargados en `.env.local`, y los dos usuarios de prueba creados.

> Nota: OAuth, PKCE, webhooks, cuentas y tarjetas de prueba están verificados contra la
> documentación oficial actual. Los campos exactos del formulario de "Crear aplicación" (paso 2)
> no figuran en la documentación y cambian seguido: si algo no coincide, mandame una captura.

---

## 15. Variables de entorno nuevas

| Variable | Dónde | Para qué |
|---|---|---|
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET` | Servidor | OAuth |
| `MP_OAUTH_REDIRECT_URI` | Servidor | La URL de vuelta registrada (túnel en desarrollo) |
| `MP_WEBHOOK_SECRET` | Servidor | Verificar la firma de los avisos |
| `PAYMENTS_PUBLIC_BASE_URL` | Servidor | Base del webhook (`https://cleo.com.ar` o el túnel) |
| `PAYMENTS_ENCRYPTION_KEY` | Servidor | Cifrar tokens (32 bytes en base64). Distinta en cada entorno |
| `SUPABASE_SECRET_KEY` | Servidor | Solo para las funciones `app.*` de pagos |
| `CRON_SECRET` | Servidor + Supabase (Vault) | Proteger la revisión cada 10 min |
| `MP_API_BASE_URL` | Solo desarrollo/e2e | Apuntar al Mercado Pago simulado; ignorada en producción |

El botón "Simular pago aprobado" del seed sigue existiendo solo en desarrollo para probar sin
Mercado Pago.

---

## 16. Orden de implementación (un commit por paso, tests en verde en cada uno)

0. Variables, `crypto.ts`, cliente de servicio y cliente HTTP de Mercado Pago + unitarios.
1. Migración: cuentas, credenciales, `state`, conexión/desconexión, `payments_connected` que
   apaga reservas online + RLS y tests.
2. Pantalla `/admin/pagos` y flujo OAuth completo (vuelta por el dominio raíz, PKCE) y
   renovación con bloqueo.
3. Migración: intenciones, pagos, eventos, avisos, devoluciones, `sync`/`apply`, transición
   `expired → confirmed`, corrección de `confirm_deposit_payment` + tests y concurrencia.
4. "Pagar seña": preferencia y pantalla de "verificando".
5. Webhook (firma, bandeja, consulta a la API) + Mercado Pago simulado + e2e.
6. Pago tardío y devoluciones automáticas + "Pagos a resolver".
7. Revisión cada 10 min y tareas diarias (`pg_cron` + `pg_net`).
8. Conciliación: `/admin/pagos/movimientos`, CSV, pagos en el detalle del turno.
9. Prueba completa en el sandbox de Mercado Pago con las cuentas de prueba (§13).
10. README, CLAUDE.md, `.env.example` y checklist manual; aplicar en desarrollo y subir.
