/**
 * Small UI primitives (spec— clean, minimal, calm;).
 * One file for the trivial building blocks so features compose them without a
 * dozen tiny modules.
 */
import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

/** Card surface. */
export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--al-border)] bg-[var(--al-bg-elevated)] p-[var(--al-space-5)] shadow-[var(--al-shadow-sm)] transition-shadow !rounded-[var(--al-radius-lg)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "text-xs font-semibold uppercase tracking-wide text-[var(--al-text-muted)]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("mb-[var(--al-space-3)] flex items-center gap-[var(--al-space-2)]", className)}
    >
      {children}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--al-accent)] text-[var(--al-text-inverted)] hover:bg-[var(--al-accent-hover)] shadow-[var(--al-shadow-sm)]",
  secondary:
    "bg-[var(--al-bg-inset)] text-[var(--al-text)] border border-[var(--al-border)] hover:bg-[var(--al-bg-hover)]",
  ghost:
    "border border-[var(--al-border)] text-[var(--al-text)] hover:bg-[var(--al-bg-hover)] hover:border-[var(--al-border-strong)]",
  danger:
    "border border-[var(--al-danger)]/50 text-[var(--al-danger)] hover:bg-[var(--al-danger-weak)]",
  subtle:
    "text-[var(--al-text-secondary)] hover:text-[var(--al-text)] hover:bg-[var(--al-bg-hover)]",
};
const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--al-radius-md)] font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "info" | "low" | "medium" | "high" | "critical" | "accent";
const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--al-bg-inset)] text-[var(--al-text-secondary)] border-[var(--al-border)]",
  info: "bg-[var(--al-info-weak)] text-[var(--al-info)] border-[var(--al-info)]/30",
  low: "bg-[var(--al-bg-inset)] text-[var(--al-text-muted)] border-[var(--al-border)]",
  medium: "bg-[var(--al-warning-weak)] text-[var(--al-warning)] border-[var(--al-warning)]/30",
  high: "bg-[var(--al-warning-weak)] text-[var(--al-warning)] border-[var(--al-warning)]/30",
  critical: "bg-[var(--al-danger-weak)] text-[var(--al-danger)] border-[var(--al-danger)]/30",
  accent: "bg-[var(--al-accent-weak)] text-[var(--al-accent)] border-transparent",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--al-radius-full)] border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A single labelled metric stat (spec). */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
}) {
  return (
    <Card className="flex flex-col justify-between gap-1">
      <span className="text-xs font-medium text-[var(--al-text-muted)]">{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone)}>
        {value}
      </span>
      {hint ? <span className="text-xs text-[var(--al-text-muted)]">{hint}</span> : null}
    </Card>
  );
}

/** Loading spinner. */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2 text-[var(--al-text-muted)]"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--al-border-strong)] border-t-[var(--al-accent)]"
        aria-hidden="true"
      />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

/** Error display with the API code + message. */
export function ErrorState({ error }: { error: unknown }) {
  const msg =
    error instanceof Error ? `${error.name}: ${error.message}` : "An unexpected error occurred.";
  return (
    <div
      role="alert"
      className="rounded-[var(--al-radius-lg)] border border-[var(--al-danger)]/40 bg-[var(--al-danger-weak)] p-4 text-sm text-[var(--al-danger)]"
    >
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1 break-words">{msg}</p>
    </div>
  );
}

/** Helpful empty state. */
export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--al-radius-lg)] border border-dashed border-[var(--al-border)] bg-[var(--al-bg-inset)] p-8 text-center">
      {icon ? <div className="text-[var(--al-text-muted)]">{icon}</div> : null}
      <p className="text-sm font-medium text-[var(--al-text)]">{title}</p>
      {children ? <p className="max-w-md text-sm text-[var(--al-text-muted)]">{children}</p> : null}
    </div>
  );
}

/** Provenance tag — communicates how a metric was derived. */
export function ProvenanceTag({ provenance }: { provenance: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-[var(--al-text-muted)]"
      title={`How this value was derived: ${provenance}`}
    >
      <span className="inline-block h-1 w-1 rounded-full bg-[var(--al-text-muted)]" />
      {provenance}
    </span>
  );
}
