# Sprint de diseño — Plan

> Estado: **implementado** (todas las pantallas). Cambios respecto de este borrador, decididos
> después: **marca** — por defecto todos los estudios se ven con la marca Cleo (logo completo); solo
> con la marca propia activada en «Marca» se ven el nombre, el logo y los colores del estudio, con el
> logo de Cleo chiquito (reemplaza D1/D2). Títulos en sans liviana y el nombre/logo en serif, como en
> las referencias. Lista de diferencias y rondas de corrección en `docs/diseno/diferencias.md`. El
> logo de Cleo está redibujado en SVG a partir de las referencias (falta el archivo original).

Referencias: `docs/diseno/ref-*.png` (7 imágenes). **Falta el logo de Cleo** (`logo-cleo`, ideal SVG
o PNG transparente): mientras no esté, se usa un logotipo de texto provisorio "Cleo" en la serif.

**Objetivo:** que la app se vea como las referencias (negro cálido, champagne, seda, vidrio) sin
cambiar nada de lo que hace: mismos datos, mismas reglas, mismos permisos.

---

## 0. Decisiones que necesito

Si estás de acuerdo con todas, alcanza con un "OK".

| # | Tema | Recomendación y por qué |
|---|---|---|
| D1 | **"by Cleo" en el sitio y el panel de cada estudio.** Hoy la regla 1b de `CLAUDE.md` dice que ahí *nunca* aparece "Cleo", y los e2e lo controlan. | **Cambiar la regla así:** en el sitio y el panel de un estudio, "Cleo" aparece **solo** como la firma chica "by Cleo" debajo del nombre del estudio (y en el logo por defecto, D2). Nada más: ni en títulos de pestaña, errores, emails ni íconos. Actualizo `CLAUDE.md` y los e2e pasan a controlar que la única aparición sea la firma. |
| D2 | **Estudio sin logo propio.** Pediste que el logo de Cleo sea la marca por defecto. | **En el encabezado: logo del estudio si lo cargó; si no, el emblema de Cleo (la hoja con la estrella) chico, y al lado el nombre del estudio en serif con "by Cleo".** El nombre del estudio siempre es lo principal: la clienta tiene que saber en qué estudio está. El ícono de la pestaña del navegador sigue siendo el logo del estudio, o ninguno. |
| D3 | **Tema único oscuro.** | **Un solo tema (oscuro) para todo**, sin modo claro. Las referencias son oscuras y mantener dos temas duplica el trabajo de contraste. |
| D4 | **Colores propios de cada estudio.** Hoy la validación de colores (en la app y en la base) supone fondo claro y texto oscuro. | **Pasan a validarse contra el tema oscuro:** el fondo propio tiene que ser oscuro (texto claro encima ≥ 4,5:1) y el color principal tiene que distinguirse del fondo. Migración nueva que actualiza `app.theme_hex`. **Ningún estudio tiene colores guardados hoy** (verificado en desarrollo), así que no se rompe nada. |
| D5 | **Tarjetas de números del panel.** Las referencias muestran "+12%", sparklines y totales de ventas. | **Solo números reales de la base, y solo si son mayores que cero:** turnos de hoy, esperando pago, confirmados de los próximos 7 días y, con permiso de caja, lo cobrado con Mercado Pago este mes. **Sin "% vs. mes anterior" ni sparklines** hasta tener historia suficiente para que signifiquen algo. Si todo da cero, en lugar de tarjetas se muestra "Todavía no hay turnos" con el botón para cargar uno. |
| D6 | **Menú.** | **Solo lo que existe:** cliente: Inicio · Reservar · Mis turnos · Cuenta. Panel: Inicio, Turnos, Servicios, Profesionales, Horarios, Bloqueos, Equipo, Reservas, Mercado Pago, Pagos, Marca (cada uno según permiso, como hoy). Sin Tienda, Pedidos, Clientes, Productos ni Reportes. |
| D7 | **Buscador y campana de notificaciones** de las referencias. | **No por ahora:** no hay búsqueda global ni notificaciones programadas. Se suman cuando existan. |

