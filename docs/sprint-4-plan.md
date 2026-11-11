# Sprint 4 — Plan: motor de reservas (Épica 05)

> Estado: **implementado** (pasos 0 a 10) y verificado con los tres e2e contra la app real.
> Pendiente: el checklist manual del README.
> Cambios de implementación respecto del plan: la configuración de reservas quedó en su propia
> sección (`/admin/reservas`) en lugar de dentro de "Marca"; se agregó `preview_booking` para
> mostrar quién atiende antes de confirmar (B4); el turno manual usa su propio chequeo de
> disponibilidad (`app.staff_slot_ok`); `app.confirm_deposit_payment` se creó en este sprint para
> que el pago simulado de desarrollo use el mismo camino que el webhook real.

## Cambios después de la revisión

| Tema | Antes (recomendación) | Ahora (decidido) |
|---|---|---|
| B3 anticipación mínima | 2 horas | **12 horas** (máximo 60 días), configurable por estudio |
| B9 seña 0% | Se confirma al instante | **No existe**: toda reserva necesita la seña pagada para quedar confirmada. La seña mínima es mayor a 0% (estudio y servicio: 1–100%). |
| Tiempo para pagar | 15 minutos (`booking_hold_minutes` de 5 a 60) | **2 horas por defecto**, configurable por estudio. Migración nueva amplía el rango a **5 minutos – 24 horas**. El vencimiento nunca pasa la hora del turno. |
| B11 turno manual | Confirmado; seña "a cobrar en el estudio" | **También necesita seña**: o se registra ya cobrada (transferencia o efectivo) y queda confirmado, o queda **esperando pago** con el mismo vencimiento que una reserva online. |
| Ventana de cancelación | 48 h | **24 h**: con 24 h o más la seña se conserva; con menos, se pierde. Migración nueva: valor por defecto 24 y Fresas en 24. README, CLAUDE.md y tests actualizados. |
| Resto (B1, B2, B4–B8, B10, B12–B14) y la reserva como bloqueo temporal | | **Aprobado** |

Consecuencia de B9 + B10: mientras no haya Mercado Pago (Sprint 5), las reservas online no se
pueden prender en producción. Para saber si un estudio tiene pagos conectados se agrega
`tenant_settings.payments_connected`, que **ninguna persona puede cambiar** por la API (lo
pondrá el servidor al conectar Mercado Pago en el Sprint 5). El seed de desarrollo lo pone en
`true` para Fresas, para poder probar el flujo completo con el pago simulado.

Backlog: BOOK-01 a BOOK-10 (selección de servicio y profesional, disponibilidad real,
duración y total, seña, bloqueo temporal, reserva pendiente, confirmación, evitar doble
reserva y código de reserva) y la base de BOOK-11 (historial). También el turno manual desde
el panel (CAL-06, parte).

**Criterios de la épica (backlog):**
- No hay doble reserva.
- El bloqueo temporal vence.
- La reserva solo se confirma con un pago verificado.
- Los precios quedan congelados.

**Fuera de alcance:**
- Mercado Pago (Sprint 5).
- Reglas de cancelación, reprogramación, créditos y pérdida de seña (Épica 07).
- Agenda visual por día y semana (Épica 08).
- Asistencia (Épica 10).
- Combos de varios servicios en un turno.
- Lista de espera.

---

## 0. Decisiones de negocio que necesito

