/**
 * Initial analytics (spec §13.5).
 *
 * `computeAnalytics` reads persisted domain rows from the database and
 * produces an {@link AnalyticsSnapshot} — every metric wrapped in a
 * {@link ProvenancedValue} so an estimate is never presented as a measured
 * value (§3.4 honest metrics).
 *
 * Aggregation is performed over the report window in one pass; this is a
 * query-time computation (not a per-event recompute), so it satisfies the
 * §20 incremental invariant. Per-event incremental caching of rule results is
 * the rule engine's job (M1-6), not this module's.
 */

import { eq, inArray } from "@agentlens/database";
import { schema, type DrizzleDb } from "@agentlens/database";
import {
  exact,
  estimated,
  inferred,
  reported,
  unknown,
  type AnalyticsSnapshot,
  type CompletenessSummary,
  type CompletionSummary,
  type Confidence,
  type ModelUsageRow,
  type ProvenancedValue,
  type ReportFilters,
  type RepeatedOperation,
  type ScanProvenanceSummary,
  type ToolUsageRow,
  type UsageMetrics,
  type ToolBehaviourMetrics,
  type WorkflowMetrics,
} from "@agentlens/domain";
import { computeCostSummary, type CostRequestRow } from "./cost.js";

/** Search-capable tools (repeated-search detection, §13.5). */
const SEARCH_TOOLS = new Set(["Grep", "Glob", "WebSearch", "WebFetch"]);
/** Write-like file operations (read-to-write ratio, files-changed). */
const WRITE_OPERATIONS = new Set(["write", "edit", "create", "delete", "replace", "move"]);
/** Default repetition threshold (occurrences) for repeated-operation rules. */
const DEFAULT_REPETITION_THRESHOLD = 3;

export interface ComputeAnalyticsOptions {
  /** Confidence floor for recommendations (passed through to the snapshot). */
  minimumRecommendationConfidence: Confidence;
  /** Privacy mode label recorded on sessions (surfaced in the snapshot). */
  privacyMode?: string;
  /** Override the "now" used to derive the report window (tests). */
  now?: Date;
  /** Repetition threshold for repeated reads/searches/commands. */
  repetitionThreshold?: number;
}

interface ResolvedWindow {
  since?: Date;
  until: Date;
  days: number | null;
}

/**
 * Compute the full analytics snapshot for a report window.
 *
 * Filters: `period` (day/week/month/all) derives `since` from `until` when
 * `since` is not given; `projectId` restricts to one project; `sessionId`
 * overrides the period and reports a single session.
 */
