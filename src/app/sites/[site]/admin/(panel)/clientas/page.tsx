import { Plus, Search, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InitialsAvatar, PageTitle } from "@/components/cleo/ui";
import { EmptyState } from "@/components/panel/panel-ui";
import { buttonVariants } from "@/components/ui/button";
import { can, requireStaff } from "@/lib/auth";
import { formatDayShort, ymdIn } from "@/lib/booking-format";
import { CLIENT_FILTERS, type ClientFilter, listClients, PAGE_SIZE } from "@/lib/clients-data";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Clientas" };

export default async function ClientsPage({ params, searchParams }: PageProps<"/sites/[site]/admin/clientas">) {
  const { site } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff(site, "/admin/clientas");
  const all = can(ctx, "clients.read");
  if (!all && !can(ctx, "clients.read_own")) notFound();

  const search = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const filter = (CLIENT_FILTERS.find((f) => f.key === sp.filtro)?.key ?? "all") as ClientFilter;
  const page = Math.max(0, Math.min(1000, Number.parseInt(String(sp.pagina ?? "0"), 10) || 0));
  const { rows, total } = await listClients(ctx, search, filter, page);
  const tz = ctx.studio.timezone;
  const url = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(search ? { q: search } : {}), ...(filter !== "all" ? { filtro: filter } : {}), ...extra });
    return `/admin/clientas?${q.toString()}`;
  };
  const chip = "flex min-h-11 items-center rounded-full border px-4 text-sm";

  return (
    <>
      <PageTitle
        title="Clientas"
        description={all ? "Fichas, historial y notas de tus clientas." : "Las clientas que atendiste o vas a atender."}
        action={can(ctx, "clients.manage") ? (
          <Link href="/admin/clientas/nueva" className={buttonVariants({ className: "h-11" })}>
            <Plus aria-hidden strokeWidth={1.8} /> Nueva clienta
          </Link>
        ) : undefined}
      />

      <form action="/admin/clientas" role="search" className="flex gap-2">
        {filter !== "all" && <input type="hidden" name="filtro" value={filter} />}
        <label htmlFor="q" className="sr-only">Buscar por nombre, teléfono o email</label>
        <div className="relative flex-1">
          <Search aria-hidden strokeWidth={1.5} className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
          <input id="q" name="q" type="search" defaultValue={search} maxLength={100} placeholder="Buscar por nombre, teléfono o email"
            className="h-11 w-full rounded-full border border-[#4a3f3c] bg-[#1a1516]/85 pr-4 pl-11 text-base text-foreground placeholder:text-muted-foreground" />
        </div>
        <button type="submit" className={buttonVariants({ variant: "outline", className: "h-11" })}>Buscar</button>
      </form>

      <nav aria-label="Filtrar" className="flex flex-wrap gap-2">
        {CLIENT_FILTERS.filter((f) => all || f.key !== "credit").map((f) => (
          <Link key={f.key} href={url({ filtro: f.key === "all" ? "" : f.key })} aria-current={filter === f.key ? "true" : undefined}
            className={`${chip} ${filter === f.key ? "champagne border-transparent font-semibold text-primary-foreground" : "border-[#4a3f3c] bg-[#1a1516]/85 text-foreground hover:bg-[#241d1c]"}`}>
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState>{search || filter !== "all" ? "No encontramos clientas con esa búsqueda." : "Todavía no hay clientas."}</EmptyState>
      ) : (
        <section aria-label="Clientas" className="glass flex flex-col rounded-[1.1rem] p-2 sm:p-3">
          <ul className="flex flex-col divide-y divide-[#2a2220]">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/clientas/${c.id}`} className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-3 hover:bg-white/5">
                  <InitialsAvatar name={c.full_name} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{c.full_name}</span>
                      {c.is_frequent && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#d4b59d]/60 px-2 py-0.5 text-[0.75rem] text-foreground">
                          <Star aria-hidden className="size-3 text-gold" strokeWidth={1.6} /> Frecuente
                        </span>
                      )}
                      {c.no_shows_180 > 0 && (
                        <span className="rounded-full border border-[#8d4d49] bg-status-cancel/50 px-2 py-0.5 text-[0.75rem] text-status-cancel-foreground">
                          {c.no_shows_180 === 1 ? "1 falta" : `${c.no_shows_180} faltas`}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {[c.phone, c.next_visit ? `próximo: ${formatDayShort(ymdIn(c.next_visit, tz))}` : null,
                        c.last_visit ? `última visita: ${formatDayShort(ymdIn(c.last_visit, tz))}` : null].filter(Boolean).join(" · ") || "Sin turnos"}
                    </span>
                  </span>
                  {c.credit_minor !== null && c.credit_minor > 0 && (
                    <span className="shrink-0 text-sm text-foreground tabular-nums">{formatMoney(c.credit_minor)} a favor</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Páginas" className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Mostrando {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} de {total}</span>
          <span className="flex gap-2">
            {page > 0 && <Link href={url({ pagina: String(page - 1) })} className={buttonVariants({ variant: "outline", className: "h-11" })}>Anteriores</Link>}
            {(page + 1) * PAGE_SIZE < total && <Link href={url({ pagina: String(page + 1) })} className={buttonVariants({ variant: "outline", className: "h-11" })}>Siguientes</Link>}
          </span>
        </nav>
      )}
    </>
  );
}
