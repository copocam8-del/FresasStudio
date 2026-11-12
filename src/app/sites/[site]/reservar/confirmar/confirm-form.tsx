"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form/form";
import { Label } from "@/components/ui/label";
import { createBookingAction, type BookingState } from "../actions";

export function ConfirmForm({
  serviceId,
  pro,
  startsAt,
  policyVersion,
  phone,
  depositLabel,
}: {
  serviceId: string;
  pro: string;
  startsAt: string;
  policyVersion: number;
  phone: string;
  depositLabel: string;
}) {
  const [state, action] = useActionState<BookingState, FormData>(createBookingAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="service" value={serviceId} />
      <input type="hidden" name="pro" value={pro} />
      <input type="hidden" name="starts_at" value={startsAt} />
      <input type="hidden" name="policy_version" value={policyVersion} />
      <Field label="Tu teléfono (WhatsApp)" name="phone" type="tel" autoComplete="tel" required defaultValue={phone}
        hint="Para que el estudio pueda avisarte sobre tu turno." />
      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Algo que el estudio deba saber (opcional)</Label>
        <textarea id="note" name="note" maxLength={300} rows={2}
          className="w-full rounded-xl border border-input/80 bg-[#141010]/80 px-3 py-2 text-base text-foreground" />
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
        <input type="checkbox" name="accept_policy" required className="mt-0.5 size-5" />
        Leí y acepto la política del estudio.
      </label>
      <FormMessage state={state} />
      <SubmitButton pendingText="Reservando…">Reservar y pagar seña ({depositLabel})</SubmitButton>
    </form>
  );
}
