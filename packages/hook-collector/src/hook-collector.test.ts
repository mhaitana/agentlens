/**
 * Hook-collector tests (spec §14.2, §14.3, §14.4, §8.4).
 *
 * Tolerant parse, redact-before-persist, dedup, spool drain, and session
 * correlation — against a temp SQLite DB (no real ~/.claude, §21).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  closeDatabase,
  SessionRepo,
  SourceRepo,
  ProjectRepo,
} from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import { redactPath } from "@agentlens/redaction";
import {
  parseHookStdin,
  redactHookEvent,
  buildHookRedactionOptions,
  HookEventRepo,
  writeSpool,
  readSpool,
  drainSpool,
  spoolBacklog,
  ingestHookEvent,
  correlateEventToSession,
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

describe("parseHookStdin (§14.2 tolerant)", () => {
  it("parses a full PreToolUse payload", () => {
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "abc",
      cwd: "/home/u/proj",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      permission_mode: "default",
    });
    const e = parseHookStdin(raw, NOW);
    expect(e.hookEventName).toBe("PreToolUse");
    expect(e.known).toBe(true);
    expect(e.sourceSessionId).toBe("abc");
    expect(e.toolName).toBe("Bash");
    expect(e.diagnostics).toEqual([]);
  });

  it("tolerates missing fields and unknown event names", () => {
    const e = parseHookStdin(JSON.stringify({ foo: "bar" }), NOW);
    expect(e.hookEventName).toBe("unknown");
    expect(e.known).toBe(false);
    expect(e.sourceSessionId).toBeUndefined();
    expect(e.diagnostics.length).toBeGreaterThan(0);
  });

  it("never throws on malformed stdin (records an unknown event)", () => {
    const e = parseHookStdin("not json {{{", NOW);
    expect(e.hookEventName).toBe("unknown");
    expect(e.diagnostics.some((d) => d.includes("JSON"))).toBe(true);
    expect(e.raw["_malformed"]).toBeDefined();
  });
});

describe("redactHookEvent (§8.4 redact before persist)", () => {
  const config = defaultConfig();

  it("strips secrets from the payload and never persists the original", () => {
    const raw = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      cwd: "/home/u/proj",
      prompt: "my token is ghp_012345678901234567890123456789012345",
    });
    const parsed = parseHookStdin(raw, NOW);
    const redacted = redactHookEvent(
      parsed,
      buildHookRedactionOptions(config),
      config.privacy.mode,
    );
    const body = JSON.stringify(redacted.redactedPayload);
    expect(body).not.toContain("ghp_012345678901234567890123456789012345");
    expect(body).toContain("[REDACTED:github-token]");
    expect(redacted.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redacts the cwd to a hash + redacted path", () => {
    const parsed = parseHookStdin(
      JSON.stringify({ hook_event_name: "PreToolUse", cwd: join(homedir(), "agentlens-proj") }),
      NOW,
    );
    const redacted = redactHookEvent(
      parsed,
      buildHookRedactionOptions(config),
      config.privacy.mode,
    );
    expect(redacted.cwdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(redacted.cwdRedactedPath).toContain("[HOME]");
  });

  it("drops content fields in metadata-only mode but keeps the envelope", () => {
    const meta = { ...config, privacy: { ...config.privacy, mode: "metadata-only" as const } };
    const parsed = parseHookStdin(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "secret prompt text" }),
      NOW,
    );
    const redacted = redactHookEvent(parsed, buildHookRedactionOptions(meta), meta.privacy.mode);
    expect(JSON.stringify(redacted.redactedPayload)).not.toContain("secret prompt text");
    expect(redacted.redactedPayload["prompt"]).toMatch(/metadata-only/);
  });
});

describe("HookEventRepo dedup + ingest (§14.3)", () => {
  it("inserts once and dedups the retransmission by payloadHash", async () => {
    await withDb(async (database) => {
      const config = defaultConfig();
      const raw = JSON.stringify({ hook_event_name: "Stop", session_id: "s1" });
      const r1 = await ingestHookEvent({ db: database.db, config }, raw, "online", NOW);
      const r2 = await ingestHookEvent({ db: database.db, config }, raw, "spool", NOW);
      expect(r1.inserted).toBe(true);
      expect(r2.inserted).toBe(false);
      expect(r2.id).toBe(r1.id);
      const repo = new HookEventRepo(database.db);
      expect(await repo.total()).toBe(1);
    });
  });
});

describe("spool write/read/drain (§14.3 fallback)", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentlens-spool-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("writes atomically, reads back, and drains (removing processed files)", async () => {
    const a = {
      v: 1,
      provenance: "claude-code-hook",
      receivedAt: NOW,
      payload: { hook_event_name: "Stop" },
    };
    const b = {
      v: 1,
      provenance: "claude-code-hook",
      receivedAt: "2026-07-10T12:00:01.000Z",
      payload: { hook_event_name: "PostToolUse" },
    };
    await writeSpool(home, a);
    await writeSpool(home, b);
    expect(await spoolBacklog(home)).toBe(2);

    const read = await readSpool(home);
    expect(read.length).toBe(2);
    const first = read[0];
    expect(first?.event.payload.hook_event_name).toBe("Stop");

    const result = await drainSpool(home, async () => undefined);
    expect(result).toEqual({ processed: 2, removed: 2, failed: 0 });
    expect(await spoolBacklog(home)).toBe(0);
  });
});

describe("correlateEventToSession (§14.4)", () => {
  it("matches by exact source session id with confidence 1.0", async () => {
    await withDb(async (database) => {
      const db = database.db;
      await new SourceRepo(db).upsert({
        id: "src",
        adapter: "claude-code",
        displayName: "cc",
        enabled: true,
      });
      await new ProjectRepo(db).upsert({
        id: "proj",
        sourceId: "src",
        displayName: "proj",
        pathHash: "deadbeef",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      });
      await new SessionRepo(db).insert({
        id: "sess",
        sourceSessionId: "claude-xyz",
        sourceId: "src",
        projectId: "proj",
        startedAt: NOW,
        entryPoint: "cli",
        completionStatus: "completed",
        privacyMode: "redacted-content",
        dataCompleteness: [],
        promptCount: 0,
        modelRequestCount: 0,
        toolCallCount: 0,
        compactionCount: 0,
        subagentCount: 0,
        importProvenance: "scan",
      });
      const result = await correlateEventToSession(db, {
        sourceSessionId: "claude-xyz",
        timestamp: NOW,
      });
      expect(result?.sessionId).toBe("sess");
      expect(result?.confidence).toBe(1.0);
      expect(result?.basis).toBe("exact-session-id");
    });
  });

  it("infers by project path + time when the session id is absent", async () => {
    await withDb(async (database) => {
      const db = database.db;
      const cwd = "/home/u/myproject";
      const pathHash = redactPath(cwd, {
        redactEmails: false,
        redactHomePath: false,
        anonymiseRepoPath: false,
      }).pathHash;
      await new SourceRepo(db).upsert({
        id: "src",
        adapter: "claude-code",
        displayName: "cc",
        enabled: true,
      });
      await new ProjectRepo(db).upsert({
        id: "proj",
        sourceId: "src",
        displayName: "myproject",
        pathHash,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      });
      await new SessionRepo(db).insert({
        id: "sess",
        sourceSessionId: "other",
        sourceId: "src",
        projectId: "proj",
        startedAt: NOW,
        entryPoint: "cli",
        completionStatus: "completed",
        privacyMode: "redacted-content",
        dataCompleteness: [],
        promptCount: 0,
        modelRequestCount: 0,
        toolCallCount: 0,
        compactionCount: 0,
        subagentCount: 0,
        importProvenance: "scan",
      });
      const result = await correlateEventToSession(db, { cwdHash: pathHash, timestamp: NOW });
      expect(result?.sessionId).toBe("sess");
      expect(result?.confidence).toBeLessThan(1.0);
      expect(result?.basis).toBe("path-and-time");
    });
  });

  it("returns null when nothing plausible exists", async () => {
    await withDb(async (database) => {
      const result = await correlateEventToSession(database.db, {
        sourceSessionId: "nope",
        timestamp: NOW,
      });
      expect(result).toBeNull();
    });
  });
});
