/**
 * Deterministic rule tests (spec §13.10, §21.1).
 *
 * Each rule is a pure async function over an {@link AnalysisContext}, so these
 * are direct unit tests: build a snapshot that crosses (or stays below) a rule's
 * threshold, call `rule.evaluate(ctx)`, and assert the candidate. No DB is
 * involved — persistence/supersession is covered in
 * `packages/recommendations/src/recommendations.test.ts`.
 *
 * §21.1 coverage: repeated reads, repeated command failures, broad tests, code
 * changes with no verification, changes after final verification, sensitive
 * path access, prompt corrections, oversized outputs, compaction, secrets.
 */
import { describe, expect, it } from "vitest";
import type {
  AnalysisContext,
  AnalyticsSnapshot,
  Confidence,
  RecommendationCandidate,
  RecommendationRule,
  ReportFilters,
} from "@agentlens/domain";
import {
  context001,
  context002,
  security001,
  security002,
  tools001,
  tools002,
  tools003,
  tools004,
  tools005,
  tools006,
  verify001,
  verify002,
  verify003,
  verify004,
  workflow001,
  workflow002,
} from "./index.js";
import { defaultRules, RULE_METADATA } from "./index.js";

const NOW = "2026-07-10T12:00:00.000Z";
const FILTERS: ReportFilters = { period: "month" };

/** A provenanced number (exact). */
function pv(value: number): { value: number; provenance: "exact" } {
  return { value, provenance: "exact" };
}
/** A provenanced nullable number (exact or unknown). */
function pvNull(value: number | null): { value: number | null; provenance: "exact" | "unknown" } {
  return value === null ? { value: null, provenance: "unknown" } : { value, provenance: "exact" };
}

