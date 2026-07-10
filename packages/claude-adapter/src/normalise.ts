import type {
  EntryPoint,
  FileOperation,
  FailureType,
  PermissionOutcome,
  QuerySource,
} from "@agentlens/domain";
import type {
  NormalisedSourceEvent,
  ParserDiagnostic,
  ToolCallEvent,
} from "@agentlens/source-adapter";
import type { ParsedRecord } from "./parser/schema.js";
import type { ContentBlock } from "./parser/schema.js";
import {
  classifyCommand,
  fileOperationFor,
  filePathFromInput,
  gitCommitIdFromCommand,
  isBashTool,
  isFileTool,
  verificationKindFor,
} from "./tools.js";
import { sha256 } from "./paths.js";

export interface NormaliserOptions {
  sourceId: string;
  /** Source-native session id (usually the transcript filename). */
  sourceSessionId: string;
  /** Project path hint, for the session-start event. */
  projectPath?: string;
}

interface PendingToolUse {
  toolUseId: string;
  toolName: string;
  input: unknown;
  startedAt: Date;
  promptSequence?: number;
  isSidechain?: boolean;
}

interface PendingModel {
  messageId: string;
  timestamp: Date;
  model?: string;
  requestId?: string;
  /** Merged token usage (monotonic across lines sharing a message.id). */
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  promptSequence?: number;
}

/**
 * Stateful transcript normaliser (spec §13.2 normalisation, §10.7–10.9).
 *
 * Feed it parsed records via {@link push} (which returns any events that are
 * ready to emit) and call {@link flush} at end-of-stream to emit trailing
 * model requests, partial tool calls, and the session-end event. Model
 * requests are deduplicated by `message.id` so a multi-line assistant response
 * is counted once (avoiding the ~2.4x over-counting from one-line-per-block).
 */
export class TranscriptNormaliser {
  private promptSequence = 0;
  private lastPromptSequence: number | undefined;
  private sessionStarted = false;
  private firstTimestamp?: Date;
  private lastTimestamp?: Date;
  private lastStopReason?: string;
  private currentModelId?: string;
  private readonly pendingToolUse = new Map<string, PendingToolUse>();
  private readonly pendingModels: PendingModel[] = [];
  private readonly diagnostics: ParserDiagnostic[] = [];

  constructor(private readonly opts: NormaliserOptions) {}

  push(record: ParsedRecord): NormalisedSourceEvent[] {
    const ts = record.timestamp ? parseDate(record.timestamp) : this.lastTimestamp;
    if (!ts) {
      // No timestamp and no prior anchor: cannot place this event on a timeline.
      this.diagnostic("warn", record, "record without timestamp; skipped");
      return [];
    }
    this.lastTimestamp = ts;
    if (!this.firstTimestamp) this.firstTimestamp = ts;

    const events: NormalisedSourceEvent[] = [];
    // Emit session-start on the first non-summary record, which carries the
    // real `cwd` (the summary line usually lacks it).
    if (!this.sessionStarted && record.kind !== "summary") {
      events.push(this.sessionStart(record, ts));
      this.sessionStarted = true;
    }

    switch (record.kind) {
      case "user":
        events.push(...this.handleUser(record, ts));
        break;
      case "assistant":
        events.push(...this.handleAssistant(record, ts));
        break;
      case "system":
        events.push(...this.handleSystem(record, ts));
        break;
      case "summary":
        // Timeline anchor only; session-start is emitted on the first real record.
        break;
      default:
        events.push(
          this.unknownEvent(record, ts, [{ level: "info", message: `unknown record kind` }]),
        );
    }

    return events;
  }

