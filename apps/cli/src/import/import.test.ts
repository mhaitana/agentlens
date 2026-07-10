import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, ADAPTER_ID } from "@agentlens/claude-adapter";
import { openDatabase, closeDatabase, schema, type Database } from "@agentlens/database";
import { normalSession } from "@agentlens/test-fixtures";
import { runPipeline } from "./pipeline.js";
import { buildPrivacy } from "./privacy.js";
import { decideImport } from "./incremental.js";
import { reconstructSession } from "./reconstruct.js";

const NOW = "2026-07-10T12:00:00.000Z";
const REPO = "/home/user/project-x";

let tempHome: string;
let database: Database;

async function freshDb(): Promise<Database> {
  return openDatabase({ home: "", nowIso: NOW, inMemory: true });
}

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "agentlens-cli-test-"));
  database = await freshDb();
});
afterEach(async () => {
  await closeDatabase(database).catch(() => undefined);
  await rm(tempHome, { recursive: true, force: true });
  await Promise.all([
    rm(database.path, { force: true }),
    rm(`${database.path}-wal`, { force: true }),
    rm(`${database.path}-shm`, { force: true }),
  ]);
});

async function writeSession(
  home: string,
  projectFolder: string,
  file: string,
  jsonl: string,
): Promise<string> {
  const dir = join(home, "projects", projectFolder);
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  await writeFile(path, jsonl, "utf8");
  return path;
}

function privacyFor(mode: "metadata-only" | "redacted-content" | "full-local") {
  return buildPrivacy({
    mode,
    redactEmails: true,
    redactHomePath: mode === "redacted-content",
    customPatterns: [],
    repoPath: REPO,
  });
}

async function run(
  home: string,
  mode: "metadata-only" | "redacted-content" | "full-local",
  opts?: { dryRun?: boolean },
) {
  const adapter = new ClaudeCodeAdapter(home);
  return runPipeline({
    database,
    adapter,
    privacy: privacyFor(mode),
    discovery: { additionalDirectories: [], excludedProjects: [], followSymlinks: false },
    dryRun: opts?.dryRun ?? false,
  });
}

async function countRows(
  table:
    | "prompts"
    | "model_requests"
    | "tool_calls"
    | "file_activity"
    | "command_runs"
    | "verification_runs"
    | "compactions"
    | "sessions",
): Promise<number> {
  const res = await database.client.execute(`SELECT COUNT(*) AS n FROM ${table};`);
  return Number((res.rows[0] as { n?: number | bigint }).n ?? 0);
}

describe("decideImport", () => {
  it("skips when size + mtime match", () => {
    const d = decideImport({
      state: {
        sourceId: "s",
        uri: "u",
        size: 100,
        mtime: 1000,
        rollingHash: "h",
        importVersion: 1,
        updatedAt: NOW,
      },
      size: 100,
      mtime: 1000,
      headHash: "h",
      parserVersion: 1,
    });
    expect(d.skip).toBe(true);
    expect(d.delete).toBe(false);
  });
  it("deletes on parser version change", () => {
    const d = decideImport({
      state: {
        sourceId: "s",
        uri: "u",
        size: 100,
        mtime: 1000,
        rollingHash: "h",
        importVersion: 1,
        updatedAt: NOW,
      },
      size: 100,
      mtime: 1000,
      headHash: "h",
      parserVersion: 2,
    });
    expect(d.skip).toBe(false);
    expect(d.delete).toBe(true);
  });
  it("deletes on truncation (file shrank)", () => {
    const d = decideImport({
      state: {
        sourceId: "s",
        uri: "u",
        size: 500,
        mtime: 1000,
        rollingHash: "h",
        importVersion: 1,
        updatedAt: NOW,
      },
      size: 200,
      mtime: 2000,
      headHash: "h",
      parserVersion: 1,
    });
    expect(d.skip).toBe(false);
    expect(d.delete).toBe(true);
    expect(d.reason).toMatch(/truncat/);
  });
  it("deletes on replacement (head hash differs)", () => {
    const d = decideImport({
      state: {
        sourceId: "s",
        uri: "u",
        size: 100,
        mtime: 1000,
        rollingHash: "old",
        importVersion: 1,
        updatedAt: NOW,
      },
      size: 100,
      mtime: 2000,
      headHash: "new",
      parserVersion: 1,
    });
    expect(d.skip).toBe(false);
    expect(d.delete).toBe(true);
    expect(d.reason).toMatch(/replac/);
  });
  it("appends when head unchanged but file grew", () => {
    const d = decideImport({
      state: {
        sourceId: "s",
        uri: "u",
        size: 100,
        mtime: 1000,
        rollingHash: "h",
        importVersion: 1,
        updatedAt: NOW,
      },
      size: 200,
      mtime: 2000,
      headHash: "h",
      parserVersion: 1,
    });
    expect(d.skip).toBe(false);
    expect(d.delete).toBe(false);
    expect(d.reason).toMatch(/append/);
  });
});

