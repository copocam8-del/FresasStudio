import { getBookingContext, myCredit, myCreditMovements } from "@/lib/booking-data";
import { CREDIT_KIND, creditUsableUntil, daysUntil } from "@/lib/booking-terms";
import { formatMoney } from "@/lib/money";

/**
 * Saldo a favor de la clienta en este estudio (C9, C10): cuánto le queda de cada
 * acreditación y hasta cuándo, y los movimientos. Solo aparece si hay o hubo saldo.
 */
export async function MyCredit({ slug }: { slug: string }) {
  const [ctx, lots, movements] = await Promise.all([getBookingContext(slug), myCredit(slug), myCreditMovements(slug)]);
  if (!ctx || (lots.length === 0 && movements.length === 0)) return null;
  const tz = ctx.timezone;
  const currency = lots[0]?.currency ?? movements[0]?.currency ?? ctx.currency;
  const total = lots.reduce((sum, l) => sum + l.remaining_minor, 0);

  return (
    <section aria-labelledby="saldo" className="glass flex flex-col gap-3 rounded-[1.1rem] p-5 text-card-foreground">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="saldo" className="text-lg font-semibold">Saldo a favor</h2>
        <span className="text-xl font-semibold tabular-nums">{formatMoney(total, currency)}</span>
      </div>
      {lots.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {lots.map((l) => {
              const days = daysUntil(l.expires_at);
              const soon = days <= 15;
              return (
                <li
                  key={`${l.expires_at}-${l.appointment_code ?? l.kind}`}
                  className={`flex items-center justify-between gap-3 rounded-2xl border p-3 text-sm ${soon ? "border-[#d4b59d] bg-status-pending/15" : "border-border bg-[#1d1716]/70"}`}
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {formatMoney(l.remaining_minor, l.currency)} hasta el {creditUsableUntil(l.expires_at, tz)}
                    </span>
                    <span className="text-muted-foreground">
                      {CREDIT_KIND[l.kind] ?? "Saldo"}{l.appointment_code ? ` · turno ${l.appointment_code}` : ""}
                    </span>
                  </span>
                  {soon && (
                    <span className="shrink-0 font-medium text-foreground">
                      {days === 0 ? "Vence hoy" : `Vence en ${days} ${days === 1 ? "día" : "días"}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted-foreground">
            Se usa solo en la seña de tu próxima reserva en este estudio, empezando por lo que vence antes. Es un monto fijo
            en pesos.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No tenés saldo disponible.</p>
      )}
      {movements.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground underline underline-offset-4">
            Movimientos ({movements.length})
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-border text-sm">
            {movements.map((m, i) => (
              <li key={`${m.created_at}-${i}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex flex-col">
                  <span className="text-foreground">{CREDIT_KIND[m.kind] ?? m.kind}{m.appointment_code ? ` · ${m.appointment_code}` : ""}</span>
                  <span className="text-muted-foreground">
                    {new Intl.DateTimeFormat("es-AR", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(m.created_at))}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums ${m.amount_minor > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                  {m.amount_minor > 0 ? "+" : "−"} {formatMoney(Math.abs(m.amount_minor), m.currency)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