  flush(): NormalisedSourceEvent[] {
    const events: NormalisedSourceEvent[] = [];

    // Emit any pending model requests (in arrival order).
    for (const model of this.pendingModels) {
      events.push(this.modelRequest(model));
    }
    this.pendingModels.length = 0;

    // Capture completion BEFORE clearing pending tool uses — an unanswered
    // tool_use means the session was interrupted, and sessionEnd() needs to
    // see that state.
    const completion = this.inferCompletion();

    // Emit tool calls whose results never arrived (partial session).
    for (const pending of this.pendingToolUse.values()) {
      events.push(this.toolCall(pending, undefined));
    }
    this.pendingToolUse.clear();

    if (this.sessionStarted) {
      events.push(this.sessionEnd(completion));
    } else if (this.firstTimestamp) {
      // Session had only metadata (e.g. a lone summary): still emit a start/end
      // so the importer records a (partial) session rather than dropping it.
      events.push({
        kind: "session-start",
        sourceId: this.opts.sourceId,
        sourceSessionId: this.opts.sourceSessionId,
        timestamp: this.firstTimestamp,
        rawKind: "summary",
        entryPoint: "unknown",
        projectPath: this.opts.projectPath,
      });
      events.push(this.sessionEnd(completion));
    }
    return events;
  }

  getDiagnostics(): ParserDiagnostic[] {
    return [...this.diagnostics];
  }

  private sessionStart(record: ParsedRecord, ts: Date): NormalisedSourceEvent {
    const entryPoint: EntryPoint = record.isSidechain ? "subagent" : "unknown";
    // Prefer the real working directory from the record; fall back to the
    // decoded project hint passed in by the adapter.
    const projectPath = record.cwd ?? this.opts.projectPath;
    return {
      kind: "session-start",
      sourceId: this.opts.sourceId,
      sourceSessionId: this.opts.sourceSessionId,
      timestamp: ts,
      rawKind: record.type,
      entryPoint,
      sourceVersion: record.version,
      projectPath,
    };
  }

  private sessionEnd(
    completionStatus: "completed" | "interrupted" | "failed" | "unknown",
  ): NormalisedSourceEvent {
    // The end is explicit only when the source recorded a terminal stop reason
    // (end_turn). A synthesised end (no end_turn seen) means the transcript tail
    // is missing — flagged partial-tail-missing downstream.
    const explicit = this.lastStopReason === "end_turn";
    return {
      kind: "session-end",
      sourceId: this.opts.sourceId,
      sourceSessionId: this.opts.sourceSessionId,
      timestamp: this.lastTimestamp ?? this.firstTimestamp ?? new Date(0),
      rawKind: "session-end",
      durationMs: this.durationMs(),
      completionStatus,
      explicit,
    };
  }

  private inferCompletion(): "completed" | "interrupted" | "failed" | "unknown" {
    if (this.lastStopReason === "end_turn") return "completed";
    if (this.pendingToolUse.size > 0) return "interrupted";
    // The session had real content but no terminal stop reason: the transcript
    // was truncated (tail missing), so this is an interruption, not "unknown".
    if (this.sessionStarted) return "interrupted";
    return "unknown";
  }

  private durationMs(): number | undefined {
    if (!this.firstTimestamp || !this.lastTimestamp) return undefined;
    return this.lastTimestamp.getTime() - this.firstTimestamp.getTime();
  }

  private handleUser(record: ParsedRecord, ts: Date): NormalisedSourceEvent[] {
    const content = record.message?.content;
    if (typeof content === "string") {
      return [this.promptEvent(content, ts)];
    }
    if (Array.isArray(content)) {
      const blocks = content as ContentBlock[];
      const hasToolResult = blocks.some((b) => b?.type === "tool_result");
      if (hasToolResult) {
        return this.handleToolResults(blocks, ts, record);
      }
      const text = blocks
        .filter((b) => b?.type === "text")
        .map((b) => (b as { text?: string }).text ?? "")
        .join("\n")
        .trim();
      if (text.length > 0) return [this.promptEvent(text, ts)];
    }
    return [];
  }

  private handleToolResults(
    blocks: ContentBlock[],
    ts: Date,
    record: ParsedRecord,
  ): NormalisedSourceEvent[] {
    const events: NormalisedSourceEvent[] = [];
    for (const block of blocks) {
      if (block?.type !== "tool_result") continue;
      const id = (block as { tool_use_id?: string }).tool_use_id;
      if (!id) continue;
      const pending = this.pendingToolUse.get(id);
      if (!pending) {
        this.diagnostic("warn", record, `tool_result for unknown tool_use_id ${id}`);
        events.push(
          this.unknownEvent(record, ts, [{ level: "warn", message: "orphan tool_result" }]),
        );
        continue;
      }
      this.pendingToolUse.delete(id);
      events.push(this.toolCall(pending, ts, block));
    }
    return events;
  }

