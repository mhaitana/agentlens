/**
 * Analytics snapshot + report filter types (spec §13.5, §13.7).
 *
 * Every numeric metric is a {@link ProvenancedValue} so an estimate is never
 * presented as a measured value, and so reports can label inferred/heuristic
 * numbers accordingly (§3.4 honest metrics). These types are provider-neutral;
 * the analysis-engine produces them, reporting/CLI/dashboard consume them.
 */

import type { ProvenancedValue, Confidence } from "./provenance.js";
import type { Recommendation } from "./recommendation.js";
import type { DataCompletenessFlag, SessionCompletionStatus } from "./session.js";

/** Aggregation window for a report (§13.7). */
export type ReportPeriod = "day" | "week" | "month" | "all";

/** Filters selecting the sessions a report covers. */
export interface ReportFilters {
  period: ReportPeriod;
  /** Inclusive lower bound (ISO). Derived from `period` when omitted. */
  since?: string;
  /** Inclusive upper bound (ISO). Defaults to now. */
  until?: string;
  /** Restrict to a single project id. */
  projectId?: string;
  /** Restrict to a single session id (overrides period). */
  sessionId?: string;
}

/** Per-model usage breakdown. */
export interface ModelUsageRow {
  modelId: string;
  sessions: number;
  modelRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number | null;
}

/** Per-tool behaviour breakdown. */
export interface ToolUsageRow {
  toolName: string;
  calls: number;
  failures: number;
  failureRate: number;
  averageDurationMs: number | null;
}

/** A repeated-operation finding (repeated reads/searches/commands). */
export interface RepeatedOperation {
  /** What was repeated: a tool name, command hash, or path hash. */
  key: string;
  label: string;
  /** How many times it recurred in the window. */
  occurrences: number;
  /** Distinct sessions in which it recurred. */
  sessions: number;
  kind: "read" | "search" | "command" | "failed-command";
}

/** §13.5 usage metrics. */
export interface UsageMetrics {
  totalSessions: ProvenancedValue<number>;
  sessionsPerDay: ProvenancedValue<number>;
  sessionsPerWeek: ProvenancedValue<number>;
  sessionsPerMonth: ProvenancedValue<number>;
  activeDays: ProvenancedValue<number>;
  medianSessionDurationMs: ProvenancedValue<number | null>;
  meanSessionDurationMs: ProvenancedValue<number | null>;
  totalDurationMs: ProvenancedValue<number | null>;
  promptsPerSession: ProvenancedValue<number>;
  toolCallsPerSession: ProvenancedValue<number>;
  toolSuccessRate: ProvenancedValue<number>;
  totalTokens: ProvenancedValue<number>;
  inputTokens: ProvenancedValue<number>;
  outputTokens: ProvenancedValue<number>;
  cacheReadTokens: ProvenancedValue<number>;
  cacheCreationTokens: ProvenancedValue<number>;
  totalCompactions: ProvenancedValue<number>;
  totalSubagentSessions: ProvenancedValue<number>;
  estimatedCostUsd: ProvenancedValue<number | null>;
  modelUsage: ModelUsageRow[];
}

/** §13.5 tool-behaviour metrics. */
export interface ToolBehaviourMetrics {
  mostUsedTools: ToolUsageRow[];
  toolFailureRate: ProvenancedValue<number>;
  averageToolDurationMs: ProvenancedValue<number | null>;
  repeatedReads: RepeatedOperation[];
  repeatedSearches: RepeatedOperation[];
  repeatedCommands: RepeatedOperation[];
  repeatedFailedCommands: RepeatedOperation[];
  largestToolInputsBytes: ProvenancedValue<number | null>;
  largestToolOutputsBytes: ProvenancedValue<number | null>;
  testCommandFrequency: ProvenancedValue<number>;
  buildCommandFrequency: ProvenancedValue<number>;
}

/** §13.5 workflow-behaviour metrics. */
export interface WorkflowMetrics {
  filesChangedPerSession: ProvenancedValue<number | null>;
  readToWriteRatio: ProvenancedValue<number | null>;
  totalVerificationRuns: ProvenancedValue<number>;
  sessionsEndingAfterSuccessfulVerification: ProvenancedValue<number>;
  sessionsEndingWithKnownFailures: ProvenancedValue<number>;
  changesAfterFinalVerification: ProvenancedValue<number>;
  correctivePromptCount: ProvenancedValue<number>;
  medianTimeToFirstEditMs: ProvenancedValue<number | null>;
  medianTimeBetweenFinalEditAndVerificationMs: ProvenancedValue<number | null>;
}

/** Cost summary with the derivation chain (§13.6). */
export interface CostSummary {
  totalUsd: ProvenancedValue<number | null>;
  byModel: Array<{ modelId: string; usd: number | null; provenance: string }>;
  /** Which rung of the §13.6 priority chain produced the figure. */
  methodology: "reported" | "telemetry" | "registry" | "unknown";
}

/** Aggregate data-completeness distribution across sessions. */
export interface CompletenessSummary {
  totalSessions: number;
  complete: number;
  partialTailMissing: number;
  partialMetricsMissing: number;
  partialPromptsMissing: number;
}

/** Distribution of session completion statuses. */
export interface CompletionSummary {
  total: number;
  completed: number;
  interrupted: number;
  failed: number;
  unknown: number;
}

/** Scan/import provenance surfaced in a report (§13.7). */
export interface ScanProvenanceSummary {
  sourceId: string;
  adapterVersion?: string;
  parserVersion?: number;
  importedSessions: number;
  skippedSessions: number;
}

/** The full analytics snapshot a report renders. */
export interface AnalyticsSnapshot {
  generatedAt: string;
  filters: ReportFilters;
  privacyMode: string;
  usage: UsageMetrics;
  tools: ToolBehaviourMetrics;
  workflow: WorkflowMetrics;
  cost: CostSummary;
  completeness: CompletenessSummary;
  completion: CompletionSummary;
  scanProvenance: ScanProvenanceSummary;
  /** Recommendations produced by the rule engine (empty until M2 rules land). */
  recommendations: Recommendation[];
  /** The confidence floor used to filter recommendations. */
  minimumRecommendationConfidence: Confidence;
}

export type { DataCompletenessFlag, SessionCompletionStatus, Recommendation };
export type { ProvenancedValue, Confidence };
