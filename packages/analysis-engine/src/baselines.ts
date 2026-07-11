/**
 * Behavioural baselines + session comparison (spec §15.3).
 *
 * A baseline summarises a user's *own* history so a session can be judged
 * against what is normal for them — never against invented industry averages
 * (§15.3, §3.4). Three baselines are produced:
 *
 * - **personal** — all of the user's sessions (their overall typical behaviour)
 * - **project**  — sessions for the same project as the session under review
 * - **recent**   — the most recent N sessions (recency-weighted "lately")
 *
 * Each dimension carries a robust statistic (median + median absolute
 * deviation) and a {@link MetricProvenance}; a session is compared by robust
 * deviation score and ratio, with direction labelled. Computation reuses the
 * same persisted rows as `computeAnalytics` but is independent of the report
 * window so a baseline can span all history.
 */
import { eq, inArray } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { schema } from "@agentlens/database";
import type {
  BaselineDeviation,
  BaselineDimension,
  BehaviouralBaseline,
  MetricProvenance,
  SessionComparison,
  SessionDataPoint,
} from "@agentlens/domain";

/** Options for {@link computeBaselines}. */
export interface ComputeBaselinesOptions {
  /** Restrict the personal baseline to a single project's sessions. */
  projectId?: string;
  /** Override "now" (tests). Sessions are sorted by startedAt descending. */
  now?: Date;
  /** Number of most-recent sessions for the "recent" baseline (default 10). */
  recentCount?: number;
}

/** Result of {@link computeBaselines}. */
export interface BaselinesResult {
  personal: BehaviouralBaseline;
  /** Per-project baselines keyed by project id (includes the session's project). */
  byProject: Map<string, BehaviouralBaseline>;
  recent: BehaviouralBaseline;
  /** The underlying per-session data points (sorted oldest → newest). */
  dataPoints: SessionDataPoint[];
}

type SessionRow = typeof schema.sessions.$inferSelect;
type ModelRequestRow = typeof schema.modelRequests.$inferSelect;
type ToolCallRow = typeof schema.toolCalls.$inferSelect;
type FileActivityRow = typeof schema.fileActivity.$inferSelect;
type CommandRow = typeof schema.commandRuns.$inferSelect;
type VerificationRow = typeof schema.verificationRuns.$inferSelect;
type PromptRow = typeof schema.prompts.$inferSelect;

/**
 * Compute personal / per-project / recent baselines from persisted history.
 * Loads its own rows (independent of any report window) so a baseline can span
 * all of the user's recorded sessions.
 */
export async function computeBaselines(
  db: DrizzleDb,
  options: ComputeBaselinesOptions = {},
): Promise<BaselinesResult> {
  const sessionRows = options.projectId
    ? await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.projectId, options.projectId))
    : await db.select().from(schema.sessions);

  const sessionIds = sessionRows.map((s) => s.id);
  if (sessionIds.length === 0) {
    const empty: BehaviouralBaseline = {
      scope: "personal",
      sampleSize: 0,
      stats: {},
      modelDistribution: [],
    };
    return {
      personal: empty,
      byProject: new Map(),
      recent: { ...empty, scope: "recent" },
      dataPoints: [],
    };
  }

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

  const dataPoints = computeSessionDataPoints(
    sessionRows,
    modelRequestRows,
    toolCallRows,
    fileActivityRows,
    commandRows,
    verificationRows,
    promptRows,
  );

  const recentCount = options.recentCount ?? 10;
  const byDate = [...dataPoints].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const recentPoints = byDate.slice(-recentCount);

  const personal = aggregateBaseline(dataPoints, "personal");
  const recent = aggregateBaseline(recentPoints, "recent");

  // Attach model distributions from the recorded model requests (the data
  // points carry diversity only, not per-model counts).
  personal.modelDistribution = modelDistribution(modelRequestRows, dataPoints);
  recent.modelDistribution = modelDistribution(modelRequestRows, recentPoints);

  const byProject = new Map<string, BehaviouralBaseline>();
  const byProjectMap = new Map<string, SessionDataPoint[]>();
  for (const dp of dataPoints) {
    const arr = byProjectMap.get(dp.projectId) ?? [];
    arr.push(dp);
    byProjectMap.set(dp.projectId, arr);
  }
  for (const [pid, pts] of byProjectMap) {
    const b = aggregateBaseline(pts, "project", pid);
    b.modelDistribution = modelDistribution(modelRequestRows, pts);
    byProject.set(pid, b);
  }

  return { personal, byProject, recent, dataPoints };
}

