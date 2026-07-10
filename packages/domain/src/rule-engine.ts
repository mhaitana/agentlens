/**
 * Rule-engine contracts (spec §15.1).
 *
 * A versioned rule engine evaluates an {@link AnalysisContext} and emits
 * {@link RecommendationCandidate}s. The contracts here are provider-neutral so
 * rules are independently testable without a database or a specific adapter.
 * The engine implementation (threshold overrides, enable/disable, deterministic
 * confidence, fingerprints, supersession) lives in `@agentlens/analysis-engine`;
 * persistence/ranking lives in `@agentlens/recommendations` (M2).
 */

import type { Confidence } from "./provenance.js";
import type {
  RecommendationCategory,
  RecommendationEvidence,
  Recommendation,
  Severity,
  EstimatedImpact,
  Remediation,
} from "./recommendation.js";
import type { AnalyticsSnapshot, ReportFilters } from "./metrics.js";

/** Scope a rule's finding attaches to. */
export interface RuleScope {
  sessionId?: string;
  projectId?: string;
}

/** A recommendation before it is persisted: the rule engine's raw output. */
export interface RecommendationCandidate {
  ruleId: string;
  ruleVersion: number;
  category: RecommendationCategory;
  severity: Severity;
  /** Deterministic for deterministic rules (§15.1). */
  confidence: Confidence;
  scope: RuleScope;
  title: string;
  summary: string;
  explanation: string;
  evidence: RecommendationEvidence[];
  estimatedImpact?: EstimatedImpact;
  remediation?: Remediation;
  /**
   * Stable fingerprint of the finding (rule + evidence). Used to consolidate
   * duplicates and to supersede old recommendations when the evidence changes.
   */
  fingerprint: string;
}

/** Per-rule threshold overrides resolved from config (§15.1). */
export type RuleThresholds = Record<string, number | string | boolean>;

/** Context handed to every rule. Pure data — rules never touch the DB. */
export interface AnalysisContext {
  snapshot: AnalyticsSnapshot;
  filters: ReportFilters;
  /** Resolved threshold overrides for this rule (merged over defaults). */
  thresholds: RuleThresholds;
  /** ISO timestamp the snapshot was generated; deterministic per run. */
  generatedAt: string;
}

/** A versioned, independently-testable rule. */
export interface RecommendationRule {
  readonly id: string;
  readonly version: number;
  readonly category: RecommendationCategory;
  /** Default thresholds; overridable via config (§15.1). */
  readonly defaultThresholds?: RuleThresholds;
  evaluate(context: AnalysisContext): Promise<RecommendationCandidate[]>;
  /** Human-readable explanation of a candidate, surfaced in `rules explain`. */
  explain(candidate: RecommendationCandidate): string;
}

/** Result of running the engine over a snapshot. */
export interface RuleEngineResult {
  candidates: RecommendationCandidate[];
  /** Candidates that were consolidated as duplicates of another. */
  consolidated: RecommendationCandidate[];
  /** Rule ids that were disabled and therefore skipped. */
  skippedRules: string[];
}

export type {
  Recommendation,
  RecommendationCategory,
  RecommendationEvidence,
  Severity,
  EstimatedImpact,
  Remediation,
};
