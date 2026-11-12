import { NextResponse, type NextRequest } from "next/server";
import { can, currentStaff } from "@/lib/auth";
import { formatDateTimeLong } from "@/lib/booking-format";
import { csvLine, minorToDecimal, OUTCOME_LABEL, paymentMethodLabel, STATUS_LABEL } from "@/lib/payment-labels";
import { loadPayments, paymentPeriod } from "@/lib/payments-data";

/** CSV de los pagos del período (cash.read), para cruzar con el resumen de Mercado Pago. */
export async function GET(request: NextRequest) {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "cash.read")) return new NextResponse("No encontrado", { status: 404 });
  const period = paymentPeriod(Object.fromEntries(request.nextUrl.searchParams), ctx.studio.timezone);
  const rows = await loadPayments(ctx, period.from, period.to);
  const tz = ctx.studio.timezone;

  const lines = [
    csvLine(["Fecha", "Operación Mercado Pago", "Turno", "Fecha del turno", "Clienta", "Servicio", "Monto", "Comisión",
      "Neto", "Devuelto", "Moneda", "Medio", "Estado", "Resultado", "Prueba"]),
    ...rows.map((p) => csvLine([
      formatDateTimeLong(p.approved_at ?? p.created_at, tz), p.provider_payment_id, p.appointment_code,
      formatDateTimeLong(p.starts_at, tz), p.client_name, p.service_name, minorToDecimal(p.amount_minor),
      minorToDecimal(p.fee_minor), minorToDecimal(p.net_minor), minorToDecimal(p.refunded_minor), p.currency,
      paymentMethodLabel(p.payment_method, p.payment_type), STATUS_LABEL[p.status] ?? p.status,
      p.outcome ? (OUTCOME_LABEL[p.outcome] ?? p.outcome) : "", p.live_mode ? "" : "sí",
    ])),
  ];
  // BOM para que Excel reconozca los acentos.
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pagos-${period.desde}-a-${period.hasta}.csv"`,
      "cache-control": "no-store",
    },
  });
}
