import { z } from "zod";

/**
 * Tolerant Zod schemas for Claude Code transcript lines (spec §12, §13.2).
 *
 * The transcript format is partially undocumented and version-dependent, so
 * every schema is permissive: unknown fields are kept (`.passthrough()`),
 * optional fields default to undefined, and unrecognised `type` values fall
 * through to an "unknown" record rather than aborting the scan. The normaliser
 * (not the parser) decides what to do with each record kind.
 */

/** A content block inside an assistant/user message. */
export const ContentBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("thinking"),
    thinking: z.string().optional(),
    signature: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    is_error: z.boolean().optional(),
    isError: z.boolean().optional(),
    content: z.unknown().optional(),
  }),
  // Tolerate any other block shape (new block types appear with new versions).
  z.object({ type: z.string() }).passthrough(),
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/** Token usage reported on an assistant message (spec §10.5). */
export const UsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
  })
  .passthrough();

export type Usage = z.infer<typeof UsageSchema>;

/** The Anthropic-style message object on user/assistant lines. */
export const MessageSchema = z
  .object({
    role: z.string().optional(),
    model: z.string().optional(),
    id: z.string().optional(),
    content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
    usage: UsageSchema.optional(),
    stop_reason: z.string().optional(),
  })
  .passthrough();

export type ParsedMessage = z.infer<typeof MessageSchema>;

/** The common envelope every transcript line shares. */
export const TranscriptLineSchema = z
  .object({
    type: z.string(),
    uuid: z.string().optional(),
    parentUuid: z.string().optional().nullable(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    gitBranch: z.string().optional().nullable(),
    version: z.string().optional(),
    userType: z.string().optional(),
    isSidechain: z.boolean().optional(),
    requestId: z.string().optional(),
    message: MessageSchema.optional(),
    summary: z.string().optional(),
    leafUuid: z.string().optional(),
  })
  .passthrough();

export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

/** Known top-level record kinds we normalise; everything else is "unknown". */
export type RecordKind = "summary" | "user" | "assistant" | "system" | "unknown";

/** A parsed transcript record (one JSONL line). */
export interface ParsedRecord {
  /** 1-based line number within the file. */
  line: number;
  /** Raw `type` string from the line. */
  type: string;
  /** Classified kind. */
  kind: RecordKind;
  uuid?: string;
  parentUuid?: string | null;
  /** ISO timestamp string, when present. */
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string | null;
  version?: string;
  isSidechain?: boolean;
  requestId?: string;
  message?: ParsedMessage;
  summary?: string;
  leafUuid?: string;
  /** Original parsed JSON; the normaliser may read additional fields from it,
   *  but it must never be persisted (it may carry un-redacted content). */
  raw: unknown;
}

/** A recoverable parser diagnostic (spec §13.2). */
export interface ParserDiagnostic {
  level: "warn" | "error" | "info";
  message: string;
  line?: number;
}

/** Result of parsing a single line. */
export interface ParsedLine {
  /** 1-based line number. */
  line: number;
  /** Byte offset of the start of the line within the file. */
  byteOffset: number;
  /** Byte offset one past the end of the line (including its newline, if any). */
  endByteOffset: number;
  /** The parsed record, or null if the line was blank/malformed/skipped. */
  record: ParsedRecord | null;
  /** Diagnostics produced while parsing this line. */
  diagnostics: ParserDiagnostic[];
}

/** Parse a single JSONL line into a record + diagnostics, never throwing. */
export function parseLine(text: string, lineNo: number): ParsedLine {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { line: lineNo, byteOffset: 0, endByteOffset: 0, record: null, diagnostics: [] };
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    return {
      line: lineNo,
      byteOffset: 0,
      endByteOffset: 0,
      record: null,
      diagnostics: [
        {
          level: "error",
          line: lineNo,
          message: `Malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  const parsed = TranscriptLineSchema.safeParse(json);
  if (!parsed.success) {
    return {
      line: lineNo,
      byteOffset: 0,
      endByteOffset: 0,
      record: null,
      diagnostics: [
        {
          level: "warn",
          line: lineNo,
          message: `Schema validation failed: ${parsed.error.issues[0]?.message ?? "unknown issue"}`,
        },
      ],
    };
  }

  const data = parsed.data;
  const kind = classifyKind(data.type);
  return {
    line: lineNo,
    byteOffset: 0,
    endByteOffset: 0,
    record: {
      line: lineNo,
      type: data.type,
      kind,
      uuid: data.uuid,
      parentUuid: data.parentUuid,
      timestamp: data.timestamp,
      sessionId: data.sessionId,
      cwd: data.cwd,
      gitBranch: data.gitBranch,
      version: data.version,
      isSidechain: data.isSidechain,
      requestId: data.requestId,
      message: data.message,
      summary: data.summary,
      leafUuid: data.leafUuid,
      raw: json,
    },
    diagnostics:
      kind === "unknown"
        ? [{ level: "info", line: lineNo, message: `Unknown record type "${data.type}"` }]
        : [],
  };
}

function classifyKind(type: string): RecordKind {
  switch (type) {
    case "summary":
    case "user":
    case "assistant":
    case "system":
      return type;
    default:
      return "unknown";
  }
}
