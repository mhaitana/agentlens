/**
 * Composite widgets: confidence display (§18.3), pagination, form fields.
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { confidenceBand, confidenceLabel } from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import { Badge, Button } from "./primitives.js";

// Re-export primitives that features commonly grab alongside widgets.
export { Badge, Button };

/** Confidence pill + numeric score, severity never colour-alone (§18.5). */
export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const band = confidenceBand(confidence);
  const tone = band === "high" ? "low" : band === "moderate" ? "medium" : "high";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone}>{confidenceLabel(band)}</Badge>
      <span
        className="text-xs tabular-nums text-[var(--al-text-muted)]"
        aria-label="numeric confidence score"
      >
        {Math.round(confidence * 100)}%
      </span>
    </span>
  );
}

/** Pagination control with prev/next + page indicator. */
export function Pagination({
  page,
  hasMore,
  total,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-[var(--al-text-muted)]">
      <span>
        Page {page} · {total.toLocaleString()} total
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasMore}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Labelled input field. */
export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--al-text-secondary)]">
        {label}
      </label>
      {children}
      {hint ? <span className="text-xs text-[var(--al-text-muted)]">{hint}</span> : null}
    </div>
  );
}

const inputClass =
  "rounded-[var(--al-radius-md)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)] px-3 py-2 text-sm text-[var(--al-text)] placeholder:text-[var(--al-text-muted)] focus:border-[var(--al-accent)] focus:ring-2 focus:ring-[var(--al-accent)]/20 focus:outline-none transition-all";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, "min-w-32", props.className)} />;
}

/** A confirmation modal for destructive actions (§8 purge). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--al-bg-base)]/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.currentTarget === e.target) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-[var(--al-radius-xl)] border border-[var(--al-border)] bg-[var(--al-bg-elevated)] p-5 shadow-[var(--al-shadow-lg)]">
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-[var(--al-text-secondary)]">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
