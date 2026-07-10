import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalSession,
  interruptedSession,
  compactionAndSubagentSession,
  malformedAndUnknownLines,
} from "@agentlens/test-fixtures";
import { discoverTranscripts } from "./locations.js";
import { parseTranscriptStream } from "./parser/stream.js";
import { parseLine } from "./parser/schema.js";
import { TranscriptNormaliser } from "./normalise.js";
import { ClaudeCodeAdapter } from "./adapter.js";
import type { NormalisedSourceEvent, ToolCallEvent } from "@agentlens/source-adapter";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

let tempRoot: string;

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentlens-test-"));
  return dir;
}

beforeEach(() => {
  tempRoot = ""; // assigned per test
});
afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function writeTranscript(
  home: string,
  projectFolder: string,
  sessionFile: string,
  jsonl: string,
): Promise<string> {
  const projectDir = join(home, "projects", projectFolder);
  await mkdir(projectDir, { recursive: true });
  const file = join(projectDir, sessionFile);
  await writeFile(file, jsonl, "utf8");
  return file;
}

async function eventsFor(jsonl: string, sessionId: string): Promise<NormalisedSourceEvent[]> {
  const file = join(await tempDir(), "t.jsonl");
  tempRoot = tempRoot || join(file, "..");
  await writeFile(file, jsonl, "utf8");
  const normaliser = new TranscriptNormaliser({
    sourceId: "claude-code",
    sourceSessionId: sessionId,
  });
  const events: NormalisedSourceEvent[] = [];
  for await (const parsed of parseTranscriptStream(file)) {
    if (parsed.record) for (const e of normaliser.push(parsed.record)) events.push(e);
  }
  for (const e of normaliser.flush()) events.push(e);
  await rm(file, { force: true });
  return events;
}

describe("discovery", () => {
  it("finds transcripts under ~/.claude/projects and never mutates them", async () => {
    tempRoot = await tempDir();
    const { jsonl } = normalSession();
    const file = await writeTranscript(tempRoot, "-home-user-project-x", "sess-0001.jsonl", jsonl);
    const before = await readdir(join(tempRoot, "projects", "-home-user-project-x"));

    const found = await discoverTranscripts({
      claudeHomeOverride: tempRoot,
      additionalDirectories: [],
      excludedProjects: [],
      followSymlinks: false,
    });

    expect(found).toHaveLength(1);
    expect(found[0].uri).toBe(file);
    expect(found[0].adapter).toBe("claude-code");
    // Folder-name decode is lossy (every "-" → "/"); the real cwd comes from
    // the transcript line at normalisation time, not the folder name.
    expect(found[0].projectHint).toBe("/home/user/project/x");
    // No mutation: same files present.
    expect(await readdir(join(tempRoot, "projects", "-home-user-project-x"))).toEqual(before);
  });

  it("respects excludedProjects by prefix", async () => {
    tempRoot = await tempDir();
    await writeTranscript(tempRoot, "-home-user-secret", "a.jsonl", normalSession().jsonl);
    await writeTranscript(tempRoot, "-home-user-public", "b.jsonl", normalSession().jsonl);

    const found = await discoverTranscripts({
      claudeHomeOverride: tempRoot,
      additionalDirectories: [],
      excludedProjects: ["/home/user/secret"],
      followSymlinks: false,
    });
    expect(found).toHaveLength(1);
    expect(found[0].projectHint).toBe("/home/user/public");
  });

  it("scans additional configured directories", async () => {
    tempRoot = await tempDir();
    const extra = await tempDir();
    const { jsonl } = normalSession();
    await mkdir(join(extra, "-some-project"), { recursive: true });
    await writeFile(join(extra, "-some-project", "extra.jsonl"), jsonl, "utf8");

    const found = await discoverTranscripts({
      claudeHomeOverride: tempRoot,
      additionalDirectories: [extra],
      excludedProjects: [],
      followSymlinks: false,
    });
    expect(found).toHaveLength(1);
    expect(found[0].uri).toContain("extra.jsonl");
    await rm(extra, { recursive: true, force: true });
  });
});