---

## 1. Colores (medidos sobre las referencias)

Los valores salen de promediar zonas de las imágenes (fondo, tarjetas, botón activo, pastillas) y
ajustarlos para pasar contraste AA. Todos los pares de texto dan ≥ 4,5:1 y los de interfaz ≥ 3:1
(medido; ver tabla). Se cargan como variables en `src/app/globals.css` y los controla `theme.test.ts`.

| Variable | Hex | Uso | Contraste |
|---|---|---|---|
| `--background` | `#0D0A09` | Fondo general (negro cálido) | — |
| `--sidebar` | `#120E0C` | Menú lateral del panel | texto 16,4:1 |
| `--card` | `#171210` | Tarjetas (con vidrio: 72% de opacidad + desenfoque) | texto 15,9:1 |
| `--muted` / `--secondary` | `#211A17` | Campos, chips, filas | texto 14,7:1 |
| `--foreground` | `#F4ECE6` | Texto (marfil cálido) | 16,9:1 sobre fondo |
| `--muted-foreground` | `#B3A49B` | Texto secundario | 8,2:1 fondo · 7,7:1 tarjeta |
| `--primary` | `#D8B9A4` | **Champagne**: botones, ítem activo, chip activo | 10,7:1 sobre fondo |
| `--primary-foreground` | `#1C130F` | Texto sobre champagne | 9,9:1 |
| `--gold` (acento) | `#C9A48C` | Rosado dorado: íconos, bordes de seda, detalles. **Nunca texto chico** | 8,6:1 |
| `--border` | champagne al 14% | Borde fino de tarjetas | decorativo |
| `--input` | `#76665E` | Borde de campos | 3,6:1 |
| `--ring` | `#E2C4B0` | Foco del teclado | 12:1 |
| `--destructive` | `#F0918A` | Errores y acciones de borrar | 8,6:1 |
| Degradé champagne | `#EDD5C6 → #C29F89` | Botón principal y curvas de seda | — |

**Estados en pastilla** (fondo / texto):

| Estado | Fondo | Texto | Contraste |
|---|---|---|---|
| Confirmado | `#22362A` | `#A9DCB4` | 8,3:1 |
| Pendiente (esperando pago) | `#D8B9A4` | `#2A1C15` | 8,9:1 |
| Cancelado / Venció | `#4A2422` | `#F6B3AD` | 7,6:1 |
| Neutro (online, manual, prueba) | `#2A2220` | `#DDD0C8` | 10,3:1 |

## 2. Tipografías

| Uso | Fuente | Por qué |
|---|---|---|
| Títulos, nombre del estudio, números grandes | **Cormorant Garamond** (600 y 700) | Serif de alto contraste, con curvas y remates finos, la más parecida al logotipo "Cleo". |
| Textos, botones, formularios | **Outfit** (400, 500, 600) | Sans geométrica moderna, como la de las referencias; muy legible en 16 px en el celular. |

Ambas con `next/font/google` (se sirven desde el propio dominio, sin pedidos a Google desde el
navegador). Tamaños base: cuerpo 16 px (nunca menos de 14 px), títulos de página 32–40 px en serif.

## 3. Formas y efectos

- **Curvas de seda:** SVG propio en los bordes (arriba a la derecha y abajo a la izquierda), con
  degradé champagne a transparente, decorativo (`aria-hidden`), sin imágenes pesadas.
- **Vidrio:** tarjetas con fondo `--card` al 72%, `backdrop-blur`, borde fino champagne al 14% y
  un brillo sutil en el borde superior.
- **Radios:** tarjetas 20 px, botones y campos totalmente redondeados (pastilla), chips 999 px.
- **Íconos:** `lucide-react` (ya instalado) con trazo 1,5.
- **Movimiento:** solo transiciones cortas (150 ms) y respetando "reducir movimiento".
- **Táctil:** todo lo tocable mide al menos 44 px.

