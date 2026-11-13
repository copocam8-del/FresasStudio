# Sprint 6 — Plan: cancelaciones, agenda, ficha de clienta y asistencia (Épicas 07–10)

> Estado: **aprobado** (todas las decisiones, con C10 cambiada: el saldo vence, ver abajo).
> En implementación, paso a paso (§9).

Backlog:
- **Épica 07 (POL-01 a POL-08):** anticipación en la zona del estudio, cancelación y
  reprogramación con 24 h o más / con menos, faltas, cancelación del estudio sin perjuicio para la
  clienta, versión de la política aceptada. Libro de saldo a favor.
- **Épica 08 (CAL-01 a CAL-05, CAL-07 mínimo):** agenda día y semana, columnas y filtros por
  profesional, detalle con estados, llegó / empezó / terminó / faltó, y "Bloquear" desde la agenda.
- **Épica 09 (CRM-01, CRM-02, CRM-03, CRM-04 parcial):** directorio, buscador, alta, ficha con
  historial de turnos y pagos, notas internas, preferencias y alergias, última visita.
- **Épica 10 (ATT-01 a ATT-05):** asistencia una sola vez por turno, cancelaciones y
  reprogramaciones registradas, tasa de asistencia, frecuentes y faltas repetidas, filtro por período.

**Criterios de las épicas (backlog, con la ventana de 24 h ya decidida):**
- A exactamente 24 h se conserva; a 23:59 se pierde.
- No se reutiliza saldo consumido o perdido; cada movimiento es auditable.
- En la agenda no hay superposición, los cambios se auditan y se reflejan las reservas confirmadas.
- La ficha la ve solo el personal autorizado del estudio; el historial sobrevive a las cancelaciones.
- Cancelar con anticipación no cuenta como falta; reprogramar no duplica faltas; la asistencia se
  registra una vez.

**Fuera de alcance:**
- Caja, cobro del saldo del turno, comisiones y cierres (Épica 11). Este sprint deja registrado
  qué pasó con cada seña para que la caja lo lea.
- Emails o WhatsApp automáticos (Resend y WhatsApp están pendientes). Ver C15.
- Fotos de la clienta (CRM-05), exportación (CRM-06), alertas y reglas automáticas por faltas
  (ATT-06), lista de espera, combos de servicios.

---

## 0. Decisiones de negocio que necesito

Si estás de acuerdo con todas, alcanza con un "OK".

### Regla de 24 h y seña

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| C1 | **¿Cómo se cuentan las 24 h?** | **Con la hora del estudio y la política que aceptó la clienta al reservar.** El plazo es "la misma hora del día anterior" en el reloj del estudio (en Argentina no hay horario de verano, así que son 24 h justas; en un país con cambio de hora, sigue siendo "el día anterior a la misma hora", que es lo que la clienta entiende). Si cancela **a las 24:00:00 o antes del turno, conserva**; un segundo después, pierde. Se usa la ventana guardada en la reserva (`cancellation_window_hours`), no la actual: si el estudio cambia a 48 h, las reservas ya hechas siguen con 24 h. Así la clienta siempre ve "Podés cancelar sin perder la seña hasta el miércoles 13 a las 10:00" y eso se cumple. |
| C2 | **¿Qué significa "conservar la seña" al cancelar?** | **Pasa entera a su saldo a favor en ese estudio** (no se devuelve el dinero). Es lo que dice la regla del brief y evita devoluciones por Mercado Pago, que cuestan comisión y pueden fallar sin saldo. La excepción es C5 (cancela el estudio). |
| C3 | **Reprogramar con 24 h o más: ¿cómo queda el precio y la seña?** | **Se mueve el mismo turno: mismo servicio, mismo precio acordado y la misma seña, que pasa entera al turno nuevo** (sin pasar por el saldo). Se puede cambiar de día, hora y profesional (entre las que hacen ese servicio); el precio no cambia aunque la nueva cobre distinto. Es lo más fácil de entender para la clienta ("lo pasamos al jueves") y no hay diferencias que cobrar ni devolver. Para que el precio no quede congelado para siempre: **desde el sitio, una sola reprogramación por reserva**; desde el panel, sin límite (lo decide el estudio). |
| C4 | **Reprogramar con menos de 24 h** | **La seña anterior se pierde y el turno nuevo pide una seña nueva** (mismo precio y mismo % de seña). Desde el sitio, el turno nuevo queda "esperando pago" con el tiempo normal para pagar; **el horario viejo se libera en el momento** (si no, la clienta tendría dos horarios tomados). Si no paga, vence como cualquier reserva. Antes de confirmar se le muestra: "Vas a perder la seña de $ X y pagar una nueva de $ X". Desde el panel, la seña nueva se puede marcar cobrada en el estudio o dejar esperando pago. |
| C5 | **Si el estudio cancela** | **La clienta nunca pierde la seña.** En el panel, quien cancela elige qué prefiere la clienta: **saldo a favor** (por defecto) o **devolución del dinero**. Si pagó con Mercado Pago, la devolución se pide automáticamente (ya existe desde el Sprint 5); si pagó en el estudio, queda registrado "devuelto en el estudio" con el medio. Elegir devolución requiere permiso de caja. El motivo es obligatorio y la clienta lo ve en "Mis turnos". |
| C6 | **En el panel, ¿quién cancela?** | **Se pregunta siempre: "¿Quién cancela? La clienta / El estudio".** Si la clienta avisa por WhatsApp y la recepción lo carga, aplica la regla de 24 h igual que si lo hiciera desde el sitio. Si cancela el estudio, aplica C5. Queda registrado quién lo marcó y el motivo (para que nadie use "cancela el estudio" para regalar señas sin que quede rastro). |
| C7 | **Si la seña ya se había devuelto o hubo contracargo** (Sprint 5, P8) | **No se acredita lo que ya volvió a la clienta.** El saldo a favor es la seña menos lo devuelto. Evita que cobre dos veces. |
| C8 | **¿Hasta cuándo puede la clienta cancelar o reprogramar desde el sitio?** | **Hasta la hora del turno** (con menos de 24 h, perdiendo la seña). El horario nuevo de una reprogramación respeta las reglas normales de reserva (12 h de anticipación mínima, 60 días, horarios libres). Una reserva **esperando pago** no se reprograma: se libera (ya existe) y se reserva otra, sin consecuencias. |

