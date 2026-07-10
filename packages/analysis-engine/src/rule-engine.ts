/**
 * Rule engine framework (spec §15.1).
 *
 * A versioned, independently-testable rule engine. It registers rules,
 * resolves enable/disable + threshold overrides from config, runs each
 * enabled rule over an {@link AnalysisContext}, computes deterministic
 * fingerprints for every candidate, and consolidates duplicate candidates
 * (same fingerprint) in memory. Persistence, ranking and cross-run
 * supersession land in M2 (`@agentlens/recommendations`); here we only emit
 * {@link RecommendationCandidate}s.
 *
 * Determinism contract (§15.1): given the same snapshot + thresholds + rule
 * set, `run()` always produces the same candidates in the same order with the
 * same fingerprints and confidence — so a re-run is reproducible and a
 * persisted recommendation can be retracted when its evidence changes.
 */

import { sha256 } from "@agentlens/shared";
import type {
  AnalysisContext,
  AnalyticsSnapshot,
  Confidence,
  RecommendationCandidate,
  RecommendationRule,
  ReportFilters,
  RuleEngineResult,
  RuleThresholds,
} from "@agentlens/domain";

/** Per-rule config overrides (§15.1). */
export interface RuleOverride {
  /** When false, the rule is skipped. */
  enabled?: boolean;
  /** Thresholds merged over the rule's defaults. */
  thresholds?: RuleThresholds;
}

/** Config-shaped map of rule id → override. */
export type RuleOverrides = Record<string, RuleOverride>;

/**
 * The rule engine. Construct via {@link createRuleEngine} so config overrides
 * are resolved once at setup time.
 */
export class RuleEngine {
  private readonly rules = new Map<string, RecommendationRule>();
  private readonly disabled = new Set<string>();
  private readonly thresholdOverrides = new Map<string, RuleThresholds>();

  /** Register a rule. Last registration wins for a given id. */
  register(rule: RecommendationRule): void {
    this.rules.set(rule.id, rule);
  }

  /** Register many rules. */
  registerAll(rules: RecommendationRule[]): void {
    for (const r of rules) this.register(r);
  }

  /** Disable a rule by id (it will be skipped and reported in `skippedRules`). */
  disable(ruleId: string): void {
    this.disabled.add(ruleId);
  }

  /** Re-enable a disabled rule. */
  enable(ruleId: string): void {
    this.disabled.delete(ruleId);
  }

  isEnabled(ruleId: string): boolean {
    return this.rules.has(ruleId) && !this.disabled.has(ruleId);
  }

  /** Set threshold overrides for a rule (merged over its defaults at run time). */
  setThresholds(ruleId: string, thresholds: RuleThresholds): void {
    this.thresholdOverrides.set(ruleId, thresholds);
  }

  /** All registered rule ids (stable, sorted). */
  ruleIds(): string[] {
    return [...this.rules.keys()].sort();
  }

  /**
   * Run every enabled rule over the snapshot and consolidate duplicates.
   *
   * Order is deterministic: rules run in sorted id order, each rule's
   * candidates are kept in emitted order, and duplicate fingerprints are
   * consolidated (the first occurrence is kept; later ones move to
   * `consolidated`). Candidates below `minimumConfidence` are dropped (the
   * caller passes the config's confidence floor).
   */
  async run(
    snapshot: AnalyticsSnapshot,
    filters: ReportFilters,
    generatedAt: string,
    minimumConfidence: Confidence = 0,
  ): Promise<RuleEngineResult> {
    const candidates: RecommendationCandidate[] = [];
    const consolidated: RecommendationCandidate[] = [];
    const skippedRules: string[] = [];
    const seenFingerprints = new Set<string>();

    for (const ruleId of this.ruleIds()) {
      const rule = this.rules.get(ruleId);
      if (!rule) continue;
      if (!this.isEnabled(ruleId)) {
        skippedRules.push(ruleId);
        continue;
      }
      const thresholds = mergeThresholds(
        rule.defaultThresholds,
        this.thresholdOverrides.get(ruleId),
      );
      const context: AnalysisContext = { snapshot, filters, thresholds, generatedAt };
      let emitted: RecommendationCandidate[];
      try {
        emitted = await rule.evaluate(context);
      } catch {
        // A rule must never take down the engine (§15.1 — independently testable,
        // independently failing). Record the skip and continue.
        skippedRules.push(ruleId);
        continue;
      }

      for (const candidate of emitted) {
        // Ensure a fingerprint exists (deterministic, from rule + evidence).
        // A rule may leave the fingerprint empty; the engine fills it so two
        // candidates with the same evidence are always consolidated.
        const rawFp = candidate.fingerprint;
        const fp = rawFp ? rawFp : fingerprintCandidate(candidate);
        const withFp: RecommendationCandidate = { ...candidate, fingerprint: fp };
        if (withFp.confidence < minimumConfidence) continue;
        if (seenFingerprints.has(fp)) {
          consolidated.push(withFp);
          continue;
        }
        seenFingerprints.add(fp);
        candidates.push(withFp);
      }
    }

    return { candidates, consolidated, skippedRules };
  }
}

/** Resolve config overrides into the engine at construction time. */
export function createRuleEngine(
  rules: RecommendationRule[],
  overrides: RuleOverrides = {},
): RuleEngine {
  const engine = new RuleEngine();
  engine.registerAll(rules);
  for (const [ruleId, override] of Object.entries(overrides)) {
    if (override.enabled === false) engine.disable(ruleId);
    if (override.thresholds) engine.setThresholds(ruleId, override.thresholds);
  }
  return engine;
}

/** Merge per-rule default thresholds with overrides (overrides win). */
export function mergeThresholds(
  defaults?: RuleThresholds,
  overrides?: RuleThresholds,
): RuleThresholds {
  return { ...(defaults ?? {}), ...(overrides ?? {}) };
}

/**
 * Deterministic fingerprint of a candidate (rule + scope + evidence).
 * Two candidates with the same rule, scope and evidence share a fingerprint
 * and are consolidated as duplicates; when the evidence changes the
 * fingerprint changes, which is the basis for supersession in M2.
 */
export function fingerprintCandidate(candidate: RecommendationCandidate): string {
  const payload = {
    ruleId: candidate.ruleId,
    ruleVersion: candidate.ruleVersion,
    scope: candidate.scope,
    evidence: candidate.evidence.map((e) => ({
      kind: e.kind,
      description: e.description,
      metrics: e.metrics,
    })),
  };
  return sha256(stableJson(payload));
}

/** Stable JSON serialization (sorted keys) so fingerprints are reproducible. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

export type { RecommendationRule, RuleThresholds };
