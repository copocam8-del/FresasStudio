import { BrandLarge, CleoLogo, type BrandInfo } from "@/components/cleo/brand";
import { SilkHero, SilkSidebar } from "@/components/cleo/silk";

/**
 * Marco de las pantallas de acceso (ingresar, panel, recuperar, invitación, mis datos y
 * Cleo Admin). Marca: la del estudio según su configuración (Cleo por defecto) o, en la
 * plataforma, el logo de Cleo con "Admin".
 */
export function AuthShell({
  brand,
  title,
  description,
  children,
}: {
  brand: BrandInfo | "platform";
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate flex flex-1 flex-col overflow-x-clip">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_72%,transparent)]">
        <SilkHero />
      </div>
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 -z-10 h-[420px] w-[236px] overflow-hidden opacity-70 [mask-image:linear-gradient(to_top,black_30%,transparent),linear-gradient(to_left,transparent,black_35%)] [mask-composite:intersect]">
        <SilkSidebar />
      </div>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-[1.4rem] py-10">
        <div className="flex flex-col items-center gap-2">
          {brand === "platform" ? (
            <>
              <CleoLogo className="h-[6.2rem]" />
              <span className="text-xs tracking-[0.35em] text-[#cdbab0] uppercase">Admin</span>
            </>
          ) : (
            <BrandLarge brand={brand} align="center" />
          )}
        </div>
        <section aria-labelledby="auth-title" className="glass flex flex-col gap-5 rounded-[1.4rem] p-6">
          <div className="flex flex-col gap-1.5">
            <h1 id="auth-title" className="font-sans text-[1.75rem] leading-tight font-light text-[#f6e6dc]">{title}</h1>
            {description && <div className="text-[0.95rem] text-foreground/85">{description}</div>}
          </div>
          <div className="flex flex-col gap-4">{children}</div>
        </section>
      </main>
    </div>
  );
}