describe("reconstruction", () => {
  it("flags partial-tail-missing when no session-end", async () => {
    const { jsonl, sessionId } = normalSession();
    // Strip the final end_turn line to drop the session-end.
    const lines = jsonl.split("\n").slice(0, -1).join("\n");
    void sessionId;
    const events = await collectFromText(lines);
    const r = reconstructSession(events);
    expect(r.dataCompleteness).toContain("partial-tail-missing");
    expect(r.completionStatus).toBe("interrupted");
  });
});

// Helper: parse jsonl text into events using the adapter's normaliser path.
async function collectFromText(jsonl: string) {
  const file = await writeSession(tempHome, "-home-user-project-x", "tmp.jsonl", jsonl);
  const adapter = new ClaudeCodeAdapter(tempHome);
  const [source] = await adapter.discover({
    additionalDirectories: [],
    excludedProjects: [],
    followSymlinks: false,
  });
  const events = [];
  if (!source) throw new Error("no source discovered for tmp.jsonl");
  for await (const e of adapter.scan({ source, dryRun: true })) events.push(e);
  await rm(file, { force: true });
  return events;
}

describe("pipeline end-to-end", () => {
  it("imports a session and persists all entity kinds", async () => {
    const { jsonl } = normalSession();
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);

    const result = await run(tempHome, "redacted-content");
    expect(result.discovered).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    expect(await countRows("sessions")).toBe(1);
    expect(await countRows("prompts")).toBe(1);
    // 4 distinct assistant message ids → 4 model requests.
    expect(await countRows("model_requests")).toBe(4);
    // Read + Edit + Bash → 3 tool calls.
    expect(await countRows("tool_calls")).toBe(3);
    // Read + Edit touched files → 2 file_activity. Bash → 1 command_run + 1 verification_run.
    expect(await countRows("file_activity")).toBe(2);
    expect(await countRows("command_runs")).toBe(1);
    expect(await countRows("verification_runs")).toBe(1);
  });

  it("skips an unchanged file on the second run (no duplicates)", async () => {
    const { jsonl } = normalSession();
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);

    await run(tempHome, "redacted-content");
    const promptsBefore = await countRows("prompts");
    const sessionsBefore = await countRows("sessions");

    const second = await run(tempHome, "redacted-content");
    expect(second.skipped).toBe(1);
    expect(second.imported).toBe(0);
    expect(await countRows("prompts")).toBe(promptsBefore);
    expect(await countRows("sessions")).toBe(sessionsBefore);
  });

  it("re-imports without duplicates when the file is replaced", async () => {
    const built = normalSession();
    const file = await writeSession(
      tempHome,
      "-home-user-project-x",
      "sess-0001.jsonl",
      built.jsonl,
    );
    await run(tempHome, "redacted-content");
    const toolCallsBefore = await countRows("tool_calls");

    // Rewrite with the same content (triggers replacement path via head hash).
    await writeFile(file, built.jsonl, "utf8");
    const second = await run(tempHome, "redacted-content");
    expect(second.skipped).toBe(0);
    // Replaced → delete + reimport, no duplication.
    expect(await countRows("tool_calls")).toBe(toolCallsBefore);
    expect(await countRows("sessions")).toBe(1);
  });

  it("handles truncation by re-importing the shorter session", async () => {
    const built = normalSession();
    const file = await writeSession(
      tempHome,
      "-home-user-project-x",
      "sess-0001.jsonl",
      built.jsonl,
    );
    await run(tempHome, "redacted-content");
    const promptsBefore = await countRows("prompts");

    // Truncate to just the summary + prompt (2 lines).
    await writeFile(file, built.jsonl.split("\n").slice(0, 2).join("\n"), "utf8");
    await run(tempHome, "redacted-content");
    // Fewer events now; the session row is refreshed (not duplicated).
    expect(await countRows("sessions")).toBe(1);
    expect(await countRows("prompts")).toBeLessThanOrEqual(promptsBefore);
  });

  it("dry-run discovers but persists nothing", async () => {
    const { jsonl } = normalSession();
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);
    const result = await run(tempHome, "redacted-content", { dryRun: true });
    expect(result.discovered).toBe(1);
    expect(result.imported).toBe(0);
    expect(await countRows("sessions")).toBe(0);
  });
});

