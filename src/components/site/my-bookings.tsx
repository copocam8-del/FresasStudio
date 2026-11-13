import Link from "next/link";
import { getBookingContext, myBookings, splitBookings } from "@/lib/booking-data";
import { formatDateTimeLong } from "@/lib/booking-format";

const STATUS: Record<string, string> = {
  pending_payment: "Esperando pago",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Vencido",
  rescheduled: "Cambiado de día",
  completed: "Atendido",
  no_show: "No asististe",
};

/** "Mis turnos" de la clienta en este estudio (próximos primero). */
export async function MyBookings({ slug }: { slug: string }) {
  const [ctx, bookings] = await Promise.all([getBookingContext(slug), myBookings(slug)]);
  if (!ctx) return null;
  const { upcoming, past } = splitBookings(bookings);

  const list = (items: typeof bookings) => (
    <ul className="flex flex-col divide-y rounded-xl border">
      {items.map((b) => (
        <li key={b.code}>
          <Link href={`/reserva/${b.code}`} className="flex flex-col gap-0.5 p-3 hover:bg-accent">
            <span className="font-medium text-foreground">{b.service_name} · {b.professional_name}</span>
            <span className="text-sm text-muted-foreground">{formatDateTimeLong(b.starts_at, ctx.timezone)}</span>
            <span className="text-sm text-muted-foreground">
              {STATUS[b.status]}{b.cancelled_by === "studio" ? " por el estudio" : ""} · código {b.code}
            </span>
            {b.cancelled_by === "studio" && b.cancel_reason && (
              <span className="text-sm text-foreground">Motivo: {b.cancel_reason}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-labelledby="mis-turnos" className="flex flex-col gap-3">
      <h2 id="mis-turnos" className="text-lg font-semibold text-foreground">Mis turnos</h2>
      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no tenés turnos en este estudio.</p>
      ) : (
        <>
          {upcoming.length > 0 ? list(upcoming) : <p className="text-sm text-muted-foreground">No tenés turnos próximos.</p>}
          {past.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-foreground underline underline-offset-4">Turnos anteriores ({past.length})</summary>
              <div className="mt-2">{list(past)}</div>
            </details>
          )}
        </>
      )}
      {ctx.online_booking_enabled && (
        <Link href="/reservar" className="text-sm text-foreground underline underline-offset-4">Reservar un turno nuevo</Link>
      )}
    </section>
  );
}