  private handleAssistant(record: ParsedRecord, ts: Date): NormalisedSourceEvent[] {
    const events: NormalisedSourceEvent[] = [];
    const message = record.message;
    if (!message) return events;

    if (message.stop_reason) this.lastStopReason = message.stop_reason;
    if (message.model) this.currentModelId = message.model;

    // Model-request dedup by message.id (one event per API response).
    const messageId = message.id ?? `noid-${record.line}`;
    let pending = this.pendingModels.find((m) => m.messageId === messageId);
    if (!pending) {
      pending = {
        messageId,
        timestamp: ts,
        model: message.model,
        requestId: record.requestId,
        usage: {},
        promptSequence: this.lastPromptSequence,
      };
      this.pendingModels.push(pending);
    }
    this.mergeUsage(pending, message.usage);

    // Tool-use blocks become pending tool calls (emitted when their result arrives).
    if (Array.isArray(message.content)) {
      for (const block of message.content as ContentBlock[]) {
        if (block?.type !== "tool_use") continue;
        const id = (block as { id?: string }).id;
        if (!id) continue;
        this.pendingToolUse.set(id, {
          toolUseId: id,
          toolName: (block as { name?: string }).name ?? "unknown",
          input: (block as { input?: unknown }).input,
          startedAt: ts,
          promptSequence: this.lastPromptSequence,
          isSidechain: record.isSidechain,
        });
      }
    }

    return events;
  }

  private handleSystem(record: ParsedRecord, ts: Date): NormalisedSourceEvent[] {
    // Detect compaction conservatively (spec §12: undocumented fields unstable).
    const raw = record.raw as Record<string, unknown> | null;
    const subtype = typeof raw?.subtype === "string" ? raw.subtype : undefined;
    if (subtype && /compact/i.test(subtype)) {
      return [
        {
          kind: "compaction",
          sourceId: this.opts.sourceId,
          sourceSessionId: this.opts.sourceSessionId,
          timestamp: ts,
          rawKind: record.type,
          trigger: subtype,
          success: true,
        },
      ];
    }
    // Other system records are metadata; not surfaced as events in Phase 1.
    return [];
  }

  private promptEvent(text: string, ts: Date): NormalisedSourceEvent {
    this.promptSequence += 1;
    this.lastPromptSequence = this.promptSequence;
    return {
      kind: "prompt",
      sourceId: this.opts.sourceId,
      sourceSessionId: this.opts.sourceSessionId,
      timestamp: ts,
      rawKind: "user",
      sequence: this.promptSequence,
      content: text,
      contentHash: sha256(text),
    };
  }

  private modelRequest(pending: PendingModel): NormalisedSourceEvent {
    const querySource: QuerySource = "user";
    return {
      kind: "model-request",
      sourceId: this.opts.sourceId,
      sourceSessionId: this.opts.sourceSessionId,
      timestamp: pending.timestamp,
      rawKind: "assistant",
      modelId: pending.model ?? this.currentModelId ?? "unknown",
      sourceMessageId: pending.messageId,
      promptSequence: pending.promptSequence,
      inputTokens: pending.usage.inputTokens,
      outputTokens: pending.usage.outputTokens,
      cacheReadTokens: pending.usage.cacheReadTokens,
      cacheCreationTokens: pending.usage.cacheCreationTokens,
      querySource,
    };
  }