/**
 * Build per-session data points from the persisted rows. Pure function so it
 * is independently testable without a database (§15.1 — analysis is
 * independently testable).
 */
export function computeSessionDataPoints(
  sessionRows: SessionRow[],
  modelRequestRows: ModelRequestRow[],
  toolCallRows: ToolCallRow[],
  fileActivityRows: FileActivityRow[],
  commandRows: CommandRow[],
  verificationRows: VerificationRow[],
  promptRows: PromptRow[],
): SessionDataPoint[] {
  const toolsBySession = groupBySession(toolCallRows);
  const modelsBySession = groupBySession(modelRequestRows);
  const filesBySession = groupBySession(fileActivityRows);
  const commandsBySession = groupBySession(commandRows);
  const verifyBySession = groupBySession(verificationRows);
  const promptsBySession = groupBySession(promptRows);

  // Corrective turns: a prompt timestamped after a failed verification in the
  // same session (mirrors the snapshot's correctivePromptCount definition).
  const failedVerifyBySession = new Map<string, number[]>();
  for (const v of verificationRows) {
    if (!v.success) {
      const arr = failedVerifyBySession.get(v.sessionId) ?? [];
      arr.push(new Date(v.timestamp).getTime());
      failedVerifyBySession.set(v.sessionId, arr);
    }
  }

  return sessionRows.map((s) => {
    const tools = toolsBySession.get(s.id) ?? [];
    const models = modelsBySession.get(s.id) ?? [];
    const files = filesBySession.get(s.id) ?? [];
    const commands = commandsBySession.get(s.id) ?? [];
    const verifies = verifyBySession.get(s.id) ?? [];
    const prompts = promptsBySession.get(s.id) ?? [];

    const reads = files.filter((f) => f.operation === "read").length;
    const writes = files.filter((f) => f.operation === "write" || f.operation === "edit").length;
    const readToWriteRatio = writes > 0 ? reads / writes : null;

    const largestOutputBytes =
      commands.reduce((m, c) => Math.max(m, c.outputSizeBytes ?? 0), 0) || null;
    const testFrequency = verifies.filter((v) => v.kind === "test").length;
    const modelDiversity = new Set(models.map((m) => m.modelId)).size;

    let correctiveTurnCount = 0;
    const failedTimes = failedVerifyBySession.get(s.id);
    if (failedTimes) {
      for (const p of prompts) {
        const pMs = new Date(p.timestamp).getTime();
        if (failedTimes.some((fms) => fms < pMs)) correctiveTurnCount += 1;
      }
    }

    return {
      sessionId: s.id,
      projectId: s.projectId,
      startedAt: s.startedAt,
      sessionDurationMs: s.durationMs,
      toolCallCount: tools.length,
      testFrequency,
      readToWriteRatio,
      largestOutputBytes,
      compactionCount: s.compactionCount,
      modelDiversity,
      correctiveTurnCount,
      promptCount: s.promptCount,
    };
  });
}

/** The dimensions a baseline tracks, in stable order. */
const BASELINE_DIMENSIONS: readonly BaselineDimension[] = [
  "sessionDurationMs",
  "toolCallCount",
  "testFrequency",
  "readToWriteRatio",
  "largestOutputBytes",
  "compactionCount",
  "modelDiversity",
  "correctiveTurnCount",
  "promptCount",
];

/** Read a dimension's numeric value from a data point (null when missing). */
function pickDimension(p: SessionDataPoint, dim: BaselineDimension): number | null {
  return p[dim];
}

/**
 * Aggregate a set of data points into a baseline. Each dimension becomes a
 * robust stat (median + MAD); the model distribution is attached separately by
 * {@link computeBaselines} (it needs the raw model-request rows).
 */
