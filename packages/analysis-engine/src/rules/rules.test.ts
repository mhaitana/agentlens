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
  ModelCatalogue,
  ModelUsageRow,
  RecommendationCandidate,
  RecommendationRule,
  ReportFilters,
} from "@agentlens/domain";
import { defaultConfigurationSummary } from "@agentlens/domain";
import {
  context001,
  context002,
  context003,
  context004,
  prompt001,
  prompt002,
  prompt003,
  prompt004,
  prompt005,
  model001,
  model002,
  model003,
  security001,
  security002,
  config001,
  config002,
  tools001,
  tools002,
  tools003,
  tools004,
  tools005,
  tools006,
  tools007,
  tools008,
  verify001,
  verify002,
  verify003,
  verify004,
  verify005,
  verify006,
  workflow001,
  workflow002,
  workflow003,
  workflow004,
} from "./index.js";
import { defaultRules, RULE_METADATA } from "./index.js";
import { DEFAULT_MODEL_CATALOGUE, buildModelCatalogue } from "../model-catalogue.js";
import type { ModelCatalogueEntry } from "@agentlens/domain";

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
    prompt: {
      totalPrompts: pv(0),
      medianLength: pvNull(0),
      beginsNewTaskCount: zero,
      referencesAcceptanceCriteriaCount: zero,
      requestsVerificationCount: zero,
      multipleIndependentTasksCount: zero,
      vagueReferenceCount: zero,
      missingFileReferenceCount: zero,
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
    configuration: defaultConfigurationSummary(),
    recommendations: [],
    minimumRecommendationConfidence: 0.5 as Confidence,
  };
  return { ...base, ...overrides };
}

/** Build an analysis context with optional threshold overrides. */
function ctx(
  snapshot: AnalyticsSnapshot,
  thresholds: Record<string, unknown> = {},
  modelCatalogue?: ModelCatalogue,
): AnalysisContext {
  return { snapshot, filters: FILTERS, thresholds, generatedAt: NOW, modelCatalogue };
}

/** Run a rule and return its candidates. */
async function run(
  rule: RecommendationRule,
  snapshot: AnalyticsSnapshot,
  thresholds: Record<string, unknown> = {},
  modelCatalogue?: ModelCatalogue,
): Promise<RecommendationCandidate[]> {
  return rule.evaluate(ctx(snapshot, thresholds, modelCatalogue));
}

// ---------------------------------------------------------------------------
// Rule set integrity
// ---------------------------------------------------------------------------

describe("defaultRules (§13.10)", () => {
  it("exposes exactly 34 rules with stable ids + versions + categories", () => {
    const rules = defaultRules();
    expect(rules).toHaveLength(34);
    const ids = rules.map((r) => r.id);
    expect(ids).toEqual([
      "TOOLS-001",
      "TOOLS-002",
      "TOOLS-003",
      "TOOLS-004",
      "TOOLS-005",
      "TOOLS-006",
      "TOOLS-007",
      "TOOLS-008",
      "VERIFY-001",
      "VERIFY-002",
      "VERIFY-003",
      "VERIFY-004",
      "VERIFY-005",
      "VERIFY-006",
      "WORKFLOW-001",
      "WORKFLOW-002",
      "WORKFLOW-003",
      "WORKFLOW-004",
      "CONTEXT-001",
      "CONTEXT-002",
      "CONTEXT-003",
      "CONTEXT-004",
      "PROMPT-001",
      "PROMPT-002",
      "PROMPT-003",
      "PROMPT-004",
      "PROMPT-005",
      "MODEL-001",
      "MODEL-002",
      "MODEL-003",
      "SECURITY-001",
      "SECURITY-002",
      "CONFIG-001",
      "CONFIG-002",
    ]);
    for (const r of rules) {
      expect(r.version).toBe(1);
      expect(r.category).toMatch(
        /tools|verification|workflow|context|prompt|model|security|configuration/,
      );
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

// ---------------------------------------------------------------------------
// CONTEXT-003..004 (§15.4 context efficiency)
// ---------------------------------------------------------------------------

describe("CONTEXT-003 excessive stale context", () => {
  it("fires when cache-read share + compactions cross thresholds", async () => {
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        cacheReadTokens: pv(6000),
        inputTokens: pv(3000),
        totalCompactions: pv(2),
      },
    });
    const out = await run(context003(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("CONTEXT-003");
    expect(out[0]?.remediation?.automaticallyApplicable).toBe(false);
  });

  it("stays silent without compaction", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, cacheReadTokens: pv(6000), inputTokens: pv(3000) },
    });
    expect(await run(context003(), snap)).toHaveLength(0);
  });
});

