"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form/form";
import { loginAction } from "../../actions";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action] = useActionState<FormState, FormData>(
    loginAction,
    initialError ? { error: initialError } : undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
      <FormMessage state={state} />
      <SubmitButton pendingText="Ingresando…">Ingresar</SubmitButton>
      <Link href="/admin/recuperar" className="text-center text-sm text-foreground underline underline-offset-4">
        Olvidé mi contraseña
      </Link>
    </form>
  );
}
