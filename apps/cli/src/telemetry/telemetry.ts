/**
 * Claude Code telemetry configuration logic (spec §14.7, §14.8).
 *
 * AgentLens stores an OTLP export profile in its own config.json (safe,
 * AgentLens-owned). `buildEnvVars` turns it into the exact `OTEL_*` /
 * `CLAUDE_CODE_*` environment variables Claude Code's OpenTelemetry exporter
 * reads, pointing at the local loopback OTLP receiver. Privacy defaults
 * (§14.7, §14.11): every sensitive-content flag is OFF; traces are a beta
 * feature and disabled unless explicitly enabled.
 *
 * `--write-claude-settings` optionally persists those env vars into the Claude
 * Code user settings `env` block (safe-remediation: show plan → back up →
 * write only AgentLens-owned keys → validate → rollback hint). `remove` strips
 * exactly those keys. Unrelated `env` entries and hooks are preserved.
 *
 * Env var names follow Claude Code's documented OpenTelemetry integration
 * (spec §12 — verified against official monitoring docs). They are treated as
 * unstable/version-dependent; we key removal on a stable owned-key set.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { TelemetryConfig, AgentLensConfig } from "@agentlens/config";

/** Env keys AgentLens owns (the only ones `remove`/`--write-claude-settings` touch). */
export const AGENTLENS_OWNED_ENV_KEYS = [
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_TRACES_EXPORTER",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_ASSISTANT_RESPONSES",
  "OTEL_LOG_TOOL_DETAILS",
  "OTEL_LOG_TOOL_CONTENT",
  "OTEL_LOG_RAW_API_BODIES",
  "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
] as const;

export interface EnvVar {
  key: string;
  value: string;
  /** Why this var is included (shown in merge plan / status). */
  sensitive?: boolean;
}

/**
 * The minimal "required telemetry" profile (§14.7): enables OTLP metrics + logs
 * export to the local receiver, with every sensitive-content flag OFF and
 * traces OFF. `overrides` lets the user opt into specific flags (e.g.
 * `--tool-details`).
 */
export function minimalTelemetryConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    enabled: true,
    otlpPort: 4318,
    protocol: "http/json",
    endpoint: "http://127.0.0.1:4318",
    logUserPrompts: false,
    logAssistantResponses: false,
    logToolDetails: false,
    logToolContent: false,
    logRawApiBodies: false,
    tracesEnabled: false,
    ...overrides,
  };
}

/**
 * Build the env-var assignments for a telemetry config. `livePort` (from the
 * runtime record) overrides the configured port when the receiver is running so
 * the endpoint always matches the actual bound port.
 */
export function buildEnvVars(config: TelemetryConfig, livePort?: number): EnvVar[] {
  if (!config.enabled) return [];
  const port = livePort ?? config.otlpPort;
  const endpoint = `http://127.0.0.1:${port}`;
  const vars: EnvVar[] = [
    { key: "CLAUDE_CODE_ENABLE_TELEMETRY", value: "1" },
    { key: "OTEL_METRICS_EXPORTER", value: "otlp" },
    { key: "OTEL_LOGS_EXPORTER", value: "otlp" },
    { key: "OTEL_TRACES_EXPORTER", value: config.tracesEnabled ? "otlp" : "none" },
    { key: "OTEL_EXPORTER_OTLP_PROTOCOL", value: config.protocol },
    { key: "OTEL_EXPORTER_OTLP_ENDPOINT", value: endpoint },
    { key: "OTEL_LOG_USER_PROMPTS", value: config.logUserPrompts ? "1" : "0", sensitive: true },
    {
      key: "OTEL_LOG_ASSISTANT_RESPONSES",
      value: config.logAssistantResponses ? "1" : "0",
      sensitive: true,
    },
    { key: "OTEL_LOG_TOOL_DETAILS", value: config.logToolDetails ? "1" : "0", sensitive: true },
    { key: "OTEL_LOG_TOOL_CONTENT", value: config.logToolContent ? "1" : "0", sensitive: true },
    { key: "OTEL_LOG_RAW_API_BODIES", value: config.logRawApiBodies ? "1" : "0", sensitive: true },
  ];
  if (config.tracesEnabled) {
    vars.push({ key: "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA", value: "1" });
  }
  return vars;
}

