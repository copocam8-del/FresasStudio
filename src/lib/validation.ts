import { z } from "zod";

/** Email normalizado (sin espacios, minúsculas). */
export const emailSchema = z
  .string({ error: "Ingresá tu email." })
  .trim()
  .toLowerCase()
  .max(254, "El email es demasiado largo.")
  .pipe(z.email({ error: "Ese email no parece válido." }));

/** 10 a 72 caracteres (72 bytes es el límite de bcrypt, que usa Supabase Auth). */
export const passwordSchema = z
  .string({ error: "Ingresá una contraseña." })
  .min(10, "La contraseña tiene que tener al menos 10 caracteres.")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "La contraseña es demasiado larga (máximo 72 caracteres).");

/** Para iniciar sesión no se valida el largo: el error tiene que ser genérico. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Ingresá tu contraseña.").max(200),
});

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden.", path: ["confirm"] });

/** Token de invitación: 32 bytes en hex. */
export const invitationTokenSchema = z.string().regex(/^[0-9a-f]{64}$/, "El link de invitación no es válido.");

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Ingresá tu nombre.")
  .max(120, "El nombre es demasiado largo.");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,30}$/, "Ese teléfono no parece válido.");

/**
 * Destino después del login: solo rutas relativas de este mismo sitio. Evita
 * redirecciones abiertas (//evil.com, https://evil.com, /\evil.com, etc.).
 */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://x.invalid");
    if (url.origin !== "http://x.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** Primer mensaje de error de zod, para mostrar en el formulario. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Revisá los datos ingresados.";
}