/** Baseline all-zero/empty snapshot. Override pieces via `overrides`. */
function mkSnapshot(overrides: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot {
  const zero = pv(0);
  const unk = pvNull(null);
  const base: AnalyticsSnapshot = {
    generatedAt: NOW,
    filters: FILTERS,
    privacyMode: "redacted-content",
    usage: {
      totalSessions: pv(1),
      sessionsPerDay: zero,
      sessionsPerWeek: zero,
      sessionsPerMonth: zero,
      activeDays: pv(1),
      medianSessionDurationMs: pvNull(0),
      meanSessionDurationMs: pvNull(0),
      totalDurationMs: pvNull(0),
      promptsPerSession: pv(0),
      toolCallsPerSession: pv(0),
      toolSuccessRate: pv(1),
      totalTokens: zero,
      inputTokens: zero,
      outputTokens: zero,
      cacheReadTokens: zero,
      cacheCreationTokens: zero,
      totalCompactions: zero,
      totalSubagentSessions: zero,
      estimatedCostUsd: pvNull(null),
      modelUsage: [],
    },
    tools: {
      mostUsedTools: [],
      toolFailureRate: pv(0),
      averageToolDurationMs: unk,
      repeatedReads: [],
      repeatedSearches: [],
      repeatedCommands: [],
      repeatedFailedCommands: [],
      largestToolInputsBytes: unk,
      largestToolOutputsBytes: pvNull(0),
      testCommandFrequency: zero,
      buildCommandFrequency: zero,
      broadTestRunCount: zero,
    },
    workflow: {
      filesChangedPerSession: pvNull(0),
      readToWriteRatio: pvNull(0),
      totalVerificationRuns: zero,
      sessionsEndingAfterSuccessfulVerification: zero,
      sessionsEndingWithKnownFailures: zero,
      changesAfterFinalVerification: zero,
      correctivePromptCount: zero,
      sessionsWithChangesButNoVerification: zero,
      narrowVerificationOnlySessions: zero,
      medianTimeToFirstEditMs: unk,
      medianTimeBetweenFinalEditAndVerificationMs: unk,
    },
    cost: { totalUsd: pvNull(null), byModel: [], methodology: "unknown" },
    completeness: {
      totalSessions: 1,
      complete: 1,
      partialTailMissing: 0,
      partialMetricsMissing: 0,
      partialPromptsMissing: 0,
    },
    completion: { total: 1, completed: 1, interrupted: 0, failed: 0, unknown: 0 },
    scanProvenance: { sourceId: "claude-code", importedSessions: 1, skippedSessions: 0 },
    security: { sensitivePathAccess: [], redactedSecretFindings: [] },
    recommendations: [],
    minimumRecommendationConfidence: 0.5 as Confidence,
  };
  return { ...base, ...overrides };
}

/** Build an analysis context with optional threshold overrides. */
function ctx(
  snapshot: AnalyticsSnapshot,
  thresholds: Record<string, unknown> = {},
): AnalysisContext {
  return { snapshot, filters: FILTERS, thresholds, generatedAt: NOW };
}

/** Run a rule and return its candidates. */
async function run(
  rule: RecommendationRule,
  snapshot: AnalyticsSnapshot,
  thresholds: Record<string, unknown> = {},
): Promise<RecommendationCandidate[]> {
  return rule.evaluate(ctx(snapshot, thresholds));
}

// ---------------------------------------------------------------------------
// Rule set integrity
// ---------------------------------------------------------------------------

describe("defaultRules (§13.10)", () => {
  it("exposes exactly 16 rules with stable ids + versions + categories", () => {
    const rules = defaultRules();
    expect(rules).toHaveLength(16);
    const ids = rules.map((r) => r.id);
    expect(ids).toEqual([
      "TOOLS-001",
      "TOOLS-002",
      "TOOLS-003",
      "TOOLS-004",
      "TOOLS-005",
      "TOOLS-006",
      "VERIFY-001",
      "VERIFY-002",
      "VERIFY-003",
      "VERIFY-004",
      "WORKFLOW-001",
      "WORKFLOW-002",
      "CONTEXT-001",
      "CONTEXT-002",
      "SECURITY-001",
      "SECURITY-002",
    ]);
    for (const r of rules) {
      expect(r.version).toBe(1);
      expect(r.category).toMatch(/tools|verification|workflow|context|security/);
      expect(typeof r.explain).toBe("function");
    }
  });

  it("RULE_METADATA matches the rule set one-to-one", () => {
    const ruleIds = defaultRules().map((r) => r.id);
    const metaIds = RULE_METADATA.map((m) => m.id);
    expect(metaIds).toEqual(ruleIds);
    for (const m of RULE_METADATA) {
      expect(m.defaultThresholds).toBeTypeOf("object");
    }
  });

  it("every rule emits at most one candidate (avoid flooding, §15.2)", async () => {
    // A snapshot that trips several rules at once still yields ≤1 per rule.
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [{ key: "k1", label: "a.ts", occurrences: 5, sessions: 1, kind: "read" }],
        repeatedCommands: [
          { key: "k2", label: "ls", occurrences: 5, sessions: 1, kind: "command" },
        ],
        repeatedFailedCommands: [
          { key: "k3", label: "make", occurrences: 3, sessions: 1, kind: "failed-command" },
        ],
        largestToolOutputsBytes: pvNull(300_000),
      },
    });
    for (const rule of defaultRules()) {
      const out = await rule.evaluate(ctx(snap));
      expect(out.length).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// TOOLS-001..006
// ---------------------------------------------------------------------------

describe("TOOLS-001 repeated unchanged file reads", () => {
  it("fires when a path is read ≥ threshold times", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [
          { key: "h1", label: "[REPO]/src/a.ts", occurrences: 4, sessions: 2, kind: "read" },
        ],
      },
    });
    const out = await run(tools001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-001");
    expect(out[0]?.severity).toBe("medium");
    expect(out[0]?.confidence).toBeGreaterThanOrEqual(0.5);
    expect(out[0]?.remediation?.automaticallyApplicable).toBe(false);
    expect(out[0]?.evidence[0]?.metrics?.find((m) => m.label === "occurrences")?.value).toBe(4);
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [{ key: "h1", label: "a.ts", occurrences: 2, sessions: 1, kind: "read" }],
      },
    });
    expect(await run(tools001(), snap)).toHaveLength(0);
  });

  it("respects a raised threshold override", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [{ key: "h1", label: "a.ts", occurrences: 4, sessions: 1, kind: "read" }],
      },
    });
    expect(await run(tools001(), snap, { minOccurrences: 5 })).toHaveLength(0);
  });
});

