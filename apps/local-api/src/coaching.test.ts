/**
 * Coaching + recommendation lifecycle API tests (spec §15.12, §15.13, §17).
 *
 * Covers the coaching overview (top opportunities, avoidable usage labelled
 * estimated, repeated behaviours, configurable model catalogue), the Prompt
 * Coach list/detail (deterministic, no external model), and recommendation
 * resolve/reopen persistence. Uses Fastify `inject` against a temp seeded
 * SQLite database; no test depends on the developer's real ~/.claude (§21).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
  return mkdtempSync(join(tmpdir(), "agentlens-coaching-"));
}

async function seed(
  db: DrizzleDb,
): Promise<{ sessionId: string; promptId: string; recId: string }> {
  const sourceId = "claude-code";
  await new SourceRepo(db).upsert({
    id: sourceId,
    adapter: "claude-code",
    displayName: "Claude Code",
    version: "1.0",
    enabled: true,
  });
  const projectId = "proj-c";
  await new ProjectRepo(db).upsert({
    id: projectId,
    sourceId,
    displayName: "agentlens-demo",
    pathHash: "hash-c",
    redactedPath: "[REPO]/src",
    firstSeenAt: "2026-07-10T10:00:00Z",
    lastSeenAt: "2026-07-10T12:00:00Z",
  });
  const sessionId = "sess-c-0001";
  await new SessionRepo(db).insert({
    id: sessionId,
    sourceSessionId: "orig-c",
    sourceId,
    projectId,
    startedAt: "2026-07-10T10:00:00Z",
    endedAt: "2026-07-10T11:00:00Z",
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
  const promptId = "p-c-1";
  await db.insert(schema.prompts).values({
    id: promptId,
    sessionId,
    sequence: 1,
    timestamp: "2026-07-10T10:00:05Z",
    redactedContent: "Fix the login bug in src/auth.ts and verify with pnpm test",
    contentHash: "ch-c-1",
    characterCount: 60,
    approximateTokenCount: 14,
    features: {},
  });
  const recId = "rec:coaching-1";
  await db.insert(schema.recommendations).values({
    id: recId,
    ruleId: "TOOLS-001",
    ruleVersion: 1,
    sessionId,
    projectId,
    category: "tools",
    severity: "high",
    confidence: 0.82,
    status: "active",
    title: "Repeated unchanged file reads",
    summary: "src/big.ts read 6 times without an edit",
    explanation: "Re-reading suggests contents were not retained.",
    evidence: [{ kind: "read", description: "read src/big.ts 6x" }],
    estimatedImpact: {
      tokenRange: { minimum: 12_000, maximum: 20_000 },
      costUsdRange: { minimum: 0.12, maximum: 0.2 },
      confidence: 0.8,
      methodology: "estimated",
    },
    remediation: null,
    createdAt: "2026-07-10T10:05:00Z",
    updatedAt: "2026-07-10T10:05:00Z",
  });
  return { sessionId, promptId, recId };
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

describe("coaching + recommendation lifecycle (Phase 3, §15.12–15.13)", () => {
  let home: string;
  let deps: ServerDeps;
  let seeded: { sessionId: string; promptId: string; recId: string };

  beforeEach(async () => {
    home = mkHome();
    deps = await makeDeps(home, "redacted-content");
    seeded = await seed(deps.db);
  });

  afterEach(async () => {
    rmSync(home, { recursive: true, force: true });
  });

  afterAll(async () => {
    // vitest tears down workers; nothing else to clean.
  });

  it("GET /coaching/overview returns top opportunities, estimated avoidable usage, and the configurable model catalogue", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({ method: "GET", url: "/api/v1/coaching/overview" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.topOpportunities.length).toBeGreaterThan(0);
    expect(body.topOpportunities[0].id).toBe(seeded.recId);
    // Avoidable usage is labelled estimated (§3.4) and never presented as billing.
    expect(body.estimatedAvoidableUsage.estimatedTokens).toBe(12_000);
    expect(body.estimatedAvoidableUsage.estimatedCostUsd).toBeCloseTo(0.12, 5);
    expect(body.estimatedAvoidableUsage.costLabel).toMatch(
      /Estimated.*not an official billing value/,
    );
    // The model catalogue is configurable (§15.4) — relative tiers, not permanent claims.
    expect(body.modelCatalogue.version).toBeGreaterThan(0);
    expect(body.modelCatalogue.entries.length).toBeGreaterThan(0);
    for (const e of body.modelCatalogue.entries) {
      expect(e.capabilityTier).toBeGreaterThanOrEqual(1);
      expect(e.costTier).toBeGreaterThanOrEqual(1);
    }
    await server.close();
  });

  it("GET /coaching/prompts returns recent prompts with heuristic quality scores", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/coaching/prompts?page=1&limit=10",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe(seeded.promptId);
    expect(body.items[0].qualityProvenance).toBe("heuristic");
    expect(body.items[0].overallScore).toBeGreaterThanOrEqual(0);
    expect(body.items[0].overallScore).toBeLessThanOrEqual(1);
    await server.close();
  });

  it("GET /coaching/prompts/:id returns the Prompt Coach detail (assessment, comparison, baseline)", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "GET",
      url: `/api/v1/coaching/prompts/${seeded.promptId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(seeded.promptId);
    expect(body.assessment).not.toBeNull();
    expect(body.assessment.provenance).toBe("heuristic");
    expect(body.comparison).not.toBeNull();
    expect(body.comparison.disclaimer).toMatch(/not guaranteed/i);
    expect(body.baselineComparison).not.toBeNull();
    await server.close();
  });

  it("GET /coaching/prompts/:id returns 404 for an unknown prompt", async () => {
    const server = await buildServer(deps);
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/coaching/prompts/does-not-exist",
    });
    expect(res.statusCode).toBe(404);
    await server.close();
  });

  it("POST /recommendations/:id/resolve requires a token and persists resolved status", async () => {
    const server = await buildServer(deps);
    // No token → 401 (mutation, token-gated).
    const noToken = await server.inject({
      method: "POST",
      url: `/api/v1/recommendations/${seeded.recId}/resolve`,
    });
    expect(noToken.statusCode).toBe(401);
    // With token → resolved.
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/recommendations/${seeded.recId}/resolve`,
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("resolved");
    // It no longer appears in the active list.
    const list = await server.inject({ method: "GET", url: "/api/v1/recommendations" });
    expect(list.json().some((r: { id: string }) => r.id === seeded.recId)).toBe(false);
    await server.close();
  });

  it("POST /recommendations/:id/reopen returns a resolved recommendation to active", async () => {
    const server = await buildServer(deps);
    await server.inject({
      method: "POST",
      url: `/api/v1/recommendations/${seeded.recId}/resolve`,
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/recommendations/${seeded.recId}/reopen`,
      headers: { "x-agentlens-token": deps.runtimeToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
    const list = await server.inject({ method: "GET", url: "/api/v1/recommendations" });
    expect(list.json().some((r: { id: string }) => r.id === seeded.recId)).toBe(true);
    await server.close();
  });

  it("strips prompt content under metadata-only mode but keeps scores' provenance", async () => {
    const mdDeps = await makeDeps(home, "metadata-only");
    // Re-seed into a fresh metadata-only DB (the prior DB was redacted-content).
    const mdHome = mkHome();
    const mdDbObj = await openDatabase({
      home: mdHome,
      nowIso: new Date().toISOString(),
      inMemory: false,
    });
    const mdDeps2: ServerDeps = {
      ...mdDeps,
      db: mdDbObj.db,
      home: mdHome,
    };
    const s = await seed(mdDbObj.db);
    const server = await buildServer(mdDeps2);
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/coaching/prompts?page=1&limit=10",
    });
    const item = res.json().items[0];
    expect(item.redactedContent).toBeNull();
    // Scores collapse to 0 when content is stripped, but provenance is still labelled.
    expect(item.qualityProvenance).toBe("heuristic");
    await server.close();
    rmSync(mdHome, { recursive: true, force: true });
    // suppress unused-warning for the re-seeded prompt id.
    expect(s.promptId).toBeTruthy();
  });
});
