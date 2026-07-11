/**
 * Approved-path validation for the Configuration Doctor (spec §19.2).
 *
 * The Doctor must never write (or restore) outside approved Claude Code
 * configuration locations: the Claude home (`~/.claude`) and, for a given
 * project, that project's `CLAUDE.md`, `.mcp.json`, or `.claude/` directory.
 * Request-supplied paths are untrusted, so every write/restore target is
 * canonicalised (`resolve`) and checked against this allowlist before any file
 * is touched. Reads (`GET /doctor`) canonicalise inputs and reject traversal
 * that escapes an absolute root, but the operator may legitimately point at any
 * project root — the write-side allowlist is the hard boundary.
 */
import { resolve, sep, join, dirname, isAbsolute } from "node:path";

/**
 * True if `target` resolves to an approved Claude Code config write location
 * for the given Claude home and (optional) project root.
 */
export function isApprovedConfigTarget(
  target: string | undefined,
  claudeHome: string,
  projectPath?: string,
): boolean {
  if (!target) return false;
  const t = resolve(target);
  const home = resolve(claudeHome);
  // Anything under the Claude home (settings.json, settings.local.json, hooks,
  // skills, commands, instructions, …).
  if (t === home || t.startsWith(home + sep)) return true;
  if (!projectPath) return false;
  const p = resolve(projectPath);
  // A project's CLAUDE.md, .mcp.json, or its .claude/ directory.
  const allowedRoots = [join(p, "CLAUDE.md"), join(p, ".mcp.json"), join(p, ".claude")];
  return allowedRoots.some((a) => {
    const ar = resolve(a);
    return t === ar || t.startsWith(ar + sep);
  });
}

/**
 * Canonicalise a request-supplied path to an absolute, normalised form, or
 * `undefined` when absent. Rejects empty/whitespace-only values. `resolve()`
 * collapses `..` segments, so the result is always absolute and normalised; the
 * write-side allowlist (`isApprovedConfigTarget`) is the hard security boundary.
 */
export function canonicaliseInputPath(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return undefined;
  // resolve() against cwd would silently make a relative path absolute under the
  // server's cwd, masking intent. Require an absolute path for Doctor overrides.
  if (!isAbsolute(trimmed)) return undefined;
  return resolve(trimmed);
}

/** Reject a request-supplied path that escapes its expected root via `..`. */
export function isPathWithin(child: string, root: string): boolean {
  const c = resolve(child);
  const r = resolve(root);
  return c === r || c.startsWith(r + sep);
}

/** Sidecar filename recording the original target for a backed-up patch. */
export function targetSidecarPath(backupFile: string): string {
  // <patchId>.bak -> <patchId>.target
  return join(dirname(backupFile), `${basenameWithoutExt(backupFile)}.target`);
}

function basenameWithoutExt(p: string): string {
  const base = p.split(sep).pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
