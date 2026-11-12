import { cn } from "cn";

/*
 * Seda de las referencias (docs/diseno/ref-*.png): cintas oscuras con bordes de brillo
 * champagne y medias lunas claras. SVG propio, decorativo (aria-hidden), detrás del
 * contenido. Los ids de los degradados llevan prefijo para no chocar entre sí.
 */

const EDGE = "#f1dfd3"; // brillo del borde
const LIGHT = "#d9bfae"; // champagne claro
const MID = "#8f776a";

/** Estrella de cuatro puntas (las de las referencias). */
export function Sparkle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={className} style={style} fill="none">
      <path d="M20 0c1.3 11.6 6.8 17.6 20 20-13.2 2.4-18.7 8.4-20 20-1.3-11.6-6.8-17.6-20-20C13.2 17.6 18.7 11.6 20 0Z" fill="url(#cleo-spk)" />
    </svg>
  );
}

/** Seda de arriba a la derecha del inicio de la clienta (celular). */
export function SilkHero({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 426 300" aria-hidden
      className={cn("pointer-events-none absolute top-0 right-0 h-[300px] w-[426px] max-w-none", className)} fill="none">
      <defs>
        {/* Cara satinada de la cinta: el degradé corre de borde a borde (perpendicular) */}
        <linearGradient id="h-face" x1="318" y1="52" x2="262" y2="128" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1a1514" />
          <stop offset=".3" stopColor="#4d3f39" />
          <stop offset=".55" stopColor="#a58c7e" />
          <stop offset=".72" stopColor="#5c4b44" />
          <stop offset="1" stopColor="#171212" />
        </linearGradient>
        <linearGradient id="h-back" x1="330" y1="0" x2="426" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1c1615" />
          <stop offset="1" stopColor="#0f0c0c" />
        </linearGradient>
        <linearGradient id="h-moon" x1="335" y1="170" x2="400" y2="290" gradientUnits="userSpaceOnUse">
          <stop stopColor={EDGE} />
          <stop offset=".16" stopColor={LIGHT} />
          <stop offset=".42" stopColor="#8b7366" />
          <stop offset=".75" stopColor="#2e2522" />
          <stop offset="1" stopColor="#120e0e" />
        </linearGradient>
        <radialGradient id="h-glow" cx="380" cy="110" r="190" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c9ab98" stopOpacity=".14" />
          <stop offset="1" stopColor="#c9ab98" stopOpacity="0" />
        </radialGradient>
        <filter id="h-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <rect x="160" y="0" width="266" height="300" fill="url(#h-glow)" />
      {/* Parte de atrás de la cinta (oscura) */}
      <path d="M298 0C306 44 344 82 426 104V0H298Z" fill="url(#h-back)" />
      {/* Cinta: cara iluminada entre dos bordes brillantes */}
      <path d="M238 0C244 72 290 140 426 178V104C344 82 306 44 298 0H238Z" fill="url(#h-face)" />
      <path d="M238 0C244 72 290 140 426 178" stroke={EDGE} strokeOpacity=".35" strokeWidth="7" filter="url(#h-blur)" />
      <path d="M238 0C244 72 290 140 426 178" stroke={EDGE} strokeWidth="1.5" />
      <path d="M298 0C306 44 344 82 426 104" stroke={LIGHT} strokeOpacity=".8" strokeWidth="1.1" />
      {/* Media luna clara de abajo a la derecha */}
      <path d="M300 300C306 238 348 190 426 168V300H300Z" fill="url(#h-moon)" />
      <path d="M300 300C306 238 348 190 426 168" stroke={EDGE} strokeOpacity=".45" strokeWidth="7" filter="url(#h-blur)" />
      <path d="M300 300C306 238 348 190 426 168" stroke={EDGE} strokeWidth="1.3" />
    </svg>
  );
}

/** Seda del menú lateral del panel (arriba a la izquierda, en el medio y abajo). */
export function SilkSidebar() {
  return (
    <svg viewBox="0 0 236 1024" preserveAspectRatio="none" aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full" fill="none">
      <defs>
        <linearGradient id="s-top" x1="0" y1="0" x2="110" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b59a8b" stopOpacity=".75" />
          <stop offset=".35" stopColor="#5a4840" stopOpacity=".55" />
          <stop offset="1" stopColor="#1c1614" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="s-mid" x1="120" y1="640" x2="120" y2="860" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4a3b35" stopOpacity=".9" />
          <stop offset="1" stopColor="#1a1412" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="s-bot" x1="236" y1="850" x2="90" y2="1024" gradientUnits="userSpaceOnUse">
          <stop stopColor={EDGE} />
          <stop offset=".12" stopColor={LIGHT} />
          <stop offset=".45" stopColor="#6e5a50" />
          <stop offset="1" stopColor="#1d1715" />
        </linearGradient>
        <linearGradient id="s-lens" x1="236" y1="300" x2="150" y2="440" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3a2e2a" stopOpacity=".9" />
          <stop offset="1" stopColor="#1a1412" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 0H122C82 46 40 104 0 178V0Z" fill="url(#s-top)" />
      <path d="M122 0C82 46 40 104 0 178" stroke={EDGE} strokeOpacity=".8" strokeWidth="1.2" />
      <path d="M236 290C190 330 172 390 236 440Z" fill="url(#s-lens)" />
      <path d="M0 785C70 760 160 730 236 690V860H0Z" fill="url(#s-mid)" />
      <path d="M0 785C70 760 160 730 236 690" stroke={EDGE} strokeOpacity=".7" strokeWidth="1.3" />
      <path d="M96 1024C124 950 174 892 236 850V1024H96Z" fill="url(#s-bot)" />
      <path d="M96 1024C124 950 174 892 236 850" stroke={EDGE} strokeWidth="1.3" />
      <path d="M0 920C40 930 70 960 84 1024" stroke={LIGHT} strokeOpacity=".35" strokeWidth="1" />
    </svg>
  );
}

/** Cinta brillante que baja detrás del título del panel (área principal). */
export function SilkPanelTop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1300 300" preserveAspectRatio="xMaxYMin slice" aria-hidden
      className={cn("pointer-events-none absolute top-0 right-0 h-[300px] w-full", className)} fill="none">
      <defs>
        <linearGradient id="p-face" x1="700" y1="70" x2="790" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1a1514" />
          <stop offset=".3" stopColor="#4a3c36" />
          <stop offset=".55" stopColor="#9d8577" />
          <stop offset=".75" stopColor="#4a3c36" />
          <stop offset="1" stopColor="#120e0e" />
        </linearGradient>
        <linearGradient id="p-fade" x1="420" y1="0" x2="900" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0" />
          <stop offset=".45" stopColor="#fff" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <mask id="p-mask"><rect width="1300" height="300" fill="url(#p-fade)" /></mask>
        <filter id="p-blur" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5" /></filter>
      </defs>
      <g mask="url(#p-mask)">
        <path d="M760 0C730 110 620 180 380 214C640 236 830 150 960 0H760Z" fill="url(#p-face)" />
        <path d="M760 0C730 110 620 180 380 214" stroke={EDGE} strokeOpacity=".35" strokeWidth="8" filter="url(#p-blur)" />
        <path d="M760 0C730 110 620 180 380 214" stroke={EDGE} strokeWidth="1.5" />
        <path d="M960 0C830 150 640 236 380 214" stroke={LIGHT} strokeOpacity=".6" strokeWidth="1.1" />
      </g>
    </svg>
  );
}

