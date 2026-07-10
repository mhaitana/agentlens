/**
 * @agentlens/test-fixtures — synthetic, deterministic fixtures (spec §12, §21.1).
 *
 * Every transcript here is fully synthetic. No real Claude Code transcript or
 * private usage data is ever committed. Builders produce JSONL strings that
 * tests write into temp directories, so no test depends on the developer's real
 * `~/.claude`.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const TEST_FIXTURES_VERSION = "0.0.0";

/** Absolute path to the on-disk Claude Code fixture transcripts (for the CLI
 *  smoke run and integration tests). Resolved from this built module so it
 *  works regardless of where tests are run from. */
export const claudeCodeFixturesDir: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "claude-code",
);

// ---------------------------------------------------------------------------
// Claude Code transcript line builders (synthetic; field shape per §12).
// ---------------------------------------------------------------------------

export interface TranscriptLine {
  /** Record kind. Synthetic fixtures may use unknown kinds to exercise tolerant parsing. */
  type: string;
  [key: string]: unknown;
}

let counter = 0;
/** Deterministic unique id (no Math.random — stays stable across runs). */
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString().padStart(4, "0")}`;
}

export function summaryLine(leafUuid: string, text = "Session summary"): TranscriptLine {
  return { type: "summary", summary: text, leafUuid, timestamp: "2026-07-09T10:00:00.000Z" };
}

export interface PromptLineInput {
  content: string;
  uuid: string;
  parentUuid: string;
  sessionId: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
}

export function promptLine(input: PromptLineInput): TranscriptLine {
  return {
    type: "user",
    message: { role: "user", content: input.content },
    uuid: input.uuid,
    parentUuid: input.parentUuid,
    timestamp: input.timestamp ?? "2026-07-09T10:00:01.000Z",
    sessionId: input.sessionId,
    cwd: input.cwd ?? "/home/user/project-x",
    gitBranch: input.gitBranch ?? "main",
    version: input.version ?? "1.0.0",
    ...(input.isSidechain ? { isSidechain: true } : {}),
  };
}

export interface ToolResultLineInput {
  toolUseId: string;
  content: string;
  isError?: boolean;
  uuid: string;
  parentUuid: string;
  sessionId: string;
  timestamp?: string;
}

export function toolResultLine(input: ToolResultLineInput): TranscriptLine {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: input.toolUseId,
          content: input.content,
          is_error: input.isError ?? false,
        },
      ],
    },
    uuid: input.uuid,
    parentUuid: input.parentUuid,
    timestamp: input.timestamp ?? "2026-07-09T10:00:03.000Z",
    sessionId: input.sessionId,
  };
}

export interface AssistantLineInput {
  messageId: string;
  uuid: string;
  parentUuid: string;
  sessionId: string;
  model?: string;
  content: AssistantContentBlock[];
  stopReason?: string;
  usage?: TranscriptUsage;
  timestamp?: string;
  requestId?: string;
  isSidechain?: boolean;
}

export interface AssistantContentBlock {
  type: "text" | "thinking" | "tool_use";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function assistantLine(input: AssistantLineInput): TranscriptLine {
  return {
    type: "assistant",
    message: {
      id: input.messageId,
      role: "assistant",
      model: input.model ?? "claude-sonnet-5",
      content: input.content,
      stop_reason: input.stopReason ?? "end_turn",
      usage: input.usage ?? {},
    },
    uuid: input.uuid,
    parentUuid: input.parentUuid,
    timestamp: input.timestamp ?? "2026-07-09T10:00:02.000Z",
    sessionId: input.sessionId,
    requestId: input.requestId,
    ...(input.isSidechain ? { isSidechain: true } : {}),
  };
}

export function compactionLine(uuid: string, timestamp?: string): TranscriptLine {
  return {
    type: "system",
    subtype: "compact",
    content: "Compacted conversation history",
    uuid,
    timestamp: timestamp ?? "2026-07-09T10:05:00.000Z",
  };
}

/** A record type the parser does not know about (tolerant parsing test). */
export function unknownLine(uuid: string): TranscriptLine {
  return {
    type: "future_record_kind",
    payload: { whatever: true },
    uuid,
    timestamp: "2026-07-09T10:06:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Pre-baked scenario builders.
// ---------------------------------------------------------------------------

export interface BuiltSession {
  /** JSONL text (lines joined by \n; no trailing newline unless requested). */
  jsonl: string;
  /** The session id used across the lines. */
  sessionId: string;
}

/**
 * A normal, complete session: prompt → Read → Edit → Bash(test) → end_turn.
 * Covers prompts, model-request dedup (two lines share msg_01AAA), tool
 * correlation, file activity (Read/Edit), a command run + verification (Bash),
 * and a clean session-end.
 */
export function normalSession(opts?: { secretInPrompt?: boolean }): BuiltSession {
  const sessionId = "sess-normal-0001";
  const secret = opts?.secretInPrompt ? " sk-proj-AbCdEfGh1234567890 " : "";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-1", "Normal session"),
    promptLine({
      content: `Fix the login bug in src/auth.ts and verify with pnpm test.${secret}`,
      uuid: uid("u"),
      parentUuid: "leaf-1",
      sessionId,
    }),
    // First assistant line: text + Read tool_use, with initial usage. Same message.id
    // as the next line — tests model-request dedup (max tokens).
    assistantLine({
      messageId: "msg_01AAA",
      uuid: uid("a"),
      parentUuid: "u-0001",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1000, output_tokens: 40, cache_read_input_tokens: 200 },
      content: [
        { type: "text", text: "I'll read the file first." },
        {
          type: "tool_use",
          id: "toolu_read_01",
          name: "Read",
          input: { file_path: "/home/user/project-x/src/auth.ts" },
        },
      ],
    }),
    // Second line, same message.id, higher output_tokens (monotonic): must merge.
    assistantLine({
      messageId: "msg_01AAA",
      uuid: uid("a"),
      parentUuid: "u-0001",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1000, output_tokens: 120, cache_read_input_tokens: 200 },
      content: [],
    }),
    toolResultLine({
      toolUseId: "toolu_read_01",
      content: "export function login() { return null; /* bug */ }",
      uuid: uid("u"),
      parentUuid: "a-0002",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_02BBB",
      uuid: uid("a"),
      parentUuid: "u-0003",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1200, output_tokens: 50 },
      content: [
        {
          type: "tool_use",
          id: "toolu_edit_01",
          name: "Edit",
          input: {
            file_path: "/home/user/project-x/src/auth.ts",
            old_string: "return null",
            new_string: "return user",
          },
        },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_edit_01",
      content: "The file has been edited.",
      uuid: uid("u"),
      parentUuid: "a-0003",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_03CCC",
      uuid: uid("a"),
      parentUuid: "u-0004",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1300, output_tokens: 30 },
      content: [
        {
          type: "tool_use",
          id: "toolu_bash_01",
          name: "Bash",
          input: { command: "cd /home/user/project-x && pnpm test" },
        },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_bash_01",
      content: "\n✓ src/auth.test.ts (3 tests)\n3 passed\n",
      uuid: uid("u"),
      parentUuid: "a-0004",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_04DDD",
      uuid: uid("a"),
      parentUuid: "u-0005",
      sessionId,
      stopReason: "end_turn",
      usage: { input_tokens: 1400, output_tokens: 60 },
      content: [{ type: "text", text: "Fixed the login bug and tests pass." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/** A session that ends mid-tool-call (no tool_result): tests partial tool calls. */
export function interruptedSession(): BuiltSession {
  const sessionId = "sess-interrupt-0001";
  const lines: TranscriptLine[] = [
    promptLine({
      content: "Run the tests",
      uuid: uid("u"),
      parentUuid: "leaf-1",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_03CCC",
      uuid: uid("a"),
      parentUuid: "u-0001",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 800, output_tokens: 30 },
      content: [
        { type: "tool_use", id: "toolu_bash_01", name: "Bash", input: { command: "pnpm test" } },
      ],
    }),
    // No tool_result follows → partial tool call at flush.
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/** A session containing a compaction event and a sidechain (subagent) tool call. */
export function compactionAndSubagentSession(): BuiltSession {
  const sessionId = "sess-compact-0001";
  const lines: TranscriptLine[] = [
    promptLine({ content: "Do a big task", uuid: uid("u"), parentUuid: "leaf-1", sessionId }),
    assistantLine({
      messageId: "msg_04DDD",
      uuid: uid("a"),
      parentUuid: "u-0001",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 5000, output_tokens: 100 },
      content: [
        {
          type: "tool_use",
          id: "toolu_sub_01",
          name: "Task",
          input: { description: "subagent work" },
        },
      ],
      isSidechain: false,
    }),
    toolResultLine({
      toolUseId: "toolu_sub_01",
      content: "subagent finished",
      uuid: uid("u"),
      parentUuid: "a-0001",
      sessionId,
    }),
    compactionLine(uid("sys")),
    assistantLine({
      messageId: "msg_05EEE",
      uuid: uid("a"),
      parentUuid: "u-0002",
      sessionId,
      stopReason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 40 },
      content: [{ type: "text", text: "Done after compaction." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/** Lines with malformed JSON and an unknown record kind (recovery test). */
export function malformedAndUnknownLines(): string {
  return [
    `{"type":"summary","summary":"x","leafUuid":"l1","timestamp":"2026-07-09T10:00:00.000Z"}`,
    `{not valid json at all`,
    JSON.stringify(unknownLine("u-unknown")),
    `{"type":"user","message":{"role":"user","content":"hi"},"uuid":"u1","parentUuid":"l1","timestamp":"2026-07-09T10:00:01.000Z","sessionId":"s1","cwd":"/home/user/p","version":"1.0.0"}`,
  ].join("\n");
}

/** A JSONL string with a final line that has no trailing newline (partial tail). */
export function noTrailingNewline(lines: string): string {
  return lines;
}

export { uid as nextUid };
