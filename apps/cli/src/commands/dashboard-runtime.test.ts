/**
 * Tests for the `agentlens dashboard` runtime record + reuse logic (§13.8
 * "Reuse a healthy existing local instance", "Handle occupied ports safely").
 *
 * These exercise the pure launcher helpers against a temp AGENTLENS_HOME and a
 * real (port-bound) local-api instance for the health probe. No test depends
 * on the developer's real ~/.claude (§21).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Database } from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import { buildServer, generateRuntimeToken } from "@agentlens/local-api";
import {
  readRuntimeRecord,
  writeRuntimeRecord,
  removeRuntimeRecord,
  probeHealthy,
  runtimeRecordPath,
} from "./dashboard-runtime.js";

/** Built Fastify instance — typed without a direct fastify import (pnpm). */
type Server = Awaited<ReturnType<typeof buildServer>>;

function mkHome(): string {
  return mkdtempSync(join(tmpdir(), "agentlens-dash-"));
}

describe("dashboard runtime record", () => {
  let home: string;
  beforeEach(() => {
    home = mkHome();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("readRuntimeRecord returns null when absent", async () => {
    expect(await readRuntimeRecord(home)).toBeNull();
  });

  it("writeRuntimeRecord round-trips and reads back", async () => {
    const record = { port: 7531, token: "abc123", pid: 4242, startedAt: "2026-07-10T00:00:00Z" };
    await writeRuntimeRecord(home, record);
    expect(existsSync(runtimeRecordPath(home))).toBe(true);
    expect(await readRuntimeRecord(home)).toEqual(record);
  });

  it("writeRuntimeRecord creates the runtime dir and restrictive file mode", async () => {
    await writeRuntimeRecord(home, {
      port: 1,
      token: "t",
      pid: 1,
      startedAt: "2026-07-10T00:00:00Z",
    });
    expect(existsSync(join(home, "runtime"))).toBe(true);
  });

  it("readRuntimeRecord returns null for unparseable / partial files", async () => {
    await writeRuntimeRecord(home, {
      port: 1,
      token: "t",
      pid: 1,
      startedAt: "2026-07-10T00:00:00Z",
    });
    // Corrupt the file.
    const path = runtimeRecordPath(home);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{not json", "utf-8");
    expect(await readRuntimeRecord(home)).toBeNull();
  });

  it("removeRuntimeRecord deletes the file (idempotent)", async () => {
    await writeRuntimeRecord(home, {
      port: 1,
      token: "t",
      pid: 1,
      startedAt: "2026-07-10T00:00:00Z",
    });
    await removeRuntimeRecord(home);
    expect(existsSync(runtimeRecordPath(home))).toBe(false);
    // Idempotent: no throw on second call.
    await expect(removeRuntimeRecord(home)).resolves.toBeUndefined();
  });

  it("writeRuntimeRecord overwrites a stale record (reuse after stale)", async () => {
    await writeRuntimeRecord(home, {
      port: 9999,
      token: "old",
      pid: 1,
      startedAt: "2026-07-09T00:00:00Z",
    });
    await writeRuntimeRecord(home, {
      port: 7531,
      token: "new",
      pid: 2,
      startedAt: "2026-07-10T00:00:00Z",
    });
    const read = await readRuntimeRecord(home);
    expect(read?.port).toBe(7531);
    expect(read?.token).toBe("new");
  });
});

describe("dashboard health probe", () => {
  let home: string;
  let dbObj: Database;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    home = mkHome();
    dbObj = await openDatabase({
      home,
      nowIso: new Date().toISOString(),
      inMemory: false,
    });
    const config = defaultConfig();
    server = await buildServer({
      db: dbObj.db,
      config,
      home,
      runtimeToken: generateRuntimeToken(),
      port: 0,
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await server.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("probeHealthy returns true for a running instance", async () => {
    expect(await probeHealthy(port)).toBe(true);
  });

  it("probeHealthy returns false for a dead port", async () => {
    // Pick an almost-certainly-dead high port.
    expect(await probeHealthy(1, 500)).toBe(false);
  });

  it("a stale record pointing at a dead port is not reusable", async () => {
    await writeRuntimeRecord(home, {
      port: 1, // dead
      token: "stale",
      pid: 99999,
      startedAt: "2026-07-09T00:00:00Z",
    });
    const record = await readRuntimeRecord(home);
    expect(record).not.toBeNull();
    if (record) expect(await probeHealthy(record.port, 500)).toBe(false);
  });

  it("a live record pointing at the running port is reusable", async () => {
    await writeRuntimeRecord(home, {
      port,
      token: "live",
      pid: process.pid,
      startedAt: "2026-07-10T00:00:00Z",
    });
    const record = await readRuntimeRecord(home);
    if (record) expect(await probeHealthy(record.port)).toBe(true);
  });
});