## 4. Componentes a crear (`src/components/cleo/`)

| Componente | Qué es |
|---|---|
| `SilkBackground` | Fondo con las curvas de seda (variantes sitio y panel). |
| `GlassCard` | Tarjeta de vidrio (con título, ícono y "Ver todos →" opcionales). |
| `StudioMark` | Logo del estudio o emblema de Cleo + nombre del estudio en serif + "by Cleo". |
| `CleoLogo` | Logo de Cleo completo (Cleo Admin, cleo.com.ar). Provisorio en texto hasta tener el archivo. |
| `StatusPill` | Pastilla de estado (confirmado, pendiente, cancelado, neutro). |
| `StatCard` | Número real + etiqueta + ícono (D5). |
| `ActionTile` | Tile 2×2 del inicio de la clienta (ícono, título, bajada, flecha). |
| `BottomNav` | Barra inferior de la clienta, con el ítem activo subrayado en champagne. |
| `PanelSidebar` | Menú lateral del panel con el logo arriba; en el celular se abre desde un botón (cajón). |
| `PageTitle` | Título serif + bajada, con acción opcional. |
| Botones, campos, selects, chips | Se ajustan los de `src/components/ui` (shadcn) al estilo nuevo, sin duplicarlos. |

## 5. Pantallas que se rediseñan

**Sitio del estudio (clienta, celular primero, con barra inferior):**
1. Inicio del estudio (`/`) — **ejemplo hecho**
2. Reservar: servicios, profesional, día y horario, resumen (`/reservar…`)
3. Estado de la reserva y pago (`/reserva/[código]`)
4. Ingresar (`/ingresar`)
5. Mi ficha y Mis turnos (`/mi-ficha`)
6. 404 del estudio

**Panel del estudio (menú lateral):**
7. Inicio (`/admin`) — **ejemplo hecho**
8. Turnos del día, detalle y turno manual
9. Servicios (lista, nuevo, editar, categorías)
10. Profesionales (lista, nueva, editar)
11. Horarios y Bloqueos
12. Equipo
13. Reservas (reglas)
14. Mercado Pago y Pagos recibidos
15. Marca (colores y logo, con validación del tema oscuro)
16. Login, recuperar, restablecer e invitación del panel

**Cleo (con el logo completo):**
17. Sitio de Cleo (`cleo.com.ar`)
18. Cleo Admin: login e inicio

## 6. Reglas que se mantienen

- Nada de datos inventados: cada número, lista o gráfico sale de la base; si no hay datos, no se
  muestra.
- Contenido del estudio escapado (sin `dangerouslySetInnerHTML`).
- Contraste controlado por tests (`theme.test.ts` con los colores nuevos, incluidas las pastillas).
- Celular primero (375 px) y después escritorio.

## 7. Criterios de aceptación

1. Las 18 pantallas usan el tema nuevo; ninguna conserva el beige anterior.
2. `theme.test.ts` pasa con todos los pares de la sección 1.
3. En el sitio y el panel de un estudio, "Cleo" aparece solo como "by Cleo" (y el emblema por
   defecto, D2). Controlado por los e2e.
4. Sin secciones inexistentes en los menús.
5. Ningún número del panel es inventado.
6. A 375 px no hay desplazamiento horizontal y todo lo tocable mide ≥ 44 px.
7. Un estudio con colores y logo propios sigue viéndose con su marca.
8. `npm test`, `npm run lint`, `npm run build`, `./scripts/test-db.sh` y los e2e en verde.

## 8. Orden

1. Base: tema, tipografías y componentes + las 2 pantallas de ejemplo (**hecho, para revisar**).
2. Después del OK: migración de validación de marca (D4), regla "by Cleo" (D1) y el resto de las
   pantallas, una sección por commit, con capturas a 375 px y escritorio.
3. README, CLAUDE.md y e2e.
