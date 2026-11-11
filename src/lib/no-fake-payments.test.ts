import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * En producción no puede existir ninguna forma de simular un pago (Sprint 4, §7).
 * La simulación vive solo en supabase/seed.sql (que nunca va a producción).
 */
const migrationsDir = join(__dirname, "../../supabase/migrations");
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

describe("sin pagos falsos en producción", () => {
  it.each(migrations)("%s no crea funciones de simulación ni esquemas de desarrollo", (file) => {
    const sql = readFileSync(join(migrationsDir, file), "utf8").toLowerCase();
    expect(sql).not.toMatch(/simulate|simular|create\s+schema\s+(if\s+not\s+exists\s+)?dev\b/);
  });

  it("la simulación existe solo en el seed de desarrollo", () => {
    const seed = readFileSync(join(__dirname, "../../supabase/seed.sql"), "utf8");
    expect(seed).toContain("dev_simulate_deposit_payment");
  });

  it("app.confirm_deposit_payment no se otorga a anon ni a authenticated", () => {
    const sql = migrations.map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
    expect(sql).toMatch(/revoke execute on function app\.confirm_deposit_payment\([^)]*\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant execute on function app\.confirm_deposit_payment\([^)]*\) to [^;]*(anon|authenticated)/);
  });
});
