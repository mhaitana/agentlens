import { describe, it, expect } from "vitest";
import {
  RuleEngine,
  createRuleEngine,
  fingerprintCandidate,
  mergeThresholds,
  type RuleOverride,
} from "./rule-engine.js";
import {
  unknown,
  type AnalysisContext,
  type AnalyticsSnapshot,
  type ProvenancedValue,
  type RecommendationCandidate,
  type RecommendationRule,
  type ReportFilters,
} from "@agentlens/domain";

// A minimal snapshot is enough for the framework tests — rules read only the
// fields they care about. Only `usage.totalSessions` is parameterised.
function snapshot(totalSessions: number): AnalyticsSnapshot {
  const zero: ProvenancedValue<number> = { value: 0, provenance: "exact" };
  const unk: ProvenancedValue<number | null> = unknown<number>("none");
  return {
    generatedAt: "2026-07-10T00:00:00.000Z",
    filters: { period: "all" },
    privacyMode: "redacted-content",
    usage: {
      totalSessions: { value: totalSessions, provenance: "exact" },
      sessionsPerDay: zero,
      sessionsPerWeek: zero,
      sessionsPerMonth: zero,
      activeDays: zero,
      medianSessionDurationMs: unk,
      meanSessionDurationMs: unk,
      totalDurationMs: unk,
      promptsPerSession: zero,
      toolCallsPerSession: zero,
      toolSuccessRate: zero,
      totalTokens: zero,
      inputTokens: zero,
      outputTokens: zero,
      cacheReadTokens: zero,
      cacheCreationTokens: zero,
      totalCompactions: zero,
      totalSubagentSessions: zero,
      estimatedCostUsd: unknown<number | null>("none"),
      modelUsage: [],
    },
    tools: {
      mostUsedTools: [],
      toolFailureRate: zero,
      averageToolDurationMs: unk,
      repeatedReads: [],
      repeatedSearches: [],
      repeatedCommands: [],
      repeatedFailedCommands: [],
      largestToolInputsBytes: unk,
      largestToolOutputsBytes: unk,
      testCommandFrequency: zero,
      buildCommandFrequency: zero,
    },
    workflow: {
      filesChangedPerSession: unk,
      readToWriteRatio: unk,
      totalVerificationRuns: zero,
      sessionsEndingAfterSuccessfulVerification: zero,
      sessionsEndingWithKnownFailures: zero,
      changesAfterFinalVerification: zero,
      correctivePromptCount: zero,
      medianTimeToFirstEditMs: unk,
      medianTimeBetweenFinalEditAndVerificationMs: unk,
    },
    cost: { totalUsd: unknown<number | null>("none"), byModel: [], methodology: "unknown" },
    completeness: {
      totalSessions: 0,
      complete: 0,
      partialTailMissing: 0,
      partialMetricsMissing: 0,
      partialPromptsMissing: 0,
    },
    completion: { total: 0, completed: 0, interrupted: 0, failed: 0, unknown: 0 },
    scanProvenance: { sourceId: "claude-code", importedSessions: 0, skippedSessions: 0 },
    recommendations: [],
    minimumRecommendationConfidence: 0.65,
  };
}

/** A toy deterministic rule: fires once when totalSessions >= threshold. */
function highVolumeRule(threshold = 3): RecommendationRule {
  return {
    id: "high-session-volume",
    version: 1,
    category: "context",
    defaultThresholds: { minSessions: threshold },
    async evaluate(ctx: AnalysisContext): Promise<RecommendationCandidate[]> {
      const min = Number(ctx.thresholds["minSessions"] ?? threshold);
      const n = ctx.snapshot.usage.totalSessions.value as number;
      if (n < min) return [];
      return [
        {
          ruleId: "high-session-volume",
          ruleVersion: 1,
          category: "context",
          severity: "low",
          confidence: 0.8,
          scope: {},
          title: "High session volume",
          summary: `${n} sessions recorded`,
          explanation: `Observed ${n} sessions, above the threshold of ${min}.`,
          evidence: [
            {
              kind: "session-count",
              description: `${n} sessions`,
              metrics: [{ label: "sessions", value: n, provenance: "exact" }],
            },
          ],
          fingerprint: "",
        },
      ];
    },
    explain(c: RecommendationCandidate): string {
      return c.summary;
    },
  };
}

/** A rule that emits a candidate carrying the rule's own id (order test). */
function idRule(id: string, threshold = 1): RecommendationRule {
  return {
    id,
    version: 1,
    category: "context",
    defaultThresholds: { minSessions: threshold },
    async evaluate(ctx: AnalysisContext): Promise<RecommendationCandidate[]> {
      const min = Number(ctx.thresholds["minSessions"] ?? threshold);
      const n = ctx.snapshot.usage.totalSessions.value as number;
      if (n < min) return [];
      return [
        {
          ruleId: id,
          ruleVersion: 1,
          category: "context",
          severity: "low",
          confidence: 0.8,
          scope: {},
          title: id,
          summary: `${id} saw ${n} sessions`,
          explanation: id,
          evidence: [{ kind: "session-count", description: `${id}-${n}` }],
          fingerprint: "",
        },
      ];
    },
    explain(c: RecommendationCandidate): string {
      return c.summary;
    },
  };
}

