/**
 * Display formatters (spec §3.4 honest metrics, §13.6 cost provenance).
 *
 * Honest-metrics rule: an estimate is never presented as a measured value.
 * Cost is *always* labelled "Estimated — not an official billing value"
 * (§3.4). Provenance tags communicate exact/reported/inferred/estimated/
 * heuristic/unknown so users can judge reliability.
 */
import { confidenceBand } from "@agentlens/domain";
import type { ConfidenceBand, MetricProvenance, ProvenancedValue } from "@agentlens/domain";

export { confidenceBand };
export type { ConfidenceBand };

/** Compact integer formatting (1234 → "1,234"; null → "—"). */
export function formatNumber(n: number | null | undefined, fallback = "—"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Token counts (large → compact, e.g. 1.2M). */
export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return formatNumber(n);
}

/** USD cost, always flagged as estimated (§3.4). */
export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** The mandatory estimate caveat for any cost figure (§3.4). */
export const COST_ESTIMATE_LABEL = "Estimated — not an official billing value";

/** Duration in ms → human ("12m 34s", "1h 5m", "45s"). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Percentage 0..1 → "87%" (null → "—"). */
export function formatPct(rate: number | null | undefined, fallback = "—"): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return fallback;
  return `${Math.round(rate * 100)}%`;
}

/** ISO timestamp → "Jul 9, 14:30" (local, short). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO date → "2026-07-09". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** Relative time ("3h ago"). */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

const PROVENANCE_LABELS: Record<MetricProvenance, string> = {
  exact: "exact",
  reported: "reported",
  inferred: "inferred",
  estimated: "estimated",
  heuristic: "heuristic",
  unknown: "unknown",
};

/** Short label for a provenance kind. */
export function provenanceLabel(p: MetricProvenance | undefined): string {
  return p ? (PROVENANCE_LABELS[p] ?? "unknown") : "unknown";
}

/** A ProvenancedValue rendered with its provenance hint, e.g. "1,234 (exact)". */
export function formatProvenanced<T>(
  pv: ProvenancedValue<T> | null | undefined,
  fmt: (v: T) => string,
  fallback = "—",
): string {
  if (!pv || pv.value === null || pv.value === undefined) return fallback;
  return fmt(pv.value);
}

/** Confidence band display (§18.3): "High/Moderate/Low confidence". */
export function confidenceLabel(band: ConfidenceBand): string {
  return `${band.charAt(0).toUpperCase() + band.slice(1)} confidence`;
}

/** Escape user-controlled text before injecting (§19.4). React already escapes
 * text content, so this is only needed when dangerouslySetInnerHTML is used —
 * which the dashboard avoids. Kept for completeness/documentation. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
