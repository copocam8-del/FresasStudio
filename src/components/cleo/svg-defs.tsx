/**
 * Degradados SVG compartidos (emblema, estrellas, curvas). Van UNA vez en el layout raíz,
 * en un SVG sin tamaño pero visible: si se definieran dentro de cada ícono, el primero
 * que aparece puede estar oculto (display:none, como la barra del celular en escritorio)
 * y entonces ningún otro se pinta.
 */
export function CleoSvgDefs() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <linearGradient id="cleo-em" x1="8" y1="14" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f6e6db" />
          <stop offset=".55" stopColor="#d9bfae" />
          <stop offset="1" stopColor="#9c8273" />
        </linearGradient>
        <radialGradient id="cleo-spk" cx="20" cy="20" r="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff6ef" />
          <stop offset=".55" stopColor="#d9bfae" />
          <stop offset="1" stopColor="#8f776a" />
        </radialGradient>
        <linearGradient id="cleo-spark-fill" x1="0" y1="0" x2="0" y2="70" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c7a998" stopOpacity=".55" />
          <stop offset="1" stopColor="#c7a998" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cleo-spark-line" x1="0" y1="0" x2="150" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b99c8b" stopOpacity=".6" />
          <stop offset="1" stopColor="#f3e0d3" />
        </linearGradient>
      </defs>
    </svg>
  );
}
