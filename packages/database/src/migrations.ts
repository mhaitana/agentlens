/**
 * Versioned migrations, embedded as TS so they bundle cleanly with tsup (no
 * runtime file-path resolution). Mirrors the table definitions in schema.ts.
 *
 * Add new migrations by appending to this array; never edit an existing one.
 */
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  display_name TEXT NOT NULL,
  version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  path_hash TEXT NOT NULL,
  redacted_path TEXT,
  repository_remote_hash TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS projects_path_hash_idx ON projects(path_hash);
CREATE INDEX IF NOT EXISTS projects_last_seen_idx ON projects(last_seen_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  active_duration_ms INTEGER,
  metric_provenance TEXT,
  entry_point TEXT NOT NULL,
  source_version TEXT,
  completion_status TEXT NOT NULL,
  privacy_mode TEXT NOT NULL,
  data_completeness TEXT NOT NULL,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  model_request_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  subagent_count INTEGER NOT NULL DEFAULT 0,
  import_provenance TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions(started_at);
CREATE INDEX IF NOT EXISTS sessions_source_idx ON sessions(source_id);
CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_source_session_idx ON sessions(source_id, source_session_id);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  redacted_content TEXT,
  content_hash TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  approx_token_count INTEGER,
  features TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS prompts_session_idx ON prompts(session_id, sequence);
CREATE INDEX IF NOT EXISTS prompts_timestamp_idx ON prompts(timestamp);

CREATE TABLE IF NOT EXISTS model_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  prompt_id TEXT,
  timestamp TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_family TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  estimated_cost_usd REAL,
  duration_ms INTEGER,
  effort TEXT,
  query_source TEXT NOT NULL,
  agent_attribution TEXT,
  skill_attribution TEXT,
  plugin_attribution TEXT,
  mcp_attribution TEXT,
  metric_provenance TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS model_requests_session_idx ON model_requests(session_id);
CREATE INDEX IF NOT EXISTS model_requests_timestamp_idx ON model_requests(timestamp);
CREATE INDEX IF NOT EXISTS model_requests_model_idx ON model_requests(model_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_use_id TEXT,
  tool_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  success INTEGER NOT NULL,
  failure_type TEXT NOT NULL,
  permission_outcome TEXT NOT NULL,
  sanitised_input TEXT,
  input_size_bytes INTEGER,
  output_size_bytes INTEGER,
  prompt_id TEXT,
  model_request_id TEXT,
  subagent_attribution TEXT,
  source_provenance TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS tool_calls_session_idx ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS tool_calls_tool_name_idx ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS tool_calls_started_at_idx ON tool_calls(started_at);

CREATE TABLE IF NOT EXISTS file_activity (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_call_id TEXT,
  redacted_path TEXT,
  path_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  operation TEXT NOT NULL,
  success INTEGER NOT NULL,
  content_size_bytes INTEGER,
  intervening_modification INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS file_activity_session_idx ON file_activity(session_id);
CREATE INDEX IF NOT EXISTS file_activity_path_hash_idx ON file_activity(path_hash);
CREATE INDEX IF NOT EXISTS file_activity_timestamp_idx ON file_activity(timestamp);

CREATE TABLE IF NOT EXISTS command_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_call_id TEXT,
  executable TEXT NOT NULL,
  family TEXT NOT NULL,
  redacted_command TEXT NOT NULL,
  normalised_hash TEXT NOT NULL,
  classification TEXT NOT NULL,
  scope TEXT NOT NULL,
  exit_success INTEGER NOT NULL,
  duration_ms INTEGER,
  output_size_bytes INTEGER,
  failure_signature TEXT,
  git_commit_id TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS command_runs_session_idx ON command_runs(session_id);
CREATE INDEX IF NOT EXISTS command_runs_normalised_hash_idx ON command_runs(normalised_hash);
CREATE INDEX IF NOT EXISTS command_runs_classification_idx ON command_runs(classification);

CREATE TABLE IF NOT EXISTS verification_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  command_run_id TEXT,
  kind TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  success INTEGER NOT NULL,
  code_changed_after INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS verification_runs_session_idx ON verification_runs(session_id);
CREATE INDEX IF NOT EXISTS verification_runs_kind_idx ON verification_runs(kind);

CREATE TABLE IF NOT EXISTS compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  trigger TEXT NOT NULL,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  approx_pre_compaction_tokens INTEGER,
  approx_post_compaction_tokens INTEGER,
  source_provenance TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS compactions_session_idx ON compactions(session_id);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  session_id TEXT,
  project_id TEXT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence TEXT NOT NULL,
  estimated_impact TEXT,
  remediation TEXT
);
CREATE INDEX IF NOT EXISTS recommendations_session_idx ON recommendations(session_id);
CREATE INDEX IF NOT EXISTS recommendations_project_idx ON recommendations(project_id);
CREATE INDEX IF NOT EXISTS recommendations_status_idx ON recommendations(status);
CREATE INDEX IF NOT EXISTS recommendations_category_idx ON recommendations(category);

CREATE TABLE IF NOT EXISTS scan_state (
  source_id TEXT NOT NULL,
  uri TEXT NOT NULL,
  file_identity TEXT,
  size INTEGER,
  mtime INTEGER,
  last_byte_offset INTEGER,
  last_line INTEGER,
  rolling_hash TEXT,
  import_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, uri)
);
CREATE INDEX IF NOT EXISTS scan_state_uri_idx ON scan_state(uri);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
