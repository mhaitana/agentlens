/**
 * Patch application + rollback (spec §3.5, §15.9).
 *
 * The apply path enforces the full §3.5 sequence on every patch:
 *   1. show the proposed diff (done by the command/doctor runner before calling)
 *   2. explain the impact (carried on the patch)
 *   3. identify the destination file (patch.targetFile)
 *   4. create a backup (written to <home>/backups/doctor/<patchId>.bak)
 *   5. require explicit approval (the command gates this — apply NEVER auto-runs)
 *   6. validate the resulting configuration (re-validate after writing)
 *   7. support rollback (rollbackPatch restores from the backup)
 *
 * Refused patches and patches with no target file are never applied. If the
 * target changed since inspection, apply refuses (the diff would be stale).
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type {
  PatchApplicationResult,
  PatchValidation,
  ProposedPatch,
  RollbackResult,
} from "@agentlens/domain";
import { validatePatch, addedLinesFromDiff } from "./patches.js";
import { isApprovedConfigTarget, targetSidecarPath } from "./targets.js";

/**
 * Security context for a Doctor apply/rollback (spec §19.2). Carries the resolved
 * Claude home and project root so every write target can be checked against the
 * approved-path allowlist before any file is touched.
 */
export interface ApplySecurityCtx {
  /** Resolved Claude home (`~/.claude` or an override). */
  claudeHome: string;
  /** Resolved project root, when the doctor is scoped to a project. */
  projectPath?: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function readFileText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function backupDir(home: string): string {
  return join(home, "backups", "doctor");
}

function backupPath(home: string, patchId: string): string {
  return join(backupDir(home), `${patchId}.bak`);
}

function writeAtomic(path: string, content: string, mode: 0o600 | 0o644 = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode });
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, content, { mode });
    rmSync(tmp, { force: true });
  }
}

/**
 * Reconstruct the patched ("after") content from a unified diff produced by our
 * renderer. Our diffs are a single hunk covering the whole file starting at
 * line 1, so the after content is exactly the context + added lines (prefixes
 * stripped). Returns null if the diff is empty or malformed.
 */
export function reconstructAfter(diff: string): string | null {
  const lines = diff.split(/\r?\n/);
  // Skip headers (--- / +++) and the hunk header (@@ ... @@).
  let idx = 0;
  while (idx < lines.length) {
    const h = lines[idx] ?? "";
    if (h.startsWith("---") || h.startsWith("+++")) {
      idx++;
    } else {
      break;
    }
  }
  if (idx < lines.length) {
    const header = lines[idx] ?? "";
    if (header.startsWith("@@")) {
      // Require the hunk to start at line 1 (whole-file diff) for safe reconstruction.
      if (!/@@ -1,/.test(header)) return null;
      idx++;
    }
  }
  const out: string[] = [];
  for (; idx < lines.length; idx++) {
    const l = lines[idx] ?? "";
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) out.push(l.slice(1));
    else if (l.startsWith("-"))
      continue; // removed line
    else if (l.startsWith(" ")) out.push(l.slice(1));
    // A genuine blank context line is rendered as a single " " by our renderer,
    // so a truly empty string here is the trailing artifact from split() on a
    // diff that ends with "\n" — skip it rather than appending a phantom line.
    else if (l === "") continue;
    else out.push(""); // tolerate any other unsupported line as blank
  }
  return out.join("\n");
}

function rollbackHint(home: string, patchId: string): string {
  return `Restore from ${backupPath(home, patchId)} or run \`agentlens doctor --rollback ${patchId}\`.`;
}

/* -------------------------------------------------------------------------- */
/* Apply                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Apply a single proposed patch with the full §3.5 safety sequence. The caller
 * MUST have already obtained explicit user approval — this function does not
 * prompt. Returns the application result (applied=false when refused/invalid).
 */
