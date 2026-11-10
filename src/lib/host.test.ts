import { describe, expect, it } from "vitest";
import { classifyHost, isInternalPath, normalizeHost, rewritePath, siteKeyFromParam } from "./host";

const PROD = "cleo.com.ar";
const LOCAL = "localhost:3000";

describe("normalizeHost", () => {
  it("pasa a minúsculas y quita puerto y punto final", () => {
    expect(normalizeHost("Fresas.Cleo.com.ar")).toBe("fresas.cleo.com.ar");
    expect(normalizeHost("fresas.localhost:3000")).toBe("fresas.localhost");
    expect(normalizeHost("fresas.cleo.com.ar.")).toBe("fresas.cleo.com.ar");
  });

  it("rechaza vacíos, IPs y caracteres inválidos", () => {
    for (const bad of [null, undefined, "", "127.0.0.1", "127.0.0.1:3000", "[::1]:3000",
      "a..b.com", "-a.com", "a-.com", "fre_sas.cleo.com.ar", "fresas cleo.com.ar",
      "evil.com/path", "evil.com@cleo.com.ar", "a".repeat(64) + ".com"]) {
      expect(normalizeHost(bad as string)).toBeNull();
    }
  });
});

describe("classifyHost (producción)", () => {
  it("dominio raíz, www y previews de Vercel → sitio de Cleo", () => {
    expect(classifyHost("cleo.com.ar", PROD)).toEqual({ kind: "root" });
    expect(classifyHost("www.cleo.com.ar", PROD)).toEqual({ kind: "root" });
    expect(classifyHost("cleo-git-main-x.vercel.app", PROD)).toEqual({ kind: "root" });
  });

  it("admin.cleo.com.ar → Cleo Admin", () => {
    expect(classifyHost("admin.cleo.com.ar", PROD)).toEqual({ kind: "platform" });
    expect(classifyHost("ADMIN.cleo.com.ar:443", PROD)).toEqual({ kind: "platform" });
  });

  it("{slug}.cleo.com.ar → sitio del estudio", () => {
    expect(classifyHost("fresas.cleo.com.ar", PROD)).toEqual({ kind: "site", slug: "fresas" });
    expect(classifyHost("Estudio-Prueba.cleo.com.ar", PROD)).toEqual({ kind: "site", slug: "estudio-prueba" });
  });

  it("subdominios inválidos → 404", () => {
    for (const host of ["a.b.cleo.com.ar", "xn--abc.cleo.com.ar", "ab.cleo.com.ar".replace("ab", "a"),
      "-fresas.cleo.com.ar", "fresas-.cleo.com.ar"]) {
      expect(classifyHost(host, PROD)).toEqual({ kind: "invalid" });
    }
  });

  it("otros dominios → posible dominio propio", () => {
    expect(classifyHost("turnos.fresasstudio.com", PROD)).toEqual({ kind: "custom", domain: "turnos.fresasstudio.com" });
    expect(classifyHost("fresasstudio.com.ar", PROD)).toEqual({ kind: "custom", domain: "fresasstudio.com.ar" });
  });

  it("no confunde dominios que solo contienen la raíz", () => {
    // termina en "cleo.com.ar" pero no es un subdominio de la plataforma
    expect(classifyHost("evilcleo.com.ar", PROD)).toEqual({ kind: "custom", domain: "evilcleo.com.ar" });
    expect(classifyHost("cleo.com.ar.evil.com", PROD)).toEqual({ kind: "custom", domain: "cleo.com.ar.evil.com" });
  });

  it("hosts sin TLD válido, IPs o vacíos → 404", () => {
    for (const host of ["intranet", "10.0.0.1", "", null, "foo.123"]) {
      expect(classifyHost(host, PROD)).toEqual({ kind: "invalid" });
    }
  });
});

describe("classifyHost (local)", () => {
  it("usa localhost como raíz", () => {
    expect(classifyHost("localhost:3000", LOCAL)).toEqual({ kind: "root" });
    expect(classifyHost("admin.localhost:3000", LOCAL)).toEqual({ kind: "platform" });
    expect(classifyHost("fresas.localhost:3000", LOCAL)).toEqual({ kind: "site", slug: "fresas" });
    expect(classifyHost("estudio-prueba.localhost:3000", LOCAL)).toEqual({ kind: "site", slug: "estudio-prueba" });
  });
});

describe("rewritePath", () => {
  it("reescribe a las rutas internas", () => {
    expect(rewritePath({ kind: "root" }, "/")).toBe("/");
    expect(rewritePath({ kind: "platform" }, "/")).toBe("/platform");
    expect(rewritePath({ kind: "platform" }, "/login")).toBe("/platform/login");
    expect(rewritePath({ kind: "site", slug: "fresas" }, "/")).toBe("/sites/fresas");
    expect(rewritePath({ kind: "site", slug: "fresas" }, "/admin/equipo")).toBe("/sites/fresas/admin/equipo");
    expect(rewritePath({ kind: "custom", domain: "turnos.fresas.com" }, "/mi-ficha")).toBe("/sites/turnos.fresas.com/mi-ficha");
  });

  it("bloquea el acceso directo a las rutas internas desde cualquier host", () => {
    for (const kind of [{ kind: "root" }, { kind: "platform" }, { kind: "site", slug: "fresas" }] as const) {
      expect(rewritePath(kind, "/sites/estudio-prueba")).toBeNull();
      expect(rewritePath(kind, "/sites")).toBeNull();
      expect(rewritePath(kind, "/platform")).toBeNull();
      expect(rewritePath(kind, "/platform/login")).toBeNull();
    }
    expect(rewritePath({ kind: "invalid" }, "/")).toBeNull();
  });

  it("no confunde rutas que solo empiezan parecido", () => {
    expect(isInternalPath("/sitesmap")).toBe(false);
    expect(isInternalPath("/platformas")).toBe(false);
    expect(rewritePath({ kind: "root" }, "/sitesmap")).toBe("/sitesmap");
  });
});

describe("siteKeyFromParam", () => {
  it("slug sin puntos, dominio con puntos", () => {
    expect(siteKeyFromParam("fresas")).toEqual({ by: "slug", slug: "fresas" });
    expect(siteKeyFromParam("turnos.fresas.com")).toEqual({ by: "domain", domain: "turnos.fresas.com" });
  });

  it("rechaza valores inválidos", () => {
    for (const bad of ["x", "xn--abc", "../admin", "fresas%2F..", "127.0.0.1", "a..b"]) {
      expect(siteKeyFromParam(bad)).toBeNull();
    }
  });
});
