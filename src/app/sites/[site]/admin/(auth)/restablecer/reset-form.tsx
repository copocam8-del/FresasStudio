"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form/form";
import { resetPasswordAction } from "../../actions";

export function ResetForm() {
  const [state, action] = useActionState<FormState, FormData>(resetPasswordAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Contraseña nueva"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        hint="Al menos 10 caracteres."
      />
      <Field label="Repetila" name="confirm" type="password" autoComplete="new-password" required />
      <FormMessage state={state} />
      <SubmitButton pendingText="Guardando…">Guardar contraseña</SubmitButton>
    </form>
  );
}