describe("CONTEXT-004 verbose exploration", () => {
  it("fires when repeated reads/searches are high but few files changed", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [
          { key: "h1", label: "a.ts", occurrences: 8, sessions: 1, kind: "read" },
          { key: "h2", label: "b.ts", occurrences: 6, sessions: 1, kind: "read" },
        ],
      },
      workflow: { ...mkSnapshot().workflow, filesChangedPerSession: pvNull(1) },
    });
    const out = await run(context004(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("CONTEXT-004");
  });

  it("stays silent when many files changed (exploration justified)", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedReads: [{ key: "h1", label: "a.ts", occurrences: 20, sessions: 1, kind: "read" }],
      },
      workflow: { ...mkSnapshot().workflow, filesChangedPerSession: pvNull(10) },
    });
    expect(await run(context004(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PROMPT-001..005 (§15.4 prompt effectiveness)
// ---------------------------------------------------------------------------

describe("PROMPT-001 missing acceptance criteria", () => {
  it("fires when most prompts lack criteria", async () => {
    const snap = mkSnapshot({
      prompt: {
        ...mkSnapshot().prompt,
        totalPrompts: pv(10),
        referencesAcceptanceCriteriaCount: pv(1),
      },
    });
    const out = await run(prompt001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("medium");
    expect(
      out[0]?.evidence[0]?.metrics?.find((m) => m.label === "missingCriteriaPrompts")?.value,
    ).toBe(9);
  });

  it("stays silent below the prompt-volume threshold", async () => {
    const snap = mkSnapshot({ prompt: { ...mkSnapshot().prompt, totalPrompts: pv(2) } });
    expect(await run(prompt001(), snap)).toHaveLength(0);
  });
});

describe("PROMPT-002 missing verification request", () => {
  it("fires when few prompts request verification", async () => {
    const snap = mkSnapshot({
      prompt: {
        ...mkSnapshot().prompt,
        totalPrompts: pv(8),
        requestsVerificationCount: pv(1),
      },
    });
    const out = await run(prompt002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("PROMPT-002");
  });
});

describe("PROMPT-003 multiple independent tasks", () => {
  it("fires when enough prompts bundle tasks", async () => {
    const snap = mkSnapshot({
      prompt: {
        ...mkSnapshot().prompt,
        totalPrompts: pv(10),
        multipleIndependentTasksCount: pv(5),
      },
    });
    const out = await run(prompt003(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("PROMPT-003");
  });

  it("stays silent below the share threshold", async () => {
    const snap = mkSnapshot({
      prompt: {
        ...mkSnapshot().prompt,
        totalPrompts: pv(20),
        multipleIndependentTasksCount: pv(3),
      },
    });
    expect(await run(prompt003(), snap)).toHaveLength(0);
  });
});

describe("PROMPT-004 vague references", () => {
  it("fires when vague-reference density is high", async () => {
    const snap = mkSnapshot({
      prompt: {
        ...mkSnapshot().prompt,
        totalPrompts: pv(6),
        vagueReferenceCount: pv(6),
      },
    });
    const out = await run(prompt004(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("PROMPT-004");
  });
});

describe("PROMPT-005 repeated user corrections", () => {
  it("fires when corrective share is high", async () => {
    const snap = mkSnapshot({
      prompt: { ...mkSnapshot().prompt, totalPrompts: pv(10) },
      workflow: { ...mkSnapshot().workflow, correctivePromptCount: pv(4) },
    });
    const out = await run(prompt005(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent with few corrections", async () => {
    const snap = mkSnapshot({
      prompt: { ...mkSnapshot().prompt, totalPrompts: pv(10) },
      workflow: { ...mkSnapshot().workflow, correctivePromptCount: pv(1) },
    });
    expect(await run(prompt005(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MODEL-001..003 (§15.4 model selection, configurable catalogue)
// ---------------------------------------------------------------------------

/** A model-usage row. */
function mu(modelId: string, modelRequests: number): ModelUsageRow {
  return {
    modelId,
    sessions: 1,
    modelRequests,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: null,
  };
}

describe("MODEL-001 high-cost model on light work", () => {
  it("fires when a premium-tier model dominates low-activity work", async () => {
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        modelUsage: [mu("claude-opus-4-8", 5), mu("claude-haiku-4-5", 1)],
        toolCallsPerSession: pv(3),
      },
    });
    const out = await run(model001(), snap, {}, DEFAULT_MODEL_CATALOGUE);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("MODEL-001");
    expect(out[0]?.evidence[0]?.metrics?.find((m) => m.label === "costTier")?.value).toBe(4);
  });

  it("stays silent when work is heavy (justifies premium tier)", async () => {
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        modelUsage: [mu("claude-opus-4-8", 5)],
        toolCallsPerSession: pv(20),
      },
    });
    expect(await run(model001(), snap, {}, DEFAULT_MODEL_CATALOGUE)).toHaveLength(0);
  });

  it("stays silent for an unknown model (no tier guessing, §3.4)", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, modelUsage: [mu("some-unknown-model", 5)] },
    });
    expect(await run(model001(), snap, {}, DEFAULT_MODEL_CATALOGUE)).toHaveLength(0);
  });
});

describe("MODEL-002 lower-capability model struggling", () => {
  it("fires when a low-capability tier has a high failure rate", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, modelUsage: [mu("claude-haiku-4-5", 6)] },
      tools: { ...mkSnapshot().tools, toolFailureRate: pv(0.4) },
    });
    const out = await run(model002(), snap, {}, DEFAULT_MODEL_CATALOGUE);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("MODEL-002");
  });
});

describe("MODEL-003 stale context to a premium model", () => {
  it("fires when a premium tier gets mostly cached input", async () => {
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        modelUsage: [mu("claude-opus-4-8", 5)],
        cacheReadTokens: pv(6000),
        inputTokens: pv(3000),
      },
    });
    const out = await run(model003(), snap, {}, DEFAULT_MODEL_CATALOGUE);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("MODEL-003");
  });
});

describe("model catalogue is configurable (§15.4)", () => {
  it("a user override reclassifies a model and changes whether MODEL-001 fires", async () => {
    // Override: mark opus as cost tier 1 (cheap). MODEL-001 should now stay silent.
    const override: ModelCatalogueEntry = {
      id: "claude-opus-4-8",
      matchPatterns: ["claude-opus-4-8"],
      provider: "anthropic",
      capabilityTier: 5,
      costTier: 1,
      contextClass: "large",
      recommendedTaskClasses: ["complex"],
    };
    const catalogue = buildModelCatalogue([override]);
    const snap = mkSnapshot({
      usage: {
        ...mkSnapshot().usage,
        modelUsage: [mu("claude-opus-4-8", 5)],
        toolCallsPerSession: pv(3),
      },
    });
    expect(await run(model001(), snap, {}, catalogue)).toHaveLength(0);
    // Without the override (bundled default, cost tier 4) it fires.
    expect(await run(model001(), snap, {}, DEFAULT_MODEL_CATALOGUE)).toHaveLength(1);
  });

  it("resolveCatalogueEntry matches dated snapshots via prefix", async () => {
    const { resolveCatalogueEntry } = await import("../model-catalogue.js");
    const entry = resolveCatalogueEntry("claude-sonnet-5-20251001", DEFAULT_MODEL_CATALOGUE);
    expect(entry?.id).toBe("claude-sonnet-5");
    expect(resolveCatalogueEntry("totally-unknown", DEFAULT_MODEL_CATALOGUE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TOOLS-007..008 (§15.4 tool efficiency)
// ---------------------------------------------------------------------------

describe("TOOLS-007 repeated unchanged searches", () => {
  it("fires when a search recurs ≥ threshold times", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedSearches: [
          { key: "s1", label: "Grep", occurrences: 4, sessions: 2, kind: "search" },
        ],
      },
    });
    const out = await run(tools007(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-007");
    expect(out[0]?.remediation?.automaticallyApplicable).toBe(false);
  });

  it("stays silent below the threshold", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        repeatedSearches: [
          { key: "s1", label: "Grep", occurrences: 2, sessions: 1, kind: "search" },
        ],
      },
    });
    expect(await run(tools007(), snap)).toHaveLength(0);
  });
});

describe("TOOLS-008 repeatedly failing tool", () => {
  it("fires when a tool has a high failure rate and enough failures", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        mostUsedTools: [
          {
            toolName: "mcp__github",
            calls: 6,
            failures: 5,
            failureRate: 5 / 6,
            averageDurationMs: null,
          },
        ],
      },
    });
    const out = await run(tools008(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("TOOLS-008");
    expect(out[0]?.severity).toBe("medium");
  });

  it("stays silent when failures are below the rate floor", async () => {
    const snap = mkSnapshot({
      tools: {
        ...mkSnapshot().tools,
        mostUsedTools: [
          { toolName: "Read", calls: 10, failures: 2, failureRate: 0.2, averageDurationMs: null },
        ],
      },
    });
    expect(await run(tools008(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// WORKFLOW-003..004 (§15.4 workflow quality)
// ---------------------------------------------------------------------------

describe("WORKFLOW-003 large changes without verification", () => {
  it("fires for large changesets with unverified sessions", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, totalSessions: pv(4) },
      workflow: {
        ...mkSnapshot().workflow,
        filesChangedPerSession: pvNull(6),
        sessionsWithChangesButNoVerification: pv(3),
      },
    });
    const out = await run(workflow003(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("WORKFLOW-003");
  });

  it("stays silent when changesets are small", async () => {
    const snap = mkSnapshot({
      workflow: {
        ...mkSnapshot().workflow,
        filesChangedPerSession: pvNull(2),
        sessionsWithChangesButNoVerification: pv(3),
      },
    });
    expect(await run(workflow003(), snap)).toHaveLength(0);
  });
});

describe("WORKFLOW-004 repeated manual validation suitable for a hook", () => {
  it("fires when verification commands are run very frequently", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, totalSessions: pv(5) },
      tools: {
        ...mkSnapshot().tools,
        testCommandFrequency: pv(10),
        buildCommandFrequency: pv(2),
      },
    });
    const out = await run(workflow004(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("WORKFLOW-004");
  });

  it("stays silent when validation runs are infrequent", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, totalSessions: pv(2) },
      tools: { ...mkSnapshot().tools, testCommandFrequency: pv(3), buildCommandFrequency: pv(0) },
    });
    expect(await run(workflow004(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// VERIFY-005..006 (§15.4 verification quality)
// ---------------------------------------------------------------------------

describe("VERIFY-005 no test runs despite code changes", () => {
  it("fires when no tests ran and sessions changed code unverified", async () => {
    const snap = mkSnapshot({
      usage: { ...mkSnapshot().usage, totalSessions: pv(3) },
      tools: { ...mkSnapshot().tools, testCommandFrequency: pv(0) },
      workflow: {
        ...mkSnapshot().workflow,
        sessionsWithChangesButNoVerification: pv(2),
      },
    });
    const out = await run(verify005(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("VERIFY-005");
    expect(out[0]?.severity).toBe("high");
  });

  it("stays silent when tests did run", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, testCommandFrequency: pv(2) },
      workflow: {
        ...mkSnapshot().workflow,
        sessionsWithChangesButNoVerification: pv(2),
      },
    });
    expect(await run(verify005(), snap)).toHaveLength(0);
  });
});

describe("VERIFY-006 no build verification despite changes", () => {
  it("fires when no build ran and changesets are substantial", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, buildCommandFrequency: pv(0) },
      workflow: {
        ...mkSnapshot().workflow,
        filesChangedPerSession: pvNull(5),
        sessionsWithChangesButNoVerification: pv(2),
      },
    });
    const out = await run(verify006(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("VERIFY-006");
  });

  it("stays silent when changesets are small", async () => {
    const snap = mkSnapshot({
      tools: { ...mkSnapshot().tools, buildCommandFrequency: pv(0) },
      workflow: {
        ...mkSnapshot().workflow,
        filesChangedPerSession: pvNull(1),
        sessionsWithChangesButNoVerification: pv(2),
      },
    });
    expect(await run(verify006(), snap)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CONFIG-001..002 (§15.4 security and configuration)
// ---------------------------------------------------------------------------

describe("CONFIG-001 overly broad retention or exclusions", () => {
  it("fires for full-local mode", async () => {
    const snap = mkSnapshot({
      configuration: { ...defaultConfigurationSummary(), privacyMode: "full-local" },
    });
    const out = await run(config001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("CONFIG-001");
    expect(out[0]?.severity).toBe("high");
  });

  it("fires for long retention", async () => {
    const snap = mkSnapshot({
      configuration: { ...defaultConfigurationSummary(), retentionDays: 400 },
    });
    const out = await run(config001(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("medium");
  });

  it("fires for broad exclusions", async () => {
    const snap = mkSnapshot({
      configuration: {
        ...defaultConfigurationSummary(),
        excludedProjectCount: 6,
        broadExclusions: false,
      },
    });
    expect((await run(config001(), snap)).length).toBe(1);
  });

  it("stays silent on a tight, safe config", async () => {
    expect(await run(config001(), mkSnapshot())).toHaveLength(0);
  });
});

describe("CONFIG-002 local-first boundary weakened", () => {
  it("fires when the dashboard binds beyond loopback", async () => {
    const snap = mkSnapshot({
      configuration: {
        ...defaultConfigurationSummary(),
        dashboardHost: "0.0.0.0",
        bindsBeyondLoopback: true,
      },
    });
    const out = await run(config002(), snap);
    expect(out).toHaveLength(1);
    expect(out[0]?.ruleId).toBe("CONFIG-002");
    expect(out[0]?.severity).toBe("high");
  });

  it("fires when external analysis is enabled with an external provider", async () => {
    const snap = mkSnapshot({
      configuration: {
        ...defaultConfigurationSummary(),
        externalAnalysisEnabled: true,
        externalAnalysisProvider: "openai-compatible",
        externalAnalysisExternal: true,
      },
    });
    expect((await run(config002(), snap)).length).toBe(1);
  });

  it("stays silent on a loopback, local-only config", async () => {
    expect(await run(config002(), mkSnapshot())).toHaveLength(0);
  });
});