describe("TOOLS-002 repeated equivalent command", () => {
  it("fires when a command recurs ≥ threshold times", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedCommands: [
          { key: "k", label: "git status", occurrences: 3, sessions: 1, kind: "command" },
        ],
      },
    });
    const out = await run(tools002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-002");
    expect(out[0]?.severity).toBe("low");
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedCommands: [{ key: "k", label: "ls", occurrences: 2, sessions: 1, kind: "command" }],
      },
    });
    expect(await run(tools002(), snap)).toHaveLength(0);
  });
});

describe("TOOLS-003 repeated unchanged failure", () => {
  it("fires when a failed command recurs (threshold 2)", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedFailedCommands: [
          { key: "k", label: "npm test", occurrences: 2, sessions: 1, kind: "failed-command" },
        ],
      },
    });
    const out = await run(tools003(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-003");
    expect(out[0]?.severity).toBe("high");
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedFailedCommands: [
          { key: "k", label: "x", occurrences: 1, sessions: 1, kind: "failed-command" },
        ],
      },
    });
    expect(await run(tools003(), snap)).toHaveLength(0);
  });
});

describe("TOOLS-004 excessive broad test runs", () => {
  it("fires when broad runs ≥ 3 and changes are narrow", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, broadTestRunCount: pv(4) },
      workflow: { ...mkSnapshot().workflow, filesChangedPerSession: pvNull(1.5) },
    });
    const out = await run(tools004(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-004");
    expect(out[0]?.severity).toBe("low");
    expect(out[0]?.confidence).toBeLessThanOrEqual(0.55); // conservative
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, broadTestRunCount: pv(2) },
      workflow: { ...mkSnapshot().workflow, filesChangedPerSession: pvNull(1) },
    });
    expect(await run(tools004(), snap)).toHaveLength(0);
  });
});

describe("TOOLS-005 oversized tool result", () => {
  it("fires when the largest output exceeds the byte threshold", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, largestToolOutputsBytes: pvNull(250_000) },
    });
    const out = await run(tools005(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-005");
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, largestToolOutputsBytes: pvNull(50_000) },
    });
    expect(await run(tools005(), snap)).toHaveLength(0);
  });
});

describe("TOOLS-006 high exploration-to-change ratio", () => {
  it("fires when read/write ratio is high and few files change", async () => {
    const snap = mkSnapshot({
      workflow: {
        ...mkSnapshot().workflow,
        readToWriteRatio: pvNull(10),
        filesChangedPerSession: pvNull(1),
      },
    });
    const out = await run(tools006(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-006");
    expect(out[0]?.severity).toBe("low");
    expect(out[0]?.confidence).toBeLessThanOrEqual(0.6); // moderate
  });

  it("stays silent when ratio is low", async () => {
    const snap = mkSnapshot({
      workflow: {
        ...mkSnapshot().workflow,
        readToWriteRatio: pvNull(2),
        filesChangedPerSession: pvNull(1),
      },
    });
    expect(await run(tools006(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// VERIFY-001..004
// ---------------------------------------------------------------------------

describe("VERIFY-001 no verification after code changes", () => {
  it("fires when sessions changed code but ran no verification", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, sessionsWithChangesButNoVerification: pv(2) },
    });
    const out = await run(verify001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("VERIFY-001");
    expect(out[0]?.severity).toBe("high");
  });

  it("stays silent when every changed session was verified", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, sessionsWithChangesButNoVerification: pv(0) },
    });
    expect(await run(verify001(), snap)).toHaveLength(0);
  });
});

describe("VERIFY-002 changes after final successful verification", () => {
  it("fires when writes occurred after the last verification", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, changesAfterFinalVerification: pv(1) },
    });
    const out = await run(verify002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("VERIFY-002");
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent when there are none", async () => {
    expect(await run(verify002(), mkSnapshot())).toHaveLength(0);
  });
});

describe("VERIFY-003 session ended with failed verification", () => {
  it("fires when sessions ended with a known failure", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, sessionsEndingWithKnownFailures: pv(1) },
    });
    const out = await run(verify003(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("VERIFY-003");
    expect(out[0]?.severity).toBe("high");
  });

  it("stays silent when there are none", async () => {
    expect(await run(verify003(), mkSnapshot())).toHaveLength(0);
  });
});

