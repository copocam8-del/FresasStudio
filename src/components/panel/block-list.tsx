import { Button } from "@/components/ui/button";
import { deleteBlockAction } from "@/app/sites/[site]/admin/(panel)/bloqueos/actions";
import type { Block } from "@/lib/schedule-data";
import { BLOCK_KINDS } from "@/lib/block-kinds";
import { EmptyState } from "./panel-ui";

/** Lista de bloqueos con fechas en la hora del estudio. */
export function BlockList({
  blocks,
  timezone,
  professionals,
  canEdit,
}: {
  blocks: Block[];
  timezone: string;
  professionals: { id: string; display_name: string }[];
  canEdit: boolean;
}) {
  if (blocks.length === 0) return <EmptyState>No hay bloqueos próximos.</EmptyState>;

  const day = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: timezone });
  const time = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });

  const describe = (b: Block) => {
    const from = new Date(b.starts_at);
    const to = new Date(b.ends_at);
    if (b.all_day) {
      const last = new Date(to.getTime() - 1);
      return day.format(from) === day.format(last) ? `${day.format(from)}, todo el día` : `${day.format(from)} al ${day.format(last)}, todo el día`;
    }
    return day.format(from) === day.format(to)
      ? `${day.format(from)}, de ${time.format(from)} a ${time.format(to)}`
      : `${day.format(from)} ${time.format(from)} al ${day.format(to)} ${time.format(to)}`;
  };

  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {blocks.map((b) => (
        <li key={b.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="font-medium text-card-foreground">
              {BLOCK_KINDS.find((k) => k.value === b.kind)?.label} ·{" "}
              {b.professional_id ? professionals.find((p) => p.id === b.professional_id)?.display_name ?? "Profesional" : "Todo el estudio"}
            </span>
            <span className="text-sm text-muted-foreground">{describe(b)}</span>
            {b.note && <span className="text-sm text-muted-foreground">{b.note}</span>}
          </div>
          {canEdit && (
            <form action={deleteBlockAction}>
              <input type="hidden" name="id" value={b.id} />
              <Button type="submit" variant="outline" className="h-11">
                Quitar
              </Button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
