# Sprint 3 — Plan: servicios y profesionales (Épica 04)

> Estado: **implementado** (pasos 1 a 10). Queda el checklist manual del README (celular).
> Cambio respecto del plan: las franjas se guardan en minutos del día (540 = 09:00) en lugar
> de `time`, y las fotos se integraron en los formularios de los pasos 5 y 6.

Backlog: SERV-01 (categorías y servicios), SERV-02 (precio y duración), SERV-03 (asignar
servicios a profesionales), SERV-04 (horarios y descansos), SERV-05 (bloqueos, vacaciones y
feriados) y la parte de buffers de SERV-06. Los combos (varios servicios en un turno)
quedan para el sprint de reservas.

**Criterios de la épica (backlog):**
- Solo se reservan servicios asignados a la profesional.
- Los descansos y bloqueos no ofrecen disponibilidad.
- Los cambios de precio o duración no alteran reservas históricas.

**Fuera de alcance:** reservas, disponibilidad para clientas, agenda, seña y pagos. Este
sprint deja todo listo para que el sprint de reservas lo use.

---

## 0. Decisiones de negocio que necesito

Cada una con mi recomendación. Si estás de acuerdo con todas, alcanza con un "OK".

| # | Pregunta | Recomendación y por qué |
|---|---|---|
| N1 | **¿La seña puede ser distinta según el servicio?** | **Sí, opcional.** La seña general del estudio (hoy 50%) se aplica a todo, y en un servicio puntual se puede poner otra (por ejemplo, 30% en un servicio caro para no espantar clientas). **No por profesional**: complica explicarlo y casi nunca hace falta. |
| N2 | **Si dos profesionales cobran distinto el mismo servicio, ¿qué precio se muestra en el sitio?** | **"Desde $X"** con el más barato, y el precio exacto aparece cuando la clienta elige profesional. Es lo más honesto y lo que la clienta entiende rápido. |
| N3 | **¿Un servicio puede tener "precio desde"?** (por ejemplo, según el largo de las uñas, se define en el local) | **Sí, como opción del servicio.** Se muestra "desde $X". La seña se calcula sobre ese precio base y la diferencia se cobra en el local. |
| N4 | **Si una profesional no tiene horario propio cargado, ¿cuándo atiende?** | **En el horario del estudio.** Así una profesional nueva funciona sin configurar nada; solo se carga horario propio si es distinto. |
| N5 | **¿Una profesional puede atender fuera del horario del estudio?** | **No.** Su horario siempre queda dentro del del estudio. Si un sábado abren solo para ella, se agrega el sábado al horario del estudio. Evita turnos con el local cerrado. |
| N6 | **¿Las profesionales pueden cargar sus propios horarios y días libres desde el panel?** | **No por ahora.** Lo cargan la dueña, la encargada o recepción. Más adelante se puede habilitar como permiso aparte para que pidan días libres. |
| N7 | **¿Un estudio puede tener más de un local (sucursales)?** | **Una sola ubicación por estudio por ahora.** Es lo que necesita Fresas y simplifica todo. Si un estudio abre otro local, se suma "sucursal" en un sprint propio sin rehacer lo de ahora. |
| N8 | **Feriados: ¿se cargan solos o a mano?** | **A mano, como un bloqueo de todo el estudio.** Cada estudio decide si abre un feriado. Más adelante: un botón "sugerir feriados nacionales del año". |
| N9 | **El tiempo extra entre turnos, ¿va antes, después o ambos?** | **Solo después**, por servicio (por ejemplo, 10 minutos de limpieza después de un esmaltado). Es lo que se usa en la práctica y es más fácil de entender. |
| N10 | **¿Se puede ocultar el precio de un servicio en el sitio ("consultar")?** | **No.** Para reservar y pagar la seña online la clienta tiene que ver el precio. Si un servicio no se quiere ofrecer online, se marca "no visible en el sitio". |

---

## 1. Modelo de datos

Reglas generales:
- Todo con `tenant_id` y RLS, como siempre.
- **Integridad entre estudios por claves compuestas:** las referencias van como
  `(tenant_id, x_id) → (tenant_id, id)`. Así la base hace imposible asignar a una
  profesional del estudio A un servicio del estudio B, aunque alguien lo intente por la API.
- **Dinero en enteros:** `price_minor bigint` en centavos y moneda del estudio. En pesos
  argentinos se muestra sin decimales (por ejemplo, "$12.500").
