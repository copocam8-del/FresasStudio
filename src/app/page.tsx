import type { Metadata } from "next";
import { CleoLogo } from "@/components/cleo/brand";
import { SilkHero, SilkSidebar, Sparkle } from "@/components/cleo/silk";
import { WelcomeSplash } from "@/components/cleo/welcome";

// Sitio de la plataforma (cleo.com.ar), con el logo completo de Cleo.
export const metadata: Metadata = {
  title: "Cleo",
  description: "Gestión, reservas y pagos para estudios de belleza.",
};

const FEATURES = [
  { title: "Tu sitio y tus reservas", text: "Cada estudio con su sitio: las clientas eligen servicio, profesional y horario." },
  { title: "Señas con Mercado Pago", text: "La seña se cobra en la cuenta del estudio y el turno se confirma solo." },
  { title: "Tu panel", text: "Turnos, servicios, profesionales, horarios, equipo y pagos en un solo lugar." },
];

export default function CleoHome() {
  return (
    <div className="relative isolate flex flex-1 flex-col overflow-x-clip">
      <WelcomeSplash><CleoLogo className="h-[9rem]" /></WelcomeSplash>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent)]">
        <SilkHero />
      </div>
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 -z-10 h-[420px] w-[236px] overflow-hidden opacity-70 [mask-image:linear-gradient(to_top,black_30%,transparent)]">
        <SilkSidebar />
      </div>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-[1.4rem] py-16 text-center">
        <CleoLogo className="h-[9.5rem] sm:h-[11rem]" />
        <div className="relative flex flex-col items-center gap-3">
          <Sparkle className="absolute -top-6 -right-8 size-8" />
          <h1 className="font-sans text-[2.2rem] leading-tight font-light text-[#f6e6dc] sm:text-[2.8rem]">
            Gestión, reservas y pagos para estudios de belleza
          </h1>
          <p className="max-w-xl text-[1.05rem] text-foreground/90">
            Cada estudio con su propio sitio, su marca y su panel.
          </p>
        </div>
        <ul className="grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="glass flex flex-col gap-2 rounded-[1.25rem] p-5">
              <span className="font-medium text-foreground">{f.title}</span>
              <span className="text-sm text-foreground/85">{f.text}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
