import type { Metadata } from "next";

// Cleo Admin (admin.cleo.com.ar). El login y el control de acceso llegan en el paso 6;
// hasta entonces no muestra ningún dato.
export const metadata: Metadata = { title: "Cleo Admin" };

export default function PlatformHome() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Cleo Admin</h1>
      <p className="text-muted-foreground">Panel de administración de la plataforma.</p>
    </main>
  );
}
