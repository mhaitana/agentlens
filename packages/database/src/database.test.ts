import { describe, it, expect } from "vitest";
import {
  openDatabase,
  closeDatabase,
  SessionRepo,
  schema,
  LATEST_SCHEMA_VERSION,
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
  }
}

describe("database", () => {
  it("applies migrations and records the schema version", async () => {
    await withDb(async (database) => {
      const res = await database.client.execute("SELECT MAX(version) AS v FROM schema_version;");
      const v = (res.rows[0] as { v?: number }).v;
      expect(v).toBe(LATEST_SCHEMA_VERSION);
    });
  });

  it("enforces foreign keys", async () => {
    await withDb(async (database) => {
      await expect(
        database.client.execute({
          sql: "INSERT INTO sessions (id, source_session_id, source_id, project_id, started_at, entry_point, completion_status, privacy_mode, data_completeness, import_provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
          args: [
            "s1",
            "src-1",
            "missing-source",
            "missing-project",
            NOW,
            "cli",
            "completed",
            "redacted-content",
            "[]",
            "transcript",
          ],
        }),
      ).rejects.toThrow();
    });
  });

  it("inserts and retrieves a session via the repo", async () => {
    await withDb(async (database) => {
      await database.db.insert(schema.sources).values({
        id: "src-1",
        adapter: "claude-code",
        displayName: "Claude Code",
        enabled: true,
      });
      await database.db.insert(schema.projects).values({
        id: "proj-1",
        sourceId: "src-1",
        displayName: "agentlens",
        pathHash: "abc123",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      });

      const repo = new SessionRepo(database.db);
      await repo.insert({
        id: "sess-1",
        sourceSessionId: "raw-1",
        sourceId: "src-1",
        projectId: "proj-1",
        startedAt: NOW,
        entryPoint: "cli",
        completionStatus: "completed",
        privacyMode: "redacted-content",
        dataCompleteness: ["complete"],
        promptCount: 5,
        modelRequestCount: 5,
        toolCallCount: 12,
        compactionCount: 0,
        subagentCount: 0,
        importProvenance: "transcript",
      });

      const got = await repo.getById("sess-1");
      expect(got?.promptCount).toBe(5);
      expect(got?.privacyMode).toBe("redacted-content");
      expect(await repo.list()).toHaveLength(1);
    });
  });
});
