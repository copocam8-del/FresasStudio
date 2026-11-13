import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/cleo/ui";
import { ClientContactForm } from "@/components/panel/client-forms";
import { requirePermission } from "@/lib/auth";

export const metadata: Metadata = { title: "Nueva clienta" };

export default async function NewClientPage({ params }: PageProps<"/sites/[site]/admin/clientas/nueva">) {
  const { site } = await params;
  await requirePermission(site, "clients.manage", "/admin/clientas/nueva");
  return (
    <>
      <Link href="/admin/clientas" className="text-sm text-foreground underline underline-offset-4">← Clientas</Link>
      <PageTitle title="Nueva clienta" description="Con un teléfono o un email alcanza para empezar." />
      <section className="glass max-w-xl rounded-[1.1rem] p-5">
        <ClientContactForm />
      </section>
    </>
  );
}
