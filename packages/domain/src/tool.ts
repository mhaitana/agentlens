import type { ProvenancedValue } from "./provenance.js";

/** Outcome of a permission check on a tool call. */
export type PermissionOutcome = "allowed" | "denied" | "asked" | "auto-approved" | "unknown";

/** Broad failure category for a tool call. */
export type FailureType =
  | "none"
  | "permission-denied"
  | "timeout"
  | "not-found"
  | "syntax-error"
  | "nonzero-exit"
  | "aborted"
  | "unknown";

/** A tool invocation. (§10.6) */
export interface ToolCall {
  id: string;
  sessionId: string;
  /** Tool-use id from the source, when available. */
  toolUseId?: string;
  toolName: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: ProvenancedValue<number>;
  success: boolean;
  failureType: FailureType;
  permissionOutcome: PermissionOutcome;

  /** Privacy-mode-sanitised input (redacted). */
  sanitisedInput?: string;
  inputSizeBytes?: ProvenancedValue<number>;
  outputSizeBytes?: ProvenancedValue<number>;

  /** Associated prompt or model request, when correlatable. */
  promptId?: string;
  modelRequestId?: string;
  /** Subagent that issued the call, when attributable. */
  subagentAttribution?: string;
  /** Where the event came from. */
  sourceProvenance: string;
}

/** Normalised file operation kind. (§10.7) */
export type FileOperation = "read" | "write" | "edit" | "delete" | "search" | "list" | "unknown";

/** File activity normalised from tool calls. (§10.7) */
export interface FileActivity {
  id: string;
  sessionId: string;
  toolCallId?: string;
  /** Redacted relative path, when permitted. */
  redactedPath?: string;
  /** Stable hash of the canonical path. */
  pathHash: string;
  timestamp: Date;
  operation: FileOperation;
  success: boolean;
  /** Content size when available. */
  contentSizeBytes?: number;
  /** Whether an intervening modification occurred before the next read. */
  interveningModification?: boolean;
}

/** Command classification (test/build/lint/typecheck). (§10.8) */
export type CommandClassification =
  | "test"
  | "build"
  | "lint"
  | "typecheck"
  | "format"
  | "security-scan"
  | "git"
  | "install"
  | "run"
  | "other"
  | "unknown";

/** Scope of a command's effect. (§10.8) */
export type CommandScope = "narrow" | "broad" | "unknown";

/** Safe metadata about a shell command. (§10.8) */
export interface CommandRun {
  id: string;
  sessionId: string;
  toolCallId?: string;
  /** Executable name (e.g. "pnpm", "git"). */
  executable: string;
  /** Coarse command family (e.g. "pnpm", "npm", "git"). */
  family: string;
  /** Redacted command text (arguments redacted). */
  redactedCommand: string;
  /** Stable hash of the normalised command for repetition detection. */
  normalisedHash: string;
  classification: CommandClassification;
  scope: CommandScope;
  exitSuccess: boolean;
  durationMs?: ProvenancedValue<number>;
  outputSizeBytes?: ProvenancedValue<number>;
  /** Stable signature summarising the failure, when failed. */
  failureSignature?: string;
  /** Git commit id, when safely available. */
  gitCommitId?: string;
  timestamp: Date;
}

/** Verification kind derived from a command. (§10.9) */
export type VerificationKind =
  | "unit-test"
  | "integration-test"
  | "e2e-test"
  | "type-check"
  | "lint"
  | "format-check"
  | "build"
  | "security-scan"
  | "unknown-verification";

/** A verification run and whether code changed afterwards. (§10.9) */
export interface VerificationRun {
  id: string;
  sessionId: string;
  commandRunId?: string;
  kind: VerificationKind;
  timestamp: Date;
  success: boolean;
  /** Whether files changed after this verification. */
  codeChangedAfter: boolean;
}

/** Compaction event. (§10.10) */
export interface Compaction {
  id: string;
  sessionId: string;
  timestamp: Date;
  trigger: string;
  success: boolean;
  durationMs?: ProvenancedValue<number>;
  approximatePreCompactionTokens?: ProvenancedValue<number>;
  approximatePostCompactionTokens?: ProvenancedValue<number>;
  sourceProvenance: string;
}
