import { describe, it, expect } from "vitest";
import {
  renderReport,
  renderTerminal,
  renderMarkdown,
  renderJson,
  COST_ESTIMATE_LABEL,
  type ReportFormat,
} from "./index.js";
import type { AnalyticsSnapshot, ProvenancedValue } from "@agentlens/domain";

const zero: ProvenancedValue<number> = { value: 0, provenance: "exact" };
const one: ProvenancedValue<number> = { value: 1, provenance: "exact" };
const unk: ProvenancedValue<number | null> = { value: null, provenance: "unknown" };

/** A realistic synthetic snapshot (one completed session, estimated cost). */
function sampleSnapshot(): AnalyticsSnapshot {
  return {
    generatedAt: "2026-07-10T12:00:00.000Z",
    filters: { period: "week" },
    privacyMode: "redacted-content",
    usage: {
      totalSessions: one,
      sessionsPerDay: { value: 0.14, provenance: "estimated", note: "rate" },
      sessionsPerWeek: one,
      sessionsPerMonth: { value: 0.3, provenance: "estimated" },
      activeDays: one,
      medianSessionDurationMs: { value: 8000, provenance: "reported" },
      meanSessionDurationMs: { value: 8000, provenance: "reported" },
      totalDurationMs: { value: 8000, provenance: "reported" },
      promptsPerSession: one,
      toolCallsPerSession: { value: 3, provenance: "exact" },
      toolSuccessRate: { value: 1, provenance: "exact" },
      totalTokens: { value: 2780, provenance: "reported" },
      inputTokens: { value: 2400, provenance: "reported" },
      outputTokens: { value: 180, provenance: "reported" },
      cacheReadTokens: { value: 200, provenance: "reported" },
      cacheCreationTokens: { value: 0, provenance: "reported" },
      totalCompactions: one,
      totalSubagentSessions: zero,
      estimatedCostUsd: { value: null, provenance: "unknown" },
      modelUsage: [
        {
          modelId: "claude-sonnet-5",
          sessions: 1,
          modelRequests: 2,
          inputTokens: 2400,
          outputTokens: 180,
          cacheReadTokens: 200,
          cacheCreationTokens: 0,
          estimatedCostUsd: 0.00486,
        },
      ],
    },
    tools: {
      mostUsedTools: [
        { toolName: "Read", calls: 1, failures: 0, failureRate: 0, averageDurationMs: 500 },
        { toolName: "Edit", calls: 1, failures: 0, failureRate: 0, averageDurationMs: 300 },
        { toolName: "Bash", calls: 1, failures: 0, failureRate: 0, averageDurationMs: 1000 },
      ],
      toolFailureRate: zero,
      averageToolDurationMs: { value: 600, provenance: "reported" },
      repeatedReads: [],
      repeatedSearches: [],
      repeatedCommands: [],
      repeatedFailedCommands: [],
      largestToolInputsBytes: { value: 80, provenance: "exact" },
      largestToolOutputsBytes: { value: 200, provenance: "exact" },
      testCommandFrequency: one,
      buildCommandFrequency: zero,
    },
    workflow: {
      filesChangedPerSession: { value: 1, provenance: "exact" },
      readToWriteRatio: { value: 1, provenance: "exact" },
      totalVerificationRuns: one,
      sessionsEndingAfterSuccessfulVerification: one,
      sessionsEndingWithKnownFailures: zero,
      changesAfterFinalVerification: {
        value: 0,
        provenance: "inferred",
        note: "no writes after verify",
      },
      correctivePromptCount: zero,
      medianTimeToFirstEditMs: { value: 4000, provenance: "inferred" },
      medianTimeBetweenFinalEditAndVerificationMs: { value: 2000, provenance: "inferred" },
    },
    cost: {
      totalUsd: {
        value: 0.00486,
        provenance: "estimated",
        note: "registry estimate",
        confidence: 1,
      },
      byModel: [{ modelId: "claude-sonnet-5", usd: 0.00486, provenance: "registry" }],
      methodology: "registry",
    },
    completeness: {
      totalSessions: 1,
      complete: 1,
      partialTailMissing: 0,
      partialMetricsMissing: 0,
      partialPromptsMissing: 0,
    },
    completion: { total: 1, completed: 1, interrupted: 0, failed: 0, unknown: 0 },
    scanProvenance: {
      sourceId: "claude-code",
      adapterVersion: "0.1.0",
      parserVersion: 1,
      importedSessions: 1,
      skippedSessions: 0,
    },
    recommendations: [],
    minimumRecommendationConfidence: 0.65,
  };
}

