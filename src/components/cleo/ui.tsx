import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { TileSheen } from "@/components/cleo/silk";

/** Tarjeta de vidrio con título, ícono y enlace opcionales (como "Turnos de hoy"). */
export function GlassCard({
  title,
  icon: Icon,
  more,
  className,
  children,
  as: Tag = "section",
  anchor,
  headerRight,
}: {
  title?: string;
  icon?: LucideIcon;
  more?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
  as?: "section" | "div" | "article";
  /** id para enlazar a la tarjeta (#contacto). */
  anchor?: string;
  headerRight?: React.ReactNode;
}) {
  const id = title ? `card-${title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}` : undefined;
  return (
    <Tag id={anchor} aria-labelledby={id} className={cn("glass relative flex min-w-0 scroll-mt-6 flex-col gap-4 rounded-[1.1rem] p-5 text-card-foreground", className)}>
      {title && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h2 id={id} className="flex items-center gap-3 font-sans text-[1.05rem] font-normal tracking-normal text-foreground">
            {Icon && <Icon aria-hidden strokeWidth={1.4} className="size-[1.6rem] text-gold" />}
            {title}
          </h2>
          {more && (
            <Link href={more.href} className="flex min-h-11 items-center gap-1.5 text-sm text-foreground/90 hover:text-foreground">
              {more.label} <ArrowRight aria-hidden strokeWidth={1.5} className="size-[1.1rem]" />
            </Link>
          )}
          {headerRight}
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
    ok: "bg-status-ok text-status-ok-foreground border-[#6d7a6b]",
    pending: "bg-status-pending text-status-pending-foreground border-[#d4b59d]",
    cancel: "bg-status-cancel text-status-cancel-foreground border-[#8d4d49]",
    neutral: "bg-status-neutral text-status-neutral-foreground border-[#4a3f3c]",
  }[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-[0.2rem] text-[0.78rem] font-medium whitespace-nowrap", tone, className)}>
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

/**
 * Curva de evolución con DATOS REALES (D5): solo se dibuja si hay al menos 3 valores y
 * alguno distinto de cero. Sin ejes: es una señal de tendencia, el número está al lado.
 */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  // Con menos de 3 valores distintos de cero no hay tendencia que mostrar.
  if (values.length < 3 || values.filter((v) => v !== 0).length < 3) return null;
  const w = 150, h = 70;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 6 - ((v - min) / span) * (h - 14)] as const);
  // Curva suave (Catmull-Rom → Bézier)
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden className={cn("pointer-events-none", className)} fill="none" preserveAspectRatio="none">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#cleo-spark-fill)" />
      <path d={d} stroke="url(#cleo-spark-line)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Número real de la base, con su curva real si la hay (D5). */
export function StatCard({
  icon: Icon,
  value,
  label,
  hint,
  series,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  hint?: string;
  series?: number[];
}) {
  return (
    <div className="glass-strong relative flex min-h-[9.8rem] flex-col gap-3 overflow-hidden rounded-[1.1rem] p-5">
      {series && <Sparkline values={series} className="absolute right-0 bottom-0 h-[62%] w-[55%]" />}
      <Icon aria-hidden strokeWidth={1.4} className="relative size-[1.65rem] text-foreground" />
      <div className="relative flex flex-col">
        <span className="text-[1.8rem] leading-tight font-semibold text-foreground tabular-nums">{value}</span>
        <span className="text-[0.95rem] text-foreground/90">{label}</span>
        {hint && <span className="text-[0.8rem] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

/** Tile del inicio de la clienta (ícono, título, bajada y flecha), como en la referencia. */
export function ActionTile({
  href,
  icon: Icon,
  title,
  text,
  sheen = 0,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  text: string;
  sheen?: 0 | 1 | 2 | 3;
}) {
  return (
    <Link
      href={href}
      className="glass group relative flex h-[8.4rem] flex-col justify-between overflow-hidden rounded-[1.4rem] p-4 pl-[1.4rem] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <TileSheen variant={sheen} />
      <Icon aria-hidden strokeWidth={1.25} className="relative mt-1 size-[2.75rem] text-[#f1e1d6]" />
      <span className="relative flex items-end justify-between gap-2">
        {/* El texto nunca pasa por debajo de la flecha ni de los reflejos de la esquina */}
        <span className="flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col">
          <span className="text-[1.02rem] leading-snug font-semibold text-foreground min-[400px]:text-[1.1rem]">{title}</span>
          <span className="text-[0.88rem] leading-snug text-[#e4d8d0]">{text}</span>
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#5b4d48] bg-[#2a2324]/90">
          <ChevronRight aria-hidden strokeWidth={1.8} className="size-4 text-foreground" />
        </span>
      </span>
    </Link>
  );
}

/** Título de página (sans liviana, como "Panel Administrativo"), con bajada y acción opcional. */
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
        <h1 className="font-sans text-[2.1rem] leading-tight font-light tracking-normal text-[#f6e6dc] sm:text-[2.3rem]">{title}</h1>
        {description && <p className="text-[1.05rem] text-foreground/90">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Avatar redondo con iniciales (no hay fotos de clientas). */
export function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "·";
  return (
    <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-full border border-[#4a3d39] bg-[radial-gradient(circle_at_30%_25%,#5a4841,#241c1a)] text-sm font-medium text-[#efdcd0]", className)}>
      {initials}
    </span>
  );
}
