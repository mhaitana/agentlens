/**
 * Runtime-file + health-probe helpers for the `agentlens dashboard` command
 * (spec §13.8 "Reuse a healthy existing local instance").
 *
 * The launcher writes a small JSON file under `<home>/runtime/server.json`
 * recording the bound port, the runtime token, the PID, and the start time.
 * On a subsequent launch the command reads that file and probes the recorded
 * port's `/api/v1/health` endpoint on loopback; if it is healthy, the existing
 * instance is reused (URL printed, no new server started). If the file is
 * absent or the probe fails, a new server is started and the file is
 * overwritten.
 *
 * The runtime token is written to the file so a reused launch can surface it
 * for debugging, but it is never logged and the file is created with
 * restrictive permissions (0o600) where supported (§19.1).
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface RuntimeRecord {
  /** Bound loopback port. */
  port: number;
  /** Runtime token guarding mutations (§17, §19.1). */
  token: string;
  /** OS PID of the serving process. */
  pid: number;
  /** ISO timestamp the server was started. */
  startedAt: string;
  /** Loopback port the OTLP receiver bound (Phase 2; absent when not running). */
  otelPort?: number;
}

/** Path of the runtime record file under the AgentLens data home. */
export function runtimeRecordPath(home: string): string {
  return join(home, "runtime", "server.json");
}

/** Read the runtime record, or null if absent / unparseable. */
export async function readRuntimeRecord(home: string): Promise<RuntimeRecord | null> {
  const path = runtimeRecordPath(home);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RuntimeRecord>;
    if (
      typeof parsed.port === "number" &&
      typeof parsed.token === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "string"
    ) {
      return {
        port: parsed.port,
        token: parsed.token,
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        otelPort: typeof parsed.otelPort === "number" ? parsed.otelPort : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the runtime record (creating the runtime dir), restrictive perms. */
export async function writeRuntimeRecord(home: string, record: RuntimeRecord): Promise<void> {
  const dir = join(home, "runtime");
  await mkdir(dir, { recursive: true });
  const path = runtimeRecordPath(home);
  await writeFile(path, JSON.stringify(record, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Permissions best-effort (filesystem may not support chmod, e.g. Windows).
  }
}

/** Remove the runtime record (best-effort, on shutdown). */
export async function removeRuntimeRecord(home: string): Promise<void> {
  try {
    await rm(runtimeRecordPath(home), { force: true });
  } catch {
    // best-effort
  }
}

/**
 * Probe `GET /api/v1/health` on the recorded loopback port. Resolves true iff
 * the endpoint returns the expected healthy shape (§13.8 "healthy"). A short
 * timeout ensures a dead/stale record does not block the launch.
 */
export async function probeHealthy(port: number, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string; version?: string };
    return body.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
