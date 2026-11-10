"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form/form";
import { updateMyProfileAction } from "../client-actions";

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, action] = useActionState<FormState, FormData>(updateMyProfileAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nombre y apellido" name="full_name" defaultValue={fullName} autoComplete="name" required />
      <Field
        label="Teléfono"
        name="phone"
        type="tel"
        defaultValue={phone}
        autoComplete="tel"
        hint="Para que el estudio pueda avisarte sobre tus turnos."
      />
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
    </form>
  );
}
