import { cn } from "cn";
import { CleoLogo, CleoMark } from "@/components/cleo/cleo-logo";

/*
 * Marca que se ve en el sitio y el panel de cada estudio (regla definitiva):
 *   - Por defecto, el logo completo de Cleo.
 *   - Si el estudio activó su marca propia (/admin/marca): su nombre grande (y su logo
 *     si lo cargó) con el logo de Cleo chiquito debajo.
 */

export type BrandInfo = { name: string; ownBrand: boolean; logoSrc: string | null };

export { CleoLogo, CleoMark };

const champagneText = "bg-[linear-gradient(180deg,#fbf0e8_0%,#e8d2c3_45%,#b99c8b_100%)] bg-clip-text text-transparent";

function nameSize(name: string) {
  return name.length <= 6 ? "text-[4.1rem]" : name.length <= 10 ? "text-[3.1rem]" : name.length <= 14 ? "text-[2.55rem]" : "text-[2.1rem]";
}

/** Marca grande (inicio de la clienta, menú lateral del panel). */
export function BrandLarge({
  brand,
  align = "start",
  className,
  sizeClass,
}: {
  brand: BrandInfo;
  align?: "start" | "center";
  className?: string;
  sizeClass?: string;
}) {
  if (!brand.ownBrand) {
    return <CleoLogo className={cn(align === "start" ? "h-[6.6rem]" : "h-[5.6rem]", className)} />;
  }
  return (
    <div className={cn("flex flex-col", align === "center" ? "items-center text-center" : "items-start", className)}>
      {brand.logoSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoSrc} alt={`Logo de ${brand.name}`} className="mb-2 h-14 w-auto max-w-[160px] object-contain" />
      )}
      <span className={cn(sizeClass ?? nameSize(brand.name), champagneText, "font-serif leading-[0.95] font-semibold tracking-[-0.01em] text-balance")}>
        {brand.name}
      </span>
      <span className={cn("mt-2 flex items-center gap-1.5 text-[0.7rem] tracking-[0.2em] text-[#cdbab0] uppercase")}>
        by <CleoLogo title="Cleo" className="h-[1.35rem] drop-shadow-none" />
      </span>
    </div>
  );
}

/** Marca compacta (barra superior del panel en el celular, cajón del menú). */
export function BrandCompact({ brand, className }: { brand: BrandInfo; className?: string }) {
  if (!brand.ownBrand) return <CleoLogo className={cn("h-11", className)} />;
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {brand.logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoSrc} alt={`Logo de ${brand.name}`} className="h-9 w-auto max-w-[90px] shrink-0 object-contain" />
      ) : (
        <CleoMark className="h-8 shrink-0" />
      )}
      <div className="flex min-w-0 flex-col">
        <span className={cn("truncate font-serif text-[1.45rem] leading-tight font-semibold", champagneText)}>{brand.name}</span>
        <span className="flex items-center gap-1 text-[0.6rem] tracking-[0.2em] text-[#cdbab0] uppercase">
          by <CleoLogo title="Cleo" className="h-[0.95rem] drop-shadow-none" />
        </span>
      </div>
    </div>
  );
}
