"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { Label } from "@/components/ui/label";
import { saveBookingSettingsAction, type SettingsState } from "./actions";

export type BookingSettings = {
  online_booking_enabled: boolean;
  payments_connected: boolean;
  booking_min_notice_minutes: number;
  booking_horizon_days: number;
  slot_interval_minutes: number;
  booking_hold_minutes: number;
  deposit_percent: number;
  cancellation_window_hours: number;
};

const select = "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground";
const NOTICE = [0, 60, 120, 360, 720, 1440, 2880, 4320];
const HOLD = [15, 30, 60, 120, 240, 720, 1440];
const label = (m: number) => (m === 0 ? "Sin mínimo" : m < 60 ? `${m} minutos` : m % 1440 === 0 ? `${m / 1440} ${m === 1440 ? "día" : "días"}` : `${m / 60} ${m === 60 ? "hora" : "horas"}`);
const withCurrent = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));

export function BookingSettingsForm({ s }: { s: BookingSettings }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveBookingSettingsAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Reservas online</legend>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" name="online_booking_enabled" defaultChecked={s.online_booking_enabled}
            disabled={!s.payments_connected} className="mt-0.5 size-5" />
          <span>
            Las clientas pueden reservar desde el sitio
            {!s.payments_connected && (
              <span className="block text-muted-foreground">
                Para activarlas primero hay que <Link href="/admin/pagos" className="underline">conectar Mercado Pago</Link>:
                toda reserva se confirma con la seña pagada.
              </span>
            )}
          </span>
        </label>
        {!s.payments_connected && s.online_booking_enabled && <input type="hidden" name="online_booking_enabled" value="on" />}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-semibold">Cuándo se puede reservar</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notice">Anticipación mínima</Label>
          <select id="notice" name="booking_min_notice_minutes" defaultValue={s.booking_min_notice_minutes} className={select}>
            {withCurrent(NOTICE, s.booking_min_notice_minutes).map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </div>
        <Field label="Hasta cuántos días adelante" name="booking_horizon_days" type="number" inputMode="numeric" min={1} max={365}
          defaultValue={s.booking_horizon_days} required />
        <div className="flex flex-col gap-2">
          <Label htmlFor="interval">Horarios cada</Label>
          <select id="interval" name="slot_interval_minutes" defaultValue={s.slot_interval_minutes} className={select}>
            {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-semibold">Seña y política</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hold">Tiempo para pagar la seña</Label>
          <select id="hold" name="booking_hold_minutes" defaultValue={s.booking_hold_minutes} className={select} aria-describedby="hold-hint">
            {withCurrent(HOLD, s.booking_hold_minutes).map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
          <p id="hold-hint" className="text-sm text-muted-foreground">Si no paga en ese tiempo, el horario se libera solo.</p>
        </div>
        <Field label="Seña (%)" name="deposit_percent" type="number" inputMode="numeric" min={1} max={100}
          defaultValue={s.deposit_percent} required hint="Toda reserva lleva seña. Cada servicio puede tener la suya." />
        <Field label="Ventana de cancelación (horas)" name="cancellation_window_hours" type="number" inputMode="numeric" min={0} max={720}
          defaultValue={s.cancellation_window_hours} required
          hint="Con esta anticipación o más, la seña se conserva; con menos, se pierde." />
        <p className="text-sm text-muted-foreground">
          Cambiar la seña o la ventana crea una versión nueva de la política. Las reservas ya hechas conservan la que aceptaron.
        </p>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Guardar reglas</SubmitButton>
    </form>
  );
}
