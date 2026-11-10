import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { isPlatformAdmin } from "@/lib/auth";
import { PlatformLoginForm } from "./platform-login-form";

export const metadata: Metadata = { title: "Ingresar · Cleo Admin", robots: { index: false } };

export default async function PlatformLoginPage() {
  if (await isPlatformAdmin()) redirect("/");
  return (
    <AuthShell brandName="Cleo Admin" title="Ingresar">
      <PlatformLoginForm />
    </AuthShell>
  );
}