export async function computeAnalytics(
  db: DrizzleDb,
  filters: ReportFilters,
  options: ComputeAnalyticsOptions,
): Promise<AnalyticsSnapshot> {
  const now = options.now ?? new Date();
  const window = resolveWindow(filters, now);

  // --- Sessions in window -------------------------------------------------
  let sessionRows: (typeof schema.sessions.$inferSelect)[];
  if (filters.sessionId) {
    sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, filters.sessionId))
      .limit(1);
  } else {
    const rows = filters.projectId
      ? await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.projectId, filters.projectId))
      : await db.select().from(schema.sessions);
    sessionRows = rows.filter((r) => inWindow(r.startedAt, window));
  }

  const generatedAt = now.toISOString();
  const sessionIds = sessionRows.map((s) => s.id);

  if (sessionIds.length === 0) {
    return emptySnapshot(generatedAt, filters, options);
  }

  // --- Children (bounded by sessionIds) ----------------------------------
  const [
    modelRequestRows,
    toolCallRows,
    fileActivityRows,
    commandRows,
    verificationRows,
    promptRows,
  ] = await Promise.all([
    db
      .select()
      .from(schema.modelRequests)
      .where(inArray(schema.modelRequests.sessionId, sessionIds)),
    db.select().from(schema.toolCalls).where(inArray(schema.toolCalls.sessionId, sessionIds)),
    db.select().from(schema.fileActivity).where(inArray(schema.fileActivity.sessionId, sessionIds)),
    db.select().from(schema.commandRuns).where(inArray(schema.commandRuns.sessionId, sessionIds)),
    db
      .select()
      .from(schema.verificationRuns)
      .where(inArray(schema.verificationRuns.sessionId, sessionIds)),
    db.select().from(schema.prompts).where(inArray(schema.prompts.sessionId, sessionIds)),
  ]);

  // --- Usage metrics -----------------------------------------------------
  const usage = computeUsageMetrics(sessionRows, modelRequestRows, window);

  // --- Cost (§13.6) ------------------------------------------------------
  const costRows: CostRequestRow[] = modelRequestRows.map((m) => ({
    modelId: m.modelId,
    reportedCostUsd: m.estimatedCostUsd,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheCreationTokens: m.cacheCreationTokens,
  }));
  const costResult = computeCostSummary(costRows);

  // Merge per-model cost into the model usage rows.
  const costByModel = new Map(costResult.byModel.map((b) => [b.modelId, b.usd]));
  usage.modelUsage = usage.modelUsage.map((row) => ({
    ...row,
    estimatedCostUsd: costByModel.get(row.modelId) ?? null,
  }));

  // --- Tool behaviour ----------------------------------------------------
  const tools = computeToolBehaviour(toolCallRows, fileActivityRows, commandRows, options);
  const toolTotalCalls = toolCallRows.length;
  const toolTotalFailures = toolCallRows.filter((t) => !t.success).length;
  usage.toolSuccessRate = exact(
    toolTotalCalls > 0 ? (toolTotalCalls - toolTotalFailures) / toolTotalCalls : 0,
  );

  // --- Workflow ----------------------------------------------------------
  const workflow = computeWorkflowMetrics(
    sessionRows,
    fileActivityRows,
    verificationRows,
    promptRows,
  );

  // --- Completeness + completion ----------------------------------------
  const completeness = computeCompletenessSummary(sessionRows);
  const completion = computeCompletionSummary(sessionRows);

  // --- Scan provenance ---------------------------------------------------
  const scanProvenance = await computeScanProvenance(db, sessionRows);

  return {
    generatedAt,
    filters,
    privacyMode: options.privacyMode ?? sessionRows[0]?.privacyMode ?? "redacted-content",
    usage,
    tools,
    workflow,
    cost: {
      totalUsd: costResult.total,
      byModel: costResult.byModel,
      methodology: costResult.methodology,
    },
    completeness,
    completion,
    scanProvenance,
    recommendations: [], // M1-6 framework emits candidates; M2 persists recommendations.
    minimumRecommendationConfidence: options.minimumRecommendationConfidence,
  };
}

// ---------------------------------------------------------------------------
// Window resolution
// ---------------------------------------------------------------------------

function resolveWindow(filters: ReportFilters, now: Date): ResolvedWindow {
  const until = filters.until ? new Date(filters.until) : now;
  if (filters.since) {
    const since = new Date(filters.since);
    return { since, until, days: daysBetween(since, until) };
  }
  if (filters.sessionId || filters.period === "all") {
    return { since: undefined, until, days: null };
  }
  const dayMs = 86_400_000;
  const spans: Record<string, number> = { day: 1, week: 7, month: 30 };
  const spanDays = spans[filters.period] ?? 30;
  const since = new Date(until.getTime() - spanDays * dayMs);
  return { since, until, days: spanDays };
}

