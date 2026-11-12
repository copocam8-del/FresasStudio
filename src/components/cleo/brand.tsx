import { cn } from "cn";

/**
 * Emblema de Cleo PROVISORIO (dos hojas y una estrella, como en las referencias). Se
 * reemplaza por el logo oficial (docs/diseno/logo-cleo) cuando esté. Decorativo.
 */
export function CleoEmblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 56" aria-hidden className={className} fill="none">
      {/* estrella */}
      <path d="M32 0c.6 5.6 2.8 8.3 8.4 9-5.6.7-7.8 3.4-8.4 9-.6-5.6-2.8-8.3-8.4-9C29.2 8.3 31.4 5.6 32 0Z" fill="url(#cleo-em)" />
      {/* hoja izquierda */}
      <path d="M30 54C18 52 8 42 7 24c11 1 22 10 23 30Z" fill="url(#cleo-em)" />
      <path d="M29.6 53.4C24 44 18 36 9.5 26.5" stroke="#1a1412" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
      {/* hoja derecha */}
      <path d="M34 54c12-2 22-12 23-30-11 1-22 10-23 30Z" fill="url(#cleo-em)" />
      <path d="M34.4 53.4C40 44 46 36 54.5 26.5" stroke="#1a1412" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
      {/* brote del medio */}
      <path d="M32 54c-3.4-6-3.4-13 0-20 3.4 7 3.4 14 0 20Z" fill="url(#cleo-em)" opacity=".9" />
    </svg>
  );
}

/** Logo completo de Cleo (Cleo Admin y cleo.com.ar). Provisorio hasta tener el archivo. */
export function CleoLogo({ className }: { className?: string }) {
  return <StudioWordmark name="Cleo" className={className} signature={false} />;
}

const champagneText = "bg-[linear-gradient(180deg,#fbf0e8_0%,#e8d2c3_45%,#b99c8b_100%)] bg-clip-text text-transparent";

/**
 * Marca grande, apilada como el logo de las referencias: emblema (o el logo del estudio)
 * arriba, el nombre en serif con brillo champagne, una línea fina y "by Cleo".
 */
export function StudioWordmark({
  name,
  logoSrc = null,
  className,
  signature = true,
  align = "start",
  sizeClass,
}: {
  name: string;
  logoSrc?: string | null;
  className?: string;
  signature?: boolean;
  align?: "start" | "center";
  /** Tamaño del nombre (si no, se calcula por el largo). */
  sizeClass?: string;
}) {
  // El nombre se achica si es largo, para que entre en el celular.
  const size = sizeClass ?? (name.length <= 6 ? "text-[4.1rem]" : name.length <= 10 ? "text-[3.1rem]" : name.length <= 14 ? "text-[2.55rem]" : "text-[2.1rem]");
  return (
    <div className={cn("flex flex-col", align === "center" ? "items-center text-center" : "items-start", className)}>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={`Logo de ${name}`} className="mb-2 h-14 w-auto max-w-[160px] object-contain" />
      ) : (
        <CleoEmblem className={cn("mb-[-0.15rem] h-[2.9rem] w-auto drop-shadow-[0_2px_6px_rgb(0_0_0/0.5)]", align === "start" && "ml-[18%]")} />
      )}
      <span className={cn(size, champagneText, "font-serif leading-[0.95] font-semibold tracking-[-0.01em] text-balance drop-shadow-[0_1px_0_rgb(0_0_0/0.4)]")}>
        {name}
      </span>
      <span aria-hidden className={cn("mt-2 h-px w-28 bg-[linear-gradient(90deg,transparent,#d9bfae,transparent)]", align === "start" && "ml-[6%]")} />
      {signature && (
        <span className={cn("mt-1.5 text-[0.68rem] tracking-[0.32em] text-[#cdbab0] uppercase", align === "start" && "ml-[8%]")}>by Cleo</span>
      )}
    </div>
  );
}

/** Marca compacta (barra superior del panel en el celular). */
export function StudioMark({ name, logoSrc, className }: { name: string; logoSrc: string | null; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={`Logo de ${name}`} className="h-9 w-auto max-w-[90px] shrink-0 object-contain" />
      ) : (
        <CleoEmblem className="h-8 w-auto shrink-0" />
      )}
      <div className="flex min-w-0 flex-col">
        <span className={cn("truncate font-serif text-[1.45rem] leading-tight font-semibold", champagneText)}>{name}</span>
        <span className="text-[0.62rem] tracking-[0.3em] text-[#cdbab0] uppercase">by Cleo</span>
      </div>
    </div>
  );
}
