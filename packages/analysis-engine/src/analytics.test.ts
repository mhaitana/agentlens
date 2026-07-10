import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import { openDatabase, closeDatabase, schema, type Database } from "@agentlens/database";
import { computeAnalytics } from "./analytics.js";
import { defaultRules } from "./rules/index.js";

const NOW = "2026-07-10T12:00:00.000Z";
const SESSION_STARTED = "2026-07-09T10:00:00.000Z";
const SOURCE_ID = "claude-code";
const SESSION_ID = "sess:claude-code:s1";
const PROJECT_ID = "proj:claude-code:p1";

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

/** Seed a single known session with model usage, tools, a file edit + read, a
 *  passing test verification, and a compaction. */
async function seedSession(database: Database): Promise<void> {
  const { db } = database;
  await db.insert(schema.sources).values({
    id: SOURCE_ID,
    adapter: "claude-code",
    displayName: "Claude Code",
    version: "0.1.0",
    enabled: true,
  });
  await db.insert(schema.projects).values({
    id: PROJECT_ID,
    sourceId: SOURCE_ID,
    displayName: "[REPO]",
    pathHash: "hash-p1",
    redactedPath: "[REPO]",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  });
  await db.insert(schema.sessions).values({
    id: SESSION_ID,
    sourceSessionId: "s1",
    sourceId: SOURCE_ID,
    projectId: PROJECT_ID,
    startedAt: SESSION_STARTED,
    endedAt: "2026-07-09T10:00:08.000Z",
    durationMs: 8000,
    activeDurationMs: null,
    metricProvenance: null,
    entryPoint: "cli",
    sourceVersion: "1.0.0",
    completionStatus: "completed",
    privacyMode: "redacted-content",
    dataCompleteness: ["complete"],
    promptCount: 1,
    modelRequestCount: 2,
    toolCallCount: 3,
    compactionCount: 1,
    subagentCount: 0,
    importProvenance: "claude-code@0.1.0/parser@1",
  });

  await db.insert(schema.prompts).values({
    id: `${SESSION_ID}:p:1`,
    sessionId: SESSION_ID,
    sequence: 1,
    timestamp: "2026-07-09T10:00:01.000Z",
    redactedContent: null,
    contentHash: "h-p1",
    characterCount: 50,
    approximateTokenCount: 13,
    features: {},
  });

  // Two model requests with reported token usage (no reported cost → registry).
  await db.insert(schema.modelRequests).values({
    id: `${SESSION_ID}:m:msg_01AAA`,
    sessionId: SESSION_ID,
    promptId: `${SESSION_ID}:p:1`,
    timestamp: "2026-07-09T10:00:02.000Z",
    modelId: "claude-sonnet-5",
    modelFamily: "claude-sonnet",
    inputTokens: 1000,
    outputTokens: 120,
    cacheReadTokens: 200,
    cacheCreationTokens: 0,
    estimatedCostUsd: null,
    durationMs: 1500,
    effort: null,
    querySource: "user",
    metricProvenance: { tokens: "reported", cost: "unknown" },
  });
  await db.insert(schema.modelRequests).values({
    id: `${SESSION_ID}:m:msg_04DDD`,
    sessionId: SESSION_ID,
    promptId: null,
    timestamp: "2026-07-09T10:00:08.000Z",
    modelId: "claude-sonnet-5",
    modelFamily: "claude-sonnet",
    inputTokens: 1400,
    outputTokens: 60,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: null,
    durationMs: 800,
    effort: null,
    querySource: "user",
    metricProvenance: { tokens: "reported", cost: "unknown" },
  });

  // Tool calls: Read (success), Edit (success), Bash/test (success).
  const readId = "tc:claude-code:toolu_read_01";
  const editId = "tc:claude-code:toolu_edit_01";
  const bashId = "tc:claude-code:toolu_bash_01";
  await db.insert(schema.toolCalls).values({
    id: readId,
    sessionId: SESSION_ID,
    toolUseId: "toolu_read_01",
    toolName: "Read",
    startedAt: "2026-07-09T10:00:02.000Z",
    endedAt: "2026-07-09T10:00:02.500Z",
    durationMs: 500,
    success: true,
    failureType: "none",
    permissionOutcome: "allowed",
    inputSizeBytes: 40,
    outputSizeBytes: 120,
    sourceProvenance: "claude-code@0.1.0/parser@1",
  });
  await db.insert(schema.toolCalls).values({
    id: editId,
    sessionId: SESSION_ID,
    toolUseId: "toolu_edit_01",
    toolName: "Edit",
    startedAt: "2026-07-09T10:00:04.000Z",
    endedAt: "2026-07-09T10:00:04.300Z",
    durationMs: 300,
    success: true,
    failureType: "none",
    permissionOutcome: "allowed",
    inputSizeBytes: 80,
    outputSizeBytes: 30,
    sourceProvenance: "claude-code@0.1.0/parser@1",
  });
  await db.insert(schema.toolCalls).values({
    id: bashId,
    sessionId: SESSION_ID,
    toolUseId: "toolu_bash_01",
    toolName: "Bash",
    startedAt: "2026-07-09T10:00:06.000Z",
    endedAt: "2026-07-09T10:00:07.000Z",
    durationMs: 1000,
    success: true,
    failureType: "none",
    permissionOutcome: "allowed",
    inputSizeBytes: 30,
    outputSizeBytes: 200,
    sourceProvenance: "claude-code@0.1.0/parser@1",
  });

  // File activity: one read, one edit (write).
  await db.insert(schema.fileActivity).values({
    id: `${readId}:file`,
    sessionId: SESSION_ID,
    toolCallId: readId,
    redactedPath: "[REPO]/src/auth.ts",
    pathHash: "hash-auth",
    timestamp: "2026-07-09T10:00:02.000Z",
    operation: "read",
    success: true,
    contentSizeBytes: 120,
  });
  await db.insert(schema.fileActivity).values({
    id: `${editId}:file`,
    sessionId: SESSION_ID,
    toolCallId: editId,
    redactedPath: "[REPO]/src/auth.ts",
    pathHash: "hash-auth",
    timestamp: "2026-07-09T10:00:04.000Z",
    operation: "edit",
    success: true,
    contentSizeBytes: 30,
  });

  // Command run + verification (test, success).
  await db.insert(schema.commandRuns).values({
    id: `${bashId}:cmd`,
    sessionId: SESSION_ID,
    toolCallId: bashId,
    executable: "pnpm",
    family: "test",
    redactedCommand: "cd [REPO] && pnpm test",
    normalisedHash: "hash-cmd-test",
    classification: "test",
    scope: "project",
    exitSuccess: true,
    durationMs: 1000,
    outputSizeBytes: 200,
    timestamp: "2026-07-09T10:00:06.000Z",
  });
  await db.insert(schema.verificationRuns).values({
    id: `${bashId}:verify`,
    sessionId: SESSION_ID,
    commandRunId: `${bashId}:cmd`,
    kind: "test",
    timestamp: "2026-07-09T10:00:07.000Z",
    success: true,
    codeChangedAfter: false,
  });

  await db.insert(schema.compactions).values({
    id: `${SESSION_ID}:c:2026-07-09T10:05:00.000Z`,
    sessionId: SESSION_ID,
    timestamp: "2026-07-09T10:05:00.000Z",
    trigger: "auto",
    success: true,
    durationMs: 200,
    approximatePreCompactionTokens: 5000,
    approximatePostCompactionTokens: 1500,
    sourceProvenance: "claude-code@0.1.0/parser@1",
  });
}

