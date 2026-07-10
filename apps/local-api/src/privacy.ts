/**
 * Read-side privacy gating (spec §13.9, §17, §8).
 *
 * Redaction already runs *before* persistence (§8.4), so the database only
 * ever stores what the active mode permits. This module is the
 * defense-in-depth *read* gate: regardless of what is stored, the API never
 * returns content-bearing fields when the active mode is `metadata-only`, and
 * the dashboard therefore cannot display content unavailable under the mode
 * (§13.11 "Privacy-mode restrictions are enforced").
 *
 * The three modes (§8.1–8.3):
 * - `metadata-only`  → strip all content fields; keep ids/timestamps/metrics.
 * - `redacted-content` → return the stored redacted content/paths/commands.
 * - `full-local`     → return everything that was stored (secrets already
 *                      stripped at import; never raw).
 *
 * Gating is centralised here so the API, the dashboard, and (later) the
 * Configuration Doctor all consult one definition of "content-bearing field".
 */
import type { PrivacyMode } from "@agentlens/config";

/** Whether the active mode permits *any* content to be returned. */
export function contentPermitted(mode: string): boolean {
  return mode !== "metadata-only";
}

/** A prompt as returned by the API. */
export interface PromptView {
  id: string;
  sequence: number;
  timestamp: string;
  characterCount: number;
  approximateTokenCount: number | null;
  /** Null when the active mode strips content. */
  redactedContent: string | null;
  features: unknown;
}

/** A tool call as returned by the API. */
export interface ToolCallView {
  id: string;
  toolName: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  success: boolean;
  failureType: string;
  /** Null when the active mode strips content. */
  sanitisedInput: string | null;
  inputSizeBytes: number | null;
  outputSizeBytes: number | null;
}

/** A command run as returned by the API. */
export interface CommandRunView {
  id: string;
  executable: string;
  family: string;
  /** Null when the active mode strips content. */
  redactedCommand: string | null;
  classification: string;
  scope: string;
  exitSuccess: boolean;
  timestamp: string;
  durationMs: number | null;
  outputSizeBytes: number | null;
}

/** A file-activity entry as returned by the API. */
export interface FileActivityView {
  id: string;
  operation: string;
  timestamp: string;
  success: boolean;
  /** Null when the active mode strips content. */
  redactedPath: string | null;
  pathHash: string;
  contentSizeBytes: number | null;
}

/** A verification run as returned by the API. */
export interface VerificationRunView {
  id: string;
  kind: string;
  timestamp: string;
  success: boolean;
  codeChangedAfter: boolean;
}

/** A compaction as returned by the API. */
export interface CompactionView {
  id: string;
  timestamp: string;
  trigger: string;
  success: boolean;
  durationMs: number | null;
  approximatePreCompactionTokens: number | null;
  approximatePostCompactionTokens: number | null;
}

/** Strip prompt content when the mode does not permit it. */
export function gatePrompt(
  mode: string,
  row: {
    id: string;
    sequence: number;
    timestamp: string;
    redactedContent: string | null;
    characterCount: number;
    approximateTokenCount: number | null;
    features: unknown;
  },
): PromptView {
  const permit = contentPermitted(mode);
  return {
    id: row.id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    characterCount: row.characterCount,
    approximateTokenCount: row.approximateTokenCount,
    redactedContent: permit ? row.redactedContent : null,
    features: row.features,
  };
}

/** Strip tool-call input when the mode does not permit content. */
export function gateToolCall(
  mode: string,
  row: {
    id: string;
    toolName: string;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    success: boolean;
    failureType: string;
    sanitisedInput: string | null;
    inputSizeBytes: number | null;
    outputSizeBytes: number | null;
  },
): ToolCallView {
  const permit = contentPermitted(mode);
  return {
    id: row.id,
    toolName: row.toolName,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    success: row.success,
    failureType: row.failureType,
    sanitisedInput: permit ? row.sanitisedInput : null,
    inputSizeBytes: row.inputSizeBytes,
    outputSizeBytes: row.outputSizeBytes,
  };
}

/** Strip command text when the mode does not permit content. */
export function gateCommandRun(
  mode: string,
  row: {
    id: string;
    executable: string;
    family: string;
    redactedCommand: string;
    classification: string;
    scope: string;
    exitSuccess: boolean;
    timestamp: string;
    durationMs: number | null;
    outputSizeBytes: number | null;
  },
): CommandRunView {
  const permit = contentPermitted(mode);
  return {
    id: row.id,
    executable: row.executable,
    family: row.family,
    redactedCommand: permit ? row.redactedCommand : null,
    classification: row.classification,
    scope: row.scope,
    exitSuccess: row.exitSuccess,
    timestamp: row.timestamp,
    durationMs: row.durationMs,
    outputSizeBytes: row.outputSizeBytes,
  };
}

/** Strip the file path when the mode does not permit content. */
export function gateFileActivity(
  mode: string,
  row: {
    id: string;
    operation: string;
    timestamp: string;
    success: boolean;
    redactedPath: string | null;
    pathHash: string;
    contentSizeBytes: number | null;
  },
): FileActivityView {
  const permit = contentPermitted(mode);
  return {
    id: row.id,
    operation: row.operation,
    timestamp: row.timestamp,
    success: row.success,
    redactedPath: permit ? row.redactedPath : null,
    pathHash: row.pathHash,
    contentSizeBytes: row.contentSizeBytes,
  };
}

export type { PrivacyMode };
