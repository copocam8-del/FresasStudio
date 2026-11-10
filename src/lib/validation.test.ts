import { describe, expect, it } from "vitest";
import {
  emailSchema,
  invitationTokenSchema,
  loginSchema,
  newPasswordSchema,
  passwordSchema,
  safeNext,
} from "./validation";

describe("emailSchema", () => {
  it("normaliza espacios y mayúsculas", () => {
    expect(emailSchema.parse("  Duena@FresasStudio.Test ")).toBe("duena@fresasstudio.test");
  });
  it("rechaza formatos inválidos y demasiado largos", () => {
    for (const bad of ["", "sin-arroba", "a@b", "a b@c.com", "a".repeat(250) + "@x.com"]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("passwordSchema", () => {
  it("exige entre 10 y 72 caracteres", () => {
    expect(passwordSchema.safeParse("a".repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
  });
  it("cuenta bytes, no caracteres (límite de bcrypt)", () => {
    // "ñ" ocupa 2 bytes: 37 × 2 = 74 bytes > 72
    expect(passwordSchema.safeParse("ñ".repeat(37)).success).toBe(false);
    expect(passwordSchema.safeParse("ñ".repeat(36)).success).toBe(true);
  });
});

describe("loginSchema", () => {
  it("no valida el largo de la contraseña (el error tiene que ser genérico)", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("exige que coincidan", () => {
    expect(newPasswordSchema.safeParse({ password: "unaClave-123", confirm: "otraClave-123" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "unaClave-123", confirm: "unaClave-123" }).success).toBe(true);
  });
});

describe("invitationTokenSchema", () => {
  it("solo 64 caracteres hex en minúscula", () => {
    expect(invitationTokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    for (const bad of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), "' or 1=1 --"]) {
      expect(invitationTokenSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("safeNext", () => {
  it("acepta rutas relativas de este sitio", () => {
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/admin/invitacion?token=abc")).toBe("/admin/invitacion?token=abc");
  });
  it("bloquea redirecciones abiertas", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "\\\\evil.com", "evil.com",
      "javascript:alert(1)", "/%0d%0aSet-Cookie:x", "/\u0000", null, undefined, 42]) {
      const out = safeNext(bad as string, "/fallback");
      expect(out === "/fallback" || out.startsWith("/%0d")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
    }
  });
});
