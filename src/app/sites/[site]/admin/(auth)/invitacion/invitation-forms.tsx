"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form/form";
import { acceptInvitationAction, signUpForInvitationAction } from "../../actions";

export function SignUpForm({ token }: { token: string }) {
  const [state, action] = useActionState<FormState, FormData>(signUpForInvitationAction, undefined);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Tu nombre" name="full_name" autoComplete="name" required />
      <Field
        label="Tu email"
        name="email"
        type="email"
        autoComplete="email"
        required
        hint="El mismo al que te llegó la invitación."
      />
      <Field
        label="Elegí una contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        hint="Al menos 10 caracteres."
      />
      <FormMessage state={state} />
      <SubmitButton pendingText="Creando cuenta…">Crear cuenta</SubmitButton>
    </form>
  );
}

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState<FormState, FormData>(acceptInvitationAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton pendingText="Aceptando…">Aceptar invitación</SubmitButton>
    </form>
  );
}
