import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

/** Tarjeta de vidrio con título, ícono y enlace opcionales. */
export function GlassCard({
  title,
  icon: Icon,
  more,
  className,
  children,
  as: Tag = "section",
  anchor,
}: {
  title?: string;
  icon?: LucideIcon;
  more?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
  as?: "section" | "div" | "article";
  /** id para enlazar a la tarjeta (#contacto). */
  anchor?: string;
}) {
  const id = title ? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
  return (
    <Tag id={anchor} aria-labelledby={id} className={cn("glass flex min-w-0 scroll-mt-6 flex-col gap-4 rounded-[1.25rem] p-5 text-card-foreground", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3">
          <h2 id={id} className="flex items-center gap-2.5 font-sans text-base font-medium tracking-normal">
            {Icon && <Icon aria-hidden strokeWidth={1.5} className="size-5 text-gold" />}
            {title}
          </h2>
          {more && (
            <Link href={more.href} className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {more.label} <ArrowRight aria-hidden strokeWidth={1.5} className="size-4" />
            </Link>
          )}
        </div>
      )}
      {children}
    </Tag>
  );
}

export type Status = "ok" | "pending" | "cancel" | "neutral";

/** Pastilla de estado: Confirmado (verde), Pendiente (champagne), Cancelado (rojo), neutro. */
export function StatusPill({ status, children, className }: { status: Status; children: React.ReactNode; className?: string }) {
  const tone = {
    ok: "bg-status-ok text-status-ok-foreground",
    pending: "bg-status-pending text-status-pending-foreground",
    cancel: "bg-status-cancel text-status-cancel-foreground",
    neutral: "bg-status-neutral text-status-neutral-foreground",
  }[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", tone, className)}>
      {children}
    </span>
  );
}

/** Estado de una reserva → tono de pastilla. */
export function appointmentTone(status: string): Status {
  if (status === "confirmed") return "ok";
  if (status === "pending_payment") return "pending";
  if (status === "cancelled" || status === "expired") return "cancel";
  return "neutral";
}

/** Número real de la base (D5): sin porcentajes ni curvas inventadas. */
export function StatCard({ icon: Icon, value, label, hint }: { icon: LucideIcon; value: string; label: string; hint?: string }) {
  return (
    <div className="glass flex flex-col gap-3 rounded-[1.25rem] p-4 sm:p-5">
      <Icon aria-hidden strokeWidth={1.5} className="size-6 text-gold" />
      <div className="flex flex-col">
        <span className="font-serif text-[2.1rem] leading-none font-semibold text-foreground">{value}</span>
        <span className="mt-1 text-sm text-muted-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

/** Tile del inicio de la clienta (ícono, título, bajada y flecha). */
export function ActionTile({ href, icon: Icon, title, text }: { href: string; icon: LucideIcon; title: string; text: string }) {
  return (
    <Link
      href={href}
      className="glass group relative flex min-h-36 flex-col justify-between gap-4 overflow-hidden rounded-[1.25rem] p-4 transition-colors hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="absolute -right-10 -bottom-12 size-32 rounded-full border border-gold/20 bg-gold/5" />
      <Icon aria-hidden strokeWidth={1.25} className="size-9 text-gold" />
      <span className="flex items-end justify-between gap-2">
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{title}</span>
          <span className="text-sm leading-snug text-muted-foreground">{text}</span>
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background/60">
          <ChevronRight aria-hidden strokeWidth={1.5} className="size-4 text-foreground" />
        </span>
      </span>
    </Link>
  );
}

/** Título de página en serif, con bajada y acción opcional. */
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-[2.25rem] leading-[1.05] font-semibold text-foreground sm:text-[2.6rem]">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
