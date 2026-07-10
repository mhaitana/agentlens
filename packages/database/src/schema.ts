import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * AgentLens SQLite schema (spec §10, §5.4).
 *
 * Metric provenance (§3.4) is preserved per-entity in a `metricProvenance` JSON
 * column rather than duplicating a provenance column for every numeric field.
 */

/** Tracks which migration version the database is at. */
export const schemaVersion = sqliteTable("schema_version", {
  version: integer("version").notNull(),
  appliedAt: text("applied_at").notNull(),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  adapter: text("adapter").notNull(),
  displayName: text("display_name").notNull(),
  version: text("version"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    displayName: text("display_name").notNull(),
    pathHash: text("path_hash").notNull(),
    redactedPath: text("redacted_path"),
    repositoryRemoteHash: text("repository_remote_hash"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sourceId], foreignColumns: [sources.id] }),
    index("projects_path_hash_idx").on(t.pathHash),
    index("projects_last_seen_idx").on(t.lastSeenAt),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    sourceSessionId: text("source_session_id").notNull(),
    sourceId: text("source_id").notNull(),
    projectId: text("project_id").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMs: integer("duration_ms"),
    activeDurationMs: integer("active_duration_ms"),
    metricProvenance: text("metric_provenance", { mode: "json" }),
    entryPoint: text("entry_point").notNull(),
    sourceVersion: text("source_version"),
    completionStatus: text("completion_status").notNull(),
    privacyMode: text("privacy_mode").notNull(),
    dataCompleteness: text("data_completeness", { mode: "json" }).notNull(),
    promptCount: integer("prompt_count").notNull().default(0),
    modelRequestCount: integer("model_request_count").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    compactionCount: integer("compaction_count").notNull().default(0),
    subagentCount: integer("subagent_count").notNull().default(0),
    importProvenance: text("import_provenance").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sourceId], foreignColumns: [sources.id] }),
    foreignKey({ columns: [t.projectId], foreignColumns: [projects.id] }),
    index("sessions_started_at_idx").on(t.startedAt),
    index("sessions_source_idx").on(t.sourceId),
    index("sessions_project_idx").on(t.projectId),
    index("sessions_source_session_idx").on(t.sourceId, t.sourceSessionId),
  ],
);

export const prompts = sqliteTable(
  "prompts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    timestamp: text("timestamp").notNull(),
    redactedContent: text("redacted_content"),
    contentHash: text("content_hash").notNull(),
    characterCount: integer("character_count").notNull(),
    approximateTokenCount: integer("approximate_token_count"),
    features: text("features", { mode: "json" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("prompts_session_idx").on(t.sessionId, t.sequence),
    index("prompts_timestamp_idx").on(t.timestamp),
  ],
);

export const modelRequests = sqliteTable(
  "model_requests",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    promptId: text("prompt_id"),
    timestamp: text("timestamp").notNull(),
    modelId: text("model_id").notNull(),
    modelFamily: text("model_family"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    estimatedCostUsd: real("estimated_cost_usd"),
    durationMs: integer("duration_ms"),
    effort: text("effort"),
    querySource: text("query_source").notNull(),
    agentAttribution: text("agent_attribution"),
    skillAttribution: text("skill_attribution"),
    pluginAttribution: text("plugin_attribution"),
    mcpAttribution: text("mcp_attribution"),
    metricProvenance: text("metric_provenance", { mode: "json" }),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("model_requests_session_idx").on(t.sessionId),
    index("model_requests_timestamp_idx").on(t.timestamp),
    index("model_requests_model_idx").on(t.modelId),
  ],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    toolUseId: text("tool_use_id"),
    toolName: text("tool_name").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMs: integer("duration_ms"),
    success: integer("success", { mode: "boolean" }).notNull(),
    failureType: text("failure_type").notNull(),
    permissionOutcome: text("permission_outcome").notNull(),
    sanitisedInput: text("sanitised_input"),
    inputSizeBytes: integer("input_size_bytes"),
    outputSizeBytes: integer("output_size_bytes"),
    promptId: text("prompt_id"),
    modelRequestId: text("model_request_id"),
    subagentAttribution: text("subagent_attribution"),
    sourceProvenance: text("source_provenance").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("tool_calls_session_idx").on(t.sessionId),
    index("tool_calls_tool_name_idx").on(t.toolName),
    index("tool_calls_started_at_idx").on(t.startedAt),
  ],
);

export const fileActivity = sqliteTable(
  "file_activity",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    toolCallId: text("tool_call_id"),
    redactedPath: text("redacted_path"),
    pathHash: text("path_hash").notNull(),
    timestamp: text("timestamp").notNull(),
    operation: text("operation").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    contentSizeBytes: integer("content_size_bytes"),
    interveningModification: integer("intervening_modification", { mode: "boolean" }),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("file_activity_session_idx").on(t.sessionId),
    index("file_activity_path_hash_idx").on(t.pathHash),
    index("file_activity_timestamp_idx").on(t.timestamp),
  ],
);

export const commandRuns = sqliteTable(
  "command_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    toolCallId: text("tool_call_id"),
    executable: text("executable").notNull(),
    family: text("family").notNull(),
    redactedCommand: text("redacted_command").notNull(),
    normalisedHash: text("normalised_hash").notNull(),
    classification: text("classification").notNull(),
    scope: text("scope").notNull(),
    exitSuccess: integer("exit_success", { mode: "boolean" }).notNull(),
    durationMs: integer("duration_ms"),
    outputSizeBytes: integer("output_size_bytes"),
    failureSignature: text("failure_signature"),
    gitCommitId: text("git_commit_id"),
    timestamp: text("timestamp").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("command_runs_session_idx").on(t.sessionId),
    index("command_runs_normalised_hash_idx").on(t.normalisedHash),
    index("command_runs_classification_idx").on(t.classification),
  ],
);

