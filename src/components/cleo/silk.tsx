import { cn } from "cn";

/**
 * Curvas de seda de las referencias: SVG propio, decorativo, detrás del contenido.
 * Usa --primary, así toma el color principal del estudio si tiene marca propia.
 */
export function SilkBackground({ variant = "site", className }: { variant?: "site" | "panel"; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <svg className="absolute -top-24 -right-40 h-[560px] w-[620px] opacity-70 sm:-right-24" viewBox="0 0 620 560" fill="none">
        <defs>
          <linearGradient id="silk-a" x1="80" y1="40" x2="560" y2="520" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--primary)" stopOpacity=".05" />
            <stop offset=".55" stopColor="var(--primary)" stopOpacity=".38" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="silk-b" x1="300" y1="0" x2="620" y2="400" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--primary)" stopOpacity="0" />
            <stop offset=".6" stopColor="var(--primary)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M130 0c60 130 210 160 300 240 70 62 110 170 190 210V0H130Z" fill="url(#silk-a)" />
        <path d="M250 0c40 90 140 140 230 190 60 34 100 90 140 150" stroke="url(#silk-b)" strokeWidth="2" />
        <path d="M200 0c50 120 180 170 280 240 60 42 100 110 140 170" stroke="var(--primary)" strokeOpacity=".12" />
      </svg>
      <svg
        className={cn("absolute -bottom-32 -left-44 h-[420px] w-[520px] opacity-60", variant === "panel" && "hidden lg:block")}
        viewBox="0 0 520 420"
        fill="none"
      >
        <defs>
          <linearGradient id="silk-c" x1="0" y1="420" x2="420" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--primary)" stopOpacity=".32" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 160c110 10 190 60 250 130 40 47 90 100 170 130H0V160Z" fill="url(#silk-c)" />
      </svg>
    </div>
  );
}
