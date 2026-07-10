/**
 * Shared helpers for the deterministic recommendation rules (spec §13.10).
 *
 * Rules are pure functions over an {@link AnalysisContext}: they read only the
 * normalised snapshot, resolve thresholds from config, and emit at most one
 * candidate each (one finding per rule per scope — §15.2 "avoid flooding").
 * Confidence is always a deterministic function of the evidence.
 */
import type {
  AnalysisContext,
  Confidence,
  ProvenancedValue,
  RecommendationCandidate,
  RecommendationEvidence,
  Remediation,
  RuleScope,
  Severity,
} from "@agentlens/domain";

/** Resolve a numeric threshold from config overrides, falling back to default. */
export function threshold(ctx: AnalysisContext, key: string, def: number): number {
  const v = ctx.thresholds[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}

/** Resolve a boolean threshold (e.g. a rule toggle flag). */
export function flag(ctx: AnalysisContext, key: string, def: boolean): boolean {
  const v = ctx.thresholds[key];
  return typeof v === "boolean" ? v : def;
}

/** Extract a plain number from a provenanced value (null-safe). */
export function num<T extends number | null>(pv: ProvenancedValue<T>): number | null {
  const v = pv.value;
  return v == null ? null : (v as number);
}

/** Scope a finding to the active project filter (independent supersession per project). */
export function scopeOf(ctx: AnalysisContext): RuleScope {
  return ctx.filters.projectId ? { projectId: ctx.filters.projectId } : {};
}

/** Deterministic confidence that scales with count above a baseline, capped. */
export function confidenceForCount(count: number, base: number, per: number, max: number): number {
  return Math.min(max, base + Math.max(0, count) * per);
}

/** A single metric value backing a piece of evidence. */
export type RecommendationMetric = NonNullable<RecommendationEvidence["metrics"]>[number];

/** Build a metric entry. */
export function metric(
  label: string,
  value: string | number,
  provenance: "exact" | "reported" | "inferred" | "estimated" | "heuristic" | "unknown",
): RecommendationMetric {
  return { label, value, provenance };
}

/** Build an evidence entry. */
export function evidence(
  kind: string,
  description: string,
  metrics?: RecommendationEvidence["metrics"],
  references?: string[],
): RecommendationEvidence {
  const e: RecommendationEvidence = { kind, description };
  if (metrics && metrics.length > 0) e.metrics = metrics;
  if (references && references.length > 0) e.references = references;
  return e;
}

/** Build an instruction remediation (never auto-applied — §3.5 safe remediation). */
export function instructionRemediation(preview: string): Remediation {
  return { type: "instruction", preview, automaticallyApplicable: false };
}

/** Build a candidate. The fingerprint is left empty — the rule engine fills it
 *  deterministically from ruleId + version + scope + evidence. */
export function candidate(input: {
  ctx: AnalysisContext;
  ruleId: string;
  ruleVersion: number;
  category: RecommendationCandidate["category"];
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
  explanation: string;
  evidence: RecommendationEvidence[];
  remediation?: Remediation;
}): RecommendationCandidate {
  const c: RecommendationCandidate = {
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    category: input.category,
    severity: input.severity,
    confidence: input.confidence,
    scope: scopeOf(input.ctx),
    title: input.title,
    summary: input.summary,
    explanation: input.explanation,
    evidence: input.evidence,
    fingerprint: "",
  };
  if (input.remediation) c.remediation = input.remediation;
  return c;
}
