import { cn } from "cn";

/**
 * Emblema de Cleo PROVISORIO (una estrella de cuatro puntas, como la que acompaña al
 * logo en las referencias). Se reemplaza por el logo oficial (docs/diseno/logo-cleo)
 * cuando esté. Decorativo: el texto alternativo lo pone quien lo usa.
 */
export function CleoEmblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("text-gold", className)} fill="none">
      <path d="M16 2.5c.9 6.6 3.9 9.8 10.6 10.6-6.7.9-9.7 3.9-10.6 10.6-.9-6.7-3.9-9.7-10.6-10.6C12.1 12.3 15.1 9.1 16 2.5Z"
        fill="currentColor" />
      <path d="M25 21.5c.35 2.4 1.4 3.5 3.8 3.8-2.4.35-3.45 1.4-3.8 3.8-.35-2.4-1.4-3.45-3.8-3.8 2.4-.3 3.45-1.4 3.8-3.8Z"
        fill="currentColor" opacity=".7" />
    </svg>
  );
}

/** Logo completo de Cleo (Cleo Admin y cleo.com.ar). Provisorio en texto hasta tener el archivo. */
export function CleoLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-end gap-1 font-serif font-semibold leading-none text-foreground", className)}>
      <span>Cleo</span>
      <CleoEmblem className="mb-[0.55em] size-[0.42em]" />
    </span>
  );
}

/**
 * Marca del estudio (D1, D2): su logo, o el emblema de Cleo si no cargó uno; al lado el
 * nombre del estudio en serif y debajo, chiquito, "by Cleo". El nombre del estudio es
 * siempre lo principal.
 */
export function StudioMark({
  name,
  logoSrc,
  size = "md",
  className,
}: {
  name: string;
  logoSrc: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const s = {
    sm: { logo: "h-9 max-w-[90px]", emblem: "size-7", name: "text-xl", by: "text-[0.7rem]" },
    md: { logo: "h-11 max-w-[110px]", emblem: "size-8", name: "text-2xl", by: "text-xs" },
    lg: { logo: "h-14 max-w-[140px]", emblem: "size-10", name: "text-[2rem]", by: "text-xs" },
  }[size];
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={`Logo de ${name}`} className={cn(s.logo, "w-auto shrink-0 object-contain")} />
      ) : (
        <CleoEmblem className={cn(s.emblem, "shrink-0")} />
      )}
      <div className="flex min-w-0 flex-col">
        <span className={cn(s.name, "truncate font-serif font-semibold leading-tight text-foreground")}>{name}</span>
        <span className={cn(s.by, "tracking-[0.18em] text-muted-foreground uppercase")}>by Cleo</span>
      </div>
    </div>
  );
}
