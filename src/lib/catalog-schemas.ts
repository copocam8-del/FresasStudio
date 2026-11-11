import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/money";

/** Validaciones del catálogo (las mismas reglas que la base). */

const minutes = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `Indicá ${label}.` })
    .int(`${label[0].toUpperCase()}${label.slice(1)} tiene que ser en minutos enteros.`)
    .min(min, `${label[0].toUpperCase()}${label.slice(1)} tiene que ser de al menos ${min} minutos.`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} es demasiado larga.`)
    .refine((v) => v % 5 === 0, `${label[0].toUpperCase()}${label.slice(1)} tiene que ir en pasos de 5 minutos.`);

export const moneySchema = z.string().transform((v, ctx) => {
  const parsed = parseMoneyToMinor(v);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return parsed.minor;
});

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

// Una casilla sin tildar no viaja en el formulario: el campo puede faltar.
const checkbox = z
  .string()
  .nullish()
  .transform((v) => v === "on" || v === "true");

export const categorySchema = z.object({
  name: z.string().trim().min(2, "El nombre tiene que tener al menos 2 caracteres.").max(60, "El nombre es demasiado largo."),
});

export const serviceSchema = z
  .object({
    name: z.string().trim().min(2, "El nombre tiene que tener al menos 2 caracteres.").max(80, "El nombre es demasiado largo."),
    category_id: optionalUuid,
    description: z
      .string()
      .trim()
      .max(1000, "La descripción es demasiado larga.")
      .transform((v) => v || null),
    duration_minutes: minutes(5, 600, "la duración"),
    buffer_after_minutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(240, "El tiempo extra es demasiado largo.")
      .refine((v) => v % 5 === 0, "El tiempo extra tiene que ir en pasos de 5 minutos."),
    price: moneySchema,
    price_is_from: checkbox,
    deposit_mode: z.enum(["studio", "custom"]),
    deposit_percent: z.string().optional(),
    show_online: checkbox,
    is_active: checkbox,
  })
  .transform((v, ctx) => {
    let deposit: number | null = null;
    if (v.deposit_mode === "custom") {
      const n = Number(v.deposit_percent);
      if (!v.deposit_percent || !Number.isInteger(n) || n < 1 || n > 100) {
        ctx.addIssue({ code: "custom", message: "La seña propia tiene que ser un número de 1 a 100 (toda reserva lleva seña)." });
        return z.NEVER;
      }
      deposit = n;
    }
    return {
      name: v.name,
      category_id: v.category_id,
      description: v.description,
      duration_minutes: v.duration_minutes,
      buffer_after_minutes: v.buffer_after_minutes,
      price_minor: v.price,
      price_is_from: v.price_is_from,
      deposit_percent: deposit,
      show_online: v.show_online,
      is_active: v.is_active,
    };
  });

export const professionalSchema = z.object({
  display_name: z.string().trim().min(2, "El nombre tiene que tener al menos 2 caracteres.").max(60, "El nombre es demasiado largo."),
  bio: z
    .string()
    .trim()
    .max(500, "La descripción es demasiado larga.")
    .transform((v) => v || null),
  membership_id: optionalUuid,
  show_online: checkbox,
  accepts_online_booking: checkbox,
  is_active: checkbox,
});

/** "Cobra o tarda distinto" de una profesional en un servicio (vacío = igual al servicio). */
export const overrideSchema = z.object({
  price: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const parsed = parseMoneyToMinor(v);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: parsed.error });
        return z.NEVER;
      }
      return parsed.minor;
    }),
  duration: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 5 || n > 600 || n % 5 !== 0) {
        ctx.addIssue({ code: "custom", message: "La duración propia tiene que ser de 5 a 600 minutos, en pasos de 5." });
        return z.NEVER;
      }
      return n;
    }),
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Revisá los datos.";
}
