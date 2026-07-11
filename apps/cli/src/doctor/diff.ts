/**
 * Minimal unified-diff renderer for the Configuration Doctor (spec §15.9, §3.5).
 *
 * Produces a standard unified-diff string from two text buffers using a simple
 * LCS line comparison. Deliberately dependency-free and good enough for showing
 * proposed patches to the user — it is a *preview*, never applied via `patch`.
 * The apply path reconstructs the "after" buffer from this diff (see apply.ts).
 */

/** Safe 2D lookup with a default (avoids noUncheckedIndexedAccess pitfalls). */
function at(grid: number[][], i: number, j: number): number {
  const row = grid[i];
  return row ? (row[j] ?? 0) : 0;
}

/** Compute the LCS of two line arrays and return a unified diff string. */
export function unifiedDiff(before: string, after: string, path = "file"): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const m = a.length;
  const n = b.length;
  // LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    const ai = a[i] ?? "";
    const row = dp[i];
    if (!row) continue;
    for (let j = n - 1; j >= 0; j--) {
      const bj = b[j] ?? "";
      row[j] = ai === bj ? at(dp, i + 1, j + 1) + 1 : Math.max(at(dp, i + 1, j), at(dp, i, j + 1));
    }
  }
  const hunks: Array<{ type: "ctx" | "add" | "del"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const ai = a[i] ?? "";
    const bj = b[j] ?? "";
    if (ai === bj) {
      hunks.push({ type: "ctx", text: ai });
      i++;
      j++;
    } else if (at(dp, i + 1, j) >= at(dp, i, j + 1)) {
      hunks.push({ type: "del", text: ai });
      i++;
    } else {
      hunks.push({ type: "add", text: bj });
      j++;
    }
  }
  while (i < m) {
    hunks.push({ type: "del", text: a[i] ?? "" });
    i++;
  }
  while (j < n) {
    hunks.push({ type: "add", text: b[j] ?? "" });
    j++;
  }

  if (hunks.length === 0) return "";
  const lines: string[] = [];
  lines.push(`--- a/${path}`);
  lines.push(`+++ b/${path}`);
  // Compute the first changed line for the hunk header.
  let firstChange = 0;
  for (let k = 0; k < hunks.length; k++) {
    const hk = hunks[k];
    if (!hk || hk.type !== "ctx") {
      let ctxBefore = 0;
      for (let p = k - 1; p >= 0; p--) {
        const hp = hunks[p];
        if (!hp || hp.type !== "ctx") break;
        ctxBefore++;
      }
      firstChange = k - ctxBefore;
      break;
    }
  }
  const aStart = firstChange + 1;
  const aLen = hunks.filter((h) => h.type === "del" || h.type === "ctx").length;
  const bLen = hunks.filter((h) => h.type === "add" || h.type === "ctx").length;
  lines.push(`@@ -${aStart},${aLen} +${aStart},${bLen} @@`);
  for (const h of hunks) {
    const prefix = h.type === "add" ? "+" : h.type === "del" ? "-" : " ";
    lines.push(`${prefix}${h.text}`);
  }
  return lines.join("\n") + "\n";
}