- **Duraciones en minutos enteros**, múltiplos de 5.
- **Nada se borra si puede estar en un turno:** servicios y profesionales se **archivan**.
- Horarios con día de la semana ISO (1 = lunes … 7 = domingo) y horas locales del
  estudio. Bloqueos con fecha y hora absolutas (`timestamptz`), convertidas con la zona
  horaria del estudio.

### Tablas

**`service_categories`**: `id`, `tenant_id`, `name` (2–60), `position`, `is_active`.
Nombre único por estudio, sin distinguir mayúsculas.

**`services`**

| Campo | Tipo y reglas |
|---|---|
| `category_id` | Opcional; categoría del mismo estudio (clave compuesta) |
| `name`, `description` | 2–80 · hasta 1000 |
| `duration_minutes` | 5–600, múltiplo de 5 |
| `buffer_after_minutes` | 0–240, múltiplo de 5 (N9) |
| `price_minor` | `bigint` ≥ 0 |
| `price_is_from` | `boolean`: "precio desde" (N3) |
| `deposit_percent` | `smallint` 0–100, opcional: si está vacío usa el del estudio (N1) |
| `photo_path` | Opcional, en Storage (`catalog`) |
| `is_active` | Si está en `false` no se ofrece |
| `show_online` | Visible en el sitio |
| `position` | Orden dentro de la categoría |
| `archived_at` | Archivado en lugar de borrado |

**`professionals`**

| Campo | Tipo y reglas |
|---|---|
| `membership_id` | **Opcional**: si tiene cuenta en el panel, la vincula a su membresía (del mismo estudio, una profesional por membresía). Si no usa la app, queda vacío. |
| `display_name`, `bio` | 2–60 · hasta 500 |
| `photo_path` | Opcional |
| `is_active`, `show_online`, `accepts_online_booking`, `position`, `archived_at` | |

**`professional_services`**: qué servicios hace cada profesional.
- `professional_id`, `service_id` (los dos del mismo estudio).
- `price_minor_override` y `duration_minutes_override`, opcionales: "esta profesional cobra
  o tarda distinto".
- Sin fila, no hace ese servicio.

**`working_hours`**: horarios por franjas.
- `professional_id` vacío significa horario del estudio.
- `weekday`, `start_time`, `end_time`.
- **Los descansos son los huecos entre franjas.** Por ejemplo, lunes 9–13 y 14–19 = descanso
  de 13 a 14. Es más simple de cargar en el celular que una tabla de descansos aparte.
- La base impide franjas superpuestas del mismo día (restricción de exclusión con
  `btree_gist`).
- Un trigger impide que la franja de una profesional quede fuera del horario del estudio
  (N5).

**`schedule_blocks`**: bloqueos.

| Campo | Tipo y reglas |
|---|---|
| `professional_id` | Vacío = todo el estudio (feriado, cierre) |
| `kind` | `vacation` · `holiday` · `day_off` · `block` |
| `period` | `tstzrange` (desde–hasta); los "todo el día" se guardan de 00:00 a 00:00 del día siguiente, en la zona del estudio |
| `all_day`, `note` (hasta 200), `created_by` | |

### Cómo se calcula cuándo atiende una profesional

Función de base `app.working_intervals(tenant, profesional, desde, hasta)`. Este sprint la
deja hecha y testeada; el sprint de reservas le resta los turnos ocupados.

1. Toma las franjas de la profesional, o las del estudio si no tiene (N4).
2. Las recorta al horario del estudio (N5).
3. Les resta los bloqueos del estudio y los de esa profesional.
4. Lo convierte a horas reales con la zona horaria del estudio.

### Para que un cambio de precio no altere turnos (previsto para reservas)

- Cuando existan turnos, cada servicio reservado va a guardar una **foto** de lo que se
  acordó: nombre, duración, tiempo extra, precio, seña aplicada y versión de política. Esa
  foto no se recalcula nunca.
- Desde este sprint:
  - Servicios y profesionales **no se pueden borrar**, solo archivar. Las claves usan
    `on delete restrict` y no se otorga `DELETE`.
  - Cada cambio de precio, duración o seña queda en la auditoría con el valor anterior y
    el nuevo.
- Test en el sprint de reservas: cambiar el precio de un servicio y verificar que el turno
  ya tomado conserva el precio original.

### Fotos

- Bucket público **`catalog`**: PNG, JPEG o WebP, hasta 1 MB, en
  `<tenant_id>/services/<uuid>.<ext>` y `<tenant_id>/professionals/<uuid>.<ext>`.
- Mismas protecciones que los logos: tipo verificado por los bytes del archivo, sin SVG, y
  escritura solo en la carpeta del estudio con `services.manage`.
