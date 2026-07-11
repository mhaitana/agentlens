/**
 * Behavioural baseline + session-comparison types (spec §15.3).
 *
 * A baseline summarises a user's *own* history (personal, per-project, and a
 * recent window) so a session can be compared against what is normal *for them*
 * — never against invented industry averages (§15.3, §3.4). Every numeric
 * carries a {@link MetricProvenance} so an estimate is never presented as a
 * measured value. These types are provider-neutral; the computation lives in
 * `@agentlens/analysis-engine`.
 */
import type { MetricProvenance } from "./provenance.js";

/**
 * A behavioural dimension tracked across baselines (spec §15.3 examples).
 * Kept open-ended so the analysis engine can add dimensions without a breaking
 * domain change, but the well-known set is enumerated for tooling.
 */
export type BaselineDimension =
  | "sessionDurationMs"
  | "toolCallCount"
  | "testFrequency"
  | "readToWriteRatio"
  | "largestOutputBytes"
  | "compactionCount"
  | "modelDiversity"
  | "correctiveTurnCount"
  | "promptCount";

/** One session's measured value for each dimension (the raw baseline material). */
export interface SessionDataPoint {
  sessionId: string;
  projectId: string;
  startedAt: string;
  /** Reported by the source; null when the session lacks a recorded duration. */
  sessionDurationMs: number | null;
  /** Exact tool-call count. */
  toolCallCount: number;
  /** Exact count of test-kind verification runs in the session. */
  testFrequency: number;
  /** Inferred reads-per-write from file activity; null when no writes. */
  readToWriteRatio: number | null;
  /** Reported largest single tool/command output size in bytes. */
  largestOutputBytes: number | null;
  /** Exact compaction count. */
  compactionCount: number;
  /** Exact count of distinct models used. */
  modelDiversity: number;
  /** Heuristic count of corrective/clarifying prompts (from prompt features). */
  correctiveTurnCount: number;
  /** Exact prompt count. */
  promptCount: number;
}

/** A robust statistic summarising one dimension across a population. */
export interface BaselineStat {
  /** Median (typical value). */
  median: number | null;
  /** Median absolute deviation — a robust spread measure. */
  mad: number | null;
  /** Number of sessions contributing to this stat. */
  sampleSize: number;
  /**
   * How the median was derived. Dimensions sourced from exact counts are
   * `inferred` once aggregated (a median of exact values is an inference about
   * "typical"); reported-but-sometimes-missing dimensions stay `reported` or
   * `unknown` when no session supplied a value.
   */
  provenance: MetricProvenance;
}

/** A behavioural baseline over a set of the user's own sessions (§15.3). */
export interface BehaviouralBaseline {
  /** Which population this baseline summarises. */
  scope: "personal" | "project" | "recent";
  /** Project id when scope === "project". */
  projectId?: string;
  /** Number of sessions aggregated. */
  sampleSize: number;
  /** Per-dimension robust statistics. */
  stats: Partial<Record<BaselineDimension, BaselineStat>>;
  /** Normal model distribution (model id → share of model requests). */
  modelDistribution: Array<{ modelId: string; share: number; provenance: MetricProvenance }>;
}

/** How a session compares to a baseline on a single dimension. */
export interface BaselineDeviation {
  dimension: BaselineDimension;
  /** The session's value (provenance mirrors the data point's source). */
  sessionValue: number | null;
  /** The baseline median. */
  baselineMedian: number | null;
  /** session / baseline ratio (>1 higher, <1 lower); null when undefined. */
  ratio: number | null;
  /** Robust deviation: |session − median| / mad (0 when there is no spread). */
  deviationScore: number;
  direction: "higher" | "lower" | "typical" | "unknown";
  provenance: MetricProvenance;
}

/** A session compared against the personal/project/recent baselines (§15.3). */
export interface SessionComparison {
  sessionId: string;
  personal: BehaviouralBaseline;
  project: BehaviouralBaseline | null;
  recent: BehaviouralBaseline;
  /** Deviations per baseline — only dimensions the baseline has a stat for. */
  deviations: Array<{ baseline: BehaviouralBaseline["scope"]; deviations: BaselineDeviation[] }>;
}
