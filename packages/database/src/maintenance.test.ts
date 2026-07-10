/**
 * Tests for the data-maintenance primitives (spec §3.2, §8 retention, §16
 * `privacy purge`): full purge, per-project purge, and retention pruning.
 *
 * Uses an in-memory SQLite DB seeded with two sessions (one expired, one
 * recent) plus child event rows, then asserts the destructive functions
 * remove the right rows in FK-safe order. No dependency on ~/.claude (§21).
 */
import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import {
  openDatabase,
  closeDatabase,
  schema,
  purgeAllData,
  purgeProjectData,
  pruneExpiredSessions,
  retentionCutoff,
} from "./index.js";

const NOW = "2026-07-10T12:00:00.000Z";

async function withDb<T>(
  fn: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<T>,
): Promise<T> {
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

/** Seed a source, two projects, an old + a recent session, and child events. */
async function seed(db: Awaited<ReturnType<typeof openDatabase>>): Promise<void> {
  await db.db.insert(schema.sources).values({
    id: "src-1",
    adapter: "claude-code",
    displayName: "Claude Code",
    enabled: true,
  });
  await db.db.insert(schema.projects).values([
    {
      id: "proj-old",
      sourceId: "src-1",
      displayName: "old-project",
      pathHash: "h1",
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "proj-recent",
      sourceId: "src-1",
      displayName: "recent-project",
      pathHash: "h2",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    },
  ]);
  await db.db.insert(schema.sessions).values([
    {
      id: "sess-old",
      sourceSessionId: "raw-old",
      sourceId: "src-1",
      projectId: "proj-old",
      startedAt: "2026-01-01T00:00:00Z",
      endedAt: "2026-01-01T01:00:00Z",
      durationMs: 3_600_000,
      entryPoint: "cli",
      completionStatus: "completed",
      privacyMode: "redacted-content",
      dataCompleteness: [],
      promptCount: 1,
      modelRequestCount: 1,
      toolCallCount: 1,
      compactionCount: 0,
      subagentCount: 0,
      importProvenance: "transcript",
    },
    {
      id: "sess-recent",
      sourceSessionId: "raw-recent",
      sourceId: "src-1",
      projectId: "proj-recent",
      startedAt: NOW,
      endedAt: NOW,
      durationMs: 1000,
      entryPoint: "cli",
      completionStatus: "completed",
      privacyMode: "redacted-content",
      dataCompleteness: [],
      promptCount: 1,
      modelRequestCount: 1,
      toolCallCount: 1,
      compactionCount: 0,
      subagentCount: 0,
      importProvenance: "transcript",
    },
  ]);
  // Child events for both sessions (prompts + tool calls).
  await db.db.insert(schema.prompts).values([
    {
      id: "p-old",
      sessionId: "sess-old",
      sequence: 1,
      timestamp: "2026-01-01T00:00:05Z",
      redactedContent: "old prompt",
      contentHash: "ch-old",
      characterCount: 10,
      approximateTokenCount: 2,
      features: {},
    },
    {
      id: "p-recent",
      sessionId: "sess-recent",
      sequence: 1,
      timestamp: NOW,
      redactedContent: "recent prompt",
      contentHash: "ch-recent",
      characterCount: 12,
      approximateTokenCount: 3,
      features: {},
    },
  ]);
  await db.db.insert(schema.toolCalls).values([
    {
      id: "t-old",
      sessionId: "sess-old",
      toolUseId: "tu-old",
      toolName: "Read",
      startedAt: "2026-01-01T00:00:10Z",
      endedAt: "2026-01-01T00:00:11Z",
      durationMs: 1000,
      success: true,
      failureType: "none",
      permissionOutcome: "allow",
      sanitisedInput: "{}",
      inputSizeBytes: 2,
      outputSizeBytes: 2,
      sourceProvenance: "claude-code",
    },
    {
      id: "t-recent",
      sessionId: "sess-recent",
      toolUseId: "tu-recent",
      toolName: "Bash",
      startedAt: NOW,
      endedAt: NOW,
      durationMs: 1000,
      success: true,
      failureType: "none",
      permissionOutcome: "allow",
      sanitisedInput: "{}",
      inputSizeBytes: 2,
      outputSizeBytes: 2,
      sourceProvenance: "claude-code",
    },
  ]);
  await db.db.insert(schema.recommendations).values([
    {
      id: "rec-old",
      ruleId: "TOOLS-001",
      ruleVersion: 1,
      sessionId: "sess-old",
      projectId: "proj-old",
      category: "tools",
      severity: "medium",
      confidence: 0.7,
      status: "active",
      title: "old rec",
      summary: "s",
      explanation: "e",
      evidence: [],
      createdAt: "2026-01-01T00:05:00Z",
      updatedAt: "2026-01-01T00:05:00Z",
    },
    {
      id: "rec-recent",
      ruleId: "TOOLS-002",
      ruleVersion: 1,
      sessionId: "sess-recent",
      projectId: "proj-recent",
      category: "tools",
      severity: "low",
      confidence: 0.6,
      status: "active",
      title: "recent rec",
      summary: "s",
      explanation: "e",
      evidence: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
}

async function sessionCount(db: Awaited<ReturnType<typeof openDatabase>>): Promise<number> {
  const rows = await db.db.select({ n: schema.sessions.id }).from(schema.sessions);
  return rows.length;
}

describe("maintenance — retentionCutoff", () => {
  it("computes now - retentionDays", () => {
    expect(retentionCutoff(90, NOW)).toBe("2026-04-11T12:00:00.000Z");
  });
  it("throws on invalid timestamp", () => {
    expect(() => retentionCutoff(90, "not-a-date")).toThrow();
  });
});

describe("maintenance — pruneExpiredSessions", () => {
  it("prunes only sessions older than the retention window", async () => {
    await withDb(async (db) => {
      await seed(db);
      const pruned = await pruneExpiredSessions(db.db, 90, NOW);
      expect(pruned).toBe(1); // only sess-old
      expect(await sessionCount(db)).toBe(1);
      // Recent session + its events remain.
      const prompts = await db.db.select().from(schema.prompts);
      expect(prompts.map((p) => p.id)).toEqual(["p-recent"]);
      const tools = await db.db.select().from(schema.toolCalls);
      expect(tools.map((t) => t.id)).toEqual(["t-recent"]);
      // Old session's recommendation is pruned with it.
      const recs = await db.db.select().from(schema.recommendations);
      expect(recs.map((r) => r.id)).toEqual(["rec-recent"]);
    });
  });

  it("is a no-op when retentionDays is non-positive", async () => {
    await withDb(async (db) => {
      await seed(db);
      expect(await pruneExpiredSessions(db.db, 0, NOW)).toBe(0);
      expect(await pruneExpiredSessions(db.db, -5, NOW)).toBe(0);
      expect(await sessionCount(db)).toBe(2);
    });
  });

  it("also prunes in-progress sessions whose start is older than the cutoff", async () => {
    await withDb(async (db) => {
      await db.db
        .insert(schema.sources)
        .values({ id: "src-1", adapter: "claude-code", displayName: "Claude Code", enabled: true });
      await db.db.insert(schema.projects).values({
        id: "proj-1",
        sourceId: "src-1",
        displayName: "p",
        pathHash: "h",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
      });
      await db.db.insert(schema.sessions).values({
        id: "sess-open-old",
        sourceSessionId: "r",
        sourceId: "src-1",
        projectId: "proj-1",
        startedAt: "2026-01-01T00:00:00Z",
        endedAt: null, // never ended
        entryPoint: "cli",
        completionStatus: "unknown",
        privacyMode: "redacted-content",
        dataCompleteness: [],
        promptCount: 0,
        modelRequestCount: 0,
        toolCallCount: 0,
        compactionCount: 0,
        subagentCount: 0,
        importProvenance: "transcript",
      });
      const pruned = await pruneExpiredSessions(db.db, 90, NOW);
      expect(pruned).toBe(1);
    });
  });
});

describe("maintenance — purgeProjectData", () => {
  it("deletes a project and all of its sessions + events", async () => {
    await withDb(async (db) => {
      await seed(db);
      const summary = await purgeProjectData(db.db, "proj-old");
      expect(summary.sessions).toBe(1);
      expect(summary.projects).toBe(1);
      expect(await sessionCount(db)).toBe(1);
      const projects = await db.db.select().from(schema.projects);
      expect(projects.map((p) => p.id)).toEqual(["proj-recent"]);
      // Old session's prompt/tool/recommendation gone.
      const prompts = await db.db.select().from(schema.prompts);
      expect(prompts.map((p) => p.id)).toEqual(["p-recent"]);
    });
  });

  it("is a no-op-safe for an unknown project (deletes 0 rows)", async () => {
    await withDb(async (db) => {
      await seed(db);
      const summary = await purgeProjectData(db.db, "no-such-project");
      expect(summary.sessions).toBe(0);
      expect(summary.projects).toBe(0);
      expect(await sessionCount(db)).toBe(2);
    });
  });
});

describe("maintenance — purgeAllData", () => {
  it("deletes every imported data table but keeps the schema", async () => {
    await withDb(async (db) => {
      await seed(db);
      const summary = await purgeAllData(db.db);
      expect(summary.sessions).toBe(2);
      expect(summary.projects).toBe(2);
      expect(await sessionCount(db)).toBe(0);
      const projects = await db.db.select().from(schema.projects);
      expect(projects).toHaveLength(0);
      const prompts = await db.db.select().from(schema.prompts);
      expect(prompts).toHaveLength(0);
      // Sources are metadata, not imported data — left intact.
      const sources = await db.db.select().from(schema.sources);
      expect(sources).toHaveLength(1);
    });
  });
});