/** A rule that emits two candidates with identical evidence (to test dedup). */
function duplicateRule(): RecommendationRule {
  return {
    id: "duplicate-emitter",
    version: 2,
    category: "tools",
    defaultThresholds: {},
    async evaluate(): Promise<RecommendationCandidate[]> {
      const base = {
        ruleId: "duplicate-emitter",
        ruleVersion: 2,
        category: "tools" as const,
        severity: "medium" as const,
        confidence: 0.6,
        scope: { sessionId: "sess-1" },
        title: "Same finding twice",
        summary: "dup",
        explanation: "dup",
        evidence: [{ kind: "dup", description: "same evidence" }],
        fingerprint: "",
      };
      return [base, { ...base }];
    },
    explain(c: RecommendationCandidate): string {
      return c.summary;
    },
  };
}

const filters: ReportFilters = { period: "all" };

describe("rule engine framework (§15.1)", () => {
  it("runs an enabled rule and emits its candidate", async () => {
    const engine = createRuleEngine([highVolumeRule(3)], {});
    const result = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.ruleId).toBe("high-session-volume");
    expect(result.skippedRules).toEqual([]);
  });

  it("does not fire a rule whose threshold is not met", async () => {
    const engine = createRuleEngine([highVolumeRule(10)], {});
    const result = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    expect(result.candidates).toEqual([]);
  });

  it("threshold overrides from config raise/lower the threshold", async () => {
    const overrides: Record<string, RuleOverride> = {
      "high-session-volume": { thresholds: { minSessions: 2 } },
    };
    const engine = createRuleEngine([highVolumeRule(10)], overrides);
    const result = await engine.run(snapshot(3), filters, "2026-07-10T00:00:00.000Z");
    expect(result.candidates).toHaveLength(1); // threshold lowered to 2 → fires
  });

  it("disabled rules are skipped and reported", async () => {
    const overrides: Record<string, RuleOverride> = { "high-session-volume": { enabled: false } };
    const engine = createRuleEngine([highVolumeRule(1)], overrides);
    const result = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    expect(result.candidates).toEqual([]);
    expect(result.skippedRules).toContain("high-session-volume");
  });

  it("consolidates duplicate candidates (same fingerprint)", async () => {
    const engine = createRuleEngine([duplicateRule()], {});
    const result = await engine.run(snapshot(2), filters, "2026-07-10T00:00:00.000Z");
    expect(result.candidates).toHaveLength(1);
    expect(result.consolidated).toHaveLength(1);
  });

  it("is deterministic: identical runs produce identical fingerprints", async () => {
    const engine = createRuleEngine([highVolumeRule(3)], {});
    const a = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    const b = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    expect(a.candidates[0]?.fingerprint).toBe(b.candidates[0]?.fingerprint);
    expect(a.candidates[0]?.fingerprint).not.toBe("");
  });

  it("filters out candidates below the confidence floor", async () => {
    const engine = createRuleEngine([highVolumeRule(1)], {});
    const result = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z", 0.9);
    // rule emits confidence 0.8 < 0.9 floor → dropped
    expect(result.candidates).toEqual([]);
  });

  it("a rule that throws is skipped without taking down the engine", async () => {
    const throwing: RecommendationRule = {
      id: "throws-rule",
      version: 1,
      category: "configuration",
      async evaluate(): Promise<RecommendationCandidate[]> {
        throw new Error("boom");
      },
      explain(): string {
        return "x";
      },
    };
    const engine = createRuleEngine([throwing, highVolumeRule(1)], {});
    const result = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    expect(result.skippedRules).toContain("throws-rule");
    expect(result.candidates.map((c) => c.ruleId)).toContain("high-session-volume");
  });

  it("fingerprintCandidate is stable for equal evidence and changes for different evidence", () => {
    const base: RecommendationCandidate = {
      ruleId: "r",
      ruleVersion: 1,
      category: "context",
      severity: "low",
      confidence: 0.5,
      scope: {},
      title: "t",
      summary: "s",
      explanation: "e",
      evidence: [
        { kind: "k", description: "d", metrics: [{ label: "x", value: 1, provenance: "exact" }] },
      ],
      fingerprint: "",
    };
    const fp1 = fingerprintCandidate(base);
    const fp2 = fingerprintCandidate({
      ...base,
      evidence: [...base.evidence, { kind: "k2", description: "d2" }],
    });
    expect(fp1).toBe(fingerprintCandidate(base));
    expect(fp1).not.toBe(fp2);
  });

  it("mergeThresholds merges overrides over defaults", () => {
    expect(mergeThresholds({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
    expect(mergeThresholds(undefined, { x: true })).toEqual({ x: true });
  });

  it("runs rules in deterministic sorted id order", async () => {
    const engine = new RuleEngine();
    engine.register(idRule("z-rule"));
    engine.register(idRule("a-rule"));
    const result = await engine.run(snapshot(5), filters, "2026-07-10T00:00:00.000Z");
    expect(result.candidates.map((c) => c.ruleId)).toEqual(["a-rule", "z-rule"]);
  });
});
