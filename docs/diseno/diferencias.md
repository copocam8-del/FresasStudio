# Diferencias con las referencias (y su corrección)

Comparación lado a lado, al mismo tamaño que la referencia: celular 426 px a 2x
(`ref-panel-principal.png`) y escritorio 1536×1024 (`ref-panel-administrativo.png`).
`scripts/screenshots.mjs cmp-` saca las capturas.

## Inicio de la clienta (celular) — ronda 0

| # | Elemento | Referencia | Mi versión (v0) |
|---|---|---|---|
| C1 | Logo | Grande (≈130 px de ancho), emblema de hojas + estrella **arriba** del nombre, línea fina debajo | Chico (24 px), estrella al costado, nombre en una línea |
| C2 | Seda | Cintas grandes y **brillantes** que ocupan casi la mitad derecha de arriba (≈45% del ancho, hasta las tiles), con bordes de brillo champagne y una media luna clara abajo a la derecha | Una curva tenue, casi invisible |
| C3 | Estrellas | Una estrella grande (≈36 px) entre el saludo y la seda, y una chica después de "hoy?" | Solo una chiquita |
| C4 | Saludo | "¡Hola!" sans **negrita** ≈34 px | Serif 44 px |
| C5 | Bajada | Sans 17 px, gris cálido claro | Igual de tamaño, un poco más apagada |
| C6 | Orden | Las tiles van **inmediatamente** después del saludo | Antes iba la tarjeta "Tu próximo turno" |
| C7 | Tiles | 2×2 parejas (≈184×132), radio ≈22, **borde con brillo** (más claro arriba a la izquierda), **reflejos de seda** en las esquinas | Alturas distintas, borde plano, círculo tenue |
| C8 | Ícono de tile | 44 px, trazo fino, color marfil-champagne claro | 36 px, color dorado más oscuro |
| C9 | Texto de tile | Título sans semibold 18 px blanco; bajada 14,5 px | Título 16 px; bajada 14 px más gris |
| C10 | Flecha de tile | Círculo 32 px con borde y fondo oscuro, chevron blanco | Círculo más chico y apagado |
| C11 | Cantidad de tiles | 4 (dos filas completas) | 3 (queda un hueco) |
| C12 | Tarjeta ancha | "Todo en un solo lugar" con seda brillante a la derecha | Tarjeta plana "Tu próximo turno" |
| C13 | Botón de cuenta | Círculo 46 px vidrio con borde claro | 48 px, sin borde visible |
| C14 | Barra inferior | Panel con **esquinas superiores redondeadas** (≈36), un poco más claro que el fondo, 4 ítems, ícono activo **relleno** champagne, raya champagne de 64 px bajo el texto activo | Barra recta, 3 ítems, ícono de línea, raya fina |
| C15 | Fondo | Negro cálido `#0B090B` con viñeta | `#0D0A09` plano |

## Inicio del panel (escritorio) — ronda 0

| # | Elemento | Referencia | Mi versión (v0) |
|---|---|---|---|
| P1 | Menú lateral | 236 px, marrón más claro que el fondo, con **seda brillante** arriba a la izquierda, en el medio y abajo | Negro plano |
| P2 | Logo del menú | Grande y centrado (emblema arriba, nombre serif ≈44 px) | Chico, alineado a la izquierda |
| P3 | Ítems del menú | Alto 56, separación 61, texto 15 px, ícono 26 px marfil | Alto 44, ícono 20 px dorado |
| P4 | Ítem activo | Rectángulo champagne con radio ≈14 (no pastilla), degradé y brillo | Pastilla redonda |
| P5 | Barra superior | Franja de 90 px con línea inferior y, a la derecha, avatar con iniciales + nombre | No existe |
| P6 | Título | Sans liviana ≈36 px + bajada 17 px; fecha a la derecha | Serif 44 px |
| P7 | Seda del área principal | Cinta brillante grande que baja desde arriba detrás del título | Una curva tenue en la esquina |
| P8 | Tarjetas de números | Vidrio con brillo arriba a la izquierda, número sans semibold 28 px, **curva de evolución** a la derecha | Número serif, sin curva |
| P9 | Disposición | Fila de 4 números; abajo 3 tarjetas: Turnos de hoy · Calendario de turnos · Actividad reciente; abajo 2 más | 2 tarjetas (hoy y próximos) |
| P10 | Filas de turnos | Hora en chip, **avatar redondo**, nombre y servicio, pastilla | Sin avatar |
| P11 | Pastillas | Confirmado verde medio con texto claro; Pendiente champagne con texto oscuro | Verde muy oscuro, texto verde |
| P12 | Calendario | Mes con días, puntos en los días con turnos, hoy en círculo champagne | No existe |
| P13 | Actividad reciente | Lista de eventos con ícono en círculo y "Hace 5 min" | No existe |
| P14 | Botón "Nuevo turno" | En la referencia de Turnos va arriba a la derecha; en el inicio no hay | Arriba a la derecha (se mantiene: es una acción real) |

**Con datos reales:** las curvas de las tarjetas, el calendario y la actividad muestran datos de
la base (turnos por día, días con turnos, historial de reservas). Lo que en la referencia es de
la tienda (pedidos, productos, ventas) no existe todavía: en su lugar van "Próximos turnos" y
"Pagos recientes" (también reales).

## Estado después de 4 rondas (capturas en `docs/diseno/capturas/comparar-*.png`)

**Corregido:** C1–C15 y P1–P13. Logo grande apilado con emblema y línea; seda satinada con bordes
brillantes y media luna clara; estrella grande junto al saludo; saludo sans negrita; tiles 2×2
parejas con borde brillante, reflejos en las esquinas, íconos de 44 px, flecha en círculo; barra
inferior con esquinas redondeadas, ícono activo relleno y raya champagne; menú lateral marrón con
seda, marca grande centrada, ítem activo con degradé champagne; barra superior con avatar;
título sans liviano con fecha; tarjetas de números más claras con curva; filas con avatar;
pastillas con los colores medidos; calendario del mes; actividad reciente.

Un error encontrado en el camino: los degradados SVG con el mismo id en dos lugares (uno oculto)
hacían que el emblema no se pintara en el menú. Ahora están definidos una sola vez
(`src/components/cleo/svg-defs.tsx`).

**Diferencias que quedan a propósito:**
- La barra de estado del teléfono (9:41, batería) es del celular, no de la página.
- (Resuelto después) La marca por defecto es el logo de Cleo, vectorizado del original `logo.jpeg`.
- Sin Tienda, Compras, Promociones, Pedidos, Productos, buscador ni campana (no existen todavía, D6–D7).
- En el celular, en lugar del aviso "Todo en un solo lugar" va "Tu próximo turno" (dato real).
- Las curvas de las tarjetas de números se dibujan solo con datos reales y con al menos 3 días con
  turnos; hoy, con los datos de prueba, aparece en "Confirmados, próximos 7 días". En la referencia
  todas tienen curva y porcentaje porque son datos inventados.
- En el panel, en lugar de "Pedidos recientes" y "Productos más vendidos" van "Próximos turnos" y
  "Pagos recientes".
