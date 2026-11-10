"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCategoryAction, type CatalogState } from "../actions";

/** Alta (sin id) o cambio de nombre (con id) de una categoría. */
export function CategoryForm({ id, name }: { id?: string; name?: string }) {
  const [state, action] = useActionState<CatalogState, FormData>(saveCategoryAction, undefined);
  const inputId = id ? `cat-name-${id}` : "cat-name-new";
  return (
    <form action={action} className="flex flex-col gap-2">
      {id && <input type="hidden" name="id" value={id} />}
      <Label htmlFor={inputId} className={id ? "sr-only" : undefined}>
        {id ? `Nombre de ${name}` : "Nueva categoría"}
      </Label>
      <div className="flex gap-2">
        <Input id={inputId} name="name" defaultValue={name} required maxLength={60} className="h-11 flex-1 text-base" />
        <div className="w-32 shrink-0">
          <SubmitButton pendingText="…" variant={id ? "outline" : "default"}>
            {id ? "Guardar" : "Agregar"}
          </SubmitButton>
        </div>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
