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

// ---------------------------------------------------------------------------
// §21.1 rule-evidence scenario builders (F003).
// ---------------------------------------------------------------------------

/** A helper to emit a Bash tool_use + failing tool_result pair. */
function bashPair(args: {
  sessionId: string;
  parentUuid: string;
  command: string;
  fail?: boolean;
  toolUseId: string;
  assistantId: string;
  resultId: string;
  assistantMsgId?: string;
  timestamp?: string;
  resultTimestamp?: string;
  cwd?: string;
}): TranscriptLine[] {
  return [
    assistantLine({
      messageId: args.assistantMsgId ?? `msg_${args.assistantId}`,
      uuid: args.assistantId,
      parentUuid: args.parentUuid,
      sessionId: args.sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1000, output_tokens: 20 },
      content: [
        { type: "tool_use", id: args.toolUseId, name: "Bash", input: { command: args.command } },
      ],
      timestamp: args.timestamp,
    }),
    toolResultLine({
      toolUseId: args.toolUseId,
      content: args.fail ? "Error: command failed" : "ok",
      isError: args.fail ?? false,
      uuid: args.resultId,
      parentUuid: args.assistantId,
      sessionId: args.sessionId,
      timestamp: args.resultTimestamp ?? args.timestamp,
    }),
  ];
}

/**
 * §21.1 repeated file reads: the same file read three times with no intervening
 * edit (TOOLS-001 evidence).
 */
export function repeatedReadsSession(): BuiltSession {
  const sessionId = "sess-repeated-reads-0001";
  const lines: TranscriptLine[] = [summaryLine("leaf-rr", "Repeated reads")];
  let parent = "leaf-rr";
  for (let i = 1; i <= 3; i++) {
    const aid = `a-rr-${i}`;
    lines.push(
      assistantLine({
        messageId: `msg_rr_${i}`,
        uuid: aid,
        parentUuid: parent,
        sessionId,
        stopReason: "tool_use",
        usage: { input_tokens: 1000, output_tokens: 20 },
        content: [
          {
            type: "tool_use",
            id: `toolu_read_rr_${i}`,
            name: "Read",
            input: { file_path: "/home/user/project-x/src/big.ts" },
          },
        ],
      }),
      toolResultLine({
        toolUseId: `toolu_read_rr_${i}`,
        content: `// contents ${i}`,
        uuid: `u-rr-${i}`,
        parentUuid: aid,
        sessionId,
      }),
    );
    parent = `u-rr-${i}`;
  }
  lines.push(
    assistantLine({
      messageId: "msg_rr_end",
      uuid: "a-rr-end",
      parentUuid: parent,
      sessionId,
      usage: { input_tokens: 1200, output_tokens: 10 },
      content: [{ type: "text", text: "Done." }],
    }),
  );
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 repeated command failures: the same failing command twice (TOOLS-003
 * evidence). Uses `pnpm test` so it classifies as a test/verification failure.
 */
export function repeatedFailedCommandsSession(): BuiltSession {
  const sessionId = "sess-repeated-fail-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-rf", "Repeated failures"),
    promptLine({ content: "Fix and test", uuid: "u-rf-0", parentUuid: "leaf-rf", sessionId }),
  ];
  let parent = "u-rf-0";
  for (let i = 1; i <= 2; i++) {
    const pair = bashPair({
      sessionId,
      parentUuid: parent,
      command: "cd /home/user/project-x && pnpm test",
      fail: true,
      toolUseId: `toolu_bash_rf_${i}`,
      assistantId: `a-rf-${i}`,
      resultId: `u-rf-${i}`,
      timestamp: `2026-07-09T10:00:0${i}.000Z`,
    });
    lines.push(...pair);
    parent = `u-rf-${i}`;
  }
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 broad tests run repeatedly: three `pnpm test --all` invocations
 * (TOOLS-004 evidence — broad-scope test runs).
 */
export function broadTestsSession(): BuiltSession {
  const sessionId = "sess-broad-tests-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-bt", "Broad tests"),
    promptLine({ content: "Run the full suite", uuid: "u-bt-0", parentUuid: "leaf-bt", sessionId }),
  ];
  let parent = "u-bt-0";
  for (let i = 1; i <= 3; i++) {
    const pair = bashPair({
      sessionId,
      parentUuid: parent,
      command: "cd /home/user/project-x && pnpm test --all",
      fail: false,
      toolUseId: `toolu_bash_bt_${i}`,
      assistantId: `a-bt-${i}`,
      resultId: `u-bt-${i}`,
      timestamp: `2026-07-09T10:00:0${i}.000Z`,
    });
    lines.push(...pair);
    parent = `u-bt-${i}`;
  }
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 code changes with no verification: an Edit with no following
 * test/build/lint/typecheck (VERIFY-001 evidence).
 */