describe("computeAnalytics (§13.5)", () => {
  it("computes usage, tokens, tool, cost, completeness, completion, provenance", async () => {
    await withDb(async (database) => {
      await seedSession(database);
      const snapshot = await computeAnalytics(
        database.db,
        { period: "all" },
        { minimumRecommendationConfidence: 0.65, now: new Date(NOW) },
      );

      // Usage.
      expect(snapshot.usage.totalSessions.value).toBe(1);
      expect(snapshot.usage.activeDays.value).toBe(1);
      expect(snapshot.usage.inputTokens.value).toBe(2400); // 1000 + 1400
      expect(snapshot.usage.outputTokens.value).toBe(180); // 120 + 60
      expect(snapshot.usage.cacheReadTokens.value).toBe(200);
      expect(snapshot.usage.totalTokens.value).toBe(2400 + 180 + 200);
      expect(snapshot.usage.totalCompactions.value).toBe(1);
      expect(snapshot.usage.medianSessionDurationMs.value).toBe(8000);

      // Tool behaviour.
      expect(snapshot.tools.mostUsedTools).toHaveLength(3);
      expect(snapshot.usage.toolSuccessRate.value).toBe(1); // all 3 succeeded
      expect(snapshot.tools.testCommandFrequency.value).toBe(1);
      expect(snapshot.tools.largestToolInputsBytes.value).toBe(80);
      expect(snapshot.tools.largestToolOutputsBytes.value).toBe(200);

      // Workflow.
      expect(snapshot.workflow.readToWriteRatio.value).toBe(1); // 1 read / 1 write
      expect(snapshot.workflow.totalVerificationRuns.value).toBe(1);
      expect(snapshot.workflow.sessionsEndingAfterSuccessfulVerification.value).toBe(1);
      expect(snapshot.workflow.changesAfterFinalVerification.value).toBe(0); // edit before verify

      // Cost (registry methodology, sonnet known, no reported cost).
      expect(snapshot.cost.methodology).toBe("registry");
      expect(snapshot.cost.totalUsd.value).not.toBeNull();
      expect(snapshot.cost.totalUsd.value ?? 0).toBeGreaterThan(0);
      // Per-model usage carries the estimate.
      expect(snapshot.usage.modelUsage[0]?.modelId).toBe("claude-sonnet-5");
      expect(snapshot.usage.modelUsage[0]?.estimatedCostUsd).not.toBeNull();

      // Completeness + completion.
      expect(snapshot.completeness.complete).toBe(1);
      expect(snapshot.completeness.totalSessions).toBe(1);
      expect(snapshot.completion.completed).toBe(1);

      // Scan provenance.
      expect(snapshot.scanProvenance.sourceId).toBe(SOURCE_ID);
      expect(snapshot.scanProvenance.adapterVersion).toBe("0.1.0");
      expect(snapshot.scanProvenance.parserVersion).toBe(1);
      expect(snapshot.scanProvenance.importedSessions).toBe(1);

      // Privacy mode is surfaced.
      expect(snapshot.privacyMode).toBe("redacted-content");
    });
  });

  it("returns an empty (honest) snapshot when the window has no sessions", async () => {
    await withDb(async (database) => {
      const snapshot = await computeAnalytics(
        database.db,
        { period: "week" },
        { minimumRecommendationConfidence: 0.65, now: new Date(NOW) },
      );
      expect(snapshot.usage.totalSessions.value).toBe(0);
      expect(snapshot.usage.totalTokens.value).toBe(0);
      expect(snapshot.usage.modelUsage).toEqual([]);
      expect(snapshot.cost.methodology).toBe("unknown");
      expect(snapshot.cost.totalUsd.value).toBeNull();
      expect(snapshot.recommendations).toEqual([]);
    });
  });

  it("filters by projectId", async () => {
    await withDb(async (database) => {
      await seedSession(database);
      const snapshot = await computeAnalytics(
        database.db,
        { period: "all", projectId: "proj:claude-code:p1" },
        { minimumRecommendationConfidence: 0.65, now: new Date(NOW) },
      );
      expect(snapshot.usage.totalSessions.value).toBe(1);
      const other = await computeAnalytics(
        database.db,
        { period: "all", projectId: "proj:nonexistent" },
        { minimumRecommendationConfidence: 0.65, now: new Date(NOW) },
      );
      expect(other.usage.totalSessions.value).toBe(0);
    });
  });

  it("does not cost an unknown model (no guessing)", async () => {
    await withDb(async (database) => {
      await seedSession(database);
      // Insert an extra request with an unknown model id.
      await database.db.insert(schema.modelRequests).values({
        id: `${SESSION_ID}:m:msg_unknown`,
        sessionId: SESSION_ID,
        promptId: null,
        timestamp: "2026-07-09T10:00:09.000Z",
        modelId: "claude-mystery-9",
        inputTokens: 500,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        estimatedCostUsd: null,
        querySource: "user",
        metricProvenance: { tokens: "reported", cost: "unknown" },
      });
      const snapshot = await computeAnalytics(
        database.db,
        { period: "all" },
        { minimumRecommendationConfidence: 0.65, now: new Date(NOW) },
      );
      const mystery = snapshot.cost.byModel.find((b) => b.modelId === "claude-mystery-9");
      expect(mystery?.usd).toBeNull();
      expect(mystery?.provenance).toBe("unknown");
    });
  });

  it("runs the rule engine end-to-end and persists recommendations (F003)", async () => {
    await withDb(async (database) => {
      await seedSession(database);
      const { db } = database;
      // Add two more reads of the same path (3 total, no intervening edit) so
      // TOOLS-001 (minOccurrences: 3) fires, and add a sensitive-path read so
      // SECURITY-001 fires. Reuse the seeded pathHash "hash-auth".
      for (let i = 0; i < 2; i++) {
        const tcId = `tc:claude-code:toolu_read_extra_${i}`;
        await db.insert(schema.toolCalls).values({
          id: tcId,
          sessionId: SESSION_ID,
          toolUseId: `toolu_read_extra_${i}`,
          toolName: "Read",
          startedAt: `2026-07-09T10:00:1${i}.000Z`,
          endedAt: `2026-07-09T10:00:1${i}.500Z`,
          durationMs: 400,
          success: true,
          failureType: "none",
          permissionOutcome: "allowed",
          inputSizeBytes: 40,
          outputSizeBytes: 120,
          sourceProvenance: "claude-code@0.1.0/parser@1",
        });
        await db.insert(schema.fileActivity).values({
          id: `${tcId}:file`,
          sessionId: SESSION_ID,
          toolCallId: tcId,
          redactedPath: "[REPO]/src/auth.ts",
          pathHash: "hash-auth",
          timestamp: `2026-07-09T10:00:1${i}.000Z`,
          operation: "read",
          success: true,
          contentSizeBytes: 120,
        });
      }
      // Sensitive path access (.env).
      const envTc = "tc:claude-code:toolu_env_01";
      await db.insert(schema.toolCalls).values({
        id: envTc,
        sessionId: SESSION_ID,
        toolUseId: "toolu_env_01",
        toolName: "Read",
        startedAt: "2026-07-09T10:00:20.000Z",
        endedAt: "2026-07-09T10:00:20.400Z",
        durationMs: 400,
        success: true,
        failureType: "none",
        permissionOutcome: "allowed",
        inputSizeBytes: 10,
        outputSizeBytes: 80,
        sourceProvenance: "claude-code@0.1.0/parser@1",
      });
      await db.insert(schema.fileActivity).values({
        id: `${envTc}:file`,
        sessionId: SESSION_ID,
        toolCallId: envTc,
        redactedPath: "[REPO]/.env",
        pathHash: "hash-env",
        timestamp: "2026-07-09T10:00:20.000Z",
        operation: "read",
        success: true,
        contentSizeBytes: 80,
      });

      const snapshot = await computeAnalytics(
        database.db,
        { period: "all" },
        {
          minimumRecommendationConfidence: 0.5,
          now: new Date(NOW),
          rules: defaultRules(),
        },
      );

      // Both rules fired and produced persisted, ranked recommendations.
      const ruleIds = snapshot.recommendations.map((r) => r.ruleId);
      expect(ruleIds).toContain("TOOLS-001");
      expect(ruleIds).toContain("SECURITY-001");
      // Each recommendation has a stable persisted id and a remediation that is
      // never auto-applied (§3.5 safe remediation).
      for (const r of snapshot.recommendations) {
        expect(r.id).toMatch(/^rec:/);
        // No project filter → global scope (both ids undefined).
        expect(r.sessionId).toBeUndefined();
        expect(r.projectId).toBeUndefined();
        expect(r.remediation?.automaticallyApplicable).toBe(false);
        expect(r.evidence.length).toBeGreaterThan(0);
      }

      // A re-run with identical evidence is idempotent: no new inserts (dedup),
      // the same recommendations come back (§15.1 determinism).
      const before = snapshot.recommendations.length;
      const again = await computeAnalytics(
        database.db,
        { period: "all" },
        {
          minimumRecommendationConfidence: 0.5,
          now: new Date(NOW),
          rules: defaultRules(),
        },
      );
      expect(again.recommendations.length).toBe(before);
      expect(again.recommendations.map((r) => r.ruleId).sort()).toEqual(
        snapshot.recommendations.map((r) => r.ruleId).sort(),
      );
    });
  });
});
