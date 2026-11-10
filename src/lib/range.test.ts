import { describe, expect, it } from "vitest";
import { parseTstzRange } from "./range";

describe("parseTstzRange", () => {
  it("lee el formato de Postgres en UTC y con otros husos", () => {
    expect(parseTstzRange('["2026-12-08 03:00:00+00","2026-12-09 03:00:00+00")')).toEqual({
      starts_at: "2026-12-08T03:00:00.000Z",
      ends_at: "2026-12-09T03:00:00.000Z",
    });
    expect(parseTstzRange('["2026-12-08 00:00:00-03","2026-12-09 00:00:00-03")').starts_at).toBe("2026-12-08T03:00:00.000Z");
    expect(parseTstzRange('["2026-12-08 00:00:00.5+05:30","2026-12-08 01:00:00+05:30")').starts_at).toBe("2026-12-07T18:30:00.500Z");
  });
  it("rechaza rangos sin extremos o mal formados", () => {
    for (const bad of ['["2026-12-08 03:00:00+00",)', "empty", "", '["x","y")']) {
      expect(() => parseTstzRange(bad)).toThrow();
    }
  });
});
