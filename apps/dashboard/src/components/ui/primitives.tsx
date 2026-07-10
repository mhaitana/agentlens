/**
 * Small UI primitives (spec §18.1 — clean, minimal, calm; §18.5 accessible).
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
        "rounded-lg border border-[var(--al-border)] bg-[var(--al-surface)] p-4",
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
        "text-sm font-semibold text-[var(--al-text-muted)] uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </h2>
  );
}

type Variant = "primary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[var(--al-accent)] text-white hover:opacity-90",
  ghost: "border border-[var(--al-border)] hover:bg-[var(--al-surface-2)]",
  danger: "border border-red-400/60 text-red-500 hover:bg-red-500/10",
  subtle: "text-[var(--al-text-muted)] hover:text-[var(--al-text)]",
};
const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
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
        "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
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
  neutral: "bg-[var(--al-surface-2)] text-[var(--al-text-muted)] border-[var(--al-border)]",
  info: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  low: "bg-slate-500/10 text-slate-500 border-slate-500/30",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  high: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  critical: "bg-red-500/10 text-red-500 border-red-500/30",
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
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A single labelled metric stat (spec §13.9 overview). */
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
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--al-text-muted)]">{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</span>
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
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--al-border)] border-t-[var(--al-accent)]"
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
      className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500"
    >
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1 break-words">{msg}</p>
    </div>
  );
}

/** Helpful empty state (§18.4). */
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--al-border)] p-8 text-center">
      {icon ? <div className="text-[var(--al-text-muted)]">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <p className="max-w-md text-sm text-[var(--al-text-muted)]">{children}</p> : null}
    </div>
  );
}

/** Provenance tag — communicates how a metric was derived (§3.4). */
export function ProvenanceTag({ provenance }: { provenance: string }) {
  return (
    <span
      className="text-xs text-[var(--al-text-muted)]"
      title={`How this value was derived: ${provenance}`}
    >
      ({provenance})
    </span>
  );
}