export function aggregateBaseline(
  points: SessionDataPoint[],
  scope: BehaviouralBaseline["scope"],
  projectId?: string,
): BehaviouralBaseline {
  const stats: BehaviouralBaseline["stats"] = {};
  for (const dim of BASELINE_DIMENSIONS) {
    const values = points.map((p) => pickDimension(p, dim)).filter((v): v is number => v != null);
    if (values.length === 0) continue;
    const med = median(values);
    const madValue = mad(values, med);
    // A median of exact/reported per-session values is an inference about
    // "typical"; with a single contributing session it is reported as-is.
    const provenance: MetricProvenance = values.length === 1 ? "reported" : "inferred";
    stats[dim] = {
      median: med,
      mad: madValue,
      sampleSize: values.length,
      provenance,
    };
  }

  const baseline: BehaviouralBaseline = {
    scope,
    sampleSize: points.length,
    stats,
    modelDistribution: [],
  };
  if (projectId) baseline.projectId = projectId;
  return baseline;
}

/** Model distribution (model id → share of recorded requests) for a point set. */
function modelDistribution(
  modelRequestRows: ModelRequestRow[],
  points: SessionDataPoint[],
): BehaviouralBaseline["modelDistribution"] {
  const sessionSet = new Set(points.map((p) => p.sessionId));
  const counts = new Map<string, number>();
  let total = 0;
  for (const m of modelRequestRows) {
    if (!sessionSet.has(m.sessionId)) continue;
    counts.set(m.modelId, (counts.get(m.modelId) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([modelId, count]) => ({
      modelId,
      share: Number((count / total).toFixed(4)),
      provenance: "inferred" as MetricProvenance,
    }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Compare a session's data point against the personal/project/recent baselines.
 * Dimensions without a baseline stat are omitted. Direction is "typical" when
 * the robust deviation score is below the threshold (default 1.5 MADs).
 */
export function compareSession(
  point: SessionDataPoint,
  baselines: {
    personal: BehaviouralBaseline;
    project: BehaviouralBaseline | null;
    recent: BehaviouralBaseline;
  },
  options: { deviationThreshold?: number } = {},
): SessionComparison {
  const threshold = options.deviationThreshold ?? 1.5;

  const deviationsFor = (b: BehaviouralBaseline): BaselineDeviation[] => {
    const out: BaselineDeviation[] = [];
    for (const dim of BASELINE_DIMENSIONS) {
      const st = b.stats[dim];
      if (!st || st.median == null) continue;
      const sessionValue = pickDimension(point, dim);
      const baselineMedian = st.median;
      const ratio = computeRatio(sessionValue, baselineMedian);
      const spread = st.mad ?? 0;
      const deviationScore =
        sessionValue == null
          ? 0
          : spread > 0
            ? Math.abs(sessionValue - baselineMedian) / spread
            : sessionValue === baselineMedian
              ? 0
              : 1;
      const direction: BaselineDeviation["direction"] =
        sessionValue == null
          ? "unknown"
          : deviationScore < threshold
            ? "typical"
            : sessionValue > baselineMedian
              ? "higher"
              : "lower";
      out.push({
        dimension: dim,
        sessionValue,
        baselineMedian,
        ratio: ratio == null ? null : Number.isFinite(ratio) ? Number(ratio.toFixed(3)) : ratio,
        deviationScore: Number(deviationScore.toFixed(3)),
        direction,
        provenance: sessionValue == null ? "unknown" : "inferred",
      });
    }
    return out;
  };

  const deviations: SessionComparison["deviations"] = [
    { baseline: "personal", deviations: deviationsFor(baselines.personal) },
  ];
  if (baselines.project) {
    deviations.push({ baseline: "project", deviations: deviationsFor(baselines.project) });
  }
  deviations.push({ baseline: "recent", deviations: deviationsFor(baselines.recent) });

  return {
    sessionId: point.sessionId,
    personal: baselines.personal,
    project: baselines.project,
    recent: baselines.recent,
    deviations,
  };
}

function computeRatio(sessionValue: number | null, baselineMedian: number): number | null {
  if (sessionValue == null) return null;
  if (baselineMedian === 0) return sessionValue > 0 ? Number.POSITIVE_INFINITY : 0;
  return sessionValue / baselineMedian;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Median absolute deviation (robust spread). */
function mad(values: number[], med: number | null): number | null {
  if (med == null || values.length === 0) return null;
  return median(values.map((v) => Math.abs(v - med)));
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
