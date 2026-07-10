import { homedir, platform } from "node:os";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stat } from "node:fs/promises";

/** Subdirectories created inside the AgentLens data home (spec §7). */
export const DATA_SUBDIRS = ["backups", "event-spool", "exports", "logs", "runtime"] as const;

export type DataSubdir = (typeof DATA_SUBDIRS)[number];

/** Resolve the AgentLens data home, honouring AGENTLENS_HOME (spec §7). */
export function resolveAgentLensHome(override?: string): string {
  const raw =
    (override && override.trim()) ||
    (process.env.AGENTLENS_HOME && process.env.AGENTLENS_HOME.trim());

  if (raw) return resolvePath(raw);

  const p = platform();
  if (p === "darwin") {
    return join(homedir(), "Library", "Application Support", "AgentLens");
  }
  if (p === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, "AgentLens");
  }
  // Linux / other Unix: XDG_DATA_HOME or ~/.local/share/agentlens
  const xdg = process.env.XDG_DATA_HOME;
  return resolvePath(xdg && xdg.trim() ? xdg : join(homedir(), ".local", "share"), "agentlens");
}

function resolvePath(...segments: string[]): string {
  // Absolute-ise relative overrides against cwd.
  const first = segments[0] ?? "";
  const joined = segments.length === 1 ? first : join(...segments);
  return joined;
}

/** Path to config.json inside the data home. */
export function configPath(home: string): string {
  return join(home, "config.json");
}

/** Path to the SQLite database inside the data home. */
export function databasePath(home: string): string {
  return join(home, "agentlens.sqlite");
}

/**
 * Create the data home and its subdirectories with restrictive permissions
 * where supported (§7: "Create directories with restrictive permissions").
 * Best-effort on platforms that ignore POSIX modes.
 */
export async function ensureDataDirs(home: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await tryChmod(home, 0o700);
  for (const sub of DATA_SUBDIRS) {
    const dir = join(home, sub);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await tryChmod(dir, 0o700);
  }
}

/** Restrict a file's permissions where supported (used for the SQLite DB). */
export async function restrictFile(path: string, mode = 0o600): Promise<void> {
  await tryChmod(path, mode);
}

async function tryChmod(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch {
    // Windows or unsupported: best-effort, ignore.
  }
}

/** Whether a path exists. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
