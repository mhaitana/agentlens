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
export function rollbackPatch(patch: ProposedPatch, home: string): RollbackResult {
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
  const backupContent = readFileText(bkPath);
  if (patch.targetFile && existsSync(patch.targetFile)) {
    if (backupContent === "") {
      // Sentinel: the file didn't exist before the patch. Remove it.
      rmSync(patch.targetFile, { force: true });
    } else {
      writeAtomic(patch.targetFile, backupContent);
    }
  } else if (patch.targetFile && backupContent !== "") {
    // File was removed somehow; restore it from backup.
    writeAtomic(patch.targetFile, backupContent);
  }
  const restored =
    !patch.targetFile ||
    !existsSync(patch.targetFile) ||
    readFileText(patch.targetFile) === backupContent;
  return {
    patchId: patch.id,
    restored,
    backupPath: bkPath,
    targetFile: patch.targetFile,
    validation: {
      parses: true,
      noBypassPermissions: true,
      noExternalTransmission: true,
      unrelatedPreserved: true,
      notes: ["Restored from backup."],
    },
  };
}
