/**
 * Baseline + session-comparison tests (spec §15.3, §3.4).
 *
 * Covers: per-session data-point extraction, robust median/MAD aggregation,
 * personal/project/recent baseline computation, model-distribution attach,
 * session-vs-baseline deviations (direction/ratio/deviationScore), and the
 * §15.3 invariant that baselines are the user's *own* history — never invented
 * industry averages. Pure functions are tested with hand-built data points; the
 * DB-backed {@link computeBaselines} is exercised against a temp SQLite DB
 * (§21 — never the developer's real data).
 */
import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import { openDatabase, closeDatabase, schema, type Database } from "@agentlens/database";
import type { BaselineDeviation, SessionDataPoint } from "@agentlens/domain";
import {
  aggregateBaseline,
  compareSession,
  computeBaselines,
  computeSessionDataPoints,
} from "./baselines.js";

const NOW = "2026-07-10T12:00:00.000Z";

/** Pull a single dimension's deviation out of a comparison (throws clearly if absent). */
function deviation(
  cmp: ReturnType<typeof compareSession>,
  baseline: "personal" | "project" | "recent",
  dimension: BaselineDeviation["dimension"],
): BaselineDeviation {
  const group = cmp.deviations.find((d) => d.baseline === baseline);
  if (!group) throw new Error(`no deviations for baseline ${baseline}`);
  const dev = group.deviations.find((d) => d.dimension === dimension);
  if (!dev) throw new Error(`no deviation for ${dimension} under ${baseline}`);
  return dev;
}
const SOURCE_ID = "claude-code";
const PROJECT_A = "proj:a";
const PROJECT_B = "proj:b";

async function withDb<T>(fn: (database: Database) => Promise<T>): Promise<T> {
  const database = await openDatabase({ home: "", nowIso: NOW, inMemory: true });
  try {
    return await fn(database);
  } finally {
    await closeDatabase(database);
    await Promise.all([
      rm(database.path, { force: true }),
      rm(`${database.path}-wal`, { force: true }),
      rm(`${database.path}-shm`, { force: true }),
    ]);
  }
}

async function seedProject(db: Database["db"], id: string): Promise<void> {
  await db.insert(schema.projects).values({
    id,
    sourceId: SOURCE_ID,
    displayName: id,
    pathHash: `hash-${id}`,
    redactedPath: id,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  });
}

async function seedSource(db: Database["db"]): Promise<void> {
  await db.insert(schema.sources).values({
    id: SOURCE_ID,
    adapter: "claude-code",
    displayName: "Claude Code",
    version: "0.1.0",
    enabled: true,
  });
}

