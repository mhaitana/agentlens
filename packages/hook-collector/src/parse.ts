/**
 * Tolerant Claude Code hook-payload parser (spec §14.2, §12).
 *
 * Claude Code's hook input schema is version-dependent and partly undocumented.
 * We parse defensively: any object is accepted; missing fields become undefined;
 * unknown fields are preserved verbatim in `raw` (and redacted before persist);
 * an entirely unparseable stdin becomes a single `unknown` event so a malformed
 * payload never aborts capture and never blocks Claude (§14.3).
 */
import { z } from "zod";

/** Hook event names AgentLens understands (§14.2). Anything else is `unknown`. */
export const KNOWN_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "Notification",
  "MessageDisplay",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
] as const;

/**
 * The looser possible object schema: every field optional, everything else
 * passed through. `.passthrough()` keeps new/undocumented fields for the
 * redactor + diagnostics (§12 "treat undocumented fields as unstable").
 */
const HookPayloadSchema = z
  .object({
    hook_event_name: z.string().optional(),
    session_id: z.string().optional(),
    prompt_id: z.string().optional(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    permission_mode: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_response: z.unknown().optional(),
    prompt: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    source: z.string().optional(),
    model: z.string().optional(),
    stop_hook_active: z.boolean().optional(),
    message: z.string().optional(),
  })
  .passthrough();

/** A tolerant-parsed hook event, ready for redaction. */
export interface ParsedHookEvent {
  /** Normalised event name; "unknown" when absent or not recognised. */
  hookEventName: string;
  /** Whether the event name was a recognised Claude Code hook event. */
  known: boolean;
  sourceSessionId?: string;
  promptId?: string;
  transcriptPath?: string;
  cwd?: string;
  permissionMode?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  prompt?: string;
  agentId?: string;
  agentType?: string;
  /** Full passthrough object (redacted before persistence). */
  raw: Record<string, unknown>;
  /** When AgentLens received the event (ISO). */
  receivedAt: string;
  /** Event timestamp — hooks carry no clock, so this is `receivedAt`. */
  timestamp: string;
  /** Parser diagnostics (e.g. "unparseable stdin"). */
  diagnostics: string[];
}

/** Parse a raw stdin string into a {@link ParsedHookEvent}. Never throws. */
export function parseHookStdin(raw: string, receivedAt: string): ParsedHookEvent {
  const diagnostics: string[] = [];
  let obj: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      obj = parsed as Record<string, unknown>;
    } else {
      diagnostics.push("hook payload is not a JSON object");
    }
  } catch {
    diagnostics.push("hook payload is not valid JSON");
  }

  if (!obj) {
    // Keep an opaque, redactable marker so the event is still observable.
    obj = { hook_event_name: "unknown", _malformed: raw.slice(0, 4096) };
  }

  const result = HookPayloadSchema.safeParse(obj);
  const data = result.success ? (result.data as Record<string, unknown>) : obj; // fall back to the raw object on any schema issue (tolerant)

  const name = typeof data["hook_event_name"] === "string" ? data["hook_event_name"] : "unknown";
  const known = (KNOWN_HOOK_EVENTS as readonly string[]).includes(name);
  if (name === "unknown" && typeof data["hook_event_name"] !== "string") {
    diagnostics.push("missing hook_event_name");
  } else if (!known) {
    diagnostics.push(`unknown hook event "${name}"`);
  }

  return {
    hookEventName: name,
    known,
    sourceSessionId: asString(data["session_id"]),
    promptId: asString(data["prompt_id"]),
    transcriptPath: asString(data["transcript_path"]),
    cwd: asString(data["cwd"]),
    permissionMode: asString(data["permission_mode"]),
    toolName: asString(data["tool_name"]),
    toolInput: data["tool_input"],
    toolResponse: data["tool_response"],
    prompt: asString(data["prompt"]),
    agentId: asString(data["agent_id"]),
    agentType: asString(data["agent_type"]),
    raw: data,
    receivedAt,
    timestamp: receivedAt,
    diagnostics,
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
