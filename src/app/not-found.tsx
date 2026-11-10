import type { Metadata } from "next";

// 404 neutra: puede mostrarse en el sitio de cualquier estudio, así que no lleva
// ninguna marca (ni Cleo ni de un estudio).
export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Página no encontrada</h1>
      <p className="text-muted-foreground">
        La dirección no existe o ya no está disponible. Revisá que esté bien escrita.
      </p>
    </main>
  );
}