/** Seed a session with a configurable profile of child rows. */
async function seedSession(
  db: Database["db"],
  opts: {
    id: string;
    projectId: string;
    startedAt: string;
    durationMs: number | null;
    promptCount: number;
    toolCalls: number;
    compactions: number;
    models: string[];
    reads: number;
    writes: number;
    tests: number;
    failedVerifications: number;
    largestOutputBytes: number;
  },
): Promise<void> {
  await db.insert(schema.sessions).values({
    id: opts.id,
    sourceSessionId: opts.id,
    sourceId: SOURCE_ID,
    projectId: opts.projectId,
    startedAt: opts.startedAt,
    endedAt:
      opts.durationMs == null
        ? null
        : new Date(new Date(opts.startedAt).getTime() + opts.durationMs).toISOString(),
    durationMs: opts.durationMs,
    activeDurationMs: null,
    metricProvenance: null,
    entryPoint: "cli",
    sourceVersion: "1.0.0",
    completionStatus: "completed",
    privacyMode: "redacted-content",
    dataCompleteness: ["complete"],
    promptCount: opts.promptCount,
    modelRequestCount: opts.models.length,
    toolCallCount: opts.toolCalls,
    compactionCount: opts.compactions,
    subagentCount: 0,
    importProvenance: "claude-code@0.1.0/parser@1",
  });
  for (let i = 0; i < opts.models.length; i++) {
    await db.insert(schema.modelRequests).values({
      id: `${opts.id}:m:${i}`,
      sessionId: opts.id,
      promptId: null,
      timestamp: opts.startedAt,
      modelId: opts.models[i] ?? "claude-sonnet-5",
      modelFamily: null,
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      estimatedCostUsd: null,
      durationMs: null,
      effort: null,
      querySource: "user",
      metricProvenance: null,
    });
  }
  for (let i = 0; i < opts.toolCalls; i++) {
    await db.insert(schema.toolCalls).values({
      id: `${opts.id}:t:${i}`,
      sessionId: opts.id,
      toolUseId: `tu-${opts.id}-${i}`,
      toolName: "Read",
      startedAt: opts.startedAt,
      endedAt: null,
      durationMs: null,
      success: true,
      failureType: "none",
      permissionOutcome: "allowed",
      inputSizeBytes: null,
      outputSizeBytes: null,
      sourceProvenance: "claude-code@0.1.0/parser@1",
    });
  }
  for (let i = 0; i < opts.reads; i++) {
    await db.insert(schema.fileActivity).values({
      id: `${opts.id}:fr:${i}`,
      sessionId: opts.id,
      toolCallId: null,
      redactedPath: "[REPO]/f.ts",
      pathHash: `rh-${opts.id}-${i}`,
      timestamp: opts.startedAt,
      operation: "read",
      success: true,
      contentSizeBytes: null,
      interveningModification: null,
    });
  }
  for (let i = 0; i < opts.writes; i++) {
    await db.insert(schema.fileActivity).values({
      id: `${opts.id}:fw:${i}`,
      sessionId: opts.id,
      toolCallId: null,
      redactedPath: "[REPO]/f.ts",
      pathHash: `wh-${opts.id}-${i}`,
      timestamp: opts.startedAt,
      operation: "write",
      success: true,
      contentSizeBytes: null,
      interveningModification: null,
    });
  }
  for (let i = 0; i < opts.tests; i++) {
    await db.insert(schema.verificationRuns).values({
      id: `${opts.id}:vt:${i}`,
      sessionId: opts.id,
      commandRunId: null,
      kind: "test",
      timestamp: opts.startedAt,
      success: true,
      codeChangedAfter: false,
    });
  }
  for (let i = 0; i < opts.failedVerifications; i++) {
    const failTs = new Date(new Date(opts.startedAt).getTime() + 1000).toISOString();
    await db.insert(schema.verificationRuns).values({
      id: `${opts.id}:vf:${i}`,
      sessionId: opts.id,
      commandRunId: null,
      kind: "test",
      timestamp: failTs,
      success: false,
      codeChangedAfter: false,
    });
    // A corrective prompt after the failed verification.
    await db.insert(schema.prompts).values({
      id: `${opts.id}:pc:${i}`,
      sessionId: opts.id,
      sequence: 100 + i,
      timestamp: new Date(new Date(failTs).getTime() + 500).toISOString(),
      redactedContent: null,
      contentHash: `ch-${opts.id}-${i}`,
      characterCount: 10,
      approximateTokenCount: 2,
      features: {},
    });
  }
  if (opts.largestOutputBytes > 0) {
    await db.insert(schema.commandRuns).values({
      id: `${opts.id}:cmd:0`,
      sessionId: opts.id,
      toolCallId: null,
      executable: "npm",
      family: "test",
      redactedCommand: "npm test",
      normalisedHash: `nh-${opts.id}`,
      classification: "test",
      scope: "narrow",
      exitSuccess: true,
      durationMs: null,
      outputSizeBytes: opts.largestOutputBytes,
      failureSignature: null,
      gitCommitId: null,
      timestamp: opts.startedAt,
    });
  }
}

