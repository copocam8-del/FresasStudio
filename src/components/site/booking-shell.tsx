import Link from "next/link";
import { StudioLogo } from "@/components/brand/studio-logo";
import type { PublicStudio } from "@/lib/studio";
import { studioLogo } from "@/lib/studio-brand";

const STEPS = ["Servicio", "Profesional", "Día y hora", "Confirmar"];

/** Marco del flujo de reserva (marca del estudio, pasos y botón "atrás"). */
export function BookingShell({
  studio,
  step,
  title,
  back,
  children,
}: {
  studio: PublicStudio;
  step: 1 | 2 | 3 | 4;
  title: string;
  back?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <StudioLogo src={studioLogo(studio)} name={studio.name} className="h-8" />
          {studio.name}
        </Link>
        {back && (
          <Link href={back} className="rounded-lg px-3 py-2 text-sm text-foreground underline underline-offset-4">
            ← Atrás
          </Link>
        )}
      </header>
      <ol aria-label="Pasos de la reserva" className="flex gap-1">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i + 1 === step ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full ${i + 1 <= step ? "bg-primary" : "bg-muted"}`}
          >
            <span className="sr-only">
              Paso {i + 1} de {STEPS.length}: {s}
            </span>
          </li>
        ))}
      </ol>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {children}
    </main>
  );
}