- Una foto de profesional en el sitio público requiere su consentimiento: el formulario lo
  recuerda con un aviso al subirla.

---

## 2. Migraciones

1. `…1200_catalog.sql`:
   - `btree_gist`.
   - `service_categories`, `services`, `professionals` y `professional_services`.
   - Clave única `(tenant_id, id)` en `memberships` para la clave compuesta.
   - Bucket `catalog` con sus políticas.
   - RLS, grants por columna, auditoría y triggers de validación.
2. `…1300_schedule.sql`: `working_hours` (exclusión de superposición y control N5),
   `schedule_blocks` y `app.working_intervals`.
3. `…1400_public_catalog.sql`: `get_public_catalog(slug)` para el sitio.
   - Devuelve solo categorías y servicios activos y visibles, y profesionales activas y
     visibles con los servicios que hacen.
   - Calcula el precio "desde" (N2 y N3).
   - Devuelve los ids de servicios y profesionales, porque el sprint de reservas los
     necesita para elegir. No son secretos: la RLS protege los datos.
   - No devuelve membresías, ids de usuarias, rutas internas ni datos de cuentas.
4. Seed de desarrollo para Fresas:
   - Categorías Uñas, Pestañas y Cejas, con 6 servicios.
   - 2 profesionales: una vinculada a `profesional@fresasstudio.test` y "Caro", sin cuenta,
     que cobra distinto un servicio.
   - Horario de lunes a sábado con descanso al mediodía, y un feriado cargado.

## 3. Permisos

No hacen falta permisos nuevos; se usan los que ya existen.

| Qué | Permiso | Quiénes hoy |
|---|---|---|
| Ver servicios, profesionales, horarios y bloqueos en el panel | Ser del equipo | Todas |
| Crear y editar categorías, servicios, precios y fotos | `services.manage` | Dueña, Encargada |
| Crear y editar profesionales y qué servicios hacen | `services.manage` | Dueña, Encargada |
| Horario del estudio | `settings.manage` | Dueña, Encargada |
| Horario de cada profesional y bloqueos | `agenda.manage` | Dueña, Encargada, Recepción |
| Ver el catálogo público | Nadie (función pública) | Visitantes |
| Cleo Admin | Sin acceso a catálogo, horarios ni bloqueos | |

Todo se valida en la base (RLS y triggers); el panel solo oculta botones para no confundir.
En un estudio suspendido, todo queda de solo lectura.

## 4. Pantallas del panel (pensadas para celular)

- Navegación: **Inicio · Servicios · Profesionales · Horarios · Bloqueos · Equipo · Marca**.
  Barra con desplazamiento horizontal en el celular, y cada opción solo si se tiene permiso.
- **Formularios simples:**
  - Botones de al menos 44 px.
  - Duraciones con botones rápidos (15, 30, 45, 60, 90, 120 min) además del campo libre.
  - Precio con teclado numérico y vista previa ("$12.500").
- **Ordenar:** botones "subir" y "bajar", en lugar de arrastrar, que en el celular es
  incómodo.

| Ruta | Qué hace |
|---|---|
| `/admin/servicios` | Servicios agrupados por categoría: nombre, duración, precio y estado. Agregar, ordenar, activar o desactivar, archivar. |
| `/admin/servicios/nuevo`, `/admin/servicios/[id]` | Nombre, categoría, descripción, duración, tiempo extra, precio, "precio desde", seña propia (N1), foto, visible en el sitio, activo. |
| `/admin/servicios/categorias` | Crear, renombrar, ordenar y desactivar categorías. |
| `/admin/profesionales` | Lista con foto, nombre, cantidad de servicios y estado. |
| `/admin/profesionales/nueva`, `/admin/profesionales/[id]` | Pestañas **Datos** (nombre, foto, bio, vincular a una cuenta del equipo, visible, acepta reservas online), **Servicios** (lista con tildes y "cobra o tarda distinto"), **Horario** ("igual al del estudio" o propio, por franjas) y **Bloqueos** (los suyos). |
| `/admin/horarios` | Horario del estudio por día: franjas con "+ agregar franja", "cerrado" y "copiar este día a…". |
| `/admin/bloqueos` | Próximos bloqueos del estudio y de cada profesional. Crear: tipo, a quién (todo el estudio o una profesional), todo el día o desde–hasta, fechas y nota. |

## 5. Sitio público del estudio

- **Servicios** por categoría: nombre, descripción corta, duración ("1 h 30 min"), precio
  ("$12.500" o "desde $12.500") y foto si hay.