  private toolCall(
    pending: PendingToolUse,
    resultTs: Date | undefined,
    resultBlock?: ContentBlock,
  ): NormalisedSourceEvent {
    const durationMs =
      resultTs && pending.startedAt ? resultTs.getTime() - pending.startedAt.getTime() : undefined;

    const isError = resultBlock
      ? ((resultBlock as { is_error?: boolean; isError?: boolean }).is_error ??
        (resultBlock as { isError?: boolean }).isError ??
        false)
      : false;
    const success = resultBlock ? !isError : false;
    const failureType: FailureType = !resultBlock ? "unknown" : isError ? "unknown" : "none";
    const permissionOutcome: PermissionOutcome = "unknown";

    const inputJson = safeStringify(pending.input);
    const outputSize = resultOutputSize(resultBlock);

    const filePart = isFileTool(pending.toolName)
      ? {
          file: {
            operation: fileOperationFor(pending.toolName) as FileOperation,
            rawPath: filePathFromInput(pending.toolName, pending.input),
            contentSizeBytes: fileContentSize(pending),
          },
        }
      : undefined;

    let commandPart: { command: ToolCallEvent["command"] } | undefined;
    let verificationPart:
      { verification: { kind: NonNullable<ToolCallEvent["verification"]>["kind"] } } | undefined;
    if (isBashTool(pending.toolName)) {
      const cmd = bashCommand(pending.input);
      if (cmd) {
        const classified = classifyCommand(cmd);
        commandPart = {
          command: {
            executable: classified.executable,
            family: classified.family,
            rawCommand: cmd,
            classification: classified.classification,
            scope: classified.scope,
            exitSuccess: success,
            outputSizeBytes: outputSize,
            failureSignature: isError ? failureSignature(resultBlock) : undefined,
            gitCommitId: gitCommitIdFromCommand(cmd),
          },
        };
        const vKind = verificationKindFor(classified.classification);
        if (vKind) verificationPart = { verification: { kind: vKind } };
      }
    }

    const event: ToolCallEvent = {
      kind: "tool-call",
      sourceId: this.opts.sourceId,
      sourceSessionId: this.opts.sourceSessionId,
      timestamp: pending.startedAt,
      rawKind: "assistant",
      toolName: pending.toolName,
      toolUseId: pending.toolUseId,
      promptSequence: pending.promptSequence,
      durationMs,
      success,
      failureType,
      permissionOutcome,
      rawInput: inputJson ?? undefined,
      inputSizeBytes: inputJson ? Buffer.byteLength(inputJson, "utf8") : undefined,
      outputSizeBytes: outputSize,
      subagentAttribution: pending.isSidechain ? "sidechain" : undefined,
      ...(filePart ?? {}),
      ...(commandPart ?? {}),
      ...(verificationPart ?? {}),
    };

    return event;
  }

  private unknownEvent(
    record: ParsedRecord,
    ts: Date,
    diagnostics: ParserDiagnostic[],
  ): NormalisedSourceEvent {
    return {
      kind: "unknown",
      sourceId: this.opts.sourceId,
      sourceSessionId: this.opts.sourceSessionId,
      timestamp: ts,
      rawKind: record.type,
      diagnostics,
    };
  }

  private mergeUsage(
    pending: PendingModel,
    usage:
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        }
      | undefined,
  ): void {
    if (!usage) return;
    // Tokens are monotonic across lines sharing a message.id; keep the max.
    pending.usage.inputTokens = maxDefined(pending.usage.inputTokens, usage.input_tokens);
    pending.usage.outputTokens = maxDefined(pending.usage.outputTokens, usage.output_tokens);
    pending.usage.cacheCreationTokens = maxDefined(
      pending.usage.cacheCreationTokens,
      usage.cache_creation_input_tokens,
    );
    pending.usage.cacheReadTokens = maxDefined(
      pending.usage.cacheReadTokens,
      usage.cache_read_input_tokens,
    );
  }

  private diagnostic(
    level: "warn" | "error" | "info",
    record: ParsedRecord,
    message: string,
  ): void {
    this.diagnostics.push({ level, message, line: record.line });
  }
}

function parseDate(iso: string): Date | undefined {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function bashCommand(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

function fileContentSize(pending: PendingToolUse): number | undefined {
  const input = pending.input as Record<string, unknown> | undefined;
  if (!input) return undefined;
  const content = input.content;
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  return undefined;
}

function resultOutputSize(block?: ContentBlock): number | undefined {
  if (!block) return undefined;
  const content = (block as { content?: unknown }).content;
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  if (Array.isArray(content)) {
    return content.reduce(
      (n, b) => n + (typeof b === "string" ? Buffer.byteLength(b, "utf8") : 0),
      0,
    );
  }
  return undefined;
}

function failureSignature(block: ContentBlock | undefined): string | undefined {
  if (!block) return undefined;
  const content = (block as { content?: unknown }).content;
  if (typeof content !== "string") return undefined;
  // First non-empty line, truncated — a coarse failure signature (heuristic).
  const line = content.split("\n").find((l) => l.trim().length > 0);
  return line ? line.slice(0, 120) : undefined;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