describe("aggregateBaseline + compareSession (pure, §15.3)", () => {
  const points: SessionDataPoint[] = [
    {
      sessionId: "s1",
      projectId: "p",
      startedAt: "2026-07-01T00:00:00.000Z",
      sessionDurationMs: 1000,
      toolCallCount: 10,
      testFrequency: 1,
      readToWriteRatio: 4,
      largestOutputBytes: 1000,
      compactionCount: 0,
      modelDiversity: 1,
      correctiveTurnCount: 0,
      promptCount: 3,
    },
    {
      sessionId: "s2",
      projectId: "p",
      startedAt: "2026-07-02T00:00:00.000Z",
      sessionDurationMs: 2000,
      toolCallCount: 20,
      testFrequency: 2,
      readToWriteRatio: 5,
      largestOutputBytes: 2000,
      compactionCount: 1,
      modelDiversity: 1,
      correctiveTurnCount: 1,
      promptCount: 5,
    },
    {
      sessionId: "s3",
      projectId: "p",
      startedAt: "2026-07-03T00:00:00.000Z",
      sessionDurationMs: 3000,
      toolCallCount: 30,
      testFrequency: 3,
      readToWriteRatio: 6,
      largestOutputBytes: 3000,
      compactionCount: 2,
      modelDiversity: 2,
      correctiveTurnCount: 2,
      promptCount: 7,
    },
  ];

  it("aggregates a median + MAD per dimension from the user's own history (no industry averages)", () => {
    const b = aggregateBaseline(points, "personal");
    expect(b.scope).toBe("personal");
    expect(b.sampleSize).toBe(3);
    // Median of {10,20,30} = 20; MAD = median(|10-20|,|20-20|,|30-20|) = 10.
    expect(b.stats.toolCallCount?.median).toBe(20);
    expect(b.stats.toolCallCount?.mad).toBe(10);
    expect(b.stats.toolCallCount?.provenance).toBe("inferred");
    // Single-sample dimensions are reported as-is.
    const first = points[0];
    if (!first) throw new Error("fixture missing");
    const one = aggregateBaseline([first], "personal");
    expect(one.stats.toolCallCount?.median).toBe(10);
    expect(one.stats.toolCallCount?.provenance).toBe("reported");
  });

  it("compareSession labels direction by robust deviation and carries a ratio", () => {
    const baseline = aggregateBaseline(points, "personal");
    const s3 = points[2];
    const s1 = points[0];
    if (!s3 || !s1) throw new Error("fixture missing");
    // s3 sits at the top of the range → typical (deviationScore 1.0 < 1.5).
    const typical = compareSession(s3, { personal: baseline, project: null, recent: baseline });
    const personalTool = deviation(typical, "personal", "toolCallCount");
    expect(personalTool.direction).toBe("typical");
    expect(personalTool.ratio).toBe(1.5);
    expect(personalTool.deviationScore).toBe(1);

    // An outlier session with 200 tool calls → higher.
    const outlier: SessionDataPoint = { ...s1, toolCallCount: 200 };
    const out = compareSession(outlier, { personal: baseline, project: null, recent: baseline });
    const outTool = deviation(out, "personal", "toolCallCount");
    expect(outTool.direction).toBe("higher");
    expect(outTool.ratio).toBe(10);
  });

  it("omits dimensions the baseline has no stat for", () => {
    const first = points[0];
    if (!first) throw new Error("fixture missing");
    // Build a baseline missing toolCallCount by constructing one manually.
    const partial = aggregateBaseline([first], "personal");
    delete partial.stats.toolCallCount;
    const cmp = compareSession(first, { personal: partial, project: null, recent: partial });
    const group = cmp.deviations.find((d) => d.baseline === "personal");
    const dims = group ? group.deviations.map((d) => d.dimension) : [];
    expect(dims).not.toContain("toolCallCount");
  });
});

