/**
 * @agentlens/source-adapter — the provider-neutral source contract (spec §11).
 *
 * Claude Code is the first adapter (see @agentlens/claude-adapter), but the
 * domain and analysis layers must never depend on Claude-specific shapes. They
 * consume only the NormalisedSourceEvent stream produced here.
 */

import type {
  DiscoveredSource,
  SourceCapabilities,
  SourceValidationResult,
  EntryPoint,
  FileOperation,
  FailureType,
  PermissionOutcome,
  QuerySource,
  CommandClassification,
  CommandScope,
  VerificationKind,
} from "@agentlens/domain";

/** Context passed to a source adapter's discovery phase. */
export interface DiscoveryContext {
  /** Extra directories to consider beyond the adapter's defaults. */
  additionalDirectories: string[];
  /** Projects to exclude (by path). */
  excludedProjects: string[];
  /** Whether to follow symlinks during discovery. Default false (§19.2). */
  followSymlinks: boolean;
}

/** Progress reported while scanning. */
export interface ScanProgress {
  uri?: string;
  linesProcessed: number;
  diagnostics: ParserDiagnostic[];
  done: boolean;
}

/** A recoverable parser diagnostic; never fatal to a scan (§13.2). */
export interface ParserDiagnostic {
  level: "warn" | "error" | "info";
  message: string;
  uri?: string;
  line?: number;
}

/** Input to a scan. */
export interface ScanInput {
  source: DiscoveredSource;
  /** Only include events at or after this time. */
  since?: Date;
  /** Only include events at or before this time. */
  until?: Date;
  /** Restrict to a single project path. */
  project?: string;
  /** Discover and parse without persisting. */
  dryRun: boolean;
  /** Resume streaming at this byte offset (spec §13.3). */
  startOffset?: number;
  /** Cancellation. */
  signal?: AbortSignal;
  /** Progress callback. */
  onProgress?: (progress: ScanProgress) => void;
}

/** Common fields on every normalised event. */
interface NormalisedEventBase {
  /** Adapter/source id. */
  sourceId: string;
  /** Source-native session id. */
  sourceSessionId: string;
  timestamp: Date;
  /** Raw record kind label, for diagnostics. */
  rawKind?: string;
}

export interface SessionStartEvent extends NormalisedEventBase {
  kind: "session-start";
  entryPoint: EntryPoint;
  sourceVersion?: string;
  /** Project path, when the source provides one. */
  projectPath?: string;
}

export interface SessionEndEvent extends NormalisedEventBase {
  kind: "session-end";
  /** Duration in ms when known. */
  durationMs?: number;
  completionStatus?: "completed" | "interrupted" | "failed" | "unknown";
  /**
   * Whether the source recorded an explicit end (e.g. a terminal stop_reason).
   * When false, the adapter synthesised the end at end-of-stream — the tail of
   * the transcript is missing (§13.4 partial-tail-missing). Defaults to false.
   */
  explicit?: boolean;
}

export interface PromptEvent extends NormalisedEventBase {
  kind: "prompt";
  sequence: number;
  /** Raw text — must be redacted by the importer before persistence. */
  content: string;
  contentHash: string;
}

export interface ModelRequestEvent extends NormalisedEventBase {
  kind: "model-request";
  modelId: string;
  modelFamily?: string;
  /**
   * Source-native message id (e.g. Claude's `message.id`). Stable across
   * re-imports and unique per API response, so the importer uses it as the
   * deterministic row id — avoiding collisions when two requests share a
   * second-precision timestamp.
   */
  sourceMessageId?: string;
  promptSequence?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Source-reported cost, when available. */
  reportedCostUsd?: number;
  durationMs?: number;
  effort?: string;
  querySource?: QuerySource;
  agentAttribution?: string;
  skillAttribution?: string;
  pluginAttribution?: string;
  mcpAttribution?: string;
}

export interface ToolCallEvent extends NormalisedEventBase {
  kind: "tool-call";
  toolName: string;
  toolUseId?: string;
  promptSequence?: number;
  durationMs?: number;
  success: boolean;
  failureType?: FailureType;
  permissionOutcome?: PermissionOutcome;
  /** Raw input — must be redacted before persistence. */
  rawInput?: string;
  inputSizeBytes?: number;
  outputSizeBytes?: number;
  subagentAttribution?: string;
  /** Normalised file activity, when this tool touched a file. */
  file?: {
    operation: FileOperation;
    /** Raw path — redacted to redactedPath + pathHash by the importer. */
    rawPath?: string;
    contentSizeBytes?: number;
  };
  /** Normalised command, when this tool ran a shell command. */
  command?: {
    executable: string;
    family: string;
    /** Raw command text — redacted to redactedCommand + normalisedHash. */
    rawCommand: string;
    classification: CommandClassification;
    scope: CommandScope;
    exitSuccess: boolean;
    outputSizeBytes?: number;
    failureSignature?: string;
    gitCommitId?: string;
  };
  /** Verification classification, when this command verified something. */
  verification?: {
    kind: VerificationKind;
  };
}

export interface CompactionEvent extends NormalisedEventBase {
  kind: "compaction";
  trigger: string;
  success: boolean;
  durationMs?: number;
  preCompactionTokens?: number;
  postCompactionTokens?: number;
}

export interface UnknownEvent extends NormalisedEventBase {
  kind: "unknown";
  diagnostics: ParserDiagnostic[];
}

/** The event stream an adapter produces. Tolerant: unknown records become
 *  UnknownEvent rather than aborting the scan (§13.2). */
export type NormalisedSourceEvent =
  | SessionStartEvent
  | SessionEndEvent
  | PromptEvent
  | ModelRequestEvent
  | ToolCallEvent
  | CompactionEvent
  | UnknownEvent;

/** A source adapter. Implementations must be observation/parse-only; they must
 *  not mutate source files or persist data directly. */
export interface SourceAdapter {
  readonly id: string;
  readonly displayName: string;

  /** Discover available source locations. */
  discover(context: DiscoveryContext): Promise<DiscoveredSource[]>;
  /** Stream normalised events from a source. */
  scan(input: ScanInput): AsyncIterable<NormalisedSourceEvent>;
  /** Validate a discovered source is usable. */
  validateSource(source: DiscoveredSource): Promise<SourceValidationResult>;
  /** Declare capabilities. */
  getCapabilities(): SourceCapabilities;
}