describe("streaming parser recovery", () => {
  it("parses a normal session line-by-line with byte offsets", async () => {
    const file = join(await tempDir(), "n.jsonl");
    tempRoot = join(file, "..");
    const { jsonl } = normalSession();
    await writeFile(file, jsonl, "utf8");

    const lines = await collect(parseTranscriptStream(file));
    expect(lines.length).toBe(jsonl.split("\n").length);
    // Every non-empty line has a record (the fixtures are all valid JSON).
    expect(
      lines.every((l) => l.record !== null || l.diagnostics.length > 0 || l.terminated === false),
    ).toBe(true);
    // Offsets are monotonic.
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].byteOffset).toBeGreaterThanOrEqual(lines[i - 1].endByteOffset);
    }
  });

  it("recovers from malformed JSON and continues", async () => {
    const file = join(await tempDir(), "m.jsonl");
    tempRoot = join(file, "..");
    const jsonl = malformedAndUnknownLines();
    await writeFile(file, jsonl, "utf8");

    const lines = await collect(parseTranscriptStream(file));
    const malformed = lines.find((l) => l.diagnostics.some((d) => d.level === "error"));
    expect(malformed, "malformed line must produce an error diagnostic, not abort").toBeDefined();
    // Parsing continued past the bad line: the valid user line after it parsed.
    const userLine = lines.find((l) => l.record?.kind === "user");
    expect(userLine).toBeDefined();
  });

  it("yields an unterminated final line rather than dropping it", async () => {
    const file = join(await tempDir(), "p.jsonl");
    tempRoot = join(file, "..");
    // No trailing newline on the last line.
    const { jsonl } = normalSession();
    await writeFile(file, jsonl, "utf8");

    const lines = await collect(parseTranscriptStream(file));
    const last = lines[lines.length - 1];
    expect(last).toBeDefined();
    // The final assistant end_turn line must be present.
    expect(last.record?.kind).toBe("assistant");
  });
});

describe("normalisation", () => {
  it("deduplicates model requests by message.id (max tokens, no over-counting)", async () => {
    const { jsonl, sessionId } = normalSession();
    const events = await eventsFor(jsonl, sessionId);
    const modelRequests = events.filter((e) => e.kind === "model-request");
    // Four assistant message ids (msg_01AAA merged from two lines, msg_02BBB,
    // msg_03CCC, msg_04DDD) → 4 model requests, not 5 (the two msg_01AAA lines
    // must collapse to one).
    expect(modelRequests).toHaveLength(4);
    const merged = modelRequests.find(
      (m) => m.kind === "model-request" && m.timestamp.toISOString() === "2026-07-09T10:00:02.000Z",
    );
    expect(merged && merged.kind === "model-request" && merged.outputTokens).toBe(120); // max, not 40
  });

  it("correlates tool_use with tool_result into a single tool-call event", async () => {
    const { jsonl, sessionId } = normalSession();
    const events = await eventsFor(jsonl, sessionId);
    const toolCalls = events.filter((e) => e.kind === "tool-call") as ToolCallEvent[];
    // Read + Edit + Bash tool calls, all with results.
    expect(toolCalls.length).toBe(3);
    expect(toolCalls.every((t) => t.success === true)).toBe(true);
    const readCall = toolCalls.find((t) => t.toolName === "Read");
    expect(readCall?.file?.operation).toBe("read");
    const bashCall = toolCalls.find((t) => t.toolName === "Bash");
    expect(bashCall?.command?.classification).toBe("test");
    expect(bashCall?.verification?.kind).toBe("unit-test");
  });

  it("emits a partial (failed) tool-call when no tool_result arrives", async () => {
    const { jsonl, sessionId } = interruptedSession();
    const events = await eventsFor(jsonl, sessionId);
    const toolCalls = events.filter((e) => e.kind === "tool-call") as ToolCallEvent[];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].success).toBe(false); // no result → partial
    const end = events.find((e) => e.kind === "session-end");
    expect(end && end.kind === "session-end" && end.completionStatus).toBe("interrupted");
  });

  it("records compaction events", async () => {
    const { jsonl, sessionId } = compactionAndSubagentSession();
    const events = await eventsFor(jsonl, sessionId);
    const compactions = events.filter((e) => e.kind === "compaction");
    expect(compactions).toHaveLength(1);
  });

  it("emits session-start with the real cwd from the first non-summary record", async () => {
    const { jsonl, sessionId } = normalSession();
    const events = await eventsFor(jsonl, sessionId);
    const start = events.find((e) => e.kind === "session-start");
    expect(start && start.kind === "session-start" && start.projectPath).toBe(
      "/home/user/project-x",
    );
    expect(start && start.kind === "session-start" && start.entryPoint).toBe("unknown");
  });
});

describe("adapter.scan end-to-end", () => {
  it("streams normalised events from a discovered source via the adapter", async () => {
    tempRoot = await tempDir();
    const { jsonl } = normalSession();
    await writeTranscript(tempRoot, "-home-user-project-x", "sess-0001.jsonl", jsonl);

    const adapter = new ClaudeCodeAdapter(tempRoot);
    const [source] = await adapter.discover({
      additionalDirectories: [],
      excludedProjects: [],
      followSymlinks: false,
    });
    expect(source).toBeDefined();

    const events = await collect(adapter.scan({ source, dryRun: true }));
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has("session-start")).toBe(true);
    expect(kinds.has("session-end")).toBe(true);
    expect(kinds.has("prompt")).toBe(true);
    expect(kinds.has("model-request")).toBe(true);
    expect(kinds.has("tool-call")).toBe(true);
  });

  it("parseLine never throws on garbage input", () => {
    expect(() => parseLine("{not json", 1)).not.toThrow();
    expect(() => parseLine("", 1)).not.toThrow();
    expect(() => parseLine("null", 1)).not.toThrow();
  });
});
