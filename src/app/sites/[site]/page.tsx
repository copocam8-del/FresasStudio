import { notFound } from "next/navigation";
import { contactItems } from "@/lib/contact";
import { getStudio } from "@/lib/studio";

// Página pública de un estudio. Todos los datos son reales (get_public_studio).
export default async function StudioHome({ params }: PageProps<"/sites/[site]">) {
  const { site } = await params;
  const studio = await getStudio(site);
  if (!studio) notFound();

  const contact = contactItems(studio.contact);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <div className="h-px w-12 bg-gold" aria-hidden />
        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">{studio.name}</h1>
        {studio.description && (
          <p className="whitespace-pre-line text-lg text-muted-foreground">{studio.description}</p>
        )}
      </header>

      {contact.length > 0 && (
        <section aria-labelledby="contacto" className="flex flex-col gap-3">
          <h2 id="contacto" className="text-xl font-semibold text-foreground">
            Contacto
          </h2>
          <ul className="flex flex-col gap-2">
            {contact.map((item) => (
              <li key={item.key} className="flex flex-col sm:flex-row sm:gap-2">
                <span className="text-sm text-muted-foreground sm:w-28">{item.label}</span>
                {item.href ? (
                  <a
                    href={item.href}
                    className="text-foreground underline underline-offset-4 hover:text-primary"
                    rel="noopener noreferrer"
                    target={item.href.startsWith("https://") ? "_blank" : undefined}
                  >
                    {item.value}
                  </a>
                ) : (
                  <span className="text-foreground">{item.value}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="politicas" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h2 id="politicas" className="text-xl font-semibold text-card-foreground">
          Seña y cancelaciones
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-card-foreground">
          <li>Para reservar se abona una seña del {studio.deposit_percent}% del total.</li>
          <li>
            Si cancelás o reprogramás con {studio.cancellation_window_hours} horas o más de
            anticipación, conservás la seña.
          </li>
          <li>Con menos anticipación, la seña se pierde.</li>
        </ul>
        {studio.policy_text && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{studio.policy_text}</p>
        )}
      </section>
    </main>
  );
}
