import type { ProvenancedValue } from "./provenance.js";

/** Where a model request originated. */
export type QuerySource = "user" | "agent" | "skill" | "plugin" | "system" | "unknown";

/** A single model invocation with its token/cost accounting. (§10.5) */
export interface ModelRequest {
  id: string;
  sessionId: string;
  /** Optional prompt this request responds to. */
  promptId?: string;

  timestamp: Date;
  /** Model identifier as reported by the source. */
  modelId: string;
  /** Normalised model family / configured tier. */
  modelFamily?: string;

  inputTokens?: ProvenancedValue<number>;
  outputTokens?: ProvenancedValue<number>;
  cacheReadTokens?: ProvenancedValue<number>;
  cacheCreationTokens?: ProvenancedValue<number>;
  /** Estimated USD cost — never an official billing value. */
  estimatedCostUsd?: ProvenancedValue<number>;
  durationMs?: ProvenancedValue<number>;
  /** Effort setting, when the source reports one. */
  effort?: string;
  querySource: QuerySource;

  /** Attribution: agent, skill or plugin name, when available. */
  agentAttribution?: string;
  skillAttribution?: string;
  pluginAttribution?: string;
  mcpAttribution?: string;

  /** Provenance of the metric block as a whole. */
  metricProvenance: string;
}