### Saldo a favor

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| C9 | **¿Cómo se usa el saldo?** | **Automáticamente en la seña de la próxima reserva**, online o manual, en ese mismo estudio. Si cubre toda la seña, la reserva queda **confirmada al instante** sin pasar por Mercado Pago. Si cubre una parte, paga la diferencia con Mercado Pago. Lo que sobra queda para la próxima. Se muestra en el resumen: "Usás $ 3.000 de tu saldo · pagás $ 2.500". Si la reserva vence o la libera, el saldo usado vuelve (movimiento de reversa). Usar el saldo para pagar el resto del turno en el estudio llega con la caja (Épica 11). |
| C10 | **¿Vence? ¿Se transfiere?** | **Decidido: vence a los 90 días**, configurable por estudio en «Reglas de reservas» (de 30 a 365 días). Cada acreditación vence por separado, con los días de la política que aceptó la clienta en ese turno (un ajuste manual usa los días vigentes). Se usa primero lo que vence antes. Antes de vencer, «Mis turnos» muestra cuánto queda y hasta cuándo («$ 3.000 hasta el 10/02»). Lo vencido se registra con un movimiento `expired` (nunca se borra nada). No se transfiere a otra persona y sirve para cualquier servicio del estudio. Es un monto fijo en pesos, no se ajusta por inflación. |
| C11 | **¿Se puede cargar o quitar saldo a mano?** | **Sí, solo dueña y encargada** (permiso nuevo `credits.manage`), con motivo obligatorio, y nunca dejando el saldo negativo. Sirve para compensar a una clienta o corregir un error. Nunca se edita ni borra un movimiento: se corrige con otro. Recepción no puede (es plata). |

### Agenda y asistencia

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| C12 | **Faltas (no-show): ¿automáticas o a mano?** | **A mano**, desde la hora del turno en adelante. Nunca se marca sola: el estudio sabe si la clienta llegó tarde, avisó, etc. Los turnos que ya pasaron sin marcar aparecen como **"Sin cerrar"** en la agenda y en el inicio, para que nadie se olvide. Una falta **pierde la seña**. |
| C13 | **¿Se puede corregir una falta marcada por error?** | **Sí, una vez, dentro de los 7 días, con motivo** y con permiso de agenda (`agenda.manage`): "Faltó" pasa a "Atendida" y la seña vuelve a contar como pago del turno. Queda en el historial. Nada más se puede deshacer (una cancelación no se "des-cancela"). |
| C14 | **¿Quién marca llegó / empezó / terminó / faltó?** | **La profesional puede marcar llegó, empezó y terminó en sus propios turnos** (permiso nuevo `agenda.mark_own`). **"Faltó" solo recepción, encargada y dueña**, porque tiene consecuencias de plata. Se pueden saltear pasos (marcar "terminó" directo): en un día movido nadie marca todo. Lo que cuenta para la asistencia es terminó (atendida) o faltó. |
| C15 | **¿Se le avisa a la clienta cuando el estudio cancela o reprograma?** | **Este sprint, en "Mis turnos" del sitio** (con el motivo) y con un botón en el panel **"Avisar por WhatsApp"** que abre WhatsApp con el mensaje ya escrito al teléfono de la ficha. Sin envíos automáticos hasta tener Resend/WhatsApp (pendiente del README). |
| C16 | **"Columnas por especialidad" (CAL-02)** | **Una columna por profesional** en la vista día (lo que de verdad ocupa la agenda), con filtro por profesional. En el celular se ve **una profesional a la vez** (chips para cambiar) o "Todas" como lista por hora. |
| C17 | **Indicadores: ¿qué es "frecuente" y "faltas repetidas"?** | **Frecuente: 3 o más turnos atendidos en los últimos 90 días. Faltas repetidas: 2 o más faltas en los últimos 180 días.** Fijos por ahora (configurables más adelante). Se muestran como etiqueta en la agenda y en la ficha ("2 faltas"), para que la recepción lo sepa al confirmar. **Sin castigos automáticos** (por ejemplo, pedir 100% de seña): eso es ATT-06 y lo decide el estudio después. |
| C18 | **¿Qué cuenta como qué?** | **Atendida:** terminó. **Falta:** faltó. **Cancelación tardía** (menos de 24 h, por la clienta): se cuenta aparte, **no es falta**. **Cancelación a tiempo, reprogramación y cancelación del estudio: no cuentan en contra.** Tasa de asistencia = atendidas / (atendidas + faltas), solo de turnos ya pasados. |

