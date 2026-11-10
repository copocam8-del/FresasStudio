import { describe, expect, it } from "vitest";
import { contactItems } from "./contact";

describe("contactItems", () => {
  it("arma links seguros para cada dato válido", () => {
    const items = contactItems({
      address: "Av. Siempre Viva 742, CABA",
      whatsapp: "+54 9 11 5555-1234",
      phone: "011 4555-1234",
      instagram: "@fresas.studio",
      email: "Hola@Fresas.test",
    });
    expect(items.map((i) => i.key)).toEqual(["address", "whatsapp", "phone", "instagram", "email"]);
    expect(items.find((i) => i.key === "whatsapp")?.href).toBe("https://wa.me/5491155551234");
    expect(items.find((i) => i.key === "instagram")?.href).toBe("https://www.instagram.com/fresas.studio/");
    expect(items.find((i) => i.key === "email")?.href).toBe("mailto:hola@fresas.test");
    expect(items.find((i) => i.key === "address")?.href).toContain("query=Av.%20Siempre%20Viva%20742%2C%20CABA");
  });

  it("ignora claves desconocidas, tipos raros y valores inválidos", () => {
    expect(contactItems({ web: "https://evil.test", whatsapp: 123, instagram: "a b", email: "no-es-email" })).toEqual([]);
    expect(contactItems(null)).toEqual([]);
  });

  it("no deja pasar intentos de inyectar URLs o scripts", () => {
    const items = contactItems({
      instagram: "javascript:alert(1)",
      whatsapp: "javascript:alert(1)",
      phone: "tel:+54 11\" onclick=\"x",
      email: "a@b.c\" onmouseover=\"x",
    });
    expect(items).toEqual([]);
  });
});
