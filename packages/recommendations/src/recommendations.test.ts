import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import { openDatabase, closeDatabase, schema, eq, type Database } from "@agentlens/database";
import type { RecommendationCandidate } from "@agentlens/domain";
import {
  persistCandidates,
  rankRecommendations,
  generateRecommendations,
  recommendationId,
  RecommendationRepo,
  rowToRecommendation,
} from "./index.js";

const NOW = "2026-07-10T12:00:00.000Z";

async function withDb<T>(fn: (database: Database) => Promise<T>): Promise<T> {
  const database = await openDatabase({ home: "", nowIso: NOW, inMemory: true });
  try {
    return await fn(database);
  } finally {
    await closeDatabase(database);
    await Promise.all([
      rm(database.path, { force: true }),
      rm(`${database.path}-wal`, { force: true }),
      rm(`${database.path}-shm`, { force: true }),
    ]);
  }
}

let counter = 0;
function candidate(opts: {
  ruleId: string;
  fingerprint: string;
  sessionId?: string;
  projectId?: string;
  severity?: RecommendationCandidate["severity"];
  confidence?: number;
  category?: RecommendationCandidate["category"];
  title?: string;
  occurrences?: number;
  references?: string[];
}): RecommendationCandidate {
  counter += 1;
  const refs = opts.references;
  return {
    ruleId: opts.ruleId,
    ruleVersion: 1,
    category: opts.category ?? "tools",
    severity: opts.severity ?? "medium",
    confidence: opts.confidence ?? 0.8,
    scope: { sessionId: opts.sessionId, projectId: opts.projectId },
    title: opts.title ?? `${opts.ruleId} finding ${counter}`,
    summary: "summary",
    explanation: "explanation",
    evidence: [
      {
        kind: "metric",
        description: "d",
        metrics: [{ label: "occurrences", value: opts.occurrences ?? 3, provenance: "exact" }],
        ...(refs ? { references: refs } : {}),
      },
    ],
    fingerprint: opts.fingerprint,
  };
}

async function statusOf(database: Database, id: string): Promise<string | undefined> {
  const rows = await database.db
    .select({ status: schema.recommendations.status })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, id));
  return rows[0]?.status;
}

describe("recommendation persistence (§15.1)", () => {
  it("inserts a new candidate as active", async () => {
    await withDb(async (database) => {
      const c = candidate({ ruleId: "TOOLS-001", fingerprint: "fp1", sessionId: "s1" });
      const outcome = await persistCandidates(database.db, [c], NOW);
      expect(outcome.inserted).toBe(1);
      expect(outcome.unchanged).toBe(0);
      const id = recommendationId("fp1");
      expect(await statusOf(database, id)).toBe("active");
    });
  });

  it("dedups: the same fingerprint on a re-run is unchanged (no duplicate row)", async () => {
    await withDb(async (database) => {
      const c = candidate({ ruleId: "TOOLS-001", fingerprint: "fp1", sessionId: "s1" });
      await persistCandidates(database.db, [c], NOW);
      const outcome = await persistCandidates(database.db, [c], NOW);
      expect(outcome.inserted).toBe(0);
      expect(outcome.unchanged).toBe(1);
      const repo = new RecommendationRepo(database.db);
      const all = await repo.listAll();
      expect(all).toHaveLength(1); // no duplicate
    });
  });

  it("supersedes: a new fingerprint for the same rule+scope supersedes the prior active", async () => {
    await withDb(async (database) => {
      const c1 = candidate({ ruleId: "TOOLS-001", fingerprint: "fp1", sessionId: "s1" });
      await persistCandidates(database.db, [c1], NOW);
      const c2 = candidate({ ruleId: "TOOLS-001", fingerprint: "fp2", sessionId: "s1" });
      const outcome = await persistCandidates(database.db, [c2], NOW);
      expect(outcome.inserted).toBe(1);
      expect(outcome.superseded).toBe(1);
      expect(await statusOf(database, recommendationId("fp1"))).toBe("superseded");
      expect(await statusOf(database, recommendationId("fp2"))).toBe("active");
    });
  });

  it("does not supersede across different scopes", async () => {
    await withDb(async (database) => {
      const c1 = candidate({ ruleId: "TOOLS-001", fingerprint: "fp1", sessionId: "s1" });
      const c2 = candidate({ ruleId: "TOOLS-001", fingerprint: "fp2", sessionId: "s2" });
      const outcome = await persistCandidates(database.db, [c1, c2], NOW);
      expect(outcome.superseded).toBe(0);
      expect(await statusOf(database, recommendationId("fp1"))).toBe("active");
      expect(await statusOf(database, recommendationId("fp2"))).toBe("active");
    });
  });

  it("does not re-activate a dismissed recommendation on the same evidence", async () => {
    await withDb(async (database) => {
      const c = candidate({ ruleId: "TOOLS-001", fingerprint: "fp1", sessionId: "s1" });
      await persistCandidates(database.db, [c], NOW);
      // User dismisses it.
      await database.db
        .update(schema.recommendations)
        .set({ status: "dismissed" })
        .where(eq(schema.recommendations.id, recommendationId("fp1")));
      // Re-run with identical evidence (same fingerprint).
      const outcome = await persistCandidates(database.db, [c], NOW);
      expect(outcome.inserted).toBe(0);
      expect(outcome.unchanged).toBe(0);
      expect(outcome.retainedPriorStatus).toBe(1);
      expect(await statusOf(database, recommendationId("fp1"))).toBe("dismissed"); // still dismissed
    });
  });

  it("reappears on NEW evidence: a dismissed rec stays dismissed, but a new fingerprint inserts active", async () => {
    await withDb(async (database) => {
      const c1 = candidate({ ruleId: "TOOLS-001", fingerprint: "fp1", sessionId: "s1" });
      await persistCandidates(database.db, [c1], NOW);
      await database.db
        .update(schema.recommendations)
        .set({ status: "dismissed" })
        .where(eq(schema.recommendations.id, recommendationId("fp1")));
      const c2 = candidate({ ruleId: "TOOLS-001", fingerprint: "fp2", sessionId: "s1" });
      const outcome = await persistCandidates(database.db, [c2], NOW);
      // New evidence → new active appears; the dismissed prior is NOT resurrected
      // and is NOT superseded (it was already dismissed, not active).
      expect(outcome.inserted).toBe(1);
      expect(outcome.superseded).toBe(0);
      expect(await statusOf(database, recommendationId("fp1"))).toBe("dismissed");
      expect(await statusOf(database, recommendationId("fp2"))).toBe("active");
    });
  });
});

