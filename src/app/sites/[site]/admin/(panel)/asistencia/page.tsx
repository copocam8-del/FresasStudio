import { CalendarCheck2, CalendarX2, Clock3, Percent } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GlassCard, InitialsAvatar, PageTitle, StatCard } from "@/components/cleo/ui";
import { EmptyState } from "@/components/panel/panel-ui";
import { requirePermission } from "@/lib/auth";
import { formatDayShort, ymdIn } from "@/lib/booking-format";
import { loadCatalog } from "@/lib/catalog-data";
import { serverSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Asistencia" };

const PERIODS = [
  { key: "30", label: "30 días" },
  { key: "90", label: "90 días" },
  { key: "180", label: "6 meses" },
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Stats = {
  attended: number; no_shows: number; late_cancels: number; timely_cancels: number; studio_cancels: number; reschedules: number;
  rate: number | null;
  frequent: { id: string; full_name: string; attended: number; last_visit: string }[];
  repeat_no_shows: { id: string; full_name: string; no_shows: number; attended: number; last_no_show: string }[];
};

/**
 * Indicadores de asistencia (ATT-03 a ATT-05, C17, C18). Todo sale de los turnos que ya
 * pasaron: atendidas, faltas y cancelaciones tardías (que no son faltas).
 */
export default async function AttendancePage({ params, searchParams }: PageProps<"/sites/[site]/admin/asistencia">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(site, "reports.read", "/admin/asistencia");
  const period = PERIODS.find((p) => p.key === sp.periodo)?.key ?? "90";
  const { professionals } = await loadCatalog(ctx);
  const pro = typeof sp.pro === "string" && UUID.test(sp.pro) && professionals.some((p) => p.id === sp.pro) ? sp.pro : null;

  const to = new Date();
  const from = new Date(to.getTime() - Number(period) * 86_400_000);
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("attendance_stats", {
    p_tenant: ctx.tenantId, p_from: from.toISOString(), p_to: to.toISOString(), p_professional: pro,
  });
  if (error) throw new Error(`No se pudieron cargar los indicadores: ${error.message}`);
  const s = data as Stats;
  const tz = ctx.studio.timezone;
  const url = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ periodo: period, pro, ...extra })) if (v) q.set(k, v);
    return `/admin/asistencia?${q.toString()}`;
  };
  const chip = "flex min-h-11 items-center rounded-full border px-4 text-sm";
  const on = "champagne border-transparent font-semibold text-primary-foreground";
  const off = "border-[#4a3f3c] bg-[#1a1516]/85 text-foreground hover:bg-[#241d1c]";
  // D5: solo números reales y mayores que cero.
  const cards = [
    { icon: Percent, value: s.rate ?? 0, text: `${s.rate}%`, label: "Asistencia", hint: "atendidas / (atendidas + faltas)" },
    { icon: CalendarCheck2, value: s.attended, text: String(s.attended), label: "Atendidas" },
    { icon: CalendarX2, value: s.no_shows, text: String(s.no_shows), label: "Faltas" },
    { icon: Clock3, value: s.late_cancels, text: String(s.late_cancels), label: "Cancelaciones tardías", hint: "no cuentan como falta" },
  ].filter((c) => c.value > 0 || (c.label === "Asistencia" && s.rate !== null));
  const nothing = s.attended + s.no_shows + s.late_cancels + s.timely_cancels + s.studio_cancels + s.reschedules === 0;

  return (
    <>
      <PageTitle title="Asistencia" description="Turnos que ya pasaron: quiénes vienen siempre y quiénes faltan." />
      <div className="flex flex-col gap-3">
        <nav aria-label="Período" className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Link key={p.key} href={url({ periodo: p.key })} aria-current={period === p.key ? "true" : undefined} className={`${chip} ${period === p.key ? on : off}`}>
              Últimos {p.label}
            </Link>
          ))}
        </nav>
        {professionals.length > 1 && (
          <nav aria-label="Profesional" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Link href={url({ pro: null })} aria-current={!pro ? "true" : undefined} className={`${chip} shrink-0 ${!pro ? on : off}`}>Todas</Link>
            {professionals.filter((p) => !p.archived_at).map((p) => (
              <Link key={p.id} href={url({ pro: p.id })} aria-current={pro === p.id ? "true" : undefined} className={`${chip} shrink-0 ${pro === p.id ? on : off}`}>
                {p.display_name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {nothing ? (
        <EmptyState>Todavía no hay turnos pasados en este período.</EmptyState>
      ) : (
        <>
          {cards.length > 0 && (
            <section aria-label="Resumen" className="grid grid-cols-2 gap-[1.4rem] xl:grid-cols-4">
              {cards.map((c) => <StatCard key={c.label} icon={c.icon} value={c.text} label={c.label} hint={c.hint} />)}
            </section>
          )}
          {(s.timely_cancels > 0 || s.studio_cancels > 0 || s.reschedules > 0) && (
            <p className="text-sm text-muted-foreground">
              Además: {[s.timely_cancels && `${s.timely_cancels} cancelaciones a tiempo`, s.studio_cancels && `${s.studio_cancels} canceladas por el estudio`,
                s.reschedules && `${s.reschedules} reprogramaciones`].filter(Boolean).join(" · ")}. Ninguna cuenta como falta.
            </p>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <GlassCard title="Clientas frecuentes">
              <p className="text-sm text-muted-foreground">3 o más turnos atendidos en el período.</p>
              {s.frequent.length === 0 ? (
                <p className="text-sm text-foreground/80">Nadie llegó a 3 turnos en este período.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-[#2a2220]">
                  {s.frequent.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/clientas/${c.id}`} className="flex min-h-14 items-center gap-3 rounded-xl px-1 py-2 hover:bg-white/5">
                        <InitialsAvatar name={c.full_name} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-foreground">{c.full_name}</span>
                          <span className="text-sm text-muted-foreground">última visita: {formatDayShort(ymdIn(c.last_visit, tz))}</span>
                        </span>
                        <span className="shrink-0 text-sm text-foreground tabular-nums">{c.attended} turnos</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </GlassCard>
            <GlassCard title="Faltas repetidas">
              <p className="text-sm text-muted-foreground">2 o más faltas en el período. Las cancelaciones no cuentan.</p>
              {s.repeat_no_shows.length === 0 ? (
                <p className="text-sm text-foreground/80">Nadie faltó dos veces en este período.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-[#2a2220]">
                  {s.repeat_no_shows.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/clientas/${c.id}`} className="flex min-h-14 items-center gap-3 rounded-xl px-1 py-2 hover:bg-white/5">
                        <InitialsAvatar name={c.full_name} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-foreground">{c.full_name}</span>
                          <span className="text-sm text-muted-foreground">
                            última falta: {formatDayShort(ymdIn(c.last_no_show, tz))}{c.attended > 0 ? ` · vino ${c.attended} ${c.attended === 1 ? "vez" : "veces"}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full border border-[#8d4d49] bg-status-cancel/50 px-2.5 py-0.5 text-sm text-status-cancel-foreground">
                          {c.no_shows} faltas
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </>
  );
}
