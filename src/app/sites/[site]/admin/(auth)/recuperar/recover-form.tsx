"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton, type FormState } from "@/components/form/form";
import { recoverAction } from "../../actions";

export function RecoverForm() {
  const [state, action] = useActionState<FormState, FormData>(recoverAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <FormMessage state={state} />
      {!state?.ok && <SubmitButton pendingText="Enviando…">Enviar link</SubmitButton>}
      <Link href="/admin/login" className="text-center text-sm text-foreground underline underline-offset-4">
        Volver a ingresar
      </Link>
    </form>
  );
}
