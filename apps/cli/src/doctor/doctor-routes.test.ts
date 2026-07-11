/**
 * Doctor API route tests (spec §15.7–15.11, §17, §3.5, §15.13).
 *
 * Exercises the `/api/v1/doctor*` routes registered by {@link registerDoctorRoutes}
 * against a temp AgentLens home (for backups) and a temp Claude home (the
 * inspected config), via Fastify `inject`. Verifies the §3.5 safety sequence:
 * read-only GET writes nothing; `apply` requires explicit `approved: true`;
 * `--dry-run`-equivalent (no approval) changes nothing; apply backs up + validates;
 * rollback restores. The developer's real `~/.claude` is never touched (§21).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import { buildServer, generateRuntimeToken } from "@agentlens/local-api";
import type { ServerDeps } from "@agentlens/local-api";
import { registerDoctorRoutes } from "./doctor-routes.js";

let alHome: string;
let claudeHome: string;

beforeEach(() => {
  alHome = mkdtempSync(join(tmpdir(), "al-docapi-home-"));
  claudeHome = mkdtempSync(join(tmpdir(), "al-docapi-claude-"));
});

afterEach(() => {
  for (const d of [alHome, claudeHome]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

async function makeDeps(): Promise<ServerDeps> {
  const dbObj = await openDatabase({
    home: alHome,
    nowIso: new Date().toISOString(),
    inMemory: false,
  });
  const config = defaultConfig();
  return {
    db: dbObj.db,
    config,
    home: alHome,
    runtimeToken: generateRuntimeToken(),
    port: 0,
    registerExtraRoutes: registerDoctorRoutes,
  };
}

function writeSettings(content: string): void {
  writeFileSync(join(claudeHome, "settings.json"), content, { mode: 0o644 });
}

/** A user settings.json with a no-timeout hook (produces a hooks:no-timeout finding
 *  + a json-settings patch). */
function noTimeoutSettings(): string {
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "echo agentlens-check" }],
          },
        ],
      },
    },
    null,
    2,
  );
}

describe("doctor API routes (§15.7–15.11, §3.5, §15.13)", () => {
  it("GET /doctor is read-only and reports findings + proposed patches with no backups", async () => {
    writeSettings(noTimeoutSettings());
    const deps = await makeDeps();
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "GET",
      url: `/api/v1/doctor?claudeHome=${encodeURIComponent(claudeHome)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report.summary.total).toBeGreaterThan(0);
    expect(body.report.patches.length).toBeGreaterThan(0);
    expect(body.appliedPatchIds).toEqual([]);
    // Nothing was backed up.
    expect(existsSync(join(alHome, "backups", "doctor"))).toBe(false);
    await server.close();
  });

  it("POST /doctor/apply without approved:true is rejected and changes nothing", async () => {
    writeSettings(noTimeoutSettings());
    const deps = await makeDeps();
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/doctor/apply",
      headers: { "x-agentlens-token": deps.runtimeToken },
      payload: { approved: false, claudeHome },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/approval required/i);
    expect(existsSync(join(alHome, "backups", "doctor"))).toBe(false);
    await server.close();
  });

  it("POST /doctor/apply requires a runtime token", async () => {
    writeSettings(noTimeoutSettings());
    const deps = await makeDeps();
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/doctor/apply",
      payload: { approved: true, claudeHome },
    });
    expect(res.statusCode).toBe(401);
    await server.close();
  });

  it("POST /doctor/apply with approval backs up, validates, and lists the patch as rollback-eligible", async () => {
    writeSettings(noTimeoutSettings());
    const deps = await makeDeps();
    const server = await buildServer(deps);
    const before = readFileSync(join(claudeHome, "settings.json"), "utf8");

    const res = await server.inject({
      method: "POST",
      url: "/api/v1/doctor/apply",
      headers: { "x-agentlens-token": deps.runtimeToken },
      payload: { approved: true, claudeHome },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied.length).toBeGreaterThan(0);
    const applied = body.applied.find((r: { applied: boolean }) => r.applied);
    expect(applied).toBeTruthy();
    expect(applied.backupPath).toBeTruthy();
    expect(existsSync(applied.backupPath)).toBe(true);
    expect(body.appliedPatchIds).toContain(applied.patchId);
    // The settings file changed (timeout added).
    const after = readFileSync(join(claudeHome, "settings.json"), "utf8");
    expect(after).not.toBe(before);
    expect(after).toMatch(/timeout/);
    await server.close();

    // Roll back via a fresh server (rollback is keyed by patchId + backup).
    const server2 = await buildServer(deps);
    const rb = await server2.inject({
      method: "POST",
      url: "/api/v1/doctor/rollback",
      headers: { "x-agentlens-token": deps.runtimeToken },
      payload: { patchId: applied.patchId, targetFile: applied.targetFile },
    });
    expect(rb.statusCode).toBe(200);
    expect(rb.json().result.restored).toBe(true);
    const restored = readFileSync(join(claudeHome, "settings.json"), "utf8");
    expect(restored).toBe(before);
    await server2.close();
  });

  it("POST /doctor/rollback returns 404 when no backup exists for the patch id", async () => {
    const deps = await makeDeps();
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/doctor/rollback",
      headers: { "x-agentlens-token": deps.runtimeToken },
      payload: { patchId: "never-applied" },
    });
    expect(res.statusCode).toBe(404);
    await server.close();
  });

  it("rollback ignores a forged client targetFile and restores the sidecar target (§19.2)", async () => {
    writeSettings(noTimeoutSettings());
    const deps = await makeDeps();
    const server = await buildServer(deps);
    const before = readFileSync(join(claudeHome, "settings.json"), "utf8");

    const applied = await server
      .inject({
        method: "POST",
        url: "/api/v1/doctor/apply",
        headers: { "x-agentlens-token": deps.runtimeToken },
        payload: { approved: true, claudeHome },
      })
      .then((r) => r.json().applied.find((x: { applied: boolean }) => x.applied));
    expect(applied).toBeTruthy();
    await server.close();

    // Forge a targetFile pointing at an unrelated, attacker-chosen path. The
    // server MUST ignore it and restore to the authoritative sidecar target
    // (the real settings.json), never to /tmp/agentlens-forged.
    const forged = join(tmpdir(), "agentlens-forged-settings.json");
    const server2 = await buildServer(deps);
    const rb = await server2.inject({
      method: "POST",
      url: "/api/v1/doctor/rollback",
      headers: { "x-agentlens-token": deps.runtimeToken },
      payload: { patchId: applied.patchId, targetFile: forged },
    });
    expect(rb.statusCode).toBe(200);
    expect(rb.json().result.restored).toBe(true);
    // The forged file was NOT created.
    expect(existsSync(forged)).toBe(false);
    // The real settings.json was restored to its pre-patch content.
    expect(readFileSync(join(claudeHome, "settings.json"), "utf8")).toBe(before);
    await server2.close();
  });
});
