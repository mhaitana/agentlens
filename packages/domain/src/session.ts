import type { ProvenancedValue } from "./provenance.js";

/** How a session ended, as best AgentLens can determine. */
export type SessionCompletionStatus = "completed" | "interrupted" | "failed" | "unknown";

/** Where a session was started from. */
export type EntryPoint = "cli" | "ide" | "ci" | "api" | "subagent" | "unknown";

/** Indicator that a given session dimension is partial/complete. */
export type DataCompletenessFlag =
  | "complete"
  | "partial-tail-missing"
  | "partial-metrics-missing"
  | "partial-prompts-missing"
  | "partial-tools-missing"
  | "partial";

/** A reconstructed coding session. (§10.3) */
export interface Session {
  id: string;
  /** Source-native session identifier. */
  sourceSessionId: string;
  sourceId: string;
  projectId: string;

  startedAt: Date;
  endedAt?: Date;
  /** Wall-clock duration in milliseconds. */
  durationMs: ProvenancedValue<number>;
  /** Active (non-idle) duration in milliseconds, when estimable. */
  activeDurationMs?: ProvenancedValue<number>;

  entryPoint: EntryPoint;
  /** Claude Code (or other source) version, when available. */
  sourceVersion?: string;
  completionStatus: SessionCompletionStatus;

  /** Privacy mode in effect when this session was imported. */
  privacyMode: string;
  /** Completeness indicators for reconstructed dimensions. */
  dataCompleteness: DataCompletenessFlag[];

  promptCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;

  /** How this session entered the database (transcript scan, hook, telemetry). */
  importProvenance: string;
}
