"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, currentStaff } from "@/lib/auth";
import { userFacingDbError } from "@/lib/db-errors";
import { parseMoneyToMinor } from "@/lib/money";
import { serverSupabase } from "@/lib/supabase/server";
import { emailSchema, fullNameSchema, phoneSchema } from "@/lib/validation";

export type ClientState = { error?: string; ok?: string; savedAt?: number } | undefined;

const uuid = z.uuid();
const optionalPhone = z.union([z.literal(""), phoneSchema]);
const optionalEmail = z.union([z.literal(""), emailSchema]);

function readContact(formData: FormData) {
  const name = fullNameSchema.safeParse(formData.get("full_name"));
  const phone = optionalPhone.safeParse(String(formData.get("phone") ?? "").trim());
  const email = optionalEmail.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!name.success) return { error: "Ingresá el nombre (de 2 a 120 caracteres)." } as const;
  if (!phone.success) return { error: "El teléfono no es válido." } as const;
  if (!email.success) return { error: "El email no es válido." } as const;
  if (!phone.data && !email.data) return { error: "Ingresá un teléfono o un email para poder contactarla." } as const;
  return { name: name.data, phone: phone.data || null, email: email.data || null } as const;
}

/** Alta de clienta (CRM-01). El estudio sale de la sesión. */
export async function createClientAction(_prev: ClientState, formData: FormData): Promise<ClientState> {
  const ctx = await currentStaff();
  if (!ctx || !can(ctx, "clients.manage")) return { error: "No tenés permiso para cargar clientas." };
  const c = readContact(formData);
  if ("error" in c) return { error: c.error };
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("create_client", {
    p_tenant: ctx.tenantId, p_full_name: c.name, p_phone: c.phone, p_email: c.email,
  });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath("/admin/clientas");
  redirect(`/admin/clientas/${data as string}`);
}

/** Editar datos (RLS: clients.manage del estudio). */
export async function updateClientAction(_prev: ClientState, formData: FormData): Promise<ClientState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  if (!ctx || !id.success || !can(ctx, "clients.manage")) return { error: "No tenés permiso para editar esta ficha." };
  const c = readContact(formData);
  if ("error" in c) return { error: c.error };
  const supabase = await serverSupabase();
  const { data, error } = await supabase.from("client_profiles")
    .update({ full_name: c.name, phone: c.phone, email: c.email })
    .eq("id", id.data).eq("tenant_id", ctx.tenantId).select("id");
  if (error) return { error: error.code === "23505" ? "Ya hay una clienta con ese email." : userFacingDbError(error) };
  if (!data?.length) return { error: "No tenés permiso para editar esta ficha." };
  revalidatePath(`/admin/clientas/${id.data}`);
  return { ok: "Datos guardados.", savedAt: Date.now() };
}

/** Nota interna (C20): la escribe quien ve la ficha; nunca la ve la clienta. */
export async function addNoteAction(_prev: ClientState, formData: FormData): Promise<ClientState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  const body = z.string().trim().min(1, "Escribí la nota.").max(1000, "La nota puede tener hasta 1000 caracteres.").safeParse(formData.get("body"));
  if (!ctx || !id.success) return { error: "No se pudo guardar la nota." };
  if (!body.success) return { error: body.error.issues[0]?.message };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("add_client_note", { p_client: id.data, p_body: body.data });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath(`/admin/clientas/${id.data}`);
  return { ok: "Nota guardada.", savedAt: Date.now() };
}

export async function hideNoteAction(formData: FormData): Promise<void> {
  const ctx = await currentStaff();
  const note = uuid.safeParse(formData.get("note"));
  const client = uuid.safeParse(formData.get("id"));
  if (!ctx || !note.success || !client.success) return;
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("hide_client_note", { p_note: note.data });
  if (error) console.error("hide_client_note", userFacingDbError(error));
  revalidatePath(`/admin/clientas/${client.data}`);
}

/** Preferencias y alergias (C21, clients.manage). */
export async function setPreferencesAction(_prev: ClientState, formData: FormData): Promise<ClientState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  if (!ctx || !id.success || !can(ctx, "clients.manage")) return { error: "No tenés permiso para editar esta ficha." };
  const allergies = String(formData.get("allergies") ?? "").trim();
  const preferences = String(formData.get("preferences") ?? "").trim();
  if (allergies.length > 500) return { error: "Las alergias pueden tener hasta 500 caracteres." };
  if (preferences.length > 1000) return { error: "Las preferencias pueden tener hasta 1000 caracteres." };
  const pro = String(formData.get("preferred_professional") ?? "");
  const proId = pro ? uuid.safeParse(pro) : null;
  if (proId && !proId.success) return { error: "Elegí una profesional de la lista." };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("set_client_preferences", {
    p_client: id.data, p_allergies: allergies || null, p_preferences: preferences || null,
    p_preferred_professional: proId?.success ? proId.data : null,
  });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath(`/admin/clientas/${id.data}`);
  return { ok: "Preferencias guardadas.", savedAt: Date.now() };
}

/** Ajuste manual del saldo (C11): solo credits.manage, con motivo, nunca negativo. */
export async function adjustCreditAction(_prev: ClientState, formData: FormData): Promise<ClientState> {
  const ctx = await currentStaff();
  const id = uuid.safeParse(formData.get("id"));
  if (!ctx || !id.success || !can(ctx, "credits.manage")) return { error: "No tenés permiso para ajustar el saldo." };
  const direction = formData.get("direction");
  if (direction !== "add" && direction !== "remove") return { error: "Elegí si se suma o se resta." };
  const amount = parseMoneyToMinor(String(formData.get("amount") ?? ""));
  if (!amount.ok) return { error: amount.error.replace("precio", "monto") };
  if (amount.minor <= 0) return { error: "Ingresá un monto mayor a cero." };
  if (amount.minor % 100 !== 0) return { error: "El saldo se ajusta en pesos enteros." };
  const reason = z.string().trim().min(3, "Escribí el motivo (al menos 3 letras).").max(200).safeParse(formData.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0]?.message };
  const supabase = await serverSupabase();
  const { error } = await supabase.rpc("adjust_client_credit", {
    p_client: id.data, p_amount_minor: direction === "add" ? amount.minor : -amount.minor, p_reason: reason.data,
  });
  if (error) return { error: userFacingDbError(error) };
  revalidatePath(`/admin/clientas/${id.data}`);
  return { ok: "Saldo ajustado.", savedAt: Date.now() };
}
