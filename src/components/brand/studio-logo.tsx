/**
 * Logo del estudio (o su nombre si no tiene). Se usa <img> común: el archivo viene del
 * bucket público de Storage y ya está limitado a 1 MB y a PNG/JPEG/WebP.
 */
export function StudioLogo({ src, name, className = "h-12" }: { src: string | null; name: string; className?: string }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`Logo de ${name}`} className={`${className} w-auto max-w-[220px] object-contain`} />
  );
}