Si estás de acuerdo con todas, alcanza con un "OK".

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| B1 | **¿Cuándo tiene que iniciar sesión la clienta?** | **Justo antes del resumen**, después de elegir el horario. Puede mirar servicios y horarios libres sin cuenta, pero para *apartar* un horario tiene que identificarse con Google. Así nadie aparta horarios de forma anónima. |
| B2 | **¿Cada cuánto se ofrecen horarios?** | **Cada 15 minutos** (9:00, 9:15, 9:30…). Configurable por estudio más adelante. |
| B3 | **¿Con cuánta anticipación se puede reservar?** | ~~2 horas~~ → **Decidido: mínimo 12 horas y hasta 60 días**, configurable por estudio. |
| B4 | **Con "cualquiera disponible", ¿a quién se asigna?** | **A la que tenga menos turnos ese día**; si empatan, por el orden del panel. Reparte el trabajo. La clienta ve el nombre en el resumen, antes de confirmar. |
| B5 | **¿Se pueden reservar varios servicios en un mismo turno?** | **No por ahora: un servicio por reserva.** Si quiere dos, hace dos reservas seguidas. Los combos llegan más adelante y el modelo ya lo prevé. |
| B6 | **¿El teléfono es obligatorio para reservar online?** | **Sí.** El estudio necesita poder avisarle por WhatsApp. Si su ficha no lo tiene, se pide en el resumen. |
| B7 | **¿Cuántas reservas "esperando pago" puede tener una clienta?** | **Una por estudio a la vez.** Evita que alguien aparte muchos horarios sin pagar. |
| B8 | **¿Cómo se redondea la seña?** | **Hacia arriba, al peso entero.** Por ejemplo, 50% de $ 12.555 = $ 6.278. Nunca hay centavos en la seña. |
| B9 | ~~Si un servicio no pide seña (0%)~~ | **Decidido: no hay servicios sin seña.** Toda reserva se confirma solo con la seña pagada. |
| B10 | **¿Se activan las reservas online en producción ya?** | **Se activan con Mercado Pago (Sprint 5).** Cada estudio tiene un interruptor "Reservas online", apagado por defecto, y la base no deja prenderlo si el estudio cobra seña y todavía no tiene pagos conectados. En desarrollo se prueba todo con un pago simulado que **solo existe en el seed de desarrollo** (ver sección 7). |
| B11 | **Turno manual desde el panel (WhatsApp): ¿cómo queda?** | **Decidido: también necesita seña.** O se registra "cobrada por transferencia o efectivo" (con permiso de caja, queda en el historial) y queda **confirmado**, o queda **esperando pago** con el mismo vencimiento que una online. Puede ir fuera del horario o sobre un bloqueo con un tilde explícito ("lo atiendo igual"), pero **nunca encima de otro turno**. |
| B12 | **¿El tiempo extra puede pasar el cierre?** | **Sí.** El servicio tiene que terminar antes del cierre o del descanso; el tiempo de limpieza puede pasarse, porque después no hay clientas. Lo que nunca puede pisar es otro turno. |
| B13 | **¿Se puede cancelar en este sprint?** | **Solo lo que no tiene consecuencias de plata:** liberar una reserva esperando pago (la clienta o el estudio) y cancelar un turno manual sin seña cobrada. Las cancelaciones con seña (48 h, crédito o pérdida) llegan con la Épica 07, para hacerlas bien de una vez. |
| B14 | **¿En qué hora se muestran los turnos?** | **Siempre en la hora del estudio**, aclarándolo si el celular de la clienta está en otra zona horaria ("hora de Buenos Aires"). |

---

## 1. Decisión técnica clave: el bloqueo temporal es la misma reserva

El backlog nombra `booking_holds`. En lugar de una tabla aparte, el bloqueo temporal es
**la reserva misma, en estado "esperando pago" y con vencimiento** (`hold_expires_at`).

**Por qué:** la garantía de "imposible reservar dos veces el mismo horario" tiene que estar
en la base, como una restricción. PostgreSQL solo puede impedir superposiciones dentro de
una misma tabla. Con los bloqueos en otra tabla, dos clientas podrían colarse en el hueco
entre las dos tablas. Con una sola tabla, una sola restricción cubre los turnos confirmados
y los que están esperando pago.