describe("VERIFY-004 narrow verification only (conservative)", () => {
  it("fires for cross-cutting changes with one verification kind", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, narrowVerificationOnlySessions: pv(2) },
    });
    const out = await run(verify004(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("VERIFY-004");
    expect(out[0]?.severity).toBe("low");
    expect(out[0]?.confidence).toBeLessThanOrEqual(0.55); // conservative cap
  });

  it("stays silent when there are none", async () => {
    expect(await run(verify004(), mkSnapshot())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// WORKFLOW-001..002
// ---------------------------------------------------------------------------

describe("WORKFLOW-001 excessive corrective turns", () => {
  it("fires when corrective prompts cross the threshold", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, correctivePromptCount: pv(4) },
    });
    const out = await run(workflow001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("WORKFLOW-001");
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      workflow: { ...mkSnapshot().workflow, correctivePromptCount: pv(2) },
    });
    expect(await run(workflow001(), snap)).toHaveLength(0);
  });
});

describe("WORKFLOW-002 very long session with task switching", () => {
  it("fires when median duration and prompts both exceed thresholds", async () => {
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        medianSessionDurationMs: pvNull(4_000_000),
        promptsPerSession: pv(7),
      },
    });
    const out = await run(workflow002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("WORKFLOW-002");
    expect(out[0]?.severity).toBe("low");
    expect(out[0]?.confidence).toBe(0.45); // conservative, fixed
  });

  it("stays silent when duration is short", async () => {
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        medianSessionDurationMs: pvNull(600_000),
        promptsPerSession: pv(7),
      },
    });
    expect(await run(workflow002(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CONTEXT-001..002
// ---------------------------------------------------------------------------

describe("CONTEXT-001 frequent compaction", () => {
  it("fires when compactions cross the threshold", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, totalCompactions: pv(3) },
    });
    const out = await run(context001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("CONTEXT-001");
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, totalCompactions: pv(1) },
    });
    expect(await run(context001(), snap)).toHaveLength(0);
  });
});

describe("CONTEXT-002 large repeated outputs", () => {
  it("fires when a large output repeats", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        largestToolOutputsBytes: pvNull(150_000),
        repeatedCommands: [
          { key: "k", label: "cat big.log", occurrences: 2, sessions: 1, kind: "command" },
        ],
      },
    });
    const out = await run(context002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("CONTEXT-002");
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent when output is small", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        largestToolOutputsBytes: pvNull(10_000),
        repeatedCommands: [{ key: "k", label: "x", occurrences: 2, sessions: 1, kind: "command" }],
      },
    });
    expect(await run(context002(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SECURITY-001..002
// ---------------------------------------------------------------------------

describe("SECURITY-001 sensitive path access", () => {
  it("fires when a sensitive path is accessed", async () => {
    const snap = mkSnapshot({
      security: {
        sensitivePathAccess: [
          {
            pathHash: "h",
            redactedPath: "[REPO]/.env",
            category: "env-file",
            operations: 2,
            sessions: 1,
            operationsSeen: ["read"],
          },
        ],
        redactedSecretFindings: [],
      },
    });
    const out = await run(security001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("SECURITY-001");
    expect(out[0]?.severity).toBe("high");
    // The redacted path appears in evidence, but never a secret value.
    expect(out[0]?.summary).toContain(".env");
  });

  it("stays silent when no sensitive paths were accessed", async () => {
    expect(await run(security001(), mkSnapshot())).toHaveLength(0);
  });
});

describe("SECURITY-002 potential secret in persisted content", () => {
  it("fires when redaction scrubbed a secret, surfacing only the label", async () => {
    const snap = mkSnapshot({
      security: {
        sensitivePathAccess: [],
        redactedSecretFindings: [
          { category: "api-key", label: "github-token", count: 1, sessions: 1 },
        ],
      },
    });
    const out = await run(security002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("SECURITY-002");
    expect(out[0]?.severity).toBe("critical");
    // Only the detector label/category is surfaced, never the secret value.
    expect(out[0]?.summary).toContain("github-token");
    expect(out[0]?.summary).not.toContain("ghp_");
  });

  it("stays silent when there are no redacted-secret findings", async () => {
    expect(await run(security002(), mkSnapshot())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism (§15.1)", () => {
  it("the same snapshot + thresholds produce identical candidates twice", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [{ key: "h1", label: "a.ts", occurrences: 5, sessions: 2, kind: "read" }],
      },
    });
    const a = await run(tools001(), snap);
    const b = await run(tools001(), snap);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