describe("recommendation ranking (§15.2)", () => {
  it("ranks higher severity above lower severity, all else equal", () => {
    const high = rowToRecommendation({
      id: "rec:h",
      ruleId: "R",
      ruleVersion: 1,
      sessionId: null,
      projectId: null,
      category: "tools",
      severity: "high",
      confidence: 0.8,
      status: "active",
      title: "h",
      summary: "s",
      explanation: "e",
      evidence: [],
      estimatedImpact: null,
      remediation: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const low = { ...high, id: "rec:l", severity: "low" as const };
    const ranked = rankRecommendations([low, high], { now: NOW });
    expect(ranked[0]?.id).toBe("rec:h");
  });

  it("is deterministic: identical inputs produce identical ordering", () => {
    const a = {
      id: "rec:a",
      ruleId: "A",
      ruleVersion: 1,
      sessionId: null,
      projectId: null,
      category: "tools",
      severity: "medium" as const,
      confidence: 0.7 as number,
      status: "active",
      title: "a",
      summary: "s",
      explanation: "e",
      evidence: [],
      estimatedImpact: null,
      remediation: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const b = {
      id: "rec:b",
      ruleId: "B",
      ruleVersion: 1,
      sessionId: null,
      projectId: null,
      category: "tools",
      severity: "medium" as const,
      confidence: 0.7 as number,
      status: "active",
      title: "b",
      summary: "s",
      explanation: "e",
      evidence: [],
      estimatedImpact: null,
      remediation: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const recs = [rowToRecommendation(a), rowToRecommendation(b)];
    const r1 = rankRecommendations(recs, { now: NOW });
    const r2 = rankRecommendations(recs, { now: NOW });
    expect(r1.map((r) => r.id)).toEqual(r2.map((r) => r.id));
  });

  it("caps to maxRecommendations (avoid flooding)", () => {
    const recs = Array.from({ length: 30 }, (_, i) =>
      rowToRecommendation({
        id: `rec:${i}`,
        ruleId: `R${i}`,
        ruleVersion: 1,
        sessionId: null,
        projectId: null,
        category: "tools",
        severity: "low",
        confidence: 0.5,
        status: "active",
        title: `t${i}`,
        summary: "s",
        explanation: "e",
        evidence: [],
        estimatedImpact: null,
        remediation: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    const ranked = rankRecommendations(recs, { now: NOW, maxRecommendations: 10 });
    expect(ranked).toHaveLength(10);
  });
});

describe("generateRecommendations", () => {
  it("persists candidates, ranks active, and drops below the confidence floor", async () => {
    await withDb(async (database) => {
      const high = candidate({
        ruleId: "TOOLS-001",
        fingerprint: "fp1",
        sessionId: "s1",
        severity: "high",
        confidence: 0.9,
      });
      const low = candidate({
        ruleId: "TOOLS-002",
        fingerprint: "fp2",
        sessionId: "s1",
        severity: "low",
        confidence: 0.3,
      });
      const result = await generateRecommendations(database.db, [high, low], {
        now: NOW,
        minimumConfidence: 0.65,
        maxRecommendations: 20,
      });
      expect(result.recommendations).toHaveLength(1); // low dropped by floor
      expect(result.recommendations[0]?.ruleId).toBe("TOOLS-001");
      expect(result.outcome.inserted).toBe(1);
    });
  });
});
