import type { ScanStateRow } from "@agentlens/database";

/**
 * Incremental-import decision logic (spec §13.3).
 *
 * Given the current file stats and the last recorded scan state, decide
 * whether to skip, re-import (delete + reinsert), or append. Deduplication is
 * handled by deterministic event IDs + `onConflictDoNothing`, so "append" is
 * simply re-reading the file with idempotent inserts — the new tail is added and
 * already-imported lines are no-ops. This keeps interrupted scans resumable
 * without the orphan-result problem that true byte-offset skipping would cause.
 */
export interface IncrementalDecision {
  /** File unchanged since last import — do nothing. */
  skip: boolean;
  /** Existing session + events must be deleted before re-importing. */
  delete: boolean;
  reason: string;
}

export interface DecideInput {
  state?: ScanStateRow | undefined;
  size: number;
  /** mtime in epoch ms. */
  mtime: number;
  /** sha256 of the file head (first 64 KiB), for replacement detection. */
  headHash: string;
  parserVersion: number;
}

export function decideImport(input: DecideInput): IncrementalDecision {
  const { state } = input;
  if (!state) {
    return { skip: false, delete: false, reason: "no prior state — first import" };
  }

  if (state.importVersion !== input.parserVersion) {
    return {
      skip: false,
      delete: true,
      reason: `parser version changed (${state.importVersion} → ${input.parserVersion})`,
    };
  }

  const sameSize = (state.size ?? null) === input.size;
  const sameMtime = (state.mtime ?? null) === input.mtime;

  if (sameSize && sameMtime) {
    return { skip: true, delete: false, reason: "unchanged (size + mtime)" };
  }

  // Truncation: file shrank below the last processed offset.
  if (input.size < (state.size ?? 0)) {
    return { skip: false, delete: true, reason: "truncated (file shrank)" };
  }

  // Replacement: head changed even though size may be equal/greater.
  if (state.rollingHash && input.headHash !== state.rollingHash) {
    return { skip: false, delete: true, reason: "replaced (head hash differs)" };
  }

  // Append: head unchanged, file grew (or mtime touched without head change).
  return { skip: false, delete: false, reason: "appended (head unchanged)" };
}