function inWindow(iso: string, w: ResolvedWindow): boolean {
  const t = new Date(iso).getTime();
  if (w.since && t < w.since.getTime()) return false;
  if (t > w.until.getTime()) return false;
  return true;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Usage metrics
// ---------------------------------------------------------------------------

function computeUsageMetrics(
  sessionRows: (typeof schema.sessions.$inferSelect)[],
  modelRequestRows: (typeof schema.modelRequests.$inferSelect)[],
  window: ResolvedWindow,
): UsageMetrics {
  const totalSessions = sessionRows.length;

  // Active days = distinct UTC date of startedAt.
  const daySet = new Set(sessionRows.map((s) => s.startedAt.slice(0, 10)));
  const activeDays = daySet.size;

  // Durations (reported by source; some sessions may lack one).
  const durations = sessionRows
    .map((s) => s.durationMs)
    .filter((d): d is number => typeof d === "number");
  const durationProv =
    durations.length === totalSessions ? "reported" : durations.length > 0 ? "inferred" : "unknown";
  const medianDur = median(durations);
  const meanDur =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const totalDur = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;
  const durationNote =
    durations.length === totalSessions
      ? undefined
      : `${durations.length} of ${totalSessions} sessions had a recorded duration`;

  const totalPrompts = sessionRows.reduce((a, s) => a + s.promptCount, 0);
  const totalToolCalls = sessionRows.reduce((a, s) => a + s.toolCallCount, 0);

  // Tokens (reported by Claude usage field).
  const inputTokens = sum(modelRequestRows, (m) => m.inputTokens);
  const outputTokens = sum(modelRequestRows, (m) => m.outputTokens);
  const cacheReadTokens = sum(modelRequestRows, (m) => m.cacheReadTokens);
  const cacheCreationTokens = sum(modelRequestRows, (m) => m.cacheCreationTokens);
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  const tokensProv = modelRequestRows.length > 0 ? "reported" : "unknown";

  const totalCompactions = sessionRows.reduce((a, s) => a + s.compactionCount, 0);
  const totalSubagents = sessionRows.reduce((a, s) => a + s.subagentCount, 0);

  // Sessions per day/week/month (rate estimates over the window).
  const days = window.days ?? Math.max(activeDays, 1);
  const sessionsPerDay = totalSessions / days;
  const sessionsPerWeek = totalSessions / Math.max(days / 7, 1 / 7);
  const sessionsPerMonth = totalSessions / Math.max(days / 30, 1 / 30);

  // Model usage breakdown.
  const modelUsage = computeModelUsage(modelRequestRows);

  return {
    totalSessions: exact(totalSessions),
    sessionsPerDay: estimated(sessionsPerDay, `Rate over ${days} day(s) in the window`),
    sessionsPerWeek: estimated(sessionsPerWeek, `Rate over ${days} day(s) in the window`),
    sessionsPerMonth: estimated(sessionsPerMonth, `Rate over ${days} day(s) in the window`),
    activeDays: exact(activeDays),
    medianSessionDurationMs: durationPv(medianDur, durationProv, durationNote),
    meanSessionDurationMs: durationPv(meanDur, durationProv, durationNote),
    totalDurationMs: durationPv(totalDur, durationProv, durationNote),
    promptsPerSession: exact(totalSessions > 0 ? totalPrompts / totalSessions : 0),
    toolCallsPerSession: exact(totalSessions > 0 ? totalToolCalls / totalSessions : 0),
    toolSuccessRate: exact(0), // overwritten by tool-behaviour computation below
    totalTokens: pv(totalTokens, tokensProv),
    inputTokens: pv(inputTokens, tokensProv),
    outputTokens: pv(outputTokens, tokensProv),
    cacheReadTokens: pv(cacheReadTokens, tokensProv),
    cacheCreationTokens: pv(cacheCreationTokens, tokensProv),
    totalCompactions: exact(totalCompactions),
    totalSubagentSessions: exact(totalSubagents),
    estimatedCostUsd: unknown<number | null>("Computed by the cost module."),
    modelUsage,
  };
}

function durationPv(
  value: number | null,
  prov: "reported" | "inferred" | "unknown",
  note?: string,
): ProvenancedValue<number | null> {
  if (value === null) return unknown<number>(note);
  if (prov === "reported") return exact(value, note);
  return inferred(value, note);
}

function pv(value: number, prov: "reported" | "unknown"): ProvenancedValue<number> {
  if (prov === "unknown") return exact(value, "No model usage recorded in this window.");
  return reported(value);
}

function computeModelUsage(
  modelRequestRows: (typeof schema.modelRequests.$inferSelect)[],
): ModelUsageRow[] {
  const byModel = new Map<
    string,
    {
      sessions: Set<string>;
      modelRequests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }
  >();
  // Pre-index which sessions use which models via the session id.
  for (const m of modelRequestRows) {
    let entry = byModel.get(m.modelId);
    if (!entry) {
      entry = {
        sessions: new Set<string>(),
        modelRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      byModel.set(m.modelId, entry);
    }
    entry.sessions.add(m.sessionId);
    entry.modelRequests += 1;
    entry.inputTokens += m.inputTokens ?? 0;
    entry.outputTokens += m.outputTokens ?? 0;
    entry.cacheReadTokens += m.cacheReadTokens ?? 0;
    entry.cacheCreationTokens += m.cacheCreationTokens ?? 0;
  }
  const rows: ModelUsageRow[] = [];
  for (const [modelId, e] of byModel) {
    rows.push({
      modelId,
      sessions: e.sessions.size,
      modelRequests: e.modelRequests,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheCreationTokens: e.cacheCreationTokens,
      estimatedCostUsd: null, // filled from the cost module in computeAnalytics
    });
  }
  rows.sort((a, b) => b.modelRequests - a.modelRequests || a.modelId.localeCompare(b.modelId));
  return rows;
}

// ---------------------------------------------------------------------------
// Tool behaviour
// ---------------------------------------------------------------------------

function computeToolBehaviour(
  toolCallRows: (typeof schema.toolCalls.$inferSelect)[],
  fileActivityRows: (typeof schema.fileActivity.$inferSelect)[],
  commandRows: (typeof schema.commandRuns.$inferSelect)[],
  options: ComputeAnalyticsOptions,
): ToolBehaviourMetrics {
  const threshold = options.repetitionThreshold ?? DEFAULT_REPETITION_THRESHOLD;

  // Most-used tools.
  const byTool = new Map<string, { calls: number; failures: number; durations: number[] }>();
  for (const t of toolCallRows) {
    let entry = byTool.get(t.toolName);
    if (!entry) {
      entry = { calls: 0, failures: 0, durations: [] };
      byTool.set(t.toolName, entry);
    }
    entry.calls += 1;
    if (!t.success) entry.failures += 1;
    if (typeof t.durationMs === "number") entry.durations.push(t.durationMs);
  }
  const mostUsedTools: ToolUsageRow[] = [];
  let totalCalls = 0;
  let totalFailures = 0;
  const allDurations: number[] = [];
  for (const [toolName, e] of byTool) {
    const avgDur =
      e.durations.length > 0 ? e.durations.reduce((a, b) => a + b, 0) / e.durations.length : null;
    mostUsedTools.push({
      toolName,
      calls: e.calls,
      failures: e.failures,
      failureRate: e.calls > 0 ? e.failures / e.calls : 0,
      averageDurationMs: avgDur,
    });
    totalCalls += e.calls;
    totalFailures += e.failures;
    allDurations.push(...e.durations);
  }
  mostUsedTools.sort((a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName));

  const averageToolDurationMs =
    allDurations.length > 0 ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length : null;

  // Repeated reads: file_activity(operation=read) grouped by pathHash.
  const repeatedReads = repeatedFileOps(fileActivityRows, "read", threshold);
  // Repeated searches: search tool calls grouped by tool + input.
  const repeatedSearches = collectRepeatedSearches(toolCallRows, threshold);
  // Repeated commands: command_runs grouped by normalisedHash.
  const repeatedCommands = collectRepeatedCommands(commandRows, threshold, false);
  // Repeated failed commands.
  const repeatedFailedCommands = collectRepeatedCommands(commandRows, threshold, true);

  const largestIn = maxOrNull(toolCallRows, (t) => t.inputSizeBytes);
  const largestOut = maxOrNull(toolCallRows, (t) => t.outputSizeBytes);
  const testCount = commandRows.filter((c) => c.classification === "test").length;
  const buildCount = commandRows.filter((c) => c.classification === "build").length;

  return {
    mostUsedTools,
    toolFailureRate: exact(totalCalls > 0 ? totalFailures / totalCalls : 0),
    averageToolDurationMs: durationPv(
      averageToolDurationMs,
      averageToolDurationMs != null ? "reported" : "unknown",
    ),
    repeatedReads,
    repeatedSearches,
    repeatedCommands,
    repeatedFailedCommands,
    largestToolInputsBytes: sizePv(largestIn),
    largestToolOutputsBytes: sizePv(largestOut),
    testCommandFrequency: exact(testCount),
    buildCommandFrequency: exact(buildCount),
  };
}

function sizePv(value: number | null): ProvenancedValue<number | null> {
  if (value === null) return unknown<number>("No sizes recorded in this window.");
  return exact(value);
}

function repeatedFileOps(
  rows: (typeof schema.fileActivity.$inferSelect)[],
  operation: string,
  threshold: number,
): RepeatedOperation[] {
  const groups = new Map<string, { label: string; occurrences: number; sessions: Set<string> }>();
  for (const f of rows) {
    if (f.operation !== operation) continue;
    let g = groups.get(f.pathHash);
    if (!g) {
      g = { label: f.redactedPath ?? "[path]", occurrences: 0, sessions: new Set<string>() };
      groups.set(f.pathHash, g);
    }
    g.occurrences += 1;
    g.sessions.add(f.sessionId);
  }
  return toRepeated(groups, threshold, "read");
}

function collectRepeatedSearches(
  toolCallRows: (typeof schema.toolCalls.$inferSelect)[],
  threshold: number,
): RepeatedOperation[] {
  const groups = new Map<string, { label: string; occurrences: number; sessions: Set<string> }>();
  for (const t of toolCallRows) {
    if (!SEARCH_TOOLS.has(t.toolName)) continue;
    const key = `${t.toolName}:${t.sanitisedInput ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { label: t.toolName, occurrences: 0, sessions: new Set<string>() };
      groups.set(key, g);
    }
    g.occurrences += 1;
    g.sessions.add(t.sessionId);
  }
  return toRepeated(groups, threshold, "search");
}

function collectRepeatedCommands(
  commandRows: (typeof schema.commandRuns.$inferSelect)[],
  threshold: number,
  failedOnly: boolean,
): RepeatedOperation[] {
  const groups = new Map<string, { label: string; occurrences: number; sessions: Set<string> }>();
  for (const c of commandRows) {
    if (failedOnly && c.exitSuccess) continue;
    let g = groups.get(c.normalisedHash);
    if (!g) {
      g = { label: c.redactedCommand, occurrences: 0, sessions: new Set<string>() };
      groups.set(c.normalisedHash, g);
    }
    g.occurrences += 1;
    g.sessions.add(c.sessionId);
  }
  return toRepeated(groups, threshold, failedOnly ? "failed-command" : "command");
}

function toRepeated(
  groups: Map<string, { label: string; occurrences: number; sessions: Set<string> }>,
  threshold: number,
  kind: RepeatedOperation["kind"],
): RepeatedOperation[] {
  const out: RepeatedOperation[] = [];
  for (const [key, g] of groups) {
    if (g.occurrences < threshold) continue;
    out.push({ key, label: g.label, occurrences: g.occurrences, sessions: g.sessions.size, kind });
  }
  out.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));
  return out;
}

// ---------------------------------------------------------------------------
// Workflow metrics
// ---------------------------------------------------------------------------

function computeWorkflowMetrics(
  sessionRows: (typeof schema.sessions.$inferSelect)[],
  fileActivityRows: (typeof schema.fileActivity.$inferSelect)[],
  verificationRows: (typeof schema.verificationRuns.$inferSelect)[],
  promptRows: (typeof schema.prompts.$inferSelect)[],
): WorkflowMetrics {
  // Files changed per session: distinct write-operation pathHash per session, averaged.
  const writesBySession = new Map<string, Set<string>>();
  for (const f of fileActivityRows) {
    if (!WRITE_OPERATIONS.has(f.operation)) continue;
    let set = writesBySession.get(f.sessionId);
    if (!set) {
      set = new Set<string>();
      writesBySession.set(f.sessionId, set);
    }
    set.add(f.pathHash);
  }
  const filesChangedCounts = sessionRows.map((s) => writesBySession.get(s.id)?.size ?? 0);
  const filesChangedPerSession = mean(filesChangedCounts);

  // Read-to-write ratio across all file activity.
  let reads = 0;
  let writes = 0;
  for (const f of fileActivityRows) {
    if (f.operation === "read") reads += 1;
    else if (WRITE_OPERATIONS.has(f.operation)) writes += 1;
  }
  const readToWriteRatio = writes > 0 ? reads / writes : null;

  // Verification runs.
  const totalVerificationRuns = verificationRows.length;

  // Per-session last verification + writes timeline.
  const verifyBySession = groupBySession(verificationRows);
  const writesBySessionTimeline = new Map<string, (typeof schema.fileActivity.$inferSelect)[]>();
  for (const f of fileActivityRows) {
    if (!WRITE_OPERATIONS.has(f.operation)) continue;
    const arr = writesBySessionTimeline.get(f.sessionId) ?? [];
    arr.push(f);
    writesBySessionTimeline.set(f.sessionId, arr);
  }
  for (const arr of writesBySessionTimeline.values())
    arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let sessionsEndingAfterSuccessfulVerification = 0;
  let sessionsEndingWithKnownFailures = 0;
  let changesAfterFinalVerification = 0;
  const timeToFirstEdit: number[] = [];
  const timeBetweenFinalEditAndVerification: number[] = [];

  const sessionById = new Map(sessionRows.map((s) => [s.id, s]));

  for (const [sessionId, verifications] of verifyBySession) {
    verifications.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const last = verifications[verifications.length - 1];
    if (!last) continue;
    const session = sessionById.get(sessionId);
    if (last.success && session?.completionStatus === "completed") {
      sessionsEndingAfterSuccessfulVerification += 1;
    }
    if (!last.success || session?.completionStatus === "failed") {
      sessionsEndingWithKnownFailures += 1;
    }
    // Changes after final verification: a write with timestamp > last verify.
    const lastVerifyMs = new Date(last.timestamp).getTime();
    const writes = writesBySessionTimeline.get(sessionId) ?? [];
    if (writes.some((w) => new Date(w.timestamp).getTime() > lastVerifyMs)) {
      changesAfterFinalVerification += 1;
    }

    // Time between final edit and (next) verification, and time to first edit.
    const sessionStart = session ? new Date(session.startedAt).getTime() : null;
    if (writes.length > 0 && sessionStart != null) {
      const firstWrite = writes[0];
      if (firstWrite) {
        const firstEditMs = new Date(firstWrite.timestamp).getTime();
        timeToFirstEdit.push(firstEditMs - sessionStart);
      }
    }
    // Final edit → next verification (first verification after the last write).
    if (writes.length > 0) {
      const lastWrite = writes[writes.length - 1];
      if (lastWrite) {
        const lastWriteMs = new Date(lastWrite.timestamp).getTime();
        const nextVerify = verifications.find((v) => new Date(v.timestamp).getTime() > lastWriteMs);
        if (nextVerify) {
          timeBetweenFinalEditAndVerification.push(
            new Date(nextVerify.timestamp).getTime() - lastWriteMs,
          );
        }
      }
    }
  } // end for each verification session

  // Corrective prompts: a prompt following a failed verification in the session.
  let correctivePromptCount = 0;
  const failedVerifyBySession = new Map<string, number[]>();
  for (const v of verificationRows) {
    if (!v.success) {
      const arr = failedVerifyBySession.get(v.sessionId) ?? [];
      arr.push(new Date(v.timestamp).getTime());
      failedVerifyBySession.set(v.sessionId, arr);
    }
  }
  for (const p of promptRows) {
    const failedTimes = failedVerifyBySession.get(p.sessionId);
    if (!failedTimes) continue;
    const pMs = new Date(p.timestamp).getTime();
    if (failedTimes.some((fms) => fms < pMs)) correctivePromptCount += 1;
  }

  return {
    filesChangedPerSession: exactOrUnknown(filesChangedPerSession),
    readToWriteRatio: ratioPv(readToWriteRatio),
    totalVerificationRuns: exact(totalVerificationRuns),
    sessionsEndingAfterSuccessfulVerification: exact(sessionsEndingAfterSuccessfulVerification),
    sessionsEndingWithKnownFailures: exact(sessionsEndingWithKnownFailures),
    changesAfterFinalVerification: inferred(
      changesAfterFinalVerification,
      "Write activity after the last verification run in a session",
    ),
    correctivePromptCount: inferred(
      correctivePromptCount,
      "Prompt following a failed verification run",
    ),
    medianTimeToFirstEditMs: durationPv(
      median(timeToFirstEdit),
      timeToFirstEdit.length > 0 ? "inferred" : "unknown",
    ),
    medianTimeBetweenFinalEditAndVerificationMs: durationPv(
      median(timeBetweenFinalEditAndVerification),
      timeBetweenFinalEditAndVerification.length > 0 ? "inferred" : "unknown",
    ),
  };
}

function ratioPv(value: number | null): ProvenancedValue<number | null> {
  if (value === null) return unknown<number>("No write file activity in this window.");
  return exact(value);
}

function exactOrUnknown(value: number | null): ProvenancedValue<number | null> {
  if (value === null) return unknown<number>("No sessions in this window.");
  return exact(value);
}

// ---------------------------------------------------------------------------
// Completeness + completion + provenance
// ---------------------------------------------------------------------------

function computeCompletenessSummary(
  sessionRows: (typeof schema.sessions.$inferSelect)[],
): CompletenessSummary {
  let complete = 0;
  let partialTailMissing = 0;
  let partialMetricsMissing = 0;
  let partialPromptsMissing = 0;
  for (const s of sessionRows) {
    const flags = s.dataCompleteness as string[];
    if (flags.length === 0 || flags.includes("complete")) complete += 1;
    if (flags.includes("partial-tail-missing")) partialTailMissing += 1;
    if (flags.includes("partial-metrics-missing")) partialMetricsMissing += 1;
    if (flags.includes("partial-prompts-missing")) partialPromptsMissing += 1;
  }
  return {
    totalSessions: sessionRows.length,
    complete,
    partialTailMissing,
    partialMetricsMissing,
    partialPromptsMissing,
  };
}

function computeCompletionSummary(
  sessionRows: (typeof schema.sessions.$inferSelect)[],
): CompletionSummary {
  const counts = { completed: 0, interrupted: 0, failed: 0, unknown: 0 };
  for (const s of sessionRows) {
    const status = s.completionStatus as keyof typeof counts;
    if (status in counts) counts[status] += 1;
    else counts.unknown += 1;
  }
  return { total: sessionRows.length, ...counts };
}

async function computeScanProvenance(
  db: DrizzleDb,
  sessionRows: (typeof schema.sessions.$inferSelect)[],
): Promise<ScanProvenanceSummary> {
  const sourceIds = new Set(sessionRows.map((s) => s.sourceId));
  const sortedSourceIds = [...sourceIds].sort();
  const sourceId = sortedSourceIds.length > 0 ? (sortedSourceIds[0] ?? "unknown") : "unknown";

  let adapterVersion: string | undefined;
  let parserVersion: number | undefined;
  if (sourceIds.size > 0) {
    const sourceRow = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .limit(1);
    adapterVersion = sourceRow[0]?.version ?? undefined;
    // importProvenance is shaped "claude-code@<ver>/parser@<n>".
    const prov = sessionRows[0]?.importProvenance ?? "";
    const m = prov.match(/parser@(\d+)/);
    parserVersion = m ? Number(m[1]) : undefined;
  }

  return {
    sourceId,
    adapterVersion,
    parserVersion,
    importedSessions: sessionRows.length,
    skippedSessions: 0, // not tracked separately in M1
  };
}

// ---------------------------------------------------------------------------
// Empty snapshot + numeric helpers
// ---------------------------------------------------------------------------

function emptySnapshot(
  generatedAt: string,
  filters: ReportFilters,
  options: ComputeAnalyticsOptions,
): AnalyticsSnapshot {
  const unknownNum = unknown<number>("No sessions in this window.");
  const zero = exact(0);
  return {
    generatedAt,
    filters,
    privacyMode: options.privacyMode ?? "redacted-content",
    usage: {
      totalSessions: zero,
      sessionsPerDay: zero,
      sessionsPerWeek: zero,
      sessionsPerMonth: zero,
      activeDays: zero,
      medianSessionDurationMs: unknownNum,
      meanSessionDurationMs: unknownNum,
      totalDurationMs: unknownNum,
      promptsPerSession: zero,
      toolCallsPerSession: zero,
      toolSuccessRate: zero,
      totalTokens: zero,
      inputTokens: zero,
      outputTokens: zero,
      cacheReadTokens: zero,
      cacheCreationTokens: zero,
      totalCompactions: zero,
      totalSubagentSessions: zero,
      estimatedCostUsd: unknown<number | null>("No model usage in this window."),
      modelUsage: [],
    },
    tools: {
      mostUsedTools: [],
      toolFailureRate: zero,
      averageToolDurationMs: unknownNum,
      repeatedReads: [],
      repeatedSearches: [],
      repeatedCommands: [],
      repeatedFailedCommands: [],
      largestToolInputsBytes: unknownNum,
      largestToolOutputsBytes: unknownNum,
      testCommandFrequency: zero,
      buildCommandFrequency: zero,
    },
    workflow: {
      filesChangedPerSession: unknownNum,
      readToWriteRatio: unknownNum,
      totalVerificationRuns: zero,
      sessionsEndingAfterSuccessfulVerification: zero,
      sessionsEndingWithKnownFailures: zero,
      changesAfterFinalVerification: zero,
      correctivePromptCount: zero,
      medianTimeToFirstEditMs: unknownNum,
      medianTimeBetweenFinalEditAndVerificationMs: unknownNum,
    },
    cost: {
      totalUsd: unknown<number | null>("No model usage in this window."),
      byModel: [],
      methodology: "unknown",
    },
    completeness: {
      totalSessions: 0,
      complete: 0,
      partialTailMissing: 0,
      partialMetricsMissing: 0,
      partialPromptsMissing: 0,
    },
    completion: { total: 0, completed: 0, interrupted: 0, failed: 0, unknown: 0 },
    scanProvenance: { sourceId: "unknown", importedSessions: 0, skippedSessions: 0 },
    recommendations: [],
    minimumRecommendationConfidence: options.minimumRecommendationConfidence,
  };
}

function sum<T>(rows: T[], pick: (r: T) => number | null | undefined): number {
  let total = 0;
  for (const r of rows) {
    const v = pick(r);
    if (typeof v === "number") total += v;
  }
  return total;
}

function maxOrNull<T>(rows: T[], pick: (r: T) => number | null | undefined): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const v = pick(r);
    if (typeof v === "number" && (max === null || v > max)) max = v;
  }
  return max;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    return a !== undefined && b !== undefined ? (a + b) / 2 : null;
  }
  return sorted[mid] ?? null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function groupBySession<T extends { sessionId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const arr = out.get(r.sessionId) ?? [];
    arr.push(r);
    out.set(r.sessionId, arr);
  }
  return out;
}