export function changesNoVerificationSession(): BuiltSession {
  const sessionId = "sess-no-verify-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-nv", "No verification"),
    promptLine({ content: "Add a feature", uuid: "u-nv-0", parentUuid: "leaf-nv", sessionId }),
    assistantLine({
      messageId: "msg_nv_edit",
      uuid: "a-nv-edit",
      parentUuid: "u-nv-0",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1000, output_tokens: 30 },
      content: [
        {
          type: "tool_use",
          id: "toolu_edit_nv",
          name: "Edit",
          input: {
            file_path: "/home/user/project-x/src/feat.ts",
            old_string: "a",
            new_string: "b",
          },
        },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_edit_nv",
      content: "edited",
      uuid: "u-nv-1",
      parentUuid: "a-nv-edit",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_nv_end",
      uuid: "a-nv-end",
      parentUuid: "u-nv-1",
      sessionId,
      usage: { input_tokens: 1100, output_tokens: 10 },
      content: [{ type: "text", text: "Done." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 changes after final verification: a successful test, then an Edit after
 * (VERIFY-002 evidence — writes after the last verification).
 */
export function changesAfterVerificationSession(): BuiltSession {
  const sessionId = "sess-changes-after-verify-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-cv", "Changes after verify"),
    promptLine({ content: "Fix and test", uuid: "u-cv-0", parentUuid: "leaf-cv", sessionId }),
    // Test first (succeeds).
    ...bashPair({
      sessionId,
      parentUuid: "u-cv-0",
      command: "cd /home/user/project-x && pnpm test",
      fail: false,
      toolUseId: "toolu_bash_cv",
      assistantId: "a-cv-test",
      resultId: "u-cv-test",
      timestamp: "2026-07-09T10:00:02.000Z",
    }),
    // Then an edit AFTER the verification.
    assistantLine({
      messageId: "msg_cv_edit",
      uuid: "a-cv-edit",
      parentUuid: "u-cv-test",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1200, output_tokens: 30 },
      content: [
        {
          type: "tool_use",
          id: "toolu_edit_cv",
          name: "Edit",
          input: {
            file_path: "/home/user/project-x/src/auth.ts",
            old_string: "a",
            new_string: "b",
          },
        },
      ],
      timestamp: "2026-07-09T10:00:05.000Z",
    }),
    toolResultLine({
      toolUseId: "toolu_edit_cv",
      content: "edited",
      uuid: "u-cv-edit",
      parentUuid: "a-cv-edit",
      sessionId,
      timestamp: "2026-07-09T10:00:05.500Z",
    }),
    assistantLine({
      messageId: "msg_cv_end",
      uuid: "a-cv-end",
      parentUuid: "u-cv-edit",
      sessionId,
      usage: { input_tokens: 1300, output_tokens: 10 },
      content: [{ type: "text", text: "Done." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 multiple compactions: two compaction events (CONTEXT-001 evidence).
 */
export function multipleCompactionsSession(): BuiltSession {
  const sessionId = "sess-multi-compact-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-mc", "Multiple compactions"),
    promptLine({ content: "Big task", uuid: "u-mc-0", parentUuid: "leaf-mc", sessionId }),
    assistantLine({
      messageId: "msg_mc_1",
      uuid: "a-mc-1",
      parentUuid: "u-mc-0",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 90000, output_tokens: 200 },
      content: [
        { type: "tool_use", id: "toolu_bash_mc", name: "Bash", input: { command: "echo working" } },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_bash_mc",
      content: "working",
      uuid: "u-mc-1",
      parentUuid: "a-mc-1",
      sessionId,
    }),
    compactionLine("sys-mc-1", "2026-07-09T10:05:00.000Z"),
    assistantLine({
      messageId: "msg_mc_2",
      uuid: "a-mc-2",
      parentUuid: "sys-mc-1",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 95000, output_tokens: 200 },
      content: [
        { type: "tool_use", id: "toolu_bash_mc2", name: "Bash", input: { command: "echo more" } },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_bash_mc2",
      content: "more",
      uuid: "u-mc-2",
      parentUuid: "a-mc-2",
      sessionId,
    }),
    compactionLine("sys-mc-2", "2026-07-09T10:10:00.000Z"),
    assistantLine({
      messageId: "msg_mc_end",
      uuid: "a-mc-end",
      parentUuid: "sys-mc-2",
      sessionId,
      usage: { input_tokens: 5000, output_tokens: 40 },
      content: [{ type: "text", text: "Done." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 sensitive path access: reads of `.env` and a private key (SECURITY-001
 * evidence). The paths themselves are non-secret; only the *contents* would be.
 */
export function sensitivePathSession(): BuiltSession {
  const sessionId = "sess-sensitive-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-sp", "Sensitive path access"),
    promptLine({ content: "Check the config", uuid: "u-sp-0", parentUuid: "leaf-sp", sessionId }),
    assistantLine({
      messageId: "msg_sp_env",
      uuid: "a-sp-env",
      parentUuid: "u-sp-0",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1000, output_tokens: 20 },
      content: [
        {
          type: "tool_use",
          id: "toolu_read_env",
          name: "Read",
          input: { file_path: "/home/user/project-x/.env" },
        },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_read_env",
      content: "DATABASE_URL=postgres://example",
      uuid: "u-sp-env",
      parentUuid: "a-sp-env",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_sp_key",
      uuid: "a-sp-key",
      parentUuid: "u-sp-env",
      sessionId,
      stopReason: "tool_use",
      usage: { input_tokens: 1100, output_tokens: 20 },
      content: [
        {
          type: "tool_use",
          id: "toolu_read_key",
          name: "Read",
          input: { file_path: "/home/user/project-x/deploy.pem" },
        },
      ],
    }),
    toolResultLine({
      toolUseId: "toolu_read_key",
      content: "-----BEGIN PRIVATE KEY-----",
      uuid: "u-sp-key",
      parentUuid: "a-sp-key",
      sessionId,
    }),
    assistantLine({
      messageId: "msg_sp_end",
      uuid: "a-sp-end",
      parentUuid: "u-sp-key",
      sessionId,
      usage: { input_tokens: 1200, output_tokens: 10 },
      content: [{ type: "text", text: "Done." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 prompt corrections: a failed test followed by a corrective user prompt
 * (WORKFLOW-001 evidence — prompt after a failed verification).
 */
export function promptCorrectionsSession(): BuiltSession {
  const sessionId = "sess-prompt-correction-0001";
  const lines: TranscriptLine[] = [
    summaryLine("leaf-pc", "Prompt corrections"),
    promptLine({ content: "Fix the bug", uuid: "u-pc-0", parentUuid: "leaf-pc", sessionId }),
    // Failing test.
    ...bashPair({
      sessionId,
      parentUuid: "u-pc-0",
      command: "cd /home/user/project-x && pnpm test",
      fail: true,
      toolUseId: "toolu_bash_pc",
      assistantId: "a-pc-test",
      resultId: "u-pc-test",
      timestamp: "2026-07-09T10:00:02.000Z",
    }),
    // Corrective prompt after the failure.
    promptLine({
      content: "No, that's wrong — actually revert and try the other approach.",
      uuid: "u-pc-1",
      parentUuid: "a-pc-test",
      sessionId,
      timestamp: "2026-07-09T10:00:04.000Z",
    }),
    assistantLine({
      messageId: "msg_pc_end",
      uuid: "a-pc-end",
      parentUuid: "u-pc-1",
      sessionId,
      usage: { input_tokens: 1200, output_tokens: 10 },
      content: [{ type: "text", text: "Ok." }],
    }),
  ];
  return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
}

/**
 * §21.1 multiple projects: two sessions in different working directories
 * (cross-project aggregation evidence).
 */
export function multipleProjectsSessions(): BuiltSession[] {
  const projectA = normalSession();
  const projectB: BuiltSession = (() => {
    const sessionId = "sess-other-project-0001";
    const lines: TranscriptLine[] = [
      summaryLine("leaf-op", "Other project"),
      promptLine({
        content: "Work in another repo",
        uuid: "u-op-0",
        parentUuid: "leaf-op",
        sessionId,
        cwd: "/home/user/project-y",
      }),
      assistantLine({
        messageId: "msg_op_1",
        uuid: "a-op-1",
        parentUuid: "u-op-0",
        sessionId,
        stopReason: "tool_use",
        usage: { input_tokens: 900, output_tokens: 30 },
        content: [
          {
            type: "tool_use",
            id: "toolu_bash_op",
            name: "Bash",
            input: { command: "cd /home/user/project-y && pnpm test" },
          },
        ],
      }),
      toolResultLine({
        toolUseId: "toolu_bash_op",
        content: "1 passed",
        uuid: "u-op-1",
        parentUuid: "a-op-1",
        sessionId,
      }),
      assistantLine({
        messageId: "msg_op_end",
        uuid: "a-op-end",
        parentUuid: "u-op-1",
        sessionId,
        usage: { input_tokens: 1000, output_tokens: 10 },
        content: [{ type: "text", text: "Done." }],
      }),
    ];
    return { jsonl: lines.map((l) => JSON.stringify(l)).join("\n"), sessionId };
  })();
  return [projectA, projectB];
}

/** A JSONL string with a final line that has no trailing newline (partial tail). */
export function noTrailingNewline(lines: string): string {
  return lines;
}

export { uid as nextUid };
