/**
 * Recommendation ranking (spec §15.2).
 *
 * Rank active recommendations using: severity, confidence, estimated impact,
 * recency, frequency, whether the behaviour appears across sessions, whether
 * remediation is actionable, and a penalty for similar advice the user has
 * dismissed. Avoid flooding the user: default views show a manageable number
 * of high-value recommendations.
 *
 * The score is deterministic — identical inputs produce identical ordering —
 * so ranking is reproducible alongside rule confidence (§15.1).
 */
import type { Recommendation, Severity } from "@agentlens/domain";

export interface RankOptions {
  /** Max recommendations to surface (default 20 — "avoid flooding"). */
  maxRecommendations?: number;
  /** Reference "now" for recency scoring (ISO). Tests pass a fixed value. */
  now?: string;
  /** Rule ids the user has dismissed similar advice for recently → mild penalty. */
  dismissedRuleIds?: ReadonlySet<string>;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 30,
  high: 24,
  medium: 18,
  low: 12,
  info: 6,
};

/** Evidence metric value coerced to a number, if numeric. */
function numericMetric(rec: Recommendation, label: string): number | null {
  for (const e of rec.evidence) {
    for (const m of e.metrics ?? []) {
      if (m.label === label && typeof m.value === "number") return m.value;
    }
  }
  return null;
}

/** Distinct sessions referenced across the evidence (cross-session signal). */
function distinctSessions(rec: Recommendation): number {
  const set = new Set<string>();
  for (const e of rec.evidence) for (const ref of e.references ?? []) set.add(ref);
  return set.size;
}

/**
 * Compute a deterministic score. Higher is more important. Components:
 *  - severity (max 30), confidence (max 25), impact confidence (max 15),
 *    recency (max 10), frequency (max 10), cross-session (+0..10),
 *    actionable remediation (+5 if auto-applicable, +2 if any remediation),
 *    dismissed-similar (-6).
 */
export function scoreRecommendation(rec: Recommendation, opts: RankOptions): number {
  const severity = SEVERITY_WEIGHT[rec.severity] ?? 0;
  const confidence = (rec.confidence as number) * 25;

  const impactConfidence = rec.estimatedImpact?.confidence ?? 0;
  const impactScore = (impactConfidence as number) * 15;

  // Recency: recommendations touched in the last 7 days score highest.
  let recencyScore = 0;
  if (opts.now && rec.updatedAt) {
    const ageDays = Math.max(0, (Date.parse(opts.now) - rec.updatedAt.getTime()) / 86_400_000);
    recencyScore = Math.max(0, 10 - ageDays * 1.5);
  }

  // Frequency: occurrence/aggregate count surfaced by the rule in its evidence.
  const freq = numericMetric(rec, "occurrences") ?? numericMetric(rec, "count") ?? 0;
  const frequencyScore = Math.min(10, freq);

  // Cross-session: a behaviour appearing across sessions is more systemic.
  const crossSession = distinctSessions(rec);
  const crossSessionBoost = crossSession > 1 ? Math.min(10, crossSession * 3) : 0;

  // Actionable remediation.
  let actionableBoost = 0;
  if (rec.remediation) {
    actionableBoost += 2;
    if (rec.remediation.automaticallyApplicable) actionableBoost += 5;
  }

  // Dismissed-similar penalty (user already rejected this kind of advice).
  let dismissedPenalty = 0;
  if (opts.dismissedRuleIds?.has(rec.ruleId)) dismissedPenalty = 6;

  return (
    severity +
    confidence +
    impactScore +
    recencyScore +
    frequencyScore +
    crossSessionBoost +
    actionableBoost -
    dismissedPenalty
  );
}

/** Rank active recommendations by score (desc), deterministic tie-break, capped. */
export function rankRecommendations(
  recommendations: Recommendation[],
  opts: RankOptions = {},
): Recommendation[] {
  const now = opts.now ?? new Date().toISOString();
  const max = opts.maxRecommendations ?? 20;
  const scored = recommendations.map((rec) => ({
    rec,
    score: scoreRecommendation(rec, { ...opts, now }),
  }));
  // Deterministic tie-break: score desc → severity weight desc → ruleId asc.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sevA = SEVERITY_WEIGHT[a.rec.severity] ?? 0;
    const sevB = SEVERITY_WEIGHT[b.rec.severity] ?? 0;
    if (sevB !== sevA) return sevB - sevA;
    return a.rec.ruleId.localeCompare(b.rec.ruleId);
  });
  return scored.slice(0, max).map((s) => s.rec);
}
