/**
 * Lee un tstzrange de Postgres tal como llega por la API, por ejemplo
 *   ["2026-12-08 03:00:00+00","2026-12-09 03:00:00+00")
 * y devuelve sus extremos en ISO. Solo rangos con ambos extremos (los bloqueos los exigen).
 */
export function parseTstzRange(text: string): { starts_at: string; ends_at: string } {
  const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(text.trim());
  if (!m) throw new Error(`Rango inválido: ${text}`);
  const toIso = (s: string) => {
    const normalized = s.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida en el rango: ${s}`);
    return d.toISOString();
  };
  return { starts_at: toIso(m[1]), ends_at: toIso(m[2]) };
}
