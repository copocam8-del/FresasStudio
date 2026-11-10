"use client";

import { useActionState, useState } from "react";
import { Field, SubmitButton } from "@/components/form/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createInvitationAction, type InviteState } from "./actions";

type Role = { id: string; name: string };

export function InviteForm({ roles, studioName }: { roles: Role[]; studioName: string }) {
  const [state, action] = useActionState<InviteState, FormData>(createInvitationAction, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.link) {
    const message = `Te invito a sumarte al equipo de ${studioName}. Entrá a este link para crear tu cuenta: ${state.link}`;
    return (
      <div className="flex flex-col gap-3" role="status">
        <p className="text-sm text-foreground">
          Listo. Mandale este link a <strong>{state.email}</strong>. Por seguridad se muestra{" "}
          <strong>una sola vez</strong> y vence en 7 días.
        </p>
        <Label htmlFor="invite-link">Link de invitación</Label>
        <input
          id="invite-link"
          readOnly
          value={state.link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="h-11 flex-1"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? "¡Copiado!" : "Copiar link"}
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", className: "h-11 flex-1" })}
          >
            Enviar por WhatsApp
          </a>
        </div>
        <Button type="button" variant="ghost" className="h-11" onClick={() => window.location.reload()}>
          Invitar a otra persona
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email de la persona" name="email" type="email" autoComplete="off" required />
      <div className="flex flex-col gap-2">
        <Label htmlFor="role_id">Rol</Label>
        <select
          id="role_id"
          name="role_id"
          required
          defaultValue=""
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground"
        >
          <option value="" disabled>
            Elegí un rol
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton pendingText="Creando invitación…">Crear link de invitación</SubmitButton>
    </form>
  );
}
