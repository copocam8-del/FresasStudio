"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form/form";
import { platformLoginAction } from "../actions";

export function PlatformLoginForm() {
  const [state, action] = useActionState<FormState, FormData>(platformLoginAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
      <FormMessage state={state} />
      <SubmitButton pendingText="Ingresando…">Ingresar</SubmitButton>
    </form>
  );
}
