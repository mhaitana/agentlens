/**
 * Shared formatting helpers for report renderers (spec §13.7).
 *
 * Every metric is a {@link ProvenancedValue}; these helpers render the value
 * with an honest provenance tag (e.g. "estimated") and a dash for unknowns, so
 * a report never presents an estimate as a measured value (§3.4).
 */

import pc from "picocolors";
import type {
  AnalyticsSnapshot,
  ProvenancedValue,
  MetricProvenance,
  Recommendation,
} from "@agentlens/domain";

/** The mandatory cost-estimate disclaimer (§13.6). */
export const COST_ESTIMATE_LABEL = "Estimated — not an official billing value";

/** Format an integer-ish number with thousands separators. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (Number.isNaN(value)) return "—";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Format a millisecond duration as a compact human string. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

/** Format a USD amount, preserving null. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toFixed(4)}`;
}

/** Short provenance tag shown next to non-exact values. */
export function provenanceTag(provenance: MetricProvenance): string {
  if (provenance === "exact") return "";
  return ` (${provenance})`;
}

/**
 * Render a {@link ProvenancedValue} as "value (provenance)" — provenance shown
 * only when the value is not exact, so measured numbers read cleanly and
 * estimates/inferences are flagged.
 */
export function formatPv<T extends number | null>(
  pv: ProvenancedValue<T>,
  format: (v: T) => string = (v) => (typeof v === "number" ? formatNumber(v) : "—"),
): string {
  if (pv.value === null || pv.value === undefined) {
    return pc.dim("—");
  }
  const body = format(pv.value);
  const tag = provenanceTag(pv.provenance);
  return tag ? `${body}${pc.dim(tag)}` : body;
}

/** Render a nullable count PV with a unit suffix. */
export function formatPvCount(pv: ProvenancedValue<number | null>): string {
  return formatPv(pv, (v) => formatNumber(v));
}

/** Describe the report window from the filters (e.g. "last 7 days", "all time"). */
export function describePeriod(snapshot: AnalyticsSnapshot): string {
  const period = snapshot.filters.period;
  const labels: Record<string, string> = {
    day: "last 24 hours",
    week: "last 7 days",
    month: "last 30 days",
    all: "all time",
  };
  if (snapshot.filters.sessionId) return `session ${snapshot.filters.sessionId}`;
  if (snapshot.filters.projectId)
    return `${labels[period] ?? period} · project ${snapshot.filters.projectId}`;
  return labels[period] ?? period;
}

/** Title-case a kebab/snake word for section headers. */
export function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The list of §13.7 report sections, in display order. */
export const REPORT_SECTIONS = [
  "Summary",
  "Usage",
  "Most important findings",
  "Verification quality",
  "Tool efficiency",
  "Data completeness",
  "Top recommendations",
  "Privacy mode",
  "Scan provenance",
] as const;

/** Format the cost line, always carrying the mandatory disclaimer. */
export function costLine(snapshot: AnalyticsSnapshot): string {
  const usd = snapshot.cost.totalUsd.value;
  if (usd === null || usd === undefined) {
    return `${pc.dim("—")} ${pc.dim(`(${COST_ESTIMATE_LABEL})`)}`;
  }
  return `${formatUsd(usd)} ${pc.dim(`(${COST_ESTIMATE_LABEL})`)}`;
}

/** Summarise a recommendation as a single line (for the findings section). */
export function recommendationLine(rec: Recommendation): string {
  const sev = rec.severity;
  return `[${sev}] ${rec.title} — ${rec.summary}`;
}