/** Render env vars as shell `export KEY=VALUE` lines. */
export function envVarsToShell(vars: EnvVar[]): string {
  return vars.map((v) => `export ${v.key}=${v.value}`).join("\n");
}

/** Render env vars as `unset KEY` lines (for `remove`). */
export function envVarsToUnset(vars: EnvVar[]): string {
  return vars.map((v) => `unset ${v.key}`).join("\n");
}

export interface MergeEntry {
  key: string;
  before: unknown;
  after: unknown;
  change: "add" | "change" | "remove" | "none";
  sensitive?: boolean;
}

/** Compute a field-level merge plan between two telemetry configs. */
export function telemetryMergePlan(before: TelemetryConfig, after: TelemetryConfig): MergeEntry[] {
  const keys: Array<keyof TelemetryConfig> = [
    "enabled",
    "otlpPort",
    "protocol",
    "endpoint",
    "logUserPrompts",
    "logAssistantResponses",
    "logToolDetails",
    "logToolContent",
    "logRawApiBodies",
    "tracesEnabled",
  ];
  const sensitive = new Set([
    "logUserPrompts",
    "logAssistantResponses",
    "logToolDetails",
    "logToolContent",
    "logRawApiBodies",
  ]);
  return keys.map((k) => {
    const key = k as string;
    const b = before[k];
    const a = after[k];
    const change: MergeEntry["change"] =
      b === a ? "none" : before.enabled === false && key !== "enabled" ? "add" : "change";
    return { key, before: b, after: a, change, sensitive: sensitive.has(key) };
  });
}

/** Apply configure: return a new config with the telemetry section replaced. */
export function applyConfigure(config: AgentLensConfig, next: TelemetryConfig): AgentLensConfig {
  return { ...config, telemetry: next };
}

/** Apply remove: return a new config with telemetry disabled. */
export function applyRemoveConfig(config: AgentLensConfig): AgentLensConfig {
  return { ...config, telemetry: { ...config.telemetry, enabled: false } };
}

/* -------------------------------------------------------------------------- */
/* Claude Code settings.json env-block editing (safe remediation)             */
/* -------------------------------------------------------------------------- */

export function resolveClaudeHome(override?: string): string {
  const env = (process.env.AGENTLENS_CLAUDE_HOME || "").trim();
  const raw = (override && override.trim()) || env;
  if (raw) return raw;
  return join(homedir(), ".claude");
}

export function claudeSettingsPath(claudeHome: string): string {
  return join(claudeHome, "settings.json");
}

interface ClaudeSettings {
  env?: Record<string, string>;
  [k: string]: unknown;
}

function readJson<T = unknown>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    rmSync(tmp, { force: true });
  }
}