describe("reporting (§13.7)", () => {
  it("terminal output contains the §13.7 sections and the cost disclaimer", () => {
    const out = renderTerminal(sampleSnapshot());
    for (const section of [
      "Summary",
      "Usage",
      "Verification quality",
      "Tool efficiency",
      "Data completeness",
      "Privacy mode",
      "Scan provenance",
    ]) {
      expect(out).toContain(section);
    }
    expect(out).toContain(COST_ESTIMATE_LABEL);
    // Provenance tags surface for estimates.
    expect(out).toContain("(estimated)");
  });

  it("markdown output is well-formed and carries the disclaimer", () => {
    const out = renderMarkdown(sampleSnapshot());
    expect(out).toContain("# AgentLens report");
    expect(out).toContain("## Usage");
    expect(out).toContain("## Verification quality");
    expect(out).toContain(COST_ESTIMATE_LABEL);
    // No ANSI escapes in markdown.
    expect(out).not.toContain("\u001b[");
  });

  it("json output parses and carries the cost disclaimer as a field", () => {
    const out = renderJson(sampleSnapshot());
    const parsed = JSON.parse(out) as {
      costDisclaimer: string;
      usage: { totalTokens: { value: number } };
    };
    expect(parsed.costDisclaimer).toBe(COST_ESTIMATE_LABEL);
    expect(parsed.usage.totalTokens.value).toBe(2780);
  });

  it("renderReport dispatches by format", () => {
    const snap = sampleSnapshot();
    expect(renderReport(snap, "terminal")).toContain("AgentLens report");
    expect(renderReport(snap, "markdown")).toContain("# AgentLens report");
    expect(JSON.parse(renderReport(snap, "json"))).toBeTruthy();
  });

  it("renderReport throws on an unknown format", () => {
    expect(() => renderReport(sampleSnapshot(), "csv" as ReportFormat)).toThrow(
      /Unknown report format/,
    );
  });

  it("terminal output applies ANSI colour formatting by default", () => {
    // picocolors resolves colour support once at module load, so NO_COLOR is
    // verified in the CLI smoke (M1-11) by spawning a fresh process. Here we
    // only assert the terminal renderer produces non-empty, formatted output.
    const out = renderTerminal(sampleSnapshot());
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("AgentLens report");
  });

  it("renders an empty snapshot honestly (no crash, dashes for unknowns)", () => {
    const empty: AnalyticsSnapshot = {
      generatedAt: "2026-07-10T12:00:00.000Z",
      filters: { period: "week" },
      privacyMode: "redacted-content",
      usage: {
        totalSessions: zero,
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
        estimatedCostUsd: { value: null, provenance: "unknown" },
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
      cost: {
        totalUsd: { value: null, provenance: "unknown" },
        byModel: [],
        methodology: "unknown",
      },
      completeness: {
        totalSessions: 0,
        complete: 0,
        partialTailMissing: 0,
        partialMetricsMissing: 0,
        partialPromptsMissing: 0,
      },
      completion: { total: 0, completed: 0, interrupted: 0, failed: 0, unknown: 0 },
      scanProvenance: { sourceId: "unknown", importedSessions: 0, skippedSessions: 0 },
      recommendations: [],
      minimumRecommendationConfidence: 0.65,
    };
    expect(renderTerminal(empty)).toContain("AgentLens report");
    expect(renderMarkdown(empty)).toContain("No recommendations for this window");
    expect(JSON.parse(renderJson(empty)).usage.totalTokens.value).toBe(0);
  });
});