describe("redaction before persistence", () => {
  it("metadata-only stores no prompt content, paths, or command text", async () => {
    const { jsonl } = normalSession({ secretInPrompt: true });
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);
    await run(tempHome, "metadata-only");

    const prompts = await database.db.select().from(schema.prompts);
    expect(prompts[0].redactedContent).toBeNull();
    expect(prompts[0].contentHash).toBeTruthy(); // hash retained for correlation

    const files = await database.db.select().from(schema.fileActivity);
    expect(files.every((f) => f.redactedPath === null)).toBe(true);
    expect(files.every((f) => f.pathHash.length > 0)).toBe(true);

    const cmds = await database.db.select().from(schema.commandRuns);
    expect(cmds.length).toBe(1);
    // No command text persisted (§8.1); classification retained.
    expect(cmds[0].redactedCommand).toBe("[metadata-only]");
    expect(cmds[0].classification).toBe("test");
  });

  it("redacted-content redacts secrets and anonymises the repo path", async () => {
    const { jsonl } = normalSession({ secretInPrompt: true });
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);
    await run(tempHome, "redacted-content");

    const prompts = await database.db.select().from(schema.prompts);
    const content = prompts[0].redactedContent ?? "";
    // The API-key-shaped secret must be gone from stored prompt content.
    expect(content).not.toContain("sk-proj-AbCdEfGh1234567890");

    // The repo path lives in tool inputs (Bash cwd, file paths), not the prompt
    // text — verify it is anonymised wherever it is actually stored.
    const cmds = await database.db.select().from(schema.commandRuns);
    const cmd = cmds.find((c) => c.classification === "test") ?? cmds[0];
    expect(cmd, "command_run row must exist").toBeDefined();
    const redactedCommand = cmd ? cmd.redactedCommand : "";
    expect(redactedCommand).not.toContain(REPO);
    expect(redactedCommand).toContain("[REPO]");

    const files = await database.db.select().from(schema.fileActivity);
    const storedPath = files.find((f) => f.redactedPath ?? undefined)?.redactedPath ?? "";
    expect(storedPath).not.toContain(REPO);
    expect(storedPath).toContain("[REPO]");
  });

  it("full-local keeps paths but still strips secrets", async () => {
    const { jsonl } = normalSession({ secretInPrompt: true });
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);
    await run(tempHome, "full-local");

    const prompts = await database.db.select().from(schema.prompts);
    const content = prompts[0].redactedContent ?? "";
    expect(content).not.toContain("sk-proj-AbCdEfGh1234567890"); // secret stripped

    // Paths are retained in full-local (only secrets are stripped).
    const cmds = await database.db.select().from(schema.commandRuns);
    const cmd = cmds.find((c) => c.classification === "test") ?? cmds[0];
    expect(cmd, "command_run row must exist").toBeDefined();
    const redactedCommand = cmd ? cmd.redactedCommand : "";
    expect(redactedCommand).toContain(REPO); // full path retained

    const files = await database.db.select().from(schema.fileActivity);
    const storedPath = files.find((f) => f.redactedPath ?? undefined)?.redactedPath ?? "";
    expect(storedPath).toContain(REPO); // full path retained
  });
});

describe("reconstruction persisted on the session row", () => {
  it("records completion status and completeness flags", async () => {
    const { jsonl } = normalSession();
    await writeSession(tempHome, "-home-user-project-x", "sess-0001.jsonl", jsonl);
    await run(tempHome, "redacted-content");

    const sessions = await database.db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].completionStatus).toBe("completed");
    expect(sessions[0].entryPoint).toBe("unknown");
    expect((sessions[0].dataCompleteness as string[]).includes("complete")).toBe(true);
    expect(sessions[0].promptCount).toBe(1);
    expect(sessions[0].modelRequestCount).toBe(4);
    expect(sessions[0].toolCallCount).toBe(3);
    expect(sessions[0].sourceId).toBe(ADAPTER_ID);
  });
});