- **Profesionales:** foto, nombre, bio y qué servicios hace.
- Sin botón "Reservar" hasta que exista el flujo real: no se muestran botones que no
  funcionan.
- Todo con la marca del estudio, sin "Cleo".

## 6. Validaciones (en la base y repetidas en el servidor de Next)

- Nombres con largo mínimo y máximo; descripciones con tope.
- Precio entero ≥ 0, con tope razonable (100 millones en centavos). En pantalla se acepta
  "12.500" o "12500" y se guarda como `1250000` centavos.
- Duración de 5 a 600 minutos y tiempo extra de 0 a 240, siempre múltiplos de 5. Lo mismo
  para las diferencias por profesional.
- Seña propia de 0 a 100, o vacía.
- Franjas: inicio menor que fin, sin superponerse en el mismo día, y las de una profesional
  dentro del horario del estudio.
- Bloqueos: inicio menor que fin y como máximo un año de largo.
- Todas las referencias, del mismo estudio (claves compuestas).
- Fotos: tipo por bytes, hasta 1 MB y solo en la carpeta del estudio.

## 7. Criterios de aceptación

1. La dueña de Fresas carga una categoría y un servicio desde el celular y lo ve en el
   sitio con precio y duración.
2. Un servicio inactivo, archivado o "no visible" no aparece en el sitio.
3. Una profesional sin cuenta se carga, se le asignan servicios y aparece en el sitio. Una
   con cuenta queda vinculada a su membresía.
4. Si Caro cobra distinto un servicio, el sitio muestra "desde" con el menor precio.
5. No se puede asignar a una profesional un servicio de otro estudio, ni vincularla a una
   membresía de otro estudio, ni siquiera por la API.
6. El horario con descanso (9–13 y 14–19) y un feriado del estudio hacen que
   `working_intervals` no devuelva ni el descanso ni el feriado. Las vacaciones de una
   profesional afectan solo a ella.
7. Las franjas superpuestas se rechazan, y también la franja de una profesional fuera del
   horario del estudio.
8. Recepción puede cargar bloqueos pero no tocar precios. Una profesional no puede editar
   nada de esto. Estudio B no ve nada de A. Cleo Admin no ve el catálogo por tablas.
9. Un servicio no se puede borrar, solo archivar, y el cambio de precio queda en la
   auditoría con el valor anterior y el nuevo.
10. El catálogo público no expone membresías, cuentas ni rutas internas.

## 8. Tests

**Base de datos** (`db/tests/08_catalog.sql`, `09_schedule.sql`, `10_public_catalog.sql`):
- Aislamiento A/B en cada tabla.
- Permisos por rol: dueña, encargada, recepción, profesional y Cleo Admin.
- Claves compuestas que impiden mezclar estudios.
- Límites de cada validación.
- Archivar sí, borrar no.
- Auditoría de cambios de precio.
- Superposición de franjas y control N5.
- `working_intervals` con descansos, bloqueos del estudio y de la profesional, cambio de
  día, zona horaria del estudio y profesional sin horario propio (N4).
- Catálogo público: solo lo visible, "desde", y nada de un estudio suspendido.
- Storage del bucket `catalog`: carpeta propia sí, otra no, profesional sin permiso no.

**Unitarios (Vitest):**
- Precios: "12.500" → 1250000 → "$12.500", con casos inválidos.
- Duraciones: 90 → "1 h 30 min".
- Validación de franjas en el formulario.

**E2E** (`npm run e2e`, que se amplía):
- La dueña crea un servicio y una profesional con precio distinto, carga un horario y un
  bloqueo.
- El sitio muestra todo.
- Recepción no puede editar precios.
- Al final se limpia (archivando) para poder repetir.

**Manual:** cargar todo desde un celular real (375 px).

## 9. Orden de implementación (un commit por paso, tests en verde en cada uno)

1. Migración de catálogo + tests de base.
2. Migración de horarios y bloqueos + `working_intervals` + tests.
3. Catálogo público + seed de desarrollo + tests.
4. Helpers de precio y duración + tests unitarios.
5. Pantallas de servicios y categorías.
6. Pantallas de profesionales (datos, servicios, horario y bloqueos propios).
7. Horario del estudio y bloqueos.
8. Catálogo y profesionales en el sitio público.
9. Fotos (bucket `catalog`) en servicios y profesionales.
10. E2E, README, CLAUDE.md y checklist manual.

Cada migración se aplica al proyecto de **desarrollo** después de pasar los tests locales.