**Vencimiento:**
- **Siempre correcto, sin depender de un reloj externo.** Antes de crear una reserva se
  vencen, dentro de la misma operación, los bloqueos vencidos que se superponen con ese
  horario. La disponibilidad ignora los bloqueos vencidos.
- **Además, limpieza cada minuto con `pg_cron`.** Está disponible en Supabase (no en el
  Postgres local de los tests). Sirve para que el historial muestre "venció" a tiempo; la
  corrección no depende de él.

---

## 2. Modelo de datos

### Configuración del estudio (columnas nuevas en `tenant_settings`)

| Campo | Defecto | Reglas |
|---|---|---|
| `online_booking_enabled` | `false` | B10: no se puede prender si cobra seña y no tiene pagos conectados (Sprint 5) |
| `booking_min_notice_minutes` | **720** (12 h) | 0–10080 (B3) |
| `booking_hold_minutes` (ya existe) | **120** (antes 15) | **5–1440** (antes 5–60). Los estudios que seguían en 15 pasan a 120. |
| `payments_connected` | `false` | Solo el servidor (Sprint 5). Sin grant para personas. |
| `cancellation_window_hours` (ya existe) | **24** (antes 48) | Fresas pasa a 24 (crea una versión nueva de su política) |
| `deposit_percent` (ya existe, y el de cada servicio) | 50 | **1–100** (antes 0–100): B9 |
| `booking_horizon_days` | 60 | 1–365 (B3) |
| `slot_interval_minutes` | 15 | 5, 10, 15, 20, 30 o 60 (B2) |

### `appointments` (la reserva, con la foto de lo acordado)

| Grupo | Campos |
|---|---|
| Identidad | `id`, `tenant_id`, **`code`** (6 caracteres sin letras confusas, por ejemplo `K7M3QX`, único por estudio) |
| Quién | `client_profile_id` (clave compuesta con el estudio), `professional_id` (compuesta) |
| Cuándo | `starts_at`, `ends_at` (fin del servicio), `occupied_until` (fin + tiempo extra), `occupied` = `tstzrange(starts_at, occupied_until)` generado |
| **Foto de lo acordado** | `service_id`, `service_name`, `professional_name`, `duration_minutes`, `buffer_minutes`, `price_minor`, `price_is_from`, `currency`, `deposit_percent`, `deposit_minor`, `policy_version`, `cancellation_window_hours` |
| Estado de la reserva | `status`: `pending_payment` · `confirmed` · `cancelled` · `expired` (más adelante `completed`, `no_show`) |
| Estado de la seña (separado) | `deposit_status`: `pending` · `paid` · `paid_offline` (más adelante `credited`, `forfeited`, `refunded`). Sin `not_required`: toda reserva tiene seña (B9). |
| Bloqueo temporal | `hold_expires_at` (solo en `pending_payment`) = el menor entre ahora + `booking_hold_minutes` y la hora del turno |
| Origen | `source`: `online` · `staff`; `created_by`; `forced_outside_hours` (B11) |
| Otros | `client_note` (hasta 300, lo escribe la clienta), `created_at`, `updated_at` |

**La garantía contra la doble reserva:**
```sql
exclude using gist (tenant_id with =, professional_id with =, occupied with &&)
  where (status in ('pending_payment', 'confirmed'))
```
- Dos reservas activas de la misma profesional no pueden superponerse, incluido el tiempo
  extra. Tampoco si llegan en el mismo milisegundo: la base deja pasar una y rechaza la otra.
- Las canceladas y vencidas no cuentan.

**Otras reglas de la base:**
- `ends_at = starts_at + duración` y `occupied_until = ends_at + tiempo extra`.
- `deposit_minor` es la seña redondeada hacia arriba al peso (B8).
- Las transiciones de estado válidas las controla un trigger: por ejemplo, `expired` o
  `cancelled` no vuelven a `confirmed`.

**La foto de lo acordado nunca se recalcula.** Si mañana el servicio sube de precio, la
reserva conserva el precio, la duración, la seña y la versión de política con que se tomó.
Hay un test específico para eso.

