import { readdir, stat, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveredSource } from "@agentlens/domain";
import { ADAPTER_ID, ADAPTER_VERSION } from "./version.js";
import { claudeHome, projectsDir, decodeProjectFolder } from "./paths.js";

/** Options for transcript discovery. */
export interface DiscoverOptions {
  /** Override the `~/.claude` root (tests / non-standard installs). */
  claudeHomeOverride?: string;
  /** Extra directories to scan beyond the standard Claude projects dir. */
  additionalDirectories: string[];
  /** Projects to exclude, by path prefix (spec §13.1). */
  excludedProjects: string[];
  /** Follow symlinks. Default false (spec §19.2). */
  followSymlinks: boolean;
}

/** A discovered transcript file with its decoded project hint. */
export interface DiscoveredTranscript extends DiscoveredSource {
  /** Decoded project path hint (display only — separators are lossy). */
  projectHint: string;
  /** Project folder name as found on disk. */
  projectFolder: string;
}

/**
 * Discover Claude Code transcript files (spec §13.1).
 *
 * Walks `~/.claude/projects/<project-folder>/<session>.jsonl` plus any
 * configured extra directories, never mutating anything. Symlinks are not
 * followed unless requested. Returns one entry per `.jsonl` file.
 */
export async function discoverTranscripts(opts: DiscoverOptions): Promise<DiscoveredTranscript[]> {
  const roots = [projectsDir(claudeHome(opts.claudeHomeOverride)), ...opts.additionalDirectories];
  const results: DiscoveredTranscript[] = [];

  for (const root of roots) {
    const found = await discoverInRoot(root, opts).catch(() => []);
    results.push(...found);
  }

  // Stable order for deterministic scans.
  results.sort((a, b) => a.uri.localeCompare(b.uri));
  return results;
}

async function discoverInRoot(
  root: string,
  opts: DiscoverOptions,
): Promise<DiscoveredTranscript[]> {
  const projectFolders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out: DiscoveredTranscript[] = [];

  for (const entry of projectFolders) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const projectDir = join(root, entry.name);

    if (!opts.followSymlinks) {
      const lf = await lstat(projectDir).catch(() => null);
      if (lf?.isSymbolicLink()) continue;
    }

    const projectHint = decodeProjectFolder(entry.name);
    if (isExcluded(projectHint, opts.excludedProjects)) continue;

    const files = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.name.endsWith(".jsonl")) continue;
      const filePath = join(projectDir, file.name);

      if (!opts.followSymlinks) {
        const lf = await lstat(filePath).catch(() => null);
        if (lf?.isSymbolicLink()) continue;
      }

      const st = await stat(filePath).catch(() => null);
      if (!st || !st.isFile()) continue;

      out.push({
        adapter: ADAPTER_ID,
        displayName: `${entry.name}/${file.name}`,
        uri: filePath,
        version: ADAPTER_VERSION,
        projectHint,
        projectFolder: entry.name,
      });
    }
  }

  return out;
}

function isExcluded(projectHint: string, excluded: string[]): boolean {
  return excluded.some((p) => p.length > 0 && projectHint.startsWith(p));
}

export { claudeHome, projectsDir };
