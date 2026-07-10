/**
 * Shared CLI context helpers (spec §16): resolve the data home, open the
 * database, and build the Claude Code source adapter. All commands use these
 * so AGENTLENS_HOME resolution + DB lifecycle stay consistent.
 */

import { join } from "node:path";
import { resolveAgentLensHome, databasePath, configPath, loadConfig } from "@agentlens/config";
import { openDatabase, closeDatabase, type Database } from "@agentlens/database";
import { ClaudeCodeAdapter } from "@agentlens/claude-adapter";

/** Resolve the AgentLens data home (honours AGENTLENS_HOME, spec §7). */
export function resolveHome(): string {
  return resolveAgentLensHome(process.env.AGENTLENS_HOME);
}

/** Open the local SQLite database + run pending migrations. */
export async function openAgentLensDb(home: string): Promise<Database> {
  return openDatabase({ home, nowIso: new Date().toISOString(), inMemory: false });
}

/**
 * Build the Claude Code adapter. When `onlyPath` is set (scan --path), point
 * the adapter's claude home at a guaranteed-empty dir under the data home so
 * the real `~/.claude` is never scanned (§21) — only `--path` is read.
 */
export function buildAdapter(home: string, onlyPath: boolean): ClaudeCodeAdapter {
  const override = onlyPath ? join(home, "claude-empty") : undefined;
  return new ClaudeCodeAdapter(override);
}

export { databasePath, configPath, loadConfig, closeDatabase };
