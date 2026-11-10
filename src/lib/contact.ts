/**
 * Datos de contacto de un estudio (tenant_settings.contact, jsonb libre) → items para
 * mostrar. Solo se usan claves conocidas y valores válidos; los links se arman acá
 * con partes validadas, nunca copiando una URL que venga de la base.
 */
export type ContactItem = { key: string; label: string; value: string; href?: string };

const MAX = 200;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function contactItems(contact: Record<string, unknown> | null | undefined): ContactItem[] {
  if (!contact || typeof contact !== "object") return [];
  const items: ContactItem[] = [];

  const address = str(contact.address);
  if (address && address.length <= MAX) {
    items.push({
      key: "address",
      label: "Dirección",
      value: address,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    });
  }

  const whatsapp = str(contact.whatsapp);
  const waDigits = whatsapp.replace(/[\s()+-]/g, "");
  if (/^\d{8,15}$/.test(waDigits)) {
    items.push({ key: "whatsapp", label: "WhatsApp", value: whatsapp, href: `https://wa.me/${waDigits}` });
  }

  const phone = str(contact.phone);
  if (/^\+?[0-9 ()-]{6,30}$/.test(phone)) {
    const digits = phone.replace(/[^\d+]/g, "");
    items.push({ key: "phone", label: "Teléfono", value: phone, href: `tel:${digits}` });
  }

  const instagram = str(contact.instagram).replace(/^@/, "");
  if (/^[A-Za-z0-9._]{1,30}$/.test(instagram)) {
    items.push({
      key: "instagram",
      label: "Instagram",
      value: `@${instagram}`,
      href: `https://www.instagram.com/${instagram}/`,
    });
  }

  const email = str(contact.email).toLowerCase();
  if (email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    items.push({ key: "email", label: "Email", value: email, href: `mailto:${email}` });
  }

  return items;
}
