import { cn } from "cn";

/*
 * Logo de Cleo redibujado en SVG (fondo transparente) a partir de las referencias de
 * docs/diseno: estrella de cuatro puntas, dos hojas con su nervadura y la palabra "Cleo"
 * en serif de alto contraste, con una línea fina debajo.
 *
 * La palabra usa Cormorant Garamond (cargada con next/font), la serif más parecida al
 * logotipo. Si llega el archivo original (docs/diseno/logo-cleo), se reemplaza por sus
 * trazos exactos. Los degradados están en svg-defs.tsx (una sola vez).
 */

const LEAVES = (
  // Desplazadas para que la base de las hojas quede entre la "l" y la "e", como en el logo.
  <g transform="translate(46 -34)">
    {/* estrella */}
    <path d="M586 46c5 44 21 63 66 72-45 8-61 28-66 76-5-48-21-68-66-76 45-9 61-28 66-72Z" fill="url(#cleo-logo-g)" />
    {/* hoja izquierda (con nervadura) */}
    <path
      fillRule="evenodd"
      d="M583 390C514 362 416 300 403 158c86 6 170 54 180 232ZM571 364c-26-34-64-62-83-124 36 16 72 52 83 124Z"
      fill="url(#cleo-logo-g)"
    />
    {/* hoja derecha (con nervadura) */}
    <path
      fillRule="evenodd"
      d="M591 390c69-28 167-90 180-232-86 6-170 54-180 232Zm13-27c33-38 76-64 132-94-58 2-104 34-132 94Z"
      fill="url(#cleo-logo-g)"
    />
  </g>
);

/** Logo completo de Cleo (marca por defecto de todos los estudios, Cleo Admin y cleo.com.ar). */
export function CleoLogo({ className, title = "Cleo" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="20 0 1080 820" role="img" aria-label={title} className={cn("h-auto w-auto drop-shadow-[0_2px_8px_rgb(0_0_0/0.55)]", className)}>
      {LEAVES}
      <text
        x="44"
        y="716"
        textLength="1032"
        lengthAdjust="spacingAndGlyphs"
        fill="url(#cleo-logo-g)"
        style={{ fontFamily: "var(--font-cormorant), 'Cormorant Garamond', Georgia, serif", fontWeight: 500, fontSize: 566 }}
      >
        Cleo
      </text>
      <rect x="362" y="796" width="430" height="4" rx="2" fill="url(#cleo-logo-line)" />
    </svg>
  );
}

/** Solo el emblema (estrella y hojas), para lugares chicos. */
export function CleoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="430 0 400 380" aria-hidden className={cn("h-auto w-auto", className)}>
      {LEAVES}
    </svg>
  );
}