### Clientas

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| C19 | **¿La profesional ve todas las clientas?** (pendiente del README) | **No: solo las que tienen o tuvieron turno con ella** (permiso nuevo `clients.read_own`; se le saca `clients.read` al rol Profesional en todos los estudios). Ve sus datos, historial con ella, preferencias, alergias y notas. No ve pagos ni saldo. |
| C20 | **Notas internas** | **Solo para el equipo; la clienta nunca las ve.** Cada nota tiene autora y fecha, **no se edita ni se borra**: se puede ocultar (la autora o quien tiene `clients.manage`), y queda en el historial. Puede escribir notas quien ve la ficha (incluida la profesional, sobre sus clientas). |
| C21 | **Preferencias y alergias** | **Una tarjeta editable por quien tiene `clients.manage`** (alergias, preferencias, profesional preferida, comentario libre). Las alergias son **datos de salud** (sensibles por la ley 25.326): se muestran con un aviso visible en la ficha y en el detalle del turno, la auditoría registra qué campo cambió pero **nunca el valor**, y Cleo Admin no las ve. La clienta no las ve por ahora. |

---

## 1. Cómo funciona, en una página

```
                    ┌─────────────── ¿Cuánto falta para el turno? (hora del estudio, política de la reserva) ──┐
Clienta o panel ──► │  ≥ 24 h                                   │  < 24 h                                     │
                    ├───────────────────────────────────────────┼─────────────────────────────────────────────┤
  Cancelar (clienta)│  seña → saldo a favor (libro)            │  seña perdida                               │
  Reprogramar       │  mismo turno movido, seña pasa entera    │  seña perdida + seña nueva (esperando pago) │
  Cancela el estudio│  saldo a favor o devolución (C5), siempre, sin importar la hora                         │
  Faltó             │  —                                        │  seña perdida (desde la hora del turno)     │
  Terminó           │  la seña cuenta como pago del turno (la caja cobra el resto, Épica 11)                  │
                    └──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Una sola función decide** (`app.deposit_terms`): recibe la reserva y el momento, y devuelve el
plazo, si conserva o pierde y el monto. La usan la pantalla (para mostrar la consecuencia antes
de confirmar), las acciones del sitio y las del panel. La pantalla solo muestra; la base vuelve a
calcular al ejecutar.

**Si la consecuencia cambió mientras la clienta miraba** (vio "conservás" a las 10:00:30 de un
turno de mañana a las 10:00 y confirmó a las 10:00:45), la acción manda la consecuencia que vio
(`expected`); si ya no coincide, no hace nada y responde: "Pasó el plazo: ahora la seña se pierde.
¿Querés cancelar igual?". Nunca se ejecuta una consecuencia distinta de la que se mostró.

---

## 2. Modelo de datos

Todo con `tenant_id not null`, claves compuestas `(tenant_id, x_id)`, RLS en la misma migración,
nada para `anon` y dinero en `bigint` con moneda.

### Cambios en `appointments`

**Estados nuevos de la reserva** (`appointment_status`): `rescheduled`, `completed`, `no_show`.

| Transición | Quién | Cuándo |
|---|---|---|
| `confirmed → cancelled` | Clienta, panel | Antes de la hora del turno (clienta); siempre (panel) |
| `confirmed → rescheduled` | Clienta, panel | Antes de la hora del turno (clienta); el turno nuevo se crea en la misma transacción |
| `confirmed → completed` | `agenda.manage` o `agenda.mark_own` (sus turnos) | Desde 2 h antes del turno |
| `confirmed → no_show` | `agenda.manage` | Desde la hora del turno |
| `no_show → completed` | `agenda.manage` | Corrección (C13): una vez, 7 días, motivo |

`cancelled`, `rescheduled`, `expired` y `completed` son finales. Los estados que liberan el horario
para la restricción anti doble reserva siguen siendo los mismos: solo `pending_payment` y
`confirmed` ocupan. (`completed` y `no_show` son turnos pasados, así que no hace falta que ocupen;
la corrección C13 no vuelve a ocupar nada.)

**Estado de la seña** (`deposit_status`): suma `credit` (la cubrió entera el saldo a favor) y
`transferred` (vino de una reprogramación a tiempo).

**Columnas nuevas** (las escriben solo las funciones; el trigger de "lo acordado no cambia" sigue
igual y además impide tocar estas columnas fuera de las transiciones válidas):

| Columna | Para qué |
|---|---|
| `credit_applied_minor bigint not null default 0` | Parte de la seña cubierta con saldo (C9). Mercado Pago cobra `deposit_minor − credit_applied_minor` |
| `rescheduled_from uuid` (compuesta → `appointments`) | Turno del que viene. Único: un turno se reprograma una sola vez hacia uno solo |
| `reschedule_count smallint` | Cuántas veces se movió la cadena (C3: online, máximo 1) |
| `checked_in_at`, `started_at`, `finished_at` | Llegó / empezó / terminó. Solo se completan, nunca se borran, y en orden |
| `cancelled_by` (`client` · `studio`), `cancel_reason` | C5, C6 |
| `deposit_outcome` | Qué pasó con la seña: `applied` (atendida) · `credited` (saldo) · `forfeited` (perdida) · `refunded` (devuelta) · `transferred` (pasó al turno nuevo). Se fija **una sola vez**, al cerrar el turno |
| `deposit_outcome_minor` | Monto de ese resultado (la seña menos lo ya devuelto, C7) |
| `closed_at`, `closed_by` | Cuándo y quién cerró el turno |

**Historial** (`appointment_events`, solo agregado): tipos nuevos `checked_in`, `started`,
`completed`, `no_show`, `no_show_corrected`, `rescheduled`, `rescheduled_in`, `credited`,
`forfeited`, `refunded_offline`, `credit_used`, `credit_returned`. El detalle guarda quién, desde
dónde (sitio / panel), el plazo calculado y el momento exacto del cálculo.

> Por qué no hay tabla `attendance_records` (backlog): la asistencia es el **estado** de la
> reserva, un solo valor por turno. Una tabla aparte podría tener dos registros para el mismo
> turno o contradecir el estado. Así "la asistencia se registra una vez" lo garantiza la base.

### `client_credit_entries` — libro del saldo a favor (nuevo)

| Campo | Notas |
|---|---|
| `id`, `tenant_id`, `client_profile_id` (compuesta) | |
| `amount_minor bigint` | Positivo suma, negativo resta. Nunca 0 |
| `currency` | La del estudio |
| `kind` | `cancellation_credit` · `studio_cancellation_credit` · `used_in_booking` · `returned_from_booking` (la reserva venció o se liberó) · `manual_adjustment` · `expired` |
| `expires_at` | Solo en las acreditaciones («lotes»): fecha de la acreditación + días de vencimiento (C10) |
| `lot_id` (compuesta, misma clienta) | En los movimientos que restan o devuelven: de qué acreditación salen. Un uso que toma de dos lotes son dos movimientos |
| `appointment_id` (compuesta, opcional) | El turno que lo originó o donde se usó |
| `reverses_entry_id` (opcional) | Para `returned_from_booking`: a qué uso revierte. Único (una reversa por uso) |
| `reason` | Obligatorio en ajustes manuales |
| `created_by`, `created_at` | |

- **Solo agregado** (trigger como `audit_logs`): nadie edita ni borra, ni el superusuario.
- **Saldo = lo que queda de cada lote sin vencer** (vista `client_credit_lots`). Un lote vencido deja de
  contar en el momento aunque la tarea diaria todavía no haya escrito su movimiento `expired`
  (pg_cron, una vez por día). Si una reserva que usó saldo vence o se libera, el saldo vuelve a su
  mismo lote, con su misma fecha de vencimiento.
- Cada escritura bloquea la ficha
  de la clienta (`for update`) y verifica que el saldo no quede negativo: dos reservas simultáneas
  no pueden usar el mismo saldo dos veces (test de concurrencia).
- Índices únicos que impiden duplicados: un `cancellation_credit` por turno, un `used_in_booking`
  por turno.
- **RLS:** la clienta lee los suyos; el equipo con `clients.read` lee los del estudio (la
  profesional, no: C19). Sin escritura directa. Cleo Admin, nada.

### `client_notes` (nuevo)

`id`, `tenant_id`, `client_profile_id` (compuesta), `body` (1–1000), `author_user_id`,
`created_at`, `hidden_at`, `hidden_by`. Sin `update` del texto (trigger), sin `delete`. RLS: leen
`clients.read` y `clients.read_own` (sus clientas); la clienta **nunca** (política explícita y
test). Auditoría sin valores.

### `client_preferences` (nuevo, una fila por clienta)

`tenant_id`, `client_profile_id` (PK compuesta), `allergies` (≤ 500), `preferences` (≤ 1000),
`preferred_professional_id` (compuesta, opcional), `updated_by`, `updated_at`. RLS: leen
`clients.read` / `clients.read_own`; escribe `clients.manage` vía función. Auditoría con los
nombres de campo cambiados, nunca los valores (igual que `client_profiles`).

### Permisos nuevos

| Permiso | Roles de sistema |
|---|---|
| `agenda.mark_own` | Profesional (dueña, encargada y recepción ya pueden con `agenda.manage`) |
| `clients.read_own` | Profesional (se le saca `clients.read`, C19) |
| `credits.manage` | Dueña y encargada |

La migración actualiza los roles de sistema de **todos** los estudios. Los roles propios de cada
estudio no cambian (la dueña los ajusta).

### Migraciones

1. `20261110002700_sprint6_enums.sql`: valores nuevos de los enums (Postgres no deja usar un valor
   nuevo de enum en la misma transacción en que se crea, por eso va sola).
2. `20261110002800_cancellation_credits.sql`: columnas de `appointments`, transiciones, libro de
   saldo, `app.deposit_terms`, cancelar, reprogramar, uso del saldo en reservas, ajuste de
   `apply_mp_payment` (monto = seña − saldo usado) y del vencimiento (devuelve el saldo usado).
3. `20261110002900_attendance.sql`: llegó / empezó / terminó / faltó, corrección, permisos nuevos,
   `agenda_range`, indicadores.
4. `20261110003000_client_crm.sql`: notas, preferencias, `clients.read_own`, RLS de fichas para la
   profesional, directorio y ficha.

---

## 3. Funciones (base de datos)

Todas `SECURITY DEFINER` con `search_path = ''`, permisos validados adentro y el estudio derivado
de la sesión (o del `slug` del host para la clienta), nunca del navegador. Cada una bloquea la
reserva (`for update`) antes de decidir, así cancelar, marcar falta y un pago tardío de Mercado
Pago no se pisan.

| Función | Quién | Qué hace |
|---|---|---|
| `app.deposit_terms(appointment, at)` | Interna | **El único cálculo de la regla.** Devuelve `deadline` (local del estudio → instante), `keeps` (`at <= deadline`), `amount_minor` (seña − devuelto, C7) |
| `get_booking_terms(slug, code)` / `get_booking_terms_staff(appointment)` | Clienta dueña / equipo | Lo que muestra la pantalla: plazo, consecuencia de cancelar y de reprogramar, si puede reprogramar online (C3) |
| `cancel_my_booking(slug, code, expected)` | Clienta | `confirmed → cancelled`; `credited` (al libro) o `forfeited` según `deposit_terms`. Rechaza si `expected` no coincide |
| `cancel_booking(appointment, by, reason, refund_mode, expected)` | `agenda.manage` (devolución: además `cash.manage`) | `by = client` → regla de 24 h. `by = studio` → C5: saldo, devolución por Mercado Pago (`app.request_refund`, motivo `studio_cancelled`) o "devuelto en el estudio" |
| `reschedule_my_booking(slug, code, professional, starts_at, expected)` | Clienta | C3 / C4. Valida disponibilidad pública (12 h, 60 días, horarios); máximo 1 por cadena |
| `reschedule_booking(appointment, professional, starts_at, force_outside_hours, paid_offline_method, expected)` | `agenda.manage` | Igual, con las reglas del turno manual (fuera de horario con tilde, nunca encima de otro turno) |
| `mark_attendance(appointment, step)` | `agenda.manage` o `agenda.mark_own` (suyos) | `checked_in` / `started` / `finished`. "Finished" cierra: `completed`, `deposit_outcome = applied` |
| `mark_no_show(appointment)` | `agenda.manage` | Desde la hora del turno: `no_show`, `forfeited` |
| `correct_no_show(appointment, reason)` | `agenda.manage` | C13 |
| `agenda_range(from, to, professionals[])` | `agenda.read_all` / `read_own` | Turnos, bloqueos y horario de cada profesional en el rango (una consulta), con etiquetas de la clienta (frecuente, faltas) |
| `my_credit(slug)` | Clienta | Saldo y movimientos propios |
| `client_credit(client)` / `adjust_client_credit(client, amount, reason)` | `clients.read` / `credits.manage` | Libro y ajuste (C11) |
| `list_clients(search, filter, page)` | `clients.read` / `read_own` | Directorio: búsqueda sin mayúsculas ni acentos (`lower(x collate "und-x-icu")`), filtros frecuentes / con faltas / con saldo |
| `create_client(full_name, phone, email)` | `clients.manage` | Alta (CRM-01); email único por estudio como hoy |
| `client_file(client)` | `clients.read` / `read_own` | Ficha: datos, indicadores, turnos (la profesional, solo los suyos), pagos y saldo (solo con `clients.read` + `cash.read`) |
| `add_client_note` / `hide_client_note` / `set_client_preferences` | C20, C21 | |
| `attendance_stats(from, to, professional)` | `reports.read` | Tasa del estudio, ranking de frecuentes y de faltas repetidas, cancelaciones tardías |

**Cambios en funciones existentes:**
- `app.create_appointment` (online y manual): aplica el saldo a favor automáticamente (C9),
  bloqueando la ficha. Si cubre todo: `confirmed` + `deposit_status = credit`, sin bloqueo temporal.
- `start_deposit_checkout` y `app.apply_mp_payment`: el monto a cobrar y a verificar es
  `deposit_minor − credit_applied_minor`.
- `app.expire_holds` y `release_my_pending_booking` / `cancel_unpaid_booking`: si la reserva usó
  saldo, se devuelve con un movimiento `returned_from_booking` (trigger en el cambio de estado, así
  ningún camino se lo olvida).
- `app.apply_mp_payment`: un pago tardío para un turno `rescheduled` o `cancelled` sigue yendo a
  devolución (como hoy con `late_released`).
- `my_bookings`: suma estado de asistencia, quién canceló y motivo, saldo usado, turno nuevo de una
  reprogramación.

---

## 4. Pantallas

Todas con el tema de Cleo (`docs/diseno/`, reglas de diseño del `CLAUDE.md`): `GlassCard`,
`StatusPill`, `PageTitle`, `StatCard` solo con números reales, celular primero (375 px, todo lo
tocable ≥ 44 px), seda que nunca pasa por debajo de un texto, marca Cleo o marca propia según
`studioBrand()`. Referencias: `ref-turnos.png` (lista, pastillas, chips de filtro),
`ref-panel-principal.png` (tarjetas), `ref-movil.png` y `ref-app-elegante.png` (celular).

**Pastillas nuevas** (se agregan a `theme.test.ts` con contraste ≥ 4,5:1): Atendida (verde, como
Confirmado), En el estudio / En curso (champagne suave), Faltó y Cancelada (rojo, como Cancelado),
Reprogramada y Sin cerrar (neutro). Etiquetas de clienta: "Frecuente" (champagne) y "2 faltas"
(rojo suave). El dorado nunca como texto chico.

### Panel del estudio

| Ruta | Quién | Qué ve |
|---|---|---|
| `/admin/agenda` | `agenda.read_all` / `read_own` | **Reemplaza a "Turnos" en el menú.** Vista **Día** (por defecto, hoy) y **Semana**. **Celular:** fecha arriba con flechas y "Hoy", chips de profesional (o la propia, si es profesional), lista por hora con tarjetas de vidrio: hora, clienta (+ etiquetas), servicio, pastilla de estado y **botones grandes de acción rápida** según el momento: *Llegó* → *Empezó* → *Terminó*, y *Faltó* desde la hora del turno. **Escritorio:** grilla por hora con **una columna por profesional** (C16), bloques del alto de la duración, zonas fuera de horario y bloqueos sombreados, turnos "Sin cerrar" marcados. **Semana:** en celular, tira de 7 días con la cantidad de turnos y la lista del día elegido; en escritorio, 7 columnas. Se actualiza al volver a la pestaña y cada 60 s. Botón "Nuevo turno" (manual, ya existe) y "Bloquear" (abre Bloqueos con el día y la profesional cargados, y avisa si ese día ya tiene turnos). |
| `/admin/turnos` | Igual | Se mantiene como **vista Lista** (pestaña de la agenda), con los chips de `ref-turnos.png`: Todos · Confirmados · Pendientes · Sin cerrar · Canceladas · Faltas. |
| `/admin/turnos/[id]` | Equipo | Detalle (ya existe) más: estado de asistencia con horas, **qué pasó con la seña**, plazo de cancelación ("conserva la seña hasta…"), acciones **Cancelar** (pregunta quién cancela, muestra la consecuencia y en C5 saldo o devolución), **Reprogramar** (día, hora y profesional con disponibilidad del servidor, consecuencia antes de confirmar), **Corregir falta**, "Avisar por WhatsApp" (C15), link a la ficha de la clienta y alergias destacadas si hay. |
| `/admin/clientas` | `clients.read` / `read_own` | Directorio: buscador, chips Todas · Frecuentes · Con faltas · Con saldo, filas con iniciales (`InitialsAvatar`), última visita, próximo turno y etiquetas. Botón "Nueva clienta" (`clients.manage`). |
| `/admin/clientas/[id]` | Igual | **Ficha:** encabezado con nombre, teléfono (link a WhatsApp), email y etiquetas; tarjetas reales (turnos atendidos, faltas, tasa de asistencia, saldo a favor) que no se muestran si no hay datos; secciones **Turnos** (todos, con cancelaciones y reprogramaciones), **Pagos y saldo** (pagos de Mercado Pago y en el estudio, libro del saldo, botón "Ajustar saldo" con `credits.manage`), **Notas internas** (con autora y fecha, "Solo la ve el equipo"), **Preferencias y alergias**. Editar datos con `clients.manage`. |
| `/admin/asistencia` | `reports.read` | Período (30 / 90 / 180 días) y profesional. Tarjetas: tasa de asistencia, atendidas, faltas, cancelaciones tardías. Dos listas: **Clientas frecuentes** y **Faltas repetidas**, con link a la ficha. Sin gráficos si no hay datos suficientes. |
| Inicio del panel | Equipo | Tarjeta nueva "Sin cerrar" (turnos pasados sin marcar) y "Faltas este mes", solo si son mayores que cero. |

Menú del panel: **Agenda** (en lugar de Turnos), **Clientas** y **Asistencia** se suman según
permiso; nada más.

### Sitio (clienta)

| Ruta | Qué cambia |
|---|---|
| `/reserva/[código]` confirmada | Tarjeta "Cambios y cancelación": **"Podés cancelar o cambiar el día sin perder la seña hasta el miércoles 13 a las 10:00 (hora de Buenos Aires)"**, o "Ya pasó el plazo: si cancelás o cambiás el día, perdés la seña de $ X". Botones **Cambiar día u horario** y **Cancelar turno**, cada uno con una pantalla de confirmación que repite la consecuencia exacta en palabras simples. |
| `/reserva/[código]/cambiar` | Paso de día y horario del flujo de reserva (mismo servicio; profesional a elección), resumen "Antes / Ahora" y la consecuencia. Si es menos de 24 h, lleva a pagar la seña nueva. |
| `/reserva/[código]` cancelada / reprogramada / atendida / faltó | Explicación: "Cancelaste con más de 24 h: sumamos $ X a tu saldo", "El estudio canceló tu turno: [motivo]. Te devolvimos $ X / sumamos $ X a tu saldo", "Pasamos tu turno al jueves 14 a las 11:00" (con link al nuevo). |
| `/reservar/confirmar` | Si tiene saldo: "Usás $ X de tu saldo a favor · pagás $ Y" o "Tu saldo cubre la seña: tu turno queda confirmado". |
| `/mi-ficha` (Mis turnos) | Tarjeta **Saldo a favor** (solo si hay o hubo movimientos) con los movimientos explicados, y los estados nuevos de cada turno. |

---

## 5. Permisos

| Acción | Permiso |
|---|---|
| Ver agenda | `agenda.read_all` (todo) / `agenda.read_own` (solo sus turnos) |
| Llegó / empezó / terminó | `agenda.manage`, o `agenda.mark_own` en sus turnos |
| Faltó, corregir falta, cancelar, reprogramar desde el panel | `agenda.manage` |
| Cancelar por el estudio con devolución | `agenda.manage` + `cash.manage` |
| Ver directorio y fichas | `clients.read` (todas) / `clients.read_own` (sus clientas) |
| Alta y edición de fichas, preferencias y alergias | `clients.manage` |
| Notas internas | Quien ve la ficha escribe; ocultar: la autora o `clients.manage` |
| Ver pagos y saldo en la ficha | `clients.read` + `cash.read` (saldo solo: `clients.read`) |
| Ajustar saldo | `credits.manage` (dueña y encargada) |
| Indicadores de asistencia | `reports.read` |
| Cancelar / reprogramar / ver su saldo | La clienta dueña de la reserva (sesión, estudio del host) |
| Cleo Admin | Nada de esto (ni turnos, ni fichas, ni notas, ni saldos) |

Cada página del panel llama a `requireStaff` / `requirePermission`, y cada acción vuelve a
verificar con `currentStaff()` + `can()`; la base decide igual.

---

## 6. Validaciones

- **Servidor (zod) y base:** ids como uuid, `step` y `by` de una lista cerrada, motivo 3–200
  caracteres (obligatorio al cancelar por el estudio, corregir falta y ajustar saldo), notas
  1–1000, alergias ≤ 500, preferencias ≤ 1000, ajuste de saldo entero distinto de 0 y con tope.
  `expected` (la consecuencia que vio la pantalla) obligatorio al cancelar y reprogramar.
- La consecuencia, el plazo y los montos **nunca** vienen del navegador; se recalculan con
  `app.deposit_terms` dentro de la transacción, con la reserva bloqueada.
- Reprogramar: mismo servicio, profesional que lo hace y activa, horario libre (la restricción
  anti doble reserva es la garantía final), reglas públicas para la clienta, una vez online.
- Asistencia en orden (no "empezó" después de "terminó"), solo sobre turnos `confirmed`; "terminó"
  desde 2 h antes; "faltó" desde la hora del turno; nada sobre turnos de otra profesional con
  `agenda.mark_own`.
- Saldo: nunca negativo, una sola acreditación y un solo uso por turno (índices únicos).
- Estudio suspendido (solo lectura): ninguna de estas acciones (`app.tenant_is_writable`).
- Mensajes de error nuestros y en castellano: "Pasó el plazo…", "Ese horario ya no está libre",
  "Ya reprogramaste este turno una vez; escribile al estudio", "Este turno ya está cerrado".

---

## 7. Criterios de aceptación

1. Cancelar exactamente 24 h antes (hora del estudio) acredita la seña como saldo; 23:59 antes la
   pierde. Igual desde el sitio y desde el panel (cuando cancela la clienta).
2. La ventana es la de la política aceptada en la reserva, no la vigente.
3. Si la consecuencia cambió entre que se mostró y se confirmó, no se ejecuta nada y se avisa.
4. Reprogramar con 24 h o más mueve el turno con el mismo precio y la seña pasa entera, sin
   movimientos de saldo; con menos, la seña vieja se pierde y el turno nuevo pide seña nueva.
5. Desde el sitio se reprograma una sola vez; desde el panel, sin límite.
6. Si cancela el estudio, la clienta nunca pierde la seña: saldo a favor o devolución (por
   Mercado Pago, automática), y ve el motivo en "Mis turnos".
7. El saldo se usa solo en la próxima reserva: cubre todo (confirmada sin Mercado Pago) o una parte
   (paga la diferencia). Si esa reserva vence o se libera, el saldo vuelve.
8. El libro de saldo no se puede editar ni borrar (ni con el superusuario); un saldo usado o
   perdido no se vuelve a usar; dos reservas simultáneas no gastan el mismo saldo.
9. Faltó pierde la seña y cuenta como falta; cancelar a tiempo, reprogramar o que cancele el
   estudio no cuentan como falta; cada turno tiene un único resultado de asistencia.
10. La agenda muestra día y semana, una columna por profesional en escritorio y una profesional
    (o todas en lista) en el celular, sin superposiciones, con acciones de un toque. La profesional
    ve solo sus turnos y marca llegó / empezó / terminó, pero no "faltó".
11. Todo cambio de estado queda en el historial del turno con quién, cuándo y desde dónde.
12. La ficha muestra datos, turnos (incluidos cancelados y reprogramados), pagos, saldo, faltas,
    notas y preferencias. La clienta no ve notas ni preferencias; la profesional solo ve sus
    clientas y no ve pagos.
13. Los indicadores coinciden con los turnos de la base para el período y la profesional elegidos.
14. Estudio B no ve agenda, fichas, notas, saldos ni indicadores de A; Cleo Admin tampoco.
15. Todas las pantallas nuevas siguen el tema de Cleo, sin números inventados, sin scroll
    horizontal a 375 px, y `theme.test.ts` cubre las pastillas nuevas.

---

## 8. Tests

**Base de datos** (`db/tests/20_…` a `25_…`, `./scripts/test-db.sh`):
- `20_deposit_terms.sql`: `app.deposit_terms` con la reserva a **24:00:00** (conserva),
  **23:59:00** y **23:59:59** (pierde) y 24:00:01 (conserva); estudio en
  `America/Argentina/Buenos_Aires` y otro con cambio de hora (`America/Santiago`) alrededor del
  cambio; ventana 24 vs 48 h (política de la reserva vs. vigente); seña con devolución parcial (C7).
  Y de punta a punta con las RPC: turno a `now() + 24 h` exacto (dentro de la transacción `now()` es
  fijo) → `credited`; a `now() + 24 h − 1 min` → `forfeited`.
- `21_cancellation.sql`: clienta y panel (cancela la clienta / el estudio con saldo, devolución por
  Mercado Pago y en el estudio); `expected` distinto → error y nada cambia; turno ya pasado; estudio
  suspendido; otra clienta no puede cancelar; la recepción no puede elegir devolución sin caja.
- `22_credits.sql`: libro solo agregado (update, delete y truncate fallan, también como superusuario);
  saldo cubre todo / una parte / nada; vencimiento y liberación devuelven el saldo una sola vez;
  ajuste manual (`credits.manage`, nunca negativo); monto de Mercado Pago = seña − saldo; la
  clienta ve solo su saldo; la profesional no ve saldos.
- `23_reschedule.sql`: ≥ 24 h (mismo precio, `transferred`, sin movimientos), < 24 h (`forfeited` +
  seña nueva), límite online, horario ocupado (la restricción lo rechaza y no cambia nada),
  reprogramar a un horario que se superpone con el propio turno, pago tardío de un turno ya
  reprogramado → devolución.
- `24_attendance.sql`: transiciones válidas e inválidas, orden de pasos, "faltó" antes de hora,
  `agenda.mark_own` en un turno ajeno, corrección (una vez, 7 días), un solo resultado por turno,
  indicadores (cancelación a tiempo no es falta, reprogramación no duplica, estudio cancela no cuenta).
- `25_client_crm.sql`: notas sin update ni delete, clienta no lee notas ni preferencias, profesional
  solo sus clientas (`clients.read_own`) y sin pagos, búsqueda con acentos y Ñ, auditoría sin valores
  de alergias, aislamiento A/B de todas las tablas nuevas y Cleo Admin sin acceso.
- Meta (ya existentes): tablas nuevas con RLS, nada para `anon`, funciones con `search_path`.
- **Concurrencia** (`db/tests/concurrency/credit_race.sh`, nuevo, en `test-db.sh`): 20 reservas a la
  vez de la misma clienta con saldo para una sola → el saldo se usa una vez. Y cancelar mientras
  llega el pago tardío / mientras se marca falta → un solo resultado. `booking_race.sh` y
  `payment_race.sh` se vuelven a correr.

**Unitarios (Vitest):** formato del plazo en la zona del estudio ("hasta el miércoles 13 a las
10:00", `booking-format.ts`), textos de consecuencia, armado de la grilla de la agenda (posición y
alto por duración, columnas), validaciones zod, contraste de las pastillas nuevas (`theme.test.ts`).

**E2E** (`scripts/e2e-agenda.mjs`, nuevo, dentro de `npm run e2e`): la clienta cancela con más de
24 h y ve el saldo → reserva otra y el saldo cubre la seña (confirmada sin pagar) → reprograma →
el panel cancela "por el estudio" y elige saldo → la recepción marca llegó / terminó y faltó → la
profesional ve solo lo suyo y no puede "faltó" → ficha con notas que la clienta no ve → indicadores.
Más `e2e:pagos`: diferencia de seña pagada con Mercado Pago simulado y devolución por cancelación
del estudio. Capturas nuevas con `node scripts/screenshots.mjs p-` (agenda día/semana en celular y
escritorio, ficha, asistencia, cancelar/cambiar en el sitio).

**Checklist manual (README):** agenda en un celular real durante un día de trabajo de prueba;
cancelar y reprogramar desde el sitio; "Avisar por WhatsApp".

---

## 9. Orden de implementación (un commit por paso, tests en verde en cada uno)

0. Enums nuevos y `app.deposit_terms` + tests del límite de 24 h.
1. Libro de saldo, cancelar (clienta y panel, C5/C6), devolución por cancelación del estudio, uso del
   saldo en reservas, vencimiento que devuelve el saldo, ajustes en Mercado Pago + tests y concurrencia.
2. Reprogramar (clienta y panel) + tests.
3. Asistencia, corrección de faltas y permisos nuevos + tests.
4. Sitio: cancelar, cambiar día, saldo en el resumen y en "Mis turnos".
5. Agenda del panel (día, semana, celular y escritorio), acciones rápidas, detalle del turno.
6. Clientas: notas, preferencias, `clients.read_own`, directorio, ficha y alta.
7. Asistencia: indicadores, etiquetas y tarjetas del inicio.
8. e2e, capturas y comparación con las referencias.
9. README (garantías, checklist, pendientes), CLAUDE.md (reglas nuevas de cancelación y saldo),
   aplicar migraciones en desarrollo y subir.
