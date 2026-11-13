import { cn } from "cn";
import { CLEO_LOGO_D, CLEO_LOGO_VIEWBOX, CLEO_MARK_D, CLEO_MARK_VIEWBOX } from "@/components/cleo/cleo-logo-paths";

/*
 * Logo de Cleo: vectorizado del original (docs/diseno/logo.jpeg → docs/diseno/logo-cleo.svg),
 * fondo transparente, relleno con el degradé champagne del tema (definido una sola vez en
 * svg-defs.tsx como "cleo-logo-g").
 */

/** Logo completo de Cleo (marca por defecto de todos los estudios, Cleo Admin y cleo.com.ar). */
export function CleoLogo({ className, title = "Cleo" }: { className?: string; title?: string }) {
  return (
    <svg viewBox={CLEO_LOGO_VIEWBOX} role="img" aria-label={title}
      className={cn("h-auto w-auto drop-shadow-[0_2px_8px_rgb(0_0_0/0.55)]", className)}>
      <path d={CLEO_LOGO_D} fill="url(#cleo-logo-g)" fillRule="evenodd" />
    </svg>
  );
}

/** Solo el emblema (estrella y hojas), para lugares chicos. */
export function CleoMark({ className }: { className?: string }) {
  return (
    <svg viewBox={CLEO_MARK_VIEWBOX} aria-hidden className={cn("h-auto w-auto", className)}>
      <path d={CLEO_MARK_D} fill="url(#cleo-logo-g)" fillRule="evenodd" />
    </svg>
  );
}
