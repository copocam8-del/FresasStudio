import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/** Piezas chicas y reutilizables del panel (pensadas para el celular: 44 px). */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-sans text-[2.1rem] leading-tight font-light text-[#f6e6dc] sm:text-[2.3rem]">{title}</h1>
        {description && <p className="text-[1.02rem] text-foreground/90">{description}</p>}
      </div>
      {action && (
        <Link href={action.href} className={buttonVariants({ className: "px-5" })}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" }) {
  return (
    <span
      className={
        tone === "warn"
          ? "rounded-full border border-[#d4b59d] bg-status-pending px-2.5 py-0.5 text-xs font-medium text-status-pending-foreground"
          : "rounded-full border border-[#4a3f3c] bg-status-neutral px-2.5 py-0.5 text-xs font-medium text-status-neutral-foreground"
      }
    >
      {children}
    </span>
  );
}

/** Botones subir/bajar (en el celular, arrastrar es incómodo). */
export function MoveButtons({
  id,
  action,
  isFirst,
  isLast,
  label,
}: {
  id: string;
  action: (formData: FormData) => Promise<void>;
  isFirst: boolean;
  isLast: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-1">
      {(["up", "down"] as const).map((dir) => (
        <form key={dir} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="dir" value={dir} />
          <Button
            type="submit"
            variant="outline"
            size="icon"
            className="size-11"
            disabled={dir === "up" ? isFirst : isLast}
            aria-label={`${dir === "up" ? "Subir" : "Bajar"} ${label}`}
          >
            {dir === "up" ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          </Button>
        </form>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[1.1rem] border border-dashed border-border bg-[#141010]/70 p-6 text-center text-foreground/80">{children}</p>;
}
