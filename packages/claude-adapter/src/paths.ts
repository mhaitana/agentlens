import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Path helpers for Claude Code transcripts (spec §13.1).
 *
 * Claude Code encodes the project working directory into the projects folder
 * name by replacing path separators (and drive colons on Windows) with `-`.
 * We mirror that encoding so discovered folder names can be decoded back to a
 * best-effort project path, and we hash paths for stable correlation without
 * storing the raw absolute path.
 */

/** Claude Code's per-user root directory. Overridable for tests. */
export function claudeHome(override?: string): string {
  if (override) return override;
  return join(homedir(), ".claude");
}

/** Directory holding all Claude Code project transcript folders. */
export function projectsDir(claudeHomeDir: string): string {
  return join(claudeHomeDir, "projects");
}

/**
 * Encode a project path the way Claude Code names its transcript folders.
 * Leading separators become a leading `-` (e.g. `/Users/x/foo` →
 * `-Users-x-foo`). Backslashes (Windows) are treated the same way.
 */
export function encodeProjectPath(path: string): string {
  return path.replace(/[\\/]+/g, "-");
}

/**
 * Best-effort inverse of {@link encodeProjectPath}. The original separator
 * cannot be recovered, so we rejoin with `/`; callers treat the result as a
 * display hint, not ground truth.
 */
export function decodeProjectFolder(folder: string): string {
  return folder.replace(/-/g, "/");
}

/** A stable, one-way hash of a path — safe to persist (spec §8.4). */
export function hashPath(path: string): string {
  return sha256(`path:${path}`);
}

/** SHA-256 hex digest of a string. */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Normalise a transcript file uri to a forward-slash posix-style path. */
export function normaliseUri(uri: string): string {
  return uri.replace(/\\/g, "/");
}
