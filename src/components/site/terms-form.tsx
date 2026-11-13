"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { FormMessage, SubmitButton } from "@/components/form/form";
import type { Button } from "@/components/ui/button";

type State = { error?: string } | undefined;

/**
 * Formulario de una acción con consecuencias de seña (cancelar, cambiar día). Manda la
 * consecuencia que se mostró; si la base responde que cambió (por ejemplo, pasó el
 * plazo mientras la clienta miraba), muestra el error y vuelve a pedir la página para
 * que se vea la consecuencia nueva antes de confirmar otra vez.
 */
export function TermsForm({
  action,
  fields,
  submitLabel,
  pendingText,
  variant,
  children,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  fields: Record<string, string>;
  submitLabel: string;
  pendingText: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<State, FormData>(action, undefined);
  useEffect(() => {
    if (state?.error) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <FormMessage state={state} />
      <SubmitButton pendingText={pendingText} variant={variant}>{submitLabel}</SubmitButton>
    </form>
  );
}
