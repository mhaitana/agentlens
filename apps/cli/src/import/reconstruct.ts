import type { NormalisedSourceEvent } from "@agentlens/source-adapter";
import type { DataCompletenessFlag, EntryPoint, SessionCompletionStatus } from "@agentlens/domain";

/**
 * Session reconstruction from the normalised event stream (spec §13.4).
 *
 * Reconstructs the timeline and counts, marks data completeness, and labels
 * inferred values — never inventing timestamps or metrics that the source did
 * not provide.
 */
export interface ReconstructedSession {
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  entryPoint: EntryPoint;
  sourceVersion?: string;
  completionStatus: SessionCompletionStatus;
  dataCompleteness: DataCompletenessFlag[];
  promptCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;
}

export function reconstructSession(events: NormalisedSourceEvent[]): ReconstructedSession {
  let entryPoint: EntryPoint = "unknown";
  let sourceVersion: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let durationMs: number | undefined;
  let completionStatus: SessionCompletionStatus = "unknown";

  let promptCount = 0;
  let modelRequestCount = 0;
  let toolCallCount = 0;
  let compactionCount = 0;
  let subagentCount = 0;
  let modelRequestsWithUsage = 0;
  let hasExplicitEnd = false;

  for (const e of events) {
    switch (e.kind) {
      case "session-start":
        entryPoint = e.entryPoint;
        sourceVersion = e.sourceVersion;
        startedAt = e.timestamp.toISOString();
        break;
      case "session-end":
        endedAt = e.timestamp.toISOString();
        durationMs = e.durationMs;
        if (e.completionStatus) completionStatus = e.completionStatus;
        if (e.explicit) hasExplicitEnd = true;
        break;
      case "prompt":
        promptCount++;
        break;
      case "model-request":
        modelRequestCount++;
        if (
          e.inputTokens !== undefined ||
          e.outputTokens !== undefined ||
          e.cacheReadTokens !== undefined ||
          e.cacheCreationTokens !== undefined
        ) {
          modelRequestsWithUsage++;
        }
        break;
      case "tool-call":
        toolCallCount++;
        if (e.subagentAttribution) subagentCount++;
        break;
      case "compaction":
        compactionCount++;
        break;
      default:
        break;
    }
  }

  // Fall back to the last event timestamp if no explicit session-end was emitted.
  if (!endedAt && events.length > 0) {
    const last = events[events.length - 1];
    if (last) endedAt = last.timestamp.toISOString();
  }
  if (!startedAt && events.length > 0) {
    const first = events[0];
    if (first) startedAt = first.timestamp.toISOString();
  }

  const dataCompleteness = computeCompleteness({
    hasExplicitSessionEnd: hasExplicitEnd,
    modelRequestCount,
    modelRequestsWithUsage,
    promptCount,
  });

  return {
    startedAt: startedAt ?? new Date(0).toISOString(),
    endedAt,
    durationMs,
    entryPoint,
    sourceVersion,
    completionStatus,
    dataCompleteness,
    promptCount,
    modelRequestCount,
    toolCallCount,
    compactionCount,
    subagentCount,
  };
}

function computeCompleteness(input: {
  hasExplicitSessionEnd: boolean;
  modelRequestCount: number;
  modelRequestsWithUsage: number;
  promptCount: number;
}): DataCompletenessFlag[] {
  const flags: DataCompletenessFlag[] = [];
  // Tail missing when the adapter did not record a real end (synthetic end).
  if (!input.hasExplicitSessionEnd) flags.push("partial-tail-missing");
  if (input.modelRequestCount > 0 && input.modelRequestsWithUsage === 0)
    flags.push("partial-metrics-missing");
  if (input.promptCount === 0) flags.push("partial-prompts-missing");
  if (flags.length === 0) flags.push("complete");
  return flags;
}
