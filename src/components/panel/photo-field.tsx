import { Label } from "@/components/ui/label";

/** Campo de foto (PNG/JPG/WebP, 1 MB) con la actual y la opción de quitarla. */
export function PhotoField({
  currentUrl,
  label,
  note,
}: {
  currentUrl: string | null;
  label: string;
  note?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-card-foreground">{label}</legend>
      {currentUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt="" className="h-24 w-24 rounded-lg border object-cover" />
      )}
      <Label htmlFor="photo" className="sr-only">
        {currentUrl ? "Reemplazar foto" : "Subir foto"}
      </Label>
      <input
        id="photo"
        name="photo"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-describedby="photo-hint"
        className="text-sm text-card-foreground file:mr-3 file:h-11 file:rounded-lg file:border file:border-input file:bg-secondary file:px-4 file:text-secondary-foreground"
      />
      <p id="photo-hint" className="text-sm text-muted-foreground">
        Opcional. PNG, JPG o WebP de hasta 1 MB.{note ? ` ${note}` : ""}
      </p>
      {currentUrl && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-card-foreground">
          <input type="checkbox" name="remove_photo" className="size-5" />
          Quitar la foto
        </label>
      )}
    </fieldset>
  );
}
