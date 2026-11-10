import { StudioLogo } from "@/components/brand/studio-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Marco de las pantallas de acceso. `brandName` es el nombre del estudio (marca
 * blanca) o "Cleo Admin" en la plataforma.
 */
export function AuthShell({
  brandName,
  logoUrl = null,
  title,
  description,
  children,
}: {
  brandName: string;
  logoUrl?: string | null;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3">
        <StudioLogo src={logoUrl} name={brandName} />
        <p className="text-center text-lg font-semibold text-foreground">{brandName}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{title}</h1>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </main>
  );
}
