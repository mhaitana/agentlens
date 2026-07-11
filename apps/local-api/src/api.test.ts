/**
 * Local API tests (spec §17, §19.1) using Fastify's `inject` (no real port
 * binding) against a temp seeded SQLite database.
 *
 * Covers: route availability, pagination, privacy-mode gating (metadata-only
 * strips content), runtime-token enforcement on mutations, origin restriction,
 * and the metrics snapshot round-trip. No test depends on the developer's
 * real ~/.claude (spec §21).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, SessionRepo, ProjectRepo, SourceRepo, schema } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import type { AgentLensConfig } from "@agentlens/config";
import { buildServer } from "./server.js";
import { generateRuntimeToken } from "./index.js";
import type { ServerDeps } from "./deps.js";

function mkHome(): string {
  return mkdtempSync(join(tmpdir(), "agentlens-api-"));
}

async function seed(
  db: DrizzleDb,
): Promise<{ sourceId: string; projectId: string; sessionId: string }> {
  const sourceId = "claude-code";
  await new SourceRepo(db).upsert({
    id: sourceId,
    adapter: "claude-code",
    displayName: "Claude Code",
    version: "1.0",
    enabled: true,
  });
  const projectId = "proj-test";
  await new ProjectRepo(db).upsert({
    id: projectId,
    sourceId,
    displayName: "agentlens-demo",
    pathHash: "hash-demo",
    redactedPath: "[REPO]/src",
    firstSeenAt: "2026-07-09T10:00:00Z",
    lastSeenAt: "2026-07-09T12:00:00Z",
  });
  const sessionId = "sess-test-0001";
  await new SessionRepo(db).insert({
    id: sessionId,
    sourceSessionId: "orig-1",
    sourceId,
    projectId,
    startedAt: "2026-07-09T10:00:00Z",
    endedAt: "2026-07-09T11:00:00Z",
    durationMs: 3_600_000,
    entryPoint: "cli",
    completionStatus: "completed",
    privacyMode: "redacted-content",
    dataCompleteness: [],
    promptCount: 1,
    modelRequestCount: 1,
    toolCallCount: 1,
    compactionCount: 0,
    subagentCount: 0,
    importProvenance: "agentlens@0.1.0",
  });
  await db.insert(schema.prompts).values({
    id: "p-1",
    sessionId,
    sequence: 1,
    timestamp: "2026-07-09T10:00:05Z",
    redactedContent: "Fix the login bug",
    contentHash: "ch-1",
    characterCount: 17,
    approximateTokenCount: 4,
    features: {},
  });
  await db.insert(schema.toolCalls).values({
    id: "t-1",
    sessionId,
    toolUseId: "tu-1",
    toolName: "Read",
    startedAt: "2026-07-09T10:00:10Z",
    endedAt: "2026-07-09T10:00:11Z",
    durationMs: 1000,
    success: true,
    failureType: "none",
    permissionOutcome: "allow",
    sanitisedInput: '{"file_path":"src/auth.ts"}',
    inputSizeBytes: 30,
    outputSizeBytes: 200,
    sourceProvenance: "claude-code",
  });
  await db.insert(schema.recommendations).values({
    id: "rec:abc",
    ruleId: "TOOLS-001",
    ruleVersion: 1,
    sessionId,
    projectId,
    category: "tools",
    severity: "medium",
    confidence: 0.74,
    status: "active",
    title: "Repeated unchanged file reads",
    summary: "src/big.ts read 3 times",
    explanation: "Re-reading suggests contents were not retained.",
    evidence: [],
    createdAt: "2026-07-09T10:05:00Z",
    updatedAt: "2026-07-09T10:05:00Z",
  });
  return { sourceId, projectId, sessionId };
}

async function makeDeps(
  home: string,
  mode: AgentLensConfig["privacy"]["mode"],
): Promise<ServerDeps> {
  const dbObj = await openDatabase({ home, nowIso: new Date().toISOString(), inMemory: false });
  const config = defaultConfig();
  config.privacy.mode = mode;
  return {
    db: dbObj.db,
    config,
    home,
    runtimeToken: generateRuntimeToken(),
    port: 0,
  };
}

describe("local-api /api/v1/* (M2-4)", () => {
  let home: string;
  let deps: ServerDeps;
  let seeded: { sourceId: string; projectId: string; sessionId: string };

  beforeEach(async () => {
    home = mkHome();
    deps = await makeDeps(home, "redacted-content");
    seeded = await seed(deps.db);
  });

  afterAll(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  async function app() {
    return buildServer(deps);
  }

  it("GET /api/v1/health returns ok", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", version: "v1" });
    await server.close();
  });

  it("GET /api/v1/status reports counts and privacy mode", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.privacyMode).toBe("redacted-content");
    expect(body.projects).toBe(1);
    expect(body.recommendations).toBe(1);
    await server.close();
  });

  it("GET /api/v1/sessions paginates and returns seeded session", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/sessions?page=1&limit=10" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(seeded.sessionId);
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
    await server.close();
  });

  it("GET /api/v1/sessions/:id/events returns a merged, privacy-gated timeline", async () => {
    const server = await app();
    const res = await server.inject({
      method: "GET",
      url: `/api/v1/sessions/${seeded.sessionId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();
    const kinds = events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("prompt");
    expect(kinds).toContain("tool_call");
    // redacted-content mode permits content:
    const prompt = events.find((e: { kind: string }) => e.kind === "prompt");
    expect(prompt.data.redactedContent).toBe("Fix the login bug");
    await server.close();
  });

  it("metadata-only mode strips content fields from the timeline", async () => {
    deps = await makeDeps(mkHome(), "metadata-only");
    await seed(deps.db);
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "GET",
      url: `/api/v1/sessions/sess-test-0001/events`,
    });
    const events = res.json();
    const prompt = events.find((e: { kind: string }) => e.kind === "prompt");
    expect(prompt.data.redactedContent).toBeNull();
    const tool = events.find((e: { kind: string }) => e.kind === "tool_call");
    expect(tool.data.sanitisedInput).toBeNull();
    await server.close();
  });

  it("GET /api/v1/metrics returns a snapshot with recommendations", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/metrics?period=month" });
    expect(res.statusCode).toBe(200);
    const snap = res.json();
    expect(snap.usage).toBeDefined();
    expect(snap.recommendations).toBeDefined();
    expect(Array.isArray(snap.recommendations)).toBe(true);
    await server.close();
  });

  it("GET /api/v1/recommendations returns active recommendations", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/recommendations" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("rec:abc");
    await server.close();
  });

  it("GET /api/v1/rules lists all default rules enabled", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/rules" });
    expect(res.statusCode).toBe(200);
    const rules = res.json();
    expect(rules).toHaveLength(34);
    expect(rules.every((r: { enabled: boolean }) => r.enabled)).toBe(true);
    expect(rules[0].id).toBe("TOOLS-001");
    await server.close();
  });

  it("POST /api/v1/privacy/purge requires a runtime token", async () => {
    const server = await app();
    const noToken = await server.inject({ method: "POST", url: "/api/v1/privacy/purge" });
    expect(noToken.statusCode).toBe(401);
    const badToken = await server.inject({
      method: "POST",
      url: "/api/v1/privacy/purge",
      headers: { "x-agentlens-token": "wrong" },
    });
    expect(badToken.statusCode).toBe(403);
    await server.close();
  });

  it("POST /api/v1/privacy/purge with a valid token deletes all data", async () => {
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/privacy/purge",
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ purged: true });
    // Sessions should now be empty.
    const after = await server.inject({ method: "GET", url: "/api/v1/sessions" });
    expect(after.json().total).toBe(0);
    await server.close();
  });

  it("POST /api/v1/privacy/purge?projectId restricts deletion to one project", async () => {
    // Seed a second project + session so we can confirm only one is purged.
    // (Project must exist before the session — sessions.projectId FK.)
    await new ProjectRepo(deps.db).upsert({
      id: "proj-other",
      sourceId: seeded.sourceId,
      displayName: "other-project",
      pathHash: "hash-other",
      firstSeenAt: "2026-07-09T10:00:00Z",
      lastSeenAt: "2026-07-09T12:00:00Z",
    });
    await new SessionRepo(deps.db).insert({
      id: "sess-other",
      sourceSessionId: "orig-2",
      sourceId: seeded.sourceId,
      projectId: "proj-other",
      startedAt: "2026-07-09T10:00:00Z",
      endedAt: "2026-07-09T11:00:00Z",
      durationMs: 3_600_000,
      entryPoint: "cli",
      completionStatus: "completed",
      privacyMode: "redacted-content",
      dataCompleteness: [],
      promptCount: 0,
      modelRequestCount: 0,
      toolCallCount: 0,
      compactionCount: 0,
      subagentCount: 0,
      importProvenance: "agentlens@0.1.0",
    });
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/privacy/purge?projectId=proj-test",
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ purged: true, scope: "project", projectId: "proj-test" });
    expect(body.summary.sessions).toBe(1);
    // The other project's session survives.
    const after = await server.inject({ method: "GET", url: "/api/v1/sessions" });
    expect(after.json().total).toBe(1);
    expect(after.json().items[0].id).toBe("sess-other");
    await server.close();
  });

  it("POST /api/v1/privacy/retain requires a token and prunes expired sessions", async () => {
    // No token → 401.
    const server = await app();
    const noToken = await server.inject({ method: "POST", url: "/api/v1/privacy/retain" });
    expect(noToken.statusCode).toBe(401);
    // With a token: prunes by config.retentionDays (default 90 → nothing seeded is old).
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/privacy/retain",
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pruned).toBe(0);
    expect(res.json().retentionDays).toBe(deps.config.privacy.retentionDays);
    await server.close();
  });

  it("rejects cross-origin browser requests (Origin header)", async () => {
    const server = await app();
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
    await server.close();
  });

  it("GET /api/v1/projects returns the seeded project with a session count", async () => {
    const server = await app();
    const res = await server.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionCount).toBe(1);
    await server.close();
  });

  it("POST /api/v1/settings updates the in-memory config so GET /privacy reflects it (M2-7)", async () => {
    const server = await app();
    // Mutation is token-gated.
    const noToken = await server.inject({
      method: "POST",
      url: "/api/v1/settings",
      payload: { key: "privacy.retentionDays", value: 30 },
    });
    expect(noToken.statusCode).toBe(401);

    // Set retentionDays → reflected on the next /privacy read (no restart).
    const set = await server.inject({
      method: "POST",
      url: "/api/v1/settings",
      payload: { key: "privacy.retentionDays", value: 30 },
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(set.statusCode).toBe(200);
    const priv = await server.inject({ method: "GET", url: "/api/v1/privacy" });
    expect(priv.json().retentionDays).toBe(30);

    // Setting the privacy mode (non-full-local, no opt-in needed server-side)
    // is reflected in /privacy and /status.
    const setMode = await server.inject({
      method: "POST",
      url: "/api/v1/settings",
      payload: { key: "privacy.mode", value: "metadata-only" },
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(setMode.statusCode).toBe(200);
    const priv2 = await server.inject({ method: "GET", url: "/api/v1/privacy" });
    expect(priv2.json().mode).toBe("metadata-only");
    const status = await server.inject({ method: "GET", url: "/api/v1/status" });
    expect(status.json().privacyMode).toBe("metadata-only");

    // An invalid mode is rejected by config validation → error response.
    const bad = await server.inject({
      method: "POST",
      url: "/api/v1/settings",
      payload: { key: "privacy.mode", value: "bogus" },
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    await server.close();
  });

  it("POST /api/v1/recommendations/:id/dismiss requires the runtime token", async () => {
    const server = await app();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/recommendations/rec:abc/dismiss",
    });
    expect(res.statusCode).toBe(401);
    await server.close();
  });

  it("POST /api/v1/recommendations/:id/dismiss then /restore toggles status", async () => {
    const server = await app();
    const dismiss = await server.inject({
      method: "POST",
      url: "/api/v1/recommendations/rec:abc/dismiss",
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(dismiss.statusCode).toBe(200);
    expect(dismiss.json()).toEqual({ id: "rec:abc", status: "dismissed" });

    // Dismissed recommendation drops out of the active list.
    const active = await server.inject({ method: "GET", url: "/api/v1/recommendations" });
    expect(active.json()).toHaveLength(0);

    const restore = await server.inject({
      method: "POST",
      url: "/api/v1/recommendations/rec:abc/restore",
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toEqual({ id: "rec:abc", status: "active" });
    const after = await server.inject({ method: "GET", url: "/api/v1/recommendations" });
    expect(after.json()).toHaveLength(1);
    await server.close();
  });
});

describe("local-api dashboard serving (§13.8, §19.1)", () => {
  let home: string;
  let dashboardDir: string;
  let deps: ServerDeps;

  beforeEach(async () => {
    home = mkHome();
    dashboardDir = mkdtempSync(join(tmpdir(), "agentlens-dash-static-"));
    // Minimal built-dashboard shape: index.html + an asset under /assets.
    mkdirSync(join(dashboardDir, "assets"), { recursive: true });
    writeFileSync(
      join(dashboardDir, "index.html"),
      "<!doctype html><html><head><title>AgentLens</title></head><body><div id=root></div></body></html>",
      "utf-8",
    );
    writeFileSync(join(dashboardDir, "assets", "app.js"), "console.log('app');", "utf-8");
    const dbObj = await openDatabase({ home, nowIso: new Date().toISOString(), inMemory: false });
    deps = {
      db: dbObj.db,
      config: defaultConfig(),
      home,
      runtimeToken: generateRuntimeToken(),
      dashboardDir,
      port: 0,
    };
  });

  afterAll(() => {
    // dirs cleaned per-test via temp; nothing persistent to remove here.
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(dashboardDir, { recursive: true, force: true });
  });

  it("serves the SPA shell at / with the runtime token injected before </head>", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    // The SPA shell must never be cached: a cached index.html references old
    // asset hashes and 404s across any reinstall/redeploy that re-hashes them.
    expect(res.headers["cache-control"]).toBe("no-store");
    // Token bootstrap injected (§19.1) — same-origin dashboard reads it.
    expect(res.body).toContain("window.__AGENTLENS__");
    expect(res.body).toContain(deps.runtimeToken);
    // Injected before the closing head tag, not appended after.
    expect(res.body.indexOf("window.__AGENTLENS__")).toBeLessThan(res.body.indexOf("</head>"));
    await server.close();
  });

  it("serves /assets/* with the correct content type", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    // Hashed assets are immutable — safe to cache long-term.
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.body).toContain("console.log");
    await server.close();
  });

  it("returns 404 for a missing asset (static handler bound-checks the assets dir)", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({ method: "GET", url: "/assets/missing.js" });
    expect(res.statusCode).toBe(404);
    // A present asset still resolves (sanity).
    const ok = await server.inject({ method: "GET", url: "/assets/app.js" });
    expect(ok.statusCode).toBe(200);
    await server.close();
  });

  it("falls back to the SPA shell for client-side routes (non-/api, no extension)", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({ method: "GET", url: "/sessions/abc" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("window.__AGENTLENS__");
    // /api routes are not swallowed by the SPA fallback.
    const api = await server.inject({ method: "GET", url: "/api/v1/health" });
    expect(api.statusCode).toBe(200);
    expect(api.json()).toMatchObject({ status: "ok" });
    await server.close();
  });
});