function backupFile(path: string, agentLensHome: string, nowIso: string): string {
  const backupDir = join(agentLensHome, "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = nowIso.replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `settings.json.${stamp}.bak`);
  if (existsSync(path)) copyFileSync(path, backupPath);
  else writeFileSync(backupPath, "{}\n", { mode: 0o600 });
  return backupPath;
}

export interface WriteSettingsResult {
  dryRun: boolean;
  settingsPath: string;
  backedUp: string | null;
  writtenKeys: string[];
  preservedKeys: string[];
  rollbackHint: string;
}

/** Write AgentLens-owned env vars into the Claude settings `env` block. */
export function writeEnvToClaudeSettings(
  claudeHome: string,
  agentLensHome: string,
  vars: EnvVar[],
  dryRun: boolean,
  nowIso = new Date().toISOString(),
): WriteSettingsResult {
  const settingsPath = claudeSettingsPath(claudeHome);
  const settings = (readJson<ClaudeSettings>(settingsPath) ?? {}) as ClaudeSettings;
  const env = { ...(settings.env ?? {}) };
  const preservedKeys = Object.keys(env).filter(
    (k) => !AGENTLENS_OWNED_ENV_KEYS.includes(k as (typeof AGENTLENS_OWNED_ENV_KEYS)[number]),
  );
  if (dryRun) {
    return {
      dryRun: true,
      settingsPath,
      backedUp: null,
      writtenKeys: vars.map((v) => v.key),
      preservedKeys,
      rollbackHint: rollbackHint(agentLensHome),
    };
  }
  const backedUp = backupFile(settingsPath, agentLensHome, nowIso);
  // Rebuild the env block: keep non-owned keys + owned keys that remain in
  // `vars`, then write the new var values on top. (Object reconstruction
  // instead of computed `delete` to satisfy no-dynamic-delete.)
  const keep = new Set(vars.map((v) => v.key));
  const ownedSet = new Set(AGENTLENS_OWNED_ENV_KEYS as readonly string[]);
  const nextEnv: Record<string, string> = {};
  for (const [k, val] of Object.entries(env)) {
    if (ownedSet.has(k) && !keep.has(k)) continue; // drop owned keys no longer set
    nextEnv[k] = val;
  }
  for (const v of vars) nextEnv[v.key] = v.value;
  settings.env = nextEnv;
  writeJson(settingsPath, settings);
  return {
    dryRun: false,
    settingsPath,
    backedUp,
    writtenKeys: vars.map((v) => v.key),
    preservedKeys,
    rollbackHint: rollbackHint(agentLensHome),
  };
}

export interface RemoveSettingsResult {
  dryRun: boolean;
  settingsPath: string;
  backedUp: string | null;
  removedKeys: string[];
  preservedKeys: string[];
  rollbackHint: string;
}

/** Remove only AgentLens-owned env keys from the Claude settings `env` block. */
export function removeEnvFromClaudeSettings(
  claudeHome: string,
  agentLensHome: string,
  dryRun: boolean,
  nowIso = new Date().toISOString(),
): RemoveSettingsResult {
  const settingsPath = claudeSettingsPath(claudeHome);
  const settings = readJson<ClaudeSettings>(settingsPath);
  const env = settings?.env ?? {};
  const removedKeys: string[] = [];
  const preservedKeys: string[] = [];
  for (const k of Object.keys(env)) {
    if (AGENTLENS_OWNED_ENV_KEYS.includes(k as (typeof AGENTLENS_OWNED_ENV_KEYS)[number]))
      removedKeys.push(k);
    else preservedKeys.push(k);
  }
  if (dryRun || !settings) {
    return {
      dryRun,
      settingsPath,
      backedUp: null,
      removedKeys,
      preservedKeys,
      rollbackHint: rollbackHint(agentLensHome),
    };
  }
  const backedUp = backupFile(settingsPath, agentLensHome, nowIso);
  // Strip every AgentLens-owned key, preserving all other env entries
  // (reconstructed to avoid computed `delete`).
  const ownedSet = new Set(AGENTLENS_OWNED_ENV_KEYS as readonly string[]);
  const nextEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !ownedSet.has(k)));
  if (Object.keys(nextEnv).length === 0) delete settings.env;
  else settings.env = nextEnv;
  writeJson(settingsPath, settings);
  return {
    dryRun: false,
    settingsPath,
    backedUp,
    removedKeys,
    preservedKeys,
    rollbackHint: rollbackHint(agentLensHome),
  };
}

/** Read-only: which AgentLens-owned env keys are currently in Claude settings. */
export function claudeSettingsEnvState(claudeHome: string): { present: string[]; other: string[] } {
  const settings = readJson<ClaudeSettings>(claudeSettingsPath(claudeHome));
  const env = settings?.env ?? {};
  const present: string[] = [];
  const other: string[] = [];
  for (const k of Object.keys(env)) {
    if (AGENTLENS_OWNED_ENV_KEYS.includes(k as (typeof AGENTLENS_OWNED_ENV_KEYS)[number]))
      present.push(k);
    else other.push(k);
  }
  return { present, other };
}

function rollbackHint(agentLensHome: string): string {
  return `Restore from ${join(agentLensHome, "backups")} (settings.json.*.bak), or run \`agentlens telemetry remove --write-claude-settings\`.`;
}
