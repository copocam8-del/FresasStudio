"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Resultado de una Server Action de formulario. */
export type FormState = { error?: string; ok?: string } | undefined;

export function Field({
  label,
  name,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; name: string; hint?: string }) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className="h-11 text-base" aria-describedby={hintId} {...props} />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText = "Un momento…",
  variant,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" variant={variant} className="h-11 w-full" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="rounded-lg border bg-secondary p-3 text-sm text-secondary-foreground">
        {state.ok}
      </p>
    );
  }
  return null;
}