describe("computeBaselines (DB-backed, §15.3)", () => {
  it("computes personal / per-project / recent baselines + model distribution", async () => {
    await withDb(async (database) => {
      const { db } = database;
      await seedSource(db);
      await seedProject(db, PROJECT_A);
      await seedProject(db, PROJECT_B);

      // Project A: two short sessions; Project B: one long session.
      await seedSession(db, {
        id: "a1",
        projectId: PROJECT_A,
        startedAt: "2026-07-01T00:00:00.000Z",
        durationMs: 1000,
        promptCount: 2,
        toolCalls: 5,
        compactions: 0,
        models: ["claude-sonnet-5"],
        reads: 4,
        writes: 1,
        tests: 1,
        failedVerifications: 0,
        largestOutputBytes: 500,
      });
      await seedSession(db, {
        id: "a2",
        projectId: PROJECT_A,
        startedAt: "2026-07-02T00:00:00.000Z",
        durationMs: 3000,
        promptCount: 4,
        toolCalls: 15,
        compactions: 1,
        models: ["claude-sonnet-5", "claude-opus-4"],
        reads: 8,
        writes: 2,
        tests: 2,
        failedVerifications: 1,
        largestOutputBytes: 5000,
      });
      await seedSession(db, {
        id: "b1",
        projectId: PROJECT_B,
        startedAt: "2026-07-03T00:00:00.000Z",
        durationMs: 10000,
        promptCount: 8,
        toolCalls: 40,
        compactions: 3,
        models: ["claude-opus-4"],
        reads: 12,
        writes: 3,
        tests: 0,
        failedVerifications: 0,
        largestOutputBytes: 20000,
      });

      const result = await computeBaselines(db);
      expect(result.dataPoints.length).toBe(3);
      expect(result.personal.sampleSize).toBe(3);
      // Personal median toolCallCount = median(5,15,40) = 15.
      expect(result.personal.stats.toolCallCount?.median).toBe(15);

      // Per-project baseline for A = median(5,15) = 10.
      const projA = result.byProject.get(PROJECT_A);
      expect(projA?.scope).toBe("project");
      expect(projA?.projectId).toBe(PROJECT_A);
      expect(projA?.stats.toolCallCount?.median).toBe(10);

      // Recent baseline (default 10) includes all 3 sessions here.
      expect(result.recent.sampleSize).toBe(3);

      // Model distribution: sonnet appears twice, opus twice across 4 requests.
      const sonnet = result.personal.modelDistribution.find((m) => m.modelId === "claude-sonnet-5");
      expect(sonnet?.share).toBe(0.5);

      // a2 had a failed verification followed by a corrective prompt.
      const a2 = result.dataPoints.find((p) => p.sessionId === "a2");
      if (!a2) throw new Error("a2 data point missing");
      expect(a2.correctiveTurnCount).toBe(1);
      expect(a2.readToWriteRatio).toBe(4); // 8 reads / 2 writes
      expect(a2.modelDiversity).toBe(2);
      expect(a2.testFrequency).toBe(3); // 2 passing + 1 failed (all kind "test")
      expect(a2.largestOutputBytes).toBe(5000);
    });
  });

  it("returns empty baselines when there is no history", async () => {
    await withDb(async (database) => {
      const result = await computeBaselines(database.db);
      expect(result.dataPoints).toEqual([]);
      expect(result.personal.sampleSize).toBe(0);
      expect(result.recent.sampleSize).toBe(0);
      expect(result.byProject.size).toBe(0);
    });
  });

  it("compares a session against all three baselines", async () => {
    await withDb(async (database) => {
      const { db } = database;
      await seedSource(db);
      await seedProject(db, PROJECT_A);
      await seedSession(db, {
        id: "a1",
        projectId: PROJECT_A,
        startedAt: "2026-07-01T00:00:00.000Z",
        durationMs: 1000,
        promptCount: 2,
        toolCalls: 5,
        compactions: 0,
        models: ["claude-sonnet-5"],
        reads: 2,
        writes: 1,
        tests: 1,
        failedVerifications: 0,
        largestOutputBytes: 0,
      });
      await seedSession(db, {
        id: "a2",
        projectId: PROJECT_A,
        startedAt: "2026-07-02T00:00:00.000Z",
        durationMs: 1000,
        promptCount: 2,
        toolCalls: 5,
        compactions: 0,
        models: ["claude-sonnet-5"],
        reads: 2,
        writes: 1,
        tests: 1,
        failedVerifications: 0,
        largestOutputBytes: 0,
      });
      const result = await computeBaselines(db);
      const point = result.dataPoints.find((p) => p.sessionId === "a1");
      if (!point) throw new Error("a1 data point missing");
      const cmp = compareSession(point, {
        personal: result.personal,
        project: result.byProject.get(PROJECT_A) ?? null,
        recent: result.recent,
      });
      expect(cmp.sessionId).toBe("a1");
      const scopes = cmp.deviations.map((d) => d.baseline);
      expect(scopes).toContain("personal");
      expect(scopes).toContain("project");
      expect(scopes).toContain("recent");
      // Identical sessions → everything typical.
      for (const group of cmp.deviations) {
        for (const d of group.deviations) {
          expect(d.direction).toBe("typical");
        }
      }
    });
  });
});

describe("computeSessionDataPoints (pure extraction)", () => {
  it("handles a session with no writes (null read-to-write ratio) and no commands", () => {
    // Empty rows → a data point with zeros / nulls, no crash.
    const points = computeSessionDataPoints(
      [
        {
          id: "s",
          sourceSessionId: "s",
          sourceId: "x",
          projectId: "p",
          startedAt: NOW,
          endedAt: null,
          durationMs: null,
          activeDurationMs: null,
          metricProvenance: null,
          entryPoint: "cli",
          sourceVersion: null,
          completionStatus: "completed",
          privacyMode: "redacted-content",
          dataCompleteness: [],
          promptCount: 0,
          modelRequestCount: 0,
          toolCallCount: 0,
          compactionCount: 0,
          subagentCount: 0,
          importProvenance: "x",
        },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    );
    expect(points.length).toBe(1);
    expect(points[0]?.readToWriteRatio).toBeNull();
    expect(points[0]?.largestOutputBytes).toBeNull();
    expect(points[0]?.toolCallCount).toBe(0);
  });
});