### `appointment_events` (historial, solo agregado)
- Una fila por cada cambio: `created`, `hold_expired`, `confirmed`, `deposit_paid`,
  `deposit_paid_offline`, `cancelled`, más adelante `rescheduled`…
- Campos: quién (`actor_user_id` o "sistema"), cuándo, estado anterior y nuevo, y un
  detalle en `jsonb` (por ejemplo, "forzado fuera de horario" o el medio de pago).
- Nadie puede editarlo ni borrarlo, igual que `audit_logs`.

Las notas internas del equipo sobre un turno irán en una tabla aparte más adelante, porque
la clienta puede leer su reserva completa.

---

## 3. Funciones de la base (toda la lógica en el servidor)

**Para la clienta (`anon` o `authenticated`, por slug y sin ids internos de estudio):**
- `get_available_days(slug, service_id, professional_id | null, from_date, days)`: cuántos
  horarios libres hay por día, para pintar el calendario.
- `get_available_slots(slug, service_id, professional_id | null, date)`: los horarios
  libres de un día. La cuenta es:
  1. `working_intervals` de la profesional, o de cada profesional que hace el servicio si
     eligió "cualquiera".
  2. Menos las reservas activas no vencidas.
  3. Horarios cada `slot_interval_minutes` donde **el servicio entra completo antes del
     cierre o del descanso** (B12) y **servicio + tiempo extra no pisan otro turno**.
  4. Respetando anticipación mínima y máxima (B3), con la duración propia de cada
     profesional si la tiene, y solo profesionales activas que aceptan reservas online y
     hacen ese servicio.