export const verificationRuns = sqliteTable(
  "verification_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    commandRunId: text("command_run_id"),
    kind: text("kind").notNull(),
    timestamp: text("timestamp").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    codeChangedAfter: integer("code_changed_after", { mode: "boolean" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("verification_runs_session_idx").on(t.sessionId),
    index("verification_runs_kind_idx").on(t.kind),
  ],
);

export const compactions = sqliteTable(
  "compactions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    timestamp: text("timestamp").notNull(),
    trigger: text("trigger").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    durationMs: integer("duration_ms"),
    approximatePreCompactionTokens: integer("approx_pre_compaction_tokens"),
    approximatePostCompactionTokens: integer("approx_post_compaction_tokens"),
    sourceProvenance: text("source_provenance").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    index("compactions_session_idx").on(t.sessionId),
  ],
);

export const recommendations = sqliteTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    sessionId: text("session_id"),
    projectId: text("project_id"),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    confidence: real("confidence").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    explanation: text("explanation").notNull(),
    evidence: text("evidence", { mode: "json" }).notNull(),
    estimatedImpact: text("estimated_impact", { mode: "json" }),
    remediation: text("remediation", { mode: "json" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("recommendations_session_idx").on(t.sessionId),
    index("recommendations_project_idx").on(t.projectId),
    index("recommendations_status_idx").on(t.status),
    index("recommendations_category_idx").on(t.category),
  ],
);

/**
 * Live hook events captured from Claude Code (spec §14.2/§14.3). Payloads are
 * redacted before persistence (§8.4). Correlation to a scanned session is
 * inferred (§14.4): `correlatedSessionId` is a soft reference (no FK) because a
 * hook event frequently arrives before the transcript is scanned into a session
 * row, and may never match one.
 */
export const hookEvents = sqliteTable(
  "hook_events",
  {
    id: text("id").primaryKey(),
    /** Source-native session id from the hook payload (Claude `session_id`). */
    sourceSessionId: text("source_session_id"),
    /** Hook event name, e.g. "PreToolUse", "Stop" (§14.2). */
    hookEventName: text("hook_event_name").notNull(),
    /** When the hook fired (parsed from payload or received time). */
    timestamp: text("timestamp").notNull(),
    /** Redacted cwd path hash (the raw cwd is never persisted). */
    cwdHash: text("cwd_hash"),
    toolName: text("tool_name"),
    /** Redacted payload JSON (secrets/paths stripped, §8.4). */
    payload: text("payload", { mode: "json" }).notNull(),
    /** Stable hash of the redacted payload (correlation / dedup). */
    payloadHash: text("payload_hash").notNull(),
    /** How the event reached AgentLens: "online" (loopback POST) or "spool". */
    delivery: text("delivery").notNull(),
    receivedAt: text("received_at").notNull(),
    /** Soft correlation to a scanned session (§14.4). */
    correlatedSessionId: text("correlated_session_id"),
    /** 0–1 confidence in the correlation (1 = exact id match). */
    correlationConfidence: real("correlation_confidence"),
    /** Where this event came from ("claude-code-hook"). */
    provenance: text("provenance").notNull(),
  },
  (t) => [
    index("hook_events_source_session_idx").on(t.sourceSessionId),
    index("hook_events_name_idx").on(t.hookEventName),
    index("hook_events_received_idx").on(t.receivedAt),
    index("hook_events_correlated_idx").on(t.correlatedSessionId),
  ],
);

/**
 * Normalised OpenTelemetry events ingested from Claude Code telemetry
 * (spec §14.6/§14.8). OTLP/JSON is parsed into one row per metric/log/trace
 * record; payloads redacted before persistence. Correlation is inferred.
 */
export const otelEvents = sqliteTable(
  "otel_events",
  {
    id: text("id").primaryKey(),
    /** "metric" | "log" | "trace". */
    kind: text("kind").notNull(),
    /** Source-native session id when attributable from resource attributes. */
    sourceSessionId: text("source_session_id"),
    /** Metric/log/trace name (e.g. "claude_code.token.usage"). */
    name: text("name"),
    /** When the event occurred (from the OTLP time field, or received). */
    timestamp: text("timestamp").notNull(),
    /** Redacted normalised payload (§8.4). */
    payload: text("payload", { mode: "json" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: text("received_at").notNull(),
    correlatedSessionId: text("correlated_session_id"),
    correlationConfidence: real("correlation_confidence"),
    provenance: text("provenance").notNull(),
  },
  (t) => [
    index("otel_events_kind_idx").on(t.kind),
    index("otel_events_received_idx").on(t.receivedAt),
    index("otel_events_source_session_idx").on(t.sourceSessionId),
    index("otel_events_correlated_idx").on(t.correlatedSessionId),
  ],
);

/** Incremental-import bookkeeping (spec §13.3). */
export const scanState = sqliteTable(
  "scan_state",
  {
    sourceId: text("source_id").notNull(),
    uri: text("uri").notNull(),
    fileIdentity: text("file_identity"),
    size: integer("size"),
    mtime: integer("mtime"),
    lastByteOffset: integer("last_byte_offset"),
    lastLine: integer("last_line"),
    rollingHash: text("rolling_hash"),
    importVersion: integer("import_version").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.uri] }), index("scan_state_uri_idx").on(t.uri)],
);

export type SessionsTable = typeof sessions;
export type ProjectsTable = typeof projects;

export const _sql = sql;