/** Reflejos de seda dentro de una tile o tarjeta (esquinas). */
export function TileSheen({ variant = 0 }: { variant?: 0 | 1 | 2 | 3 }) {
  const id = `ts${variant}`;
  return (
    <svg viewBox="0 0 184 132" preserveAspectRatio="none" aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full" fill="none">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor={LIGHT} stopOpacity=".85" />
          <stop offset=".5" stopColor="#7d685d" stopOpacity=".35" />
          <stop offset="1" stopColor="#7d685d" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="184" y1="132" x2="120" y2="70" gradientUnits="userSpaceOnUse">
          <stop stopColor={EDGE} stopOpacity=".9" />
          <stop offset=".2" stopColor="#9a8174" stopOpacity=".6" />
          <stop offset=".6" stopColor="#3a2e2a" stopOpacity=".5" />
          <stop offset="1" stopColor="#2a211f" stopOpacity="0" />
        </linearGradient>
      </defs>
      {variant !== 0 && <path d="M0 26C10 14 24 4 38 0H0Z" fill={`url(#${id}a)`} />}
      {variant === 0 && (
        <>
          <path d="M120 132C124 100 150 78 184 70V132Z" fill="#100c0c" opacity=".85" />
          <path d="M120 132C124 100 150 78 184 70" stroke={EDGE} strokeOpacity=".75" strokeWidth=".9" />
          <path d="M150 132C156 112 168 100 184 96" stroke={LIGHT} strokeOpacity=".4" strokeWidth=".8" />
        </>
      )}
      {(variant === 1 || variant === 3) && (
        <path d="M150 132C160 112 172 102 184 98V132Z" fill={`url(#${id}b)`} />
      )}
      {variant === 2 && (
        <path d="M160 132C168 118 176 110 184 106V132Z" fill={`url(#${id}b)`} />
      )}
    </svg>
  );
}

/** Seda brillante para el costado derecho de una tarjeta ancha (como "Todo en un solo lugar"). */
export function BannerSilk() {
  return (
    <svg viewBox="0 0 400 140" preserveAspectRatio="xMaxYMid slice" aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-[68%]" fill="none">
      <defs>
        <linearGradient id="bn-face" x1="250" y1="40" x2="290" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor={EDGE} />
          <stop offset=".18" stopColor={LIGHT} />
          <stop offset=".5" stopColor="#7b655a" />
          <stop offset="1" stopColor="#1a1414" />
        </linearGradient>
        <linearGradient id="bn-fade" x1="120" y1="0" x2="260" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <mask id="bn-mask"><rect width="400" height="140" fill="url(#bn-fade)" /></mask>
      </defs>
      <g mask="url(#bn-mask)">
        <path d="M120 140C190 128 214 84 282 58C330 40 368 22 400 6V140H120Z" fill="url(#bn-face)" />
        <path d="M120 140C190 128 214 84 282 58C330 40 368 22 400 6" stroke={EDGE} strokeWidth="1.3" />
        <path d="M250 140C300 116 344 96 400 80V140H250Z" fill="#110d0d" opacity=".92" />
        <path d="M250 140C300 116 344 96 400 80" stroke={LIGHT} strokeOpacity=".7" strokeWidth="1" />
      </g>
    </svg>
  );
}
