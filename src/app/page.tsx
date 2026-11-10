import type { Metadata } from "next";

// Sitio de la plataforma (cleo.com.ar). Es el único lugar público con la marca Cleo.
export const metadata: Metadata = {
  title: "Cleo",
  description: "Gestión, reservas y pagos para estudios de belleza.",
};

export default function CleoHome() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="h-px w-16 bg-gold" aria-hidden />
      <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">Cleo</h1>
      <p className="text-lg text-muted-foreground">
        Gestión, reservas y pagos para estudios de belleza. Cada estudio con su propio sitio,
        su marca y su panel.
      </p>
    </main>
  );
}
