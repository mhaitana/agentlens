/**
 * Hook-event spool (spec §14.3).
 *
 * When the loopback collector is unavailable, the hook script writes a single
 * JSON file per event into `<home>/event-spool/`. The observe command drains the
 * spool later: each file is one redacted event envelope (already
 * secret-redacted by the hook script; the collector re-redacts before persist).
 *
 * Files are written atomically (write to `.<name>.tmp` then rename) so a crash
 * mid-write never leaves a partial event the drainer could pick up. Each file
 * name embeds a monotonic-ish timestamp + random suffix so ordering is stable
 * and concurrent hook processes never collide.
 */
import { readdir, readFile, writeFile, rename, mkdir, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** The spool directory under the AgentLens data home (§7). */
export function spoolDir(home: string): string {
  return join(home, "event-spool");
}

/** A spooled event envelope (what the hook script writes). */
export interface SpooledEvent {
  /** Schema marker so future readers can evolve the format. */
  v: 1;
  /** "claude-code-hook". */
  provenance: string;
  /** When the hook fired / was received by the hook script. */
  receivedAt: string;
  /** The redacted payload object the hook script produced. */
  payload: Record<string, unknown>;
}

/** Count spool files pending (backlog metric for the live dashboard, §14.10). */
export async function spoolBacklog(home: string): Promise<number> {
  const dir = spoolDir(home);
  if (!existsSync(dir)) return 0;
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith(".json") && !e.startsWith(".")).length;
  } catch {
    return 0;
  }
}

/**
 * Write one event to the spool atomically. The payload MUST already be
 * secret-redacted by the caller (the hook script) — the spool is local-only but
 * still on-disk persistence (§8.4 redact before persistence).
 */
export async function writeSpool(home: string, event: SpooledEvent): Promise<string> {
  const dir = spoolDir(home);
  await mkdir(dir, { recursive: true });
  const name = `${event.receivedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  const finalPath = join(dir, name);
  const tmpPath = join(dir, `.${name}.tmp`);
  await writeFile(tmpPath, JSON.stringify(event), { mode: 0o600 });
  await rename(tmpPath, finalPath);
  return finalPath;
}

/** Read every spooled event in received-at order. Skips malformed files. */
export async function readSpool(
  home: string,
): Promise<Array<{ file: string; event: SpooledEvent }>> {
  const dir = spoolDir(home);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: Array<{ file: string; event: SpooledEvent }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.startsWith(".")) continue;
    const file = join(dir, entry);
    try {
      const raw = await readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as SpooledEvent;
      if (parsed && parsed.v === 1 && parsed.payload) {
        out.push({ file, event: parsed });
      }
    } catch {
      // Malformed spool file: leave it; the drainer can quarantine it.
    }
  }
  out.sort((a, b) => a.event.receivedAt.localeCompare(b.event.receivedAt));
  return out;
}

/**
 * Drain the spool: pass each event to `handler`; on success the file is removed,
 * on failure it is left for the next drain pass. Returns counts. A handler
 * that throws does NOT abort the whole drain — the file stays for retry.
 */
export async function drainSpool(
  home: string,
  handler: (event: SpooledEvent, file: string) => Promise<void>,
): Promise<{ processed: number; removed: number; failed: number }> {
  const items = await readSpool(home);
  let processed = 0;
  let removed = 0;
  let failed = 0;
  for (const { file, event } of items) {
    try {
      await handler(event, file);
      await safeUnlink(file);
      processed++;
      removed++;
    } catch {
      failed++;
    }
  }
  return { processed, removed, failed };
}

/** Watch the spool for new files (used by `agentlens observe`, §14.9). */
export async function* watchSpool(
  home: string,
  signal: AbortSignal,
  pollMs = 1000,
): AsyncGenerator<SpooledEvent> {
  const dir = spoolDir(home);
  await mkdir(dir, { recursive: true });
  const seen = new Set<string>();
  // Seed `seen` with existing files so a restart doesn't re-emit the backlog
  // (the initial drain pass handles those).
  for (const entry of await readdir(dir).catch(() => [])) {
    seen.add(entry);
  }
  while (!signal.aborted) {
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry.startsWith(".") || seen.has(entry)) continue;
      seen.add(entry);
      try {
        const file = join(dir, entry);
        const st = await stat(file);
        if (!st.isFile()) continue;
        const raw = await readFile(file, "utf-8");
        const parsed = JSON.parse(raw) as SpooledEvent;
        if (parsed && parsed.v === 1 && parsed.payload) yield parsed;
      } catch {
        // best-effort; will be retried by the next drain pass
      }
    }
    await sleep(pollMs, signal);
  }
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

async function safeUnlink(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch {
    // already gone
  }
}