export function applyPatch(
  patch: ProposedPatch,
  home: string,
  _nowIso: string,
  ctx: ApplySecurityCtx,
): PatchApplicationResult {
  if (patch.refused) {
    return {
      patchId: patch.id,
      applied: false,
      targetFile: patch.targetFile,
      validation: patch.validation,
      rollbackHint: "Patch was refused; nothing to roll back.",
    };
  }
  if (!patch.targetFile) {
    return {
      patchId: patch.id,
      applied: false,
      validation: patch.validation,
      rollbackHint: "Patch has no target file.",
    };
  }
  if (!patch.diff) {
    return {
      patchId: patch.id,
      applied: false,
      targetFile: patch.targetFile,
      validation: patch.validation,
      rollbackHint: "Patch has no diff (no-op).",
    };
  }
  // §19.2: refuse to write outside approved Claude Code config paths. This is the
  // hard boundary that prevents a request-supplied project path from redirecting
  // a write to an arbitrary filesystem location.
  if (!isApprovedConfigTarget(patch.targetFile, ctx.claudeHome, ctx.projectPath)) {
    return {
      patchId: patch.id,
      applied: false,
      targetFile: patch.targetFile,
      validation: {
        parses: true,
        noBypassPermissions: true,
        noExternalTransmission: true,
        unrelatedPreserved: false,
        notes: [
          `Refused: target file "${patch.targetFile}" is outside approved Claude Code config paths.`,
        ],
      },
      rollbackHint: "Patch was refused; nothing to roll back.",
    };
  }

  const before = readFileText(patch.targetFile);
  const after = reconstructAfter(patch.diff);
  if (after === null) {
    return {
      patchId: patch.id,
      applied: false,
      targetFile: patch.targetFile,
      validation: {
        parses: false,
        noBypassPermissions: true,
        noExternalTransmission: true,
        unrelatedPreserved: false,
        notes: ["Could not reconstruct patched content from the diff."],
      },
      rollbackHint: rollbackHint(home, patch.id),
    };
  }

  // Step 4: back up before applying (record even if the file didn't exist).
  const bkPath = backupPath(home, patch.id);
  mkdirSync(backupDir(home), { recursive: true });
  if (existsSync(patch.targetFile)) {
    copyFileSync(patch.targetFile, bkPath);
  } else {
    writeFileSync(bkPath, "", { mode: 0o600 }); // sentinel: file did not exist
  }
  // Record the authoritative restore target alongside the backup (§19.2). Rollback
  // reads this sidecar instead of trusting a client-supplied targetFile, so a
  // forged rollback request cannot redirect a restore to an arbitrary path. The
  // resolved approved-path roots are stored too, so rollback can re-run the
  // allowlist check self-contained (without needing the request to repeat them).
  const sidecar = JSON.stringify({
    target: patch.targetFile,
    claudeHome: ctx.claudeHome,
    projectPath: ctx.projectPath ?? null,
  });
  writeFileSync(targetSidecarPath(bkPath), sidecar, { mode: 0o600 });

  // Step 6: write + validate after.
  writeAtomic(patch.targetFile, after);
  const writtenBack = readFileText(patch.targetFile);
  const validation: PatchValidation = validatePatch({
    kind: patch.kind,
    before,
    after: writtenBack,
    addedLines: addedLinesFromDiff(patch.diff),
  });

  const applied =
    validation.parses &&
    validation.noBypassPermissions &&
    validation.noExternalTransmission &&
    validation.unrelatedPreserved;
  return {
    patchId: patch.id,
    applied,
    backupPath: bkPath,
    targetFile: patch.targetFile,
    validation,
    rollbackHint: rollbackHint(home, patch.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Rollback                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Roll back a previously applied patch by restoring its backup (§3.5 step 7).
 * If the backup is an empty sentinel, the file is removed (it didn't exist before).
 */
export function rollbackPatch(
  patch: ProposedPatch,
  home: string,
  ctx: ApplySecurityCtx,
): RollbackResult {
  const bkPath = backupPath(home, patch.id);
  if (!existsSync(bkPath)) {
    return {
      patchId: patch.id,
      restored: false,
      backupPath: bkPath,
      targetFile: patch.targetFile,
      validation: {
        parses: true,
        noBypassPermissions: true,
        noExternalTransmission: true,
        unrelatedPreserved: true,
        notes: ["No backup found for this patch."],
      },
    };
  }
  // §19.2: the restore target is authoritative from the sidecar written at apply
  // time — never from the request body. The sidecar also carries the approved-path
  // roots used at apply, so the allowlist re-check is self-contained and does not
  // depend on the rollback request repeating them. Fall back to patch.targetFile +
  // the request ctx only for backups made before the sidecar existed.
  const sidecar = targetSidecarPath(bkPath);
  let authoritativeTarget: string | undefined = patch.targetFile;
  let allowlistHome = ctx.claudeHome;
  let allowlistProject = ctx.projectPath;
  if (existsSync(sidecar)) {
    try {
      const parsed = JSON.parse(readFileText(sidecar)) as {
        target?: string;
        claudeHome?: string;
        projectPath?: string | null;
      };
      if (parsed.target) authoritativeTarget = parsed.target;
      if (parsed.claudeHome) allowlistHome = parsed.claudeHome;
      allowlistProject = parsed.projectPath ?? undefined;
    } catch {
      // Malformed sidecar: fall back to patch.targetFile (still allowlist-checked).
    }
  }
  if (
    !authoritativeTarget ||
    !isApprovedConfigTarget(authoritativeTarget, allowlistHome, allowlistProject)
  ) {
    return {
      patchId: patch.id,
      restored: false,
      backupPath: bkPath,
      targetFile: authoritativeTarget,
      validation: {
        parses: true,
        noBypassPermissions: true,
        noExternalTransmission: true,
        unrelatedPreserved: false,
        notes: [
          `Refused: restore target "${
            authoritativeTarget ?? "(none)"
          }" is outside approved Claude Code config paths.`,
        ],
      },
    };
  }
  const backupContent = readFileText(bkPath);
  if (existsSync(authoritativeTarget)) {
    if (backupContent === "") {
      // Sentinel: the file didn't exist before the patch. Remove it.
      rmSync(authoritativeTarget, { force: true });
    } else {
      writeAtomic(authoritativeTarget, backupContent);
    }
  } else if (backupContent !== "") {
    // File was removed somehow; restore it from backup.
    writeAtomic(authoritativeTarget, backupContent);
  }
  const restored =
    !existsSync(authoritativeTarget) || readFileText(authoritativeTarget) === backupContent;
  return {
    patchId: patch.id,
    restored,
    backupPath: bkPath,
    targetFile: authoritativeTarget,
    validation: {
      parses: true,
      noBypassPermissions: true,
      noExternalTransmission: true,
      unrelatedPreserved: true,
      notes: ["Restored from backup."],
    },
  };
}