- `create_online_booking(slug, service_id, professional_id | null, starts_at,
  accepted_policy_version, phone, client_note)`. **Recalcula todo de nuevo** y no confía
  en nada de lo que mandó la pantalla:
  - Exige sesión (B1).
  - Las reservas online del estudio tienen que estar prendidas (B10).
  - La política aceptada tiene que ser la vigente. Si cambió mientras la clienta elegía:
    "La política cambió, revisala".
  - El horario tiene que seguir libre: si no, "Ese horario se acaba de ocupar".
  - Con "cualquiera", asigna según B4.
  - Crea o vincula su ficha (D7) y guarda el teléfono (B6).
  - Controla el límite de B7.
  - Arma la foto de lo acordado, crea la reserva `pending_payment` con vencimiento (o
    registra el evento y devuelve el código. Siempre queda esperando pago (B9).
- `my_bookings(slug)` y `get_my_booking(slug, code)`: solo las suyas.
- `release_my_pending_booking(slug, code)`: liberar un horario que apartó y no va a pagar
  (B13).

**Para el equipo (`authenticated`, con RLS y permisos):**
- `create_manual_booking(...)` con `agenda.manage`. Queda **esperando pago** (con vencimiento) o,
  si se indica la seña ya cobrada (transferencia o efectivo, requiere también `cash.manage`),
  **confirmado** (B11 decidido).
  - La clienta puede ser una ficha existente o una nueva (nombre y teléfono).
  - Elige servicio, profesional, fecha y hora.
  - `force_outside_hours` (B11) saltea horarios y bloqueos, pero **no** la restricción de
    superposición.
- `mark_deposit_paid_offline(appointment_id, method)` con `cash.manage` (B11).
- `cancel_unpaid_booking(appointment_id, reason)` con `agenda.manage` (B13).

**Internas (nunca expuestas a la API):**
- `app.expire_holds()`: usada por `pg_cron` y por la limpieza dentro de cada reserva.
- `app.confirm_deposit_payment(appointment_id, payment_ref, amount_minor)`: la usa **solo
  el servidor** en el Sprint 5, después de verificar el pago con Mercado Pago (sección 7).
  Sin `grant` a `anon` ni `authenticated`.

## 4. Permisos (RLS sobre `appointments` y `appointment_events`)

| Quién | Ve | Crea o cambia |
|---|---|---|
| Clienta | Solo sus reservas (por su ficha) | Solo por las funciones de la sección 3 |
| Equipo con `agenda.read_all` | Todas las del estudio | — |
| Profesional (`agenda.read_own`) | **Solo las suyas** (profesional vinculada a su cuenta) | — |
| `agenda.manage` (dueña, encargada, recepción) | Todas | Turno manual, cancelar sin seña cobrada |
| `cash.manage` | Todas | Marcar seña cobrada por transferencia o efectivo |
| Cleo Admin, `anon` | Nada | Nada |

No hay `insert`, `update` ni `delete` directos sobre `appointments`: todo pasa por las
funciones, que validan y escriben el historial.

## 5. Pantallas

### Sitio del estudio (clienta, celular primero)

Cada paso es una URL, así funciona con el botón "atrás" y se puede compartir.

| Paso | Ruta | Qué ve |
|---|---|---|
| 1 | `/reservar` | Servicios por categoría (precio "desde" y duración). Cada servicio del catálogo tiene un botón "Reservar". |
| 2 | `/reservar/[servicio]` | **Profesional:** "Cualquiera disponible" (primera opción) o cada una, con su precio y duración. |
| 3 | `/reservar/[servicio]?p=…&dia=…` | **Día:** próximos días en una tira deslizable, los que no tienen lugar en gris. **Horario:** botones grandes (9:00, 9:15…), en la hora del estudio (B14). |
| 4 | Ingresar | Si no tiene sesión, "Continuar con Google" (B1) y vuelve exactamente al paso 5. |
| 5 | `/reservar/confirmar?…` | **Resumen:** servicio, profesional, día y hora, duración, **precio total, seña a pagar ahora y saldo en el estudio**, la **política vigente** completa con "Acepto la política", y teléfono si falta (B6). Botón **"Reservar y pagar seña"** (o "Confirmar reserva" si la seña es 0%). |
| 6 | `/reserva/[código]` | "Te guardamos el horario hasta las 15:42", con cuenta regresiva, botón **"Pagar seña"** (se conecta en el Sprint 5) y "Liberar horario". Si venció, lo dice y ofrece reservar de nuevo. Si está confirmada, el detalle completo. |
| — | `/mi-ficha` | Suma **"Mis turnos"** (próximos y pasados, con su código y estado). |

### Panel

| Ruta | Qué hace |
|---|---|
| `/admin/turnos` | Lista simple por día (hoy, mañana, elegir fecha): hora, clienta, servicio, profesional, estado de la reserva y de la seña. Las profesionales ven solo los suyos. La agenda visual completa llega en la Épica 08. |
| `/admin/turnos/[id]` | Detalle con la foto de lo acordado, el **historial** y las acciones según permiso: marcar seña cobrada, cancelar sin seña. |
| `/admin/turnos/nuevo` | **Turno manual** (WhatsApp): buscar clienta por nombre o teléfono, o cargarla nueva; servicio, profesional, día y horario (sugiere los libres). Opción "Lo atiendo igual fuera de horario" (B11) con advertencia. |
| `/admin/marca` → nueva sección **"Reservas"** | Interruptor de reservas online (B10), anticipación mínima y máxima, intervalo y minutos de bloqueo temporal. |

## 6. Validaciones (base y servidor)

- Servicio activo, visible y no archivado. Profesional activa, que acepta reservas online y
  hace ese servicio. Estudio operativo y con reservas online prendidas.
- `starts_at` alineado al intervalo (B2), dentro de la anticipación (B3), y el servicio
  completo dentro de una franja libre (B12).
- Política aceptada igual a la vigente.
- Teléfono válido (B6). Nota de la clienta de hasta 300 caracteres.
- Una sola reserva pendiente por clienta y estudio (B7).
- Turno manual: con `force_outside_hours` igual tiene que caer en un día y hora válidos y
  nunca superponerse.
- Montos siempre enteros en centavos. La seña sale del precio de **esa** profesional y del
  porcentaje del servicio (N1) o del estudio, redondeada hacia arriba (B8).

## 7. Cómo se confirma con Mercado Pago (Sprint 5), sin pagos falsos en producción

1. "Pagar seña" crea en el servidor una preferencia de pago en la cuenta del estudio, por
   el monto **calculado en la base** (`deposit_minor`), con la reserva como referencia y
   un vencimiento igual al del bloqueo temporal.
2. La clienta paga en Mercado Pago. Que vuelva al sitio **no confirma nada**: la página
   consulta el estado y muestra "estamos verificando tu pago".
3. Mercado Pago avisa a nuestro webhook. El servidor:
   - **Consulta el pago a la API** de Mercado Pago con las credenciales del estudio, sin
     confiar en lo que dice el aviso.
   - Verifica que esté aprobado, que el monto y la moneda coincidan y que la referencia
     sea esta reserva de este estudio.
   - Llama a `app.confirm_deposit_payment` (solo con la clave de servidor).
   - Es idempotente: el mismo pago avisado dos veces no confirma dos veces.
4. **Pago tarde, después de vencido el bloqueo:** si el horario sigue libre, se confirma
   igual. Si ya lo tomó otra, el pago queda registrado para **devolución o crédito**, y lo
   resuelve la Épica 07.

**En este sprint no existe ningún camino para marcar una seña como pagada online.** Para
probar en desarrollo, el seed crea la función `dev.simulate_deposit_payment(code)` en un
esquema `dev`.
- Como el seed **nunca** se aplica en producción, esa función no existe ahí.
- Un test meta verifica que ninguna migración cree el esquema `dev`.
- Las únicas formas reales de marcar una seña son el webhook verificado (Sprint 5) y
  "cobrada por transferencia o efectivo" desde el panel (B11), que queda en el historial
  con el nombre de quien la marcó.

## 8. Criterios de aceptación

1. La clienta, desde el celular, elige servicio, "cualquiera disponible", día y horario,
   inicia sesión con Google, ve precio total, seña y saldo, acepta la política y queda con
   la reserva "esperando pago", con código y el tiempo que tiene para pagar (2 h por defecto).
2. La disponibilidad no ofrece descansos, bloqueos, feriados, horarios con menos
   anticipación de la mínima, días más allá del máximo ni huecos donde el servicio no entra.
3. Con duración propia de la profesional (por ejemplo, Caro 75 minutos), los horarios y la
   reserva usan esa duración y su precio.
4. Si el bloqueo vence sin pago, el horario vuelve a estar disponible y el historial dice
   "venció".
5. **Veinte intentos simultáneos sobre el mismo horario producen exactamente una reserva**,
   en la base y en la app. El resto ve "Ese horario se acaba de ocupar".
6. Cambiar el precio, la duración o la política después de reservar no cambia la reserva.
7. Cada reserva tiene un código único, el estado de la reserva separado del de la seña, y
   un historial que nadie puede editar.
8. Recepción carga un turno manual de WhatsApp para una clienta nueva, con la seña cobrada
   por transferencia (confirmado) o esperando pago (vence solo); forzar fuera de horario
   funciona con el tilde, y superponerse a otro turno es imposible.
9. La profesional ve solo sus turnos. Una clienta ve solo los suyos. Estudio B no ve nada
   de A.
10. Con las reservas online apagadas, o sin pagos conectados, no se puede reservar
    online, aunque se llame a la función directamente.
12. No se puede configurar una seña de 0% ni un tiempo para pagar fuera de 5 min – 24 h, y la
    ventana de cancelación por defecto es de 24 h.
11. En producción no existe ninguna forma de simular un pago.

## 9. Tests

**Base de datos** (`db/tests/12_booking_*.sql`):
- **Disponibilidad:**
  - Descansos, bloqueos, feriado y anticipación mínima y máxima.
  - Intervalo, servicio que no entra antes del cierre, tiempo extra que pasa el cierre
    (B12) y duración propia.
  - "Cualquiera" con asignación por menos turnos (B4).
  - Bloqueos vencidos ignorados.
- **Reserva:**
  - Foto de lo acordado y seña redondeada (B8).
  - Seña 0% rechazada por la base (B9); vencimiento = 2 h o la hora del turno, lo que llegue antes.
  - Política desactualizada rechazada.
  - Límite de B7 y teléfono obligatorio.
  - Reservas online apagadas (B10).
- **Doble reserva:**
  - Superposición rechazada por la restricción, aun insertando como superusuario.
  - Superposición solo del tiempo extra, también rechazada.
- **Vencimiento:** un bloqueo vencido se libera al reservar encima y queda `expired` con su
  evento.
- **Turno manual:** con y sin forzar, nunca superpuesto, y seña cobrada sin pago.
- **Permisos:** la clienta solo las suyas, la profesional solo las suyas, B nada, Cleo
  Admin nada, nada de escritura directa, historial inmutable.
- **Meta:** ninguna migración crea el esquema `dev`, y `confirm_deposit_payment` no se
  puede ejecutar desde la API.

**Concurrencia** (nuevo, `db/tests/concurrency/booking_race.sh`, se corre desde
`test-db.sh`):
- Base real comprometida (no dentro de una transacción que se descarta).
- 20 conexiones `psql` en paralelo, cada una de una clienta distinta, intentan el mismo
  horario al mismo tiempo, sincronizadas con un bloqueo previo.
- Tiene que quedar **exactamente una** reserva activa, y las otras 19 tienen que recibir
  el error de superposición.
- Lo mismo con "cualquiera disponible" y dos profesionales libres: exactamente dos
  reservas, una por profesional.

**Unitarios (Vitest):** generación del código, formato de horarios en la hora del estudio,
seña redondeada (los mismos casos que la base) y armado de las URLs de los pasos.

**E2E** (`scripts/e2e-booking.mjs`):
- El flujo completo de la clienta con una sesión de prueba.
- **10 envíos simultáneos** al mismo horario contra la app real: exactamente 1 éxito.
- Vencimiento (con un bloqueo de 5 minutos más la limpieza).
- Turno manual de recepción.
- Foto de lo acordado después de cambiar el precio.
- Limpieza al final.

**Manual:** el flujo completo desde un celular real con Google; turno manual desde el
celular.

## 10. Orden de implementación (un commit por paso, tests en verde en cada uno)

0. Migración de ajustes de negocio: ventana de 24 h (y Fresas en 24), seña 1–100%, tiempo
   para pagar 5 min – 24 h (2 h por defecto), configuración de reservas y `payments_connected`.
   README, CLAUDE.md y tests de 48 h actualizados.
1. Migración: `appointments`, `appointment_events`, restricción de exclusión, triggers de
   estado y RLS + tests.
2. Disponibilidad (`get_available_days` y `get_available_slots`) + tests.
3. `create_online_booking`, vencimiento, `my_bookings` y liberar + tests.
4. Test de concurrencia en `test-db.sh`.
5. Turno manual, cancelar sin seña y seña cobrada sin pago + tests. Seed: reservas de
   ejemplo y `dev.simulate_deposit_payment`.
6. Flujo de la clienta en el sitio (pasos 1 a 6) y "Mis turnos".
7. Panel: `/admin/turnos`, detalle con historial y turno manual.
8. Sección "Reservas" en la configuración del estudio.
9. `pg_cron` para la limpieza (solo en Supabase) + E2E con concurrencia.
10. README, CLAUDE.md y checklist manual; aplicar en desarrollo y subir.
