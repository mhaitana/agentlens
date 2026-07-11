/**
 * Dashboard smoke test (spec §13.9, §3.4). Renders the app against a mocked
 * fetch and asserts the overview surfaces the mandatory cost-estimate caveat
 * and provenance tags — i.e. honest-metrics labelling reaches the DOM.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";

/** Minimal ProvenancedValue. */
const pv = <T,>(value: T, provenance = "exact") => ({ value, provenance });

function mockSnapshot() {
  return {
    generatedAt: "2026-07-10T00:00:00.000Z",
    filters: { period: "week" },
    privacyMode: "redacted-content",
    usage: {
      totalSessions: pv(3),
      sessionsPerDay: pv(0.4),
      sessionsPerWeek: pv(3),
      sessionsPerMonth: pv(12),
      activeDays: pv(2),
      medianSessionDurationMs: pv(3_600_000),
      meanSessionDurationMs: pv(3_600_000),
      totalDurationMs: pv(10_800_000),
      promptsPerSession: pv(4),
      toolCallsPerSession: pv(6),
      toolSuccessRate: pv(0.9),
      totalTokens: pv(12_000),
      inputTokens: pv(10_000),
      outputTokens: pv(2_000),
      cacheReadTokens: pv(0),
      cacheCreationTokens: pv(0),
      totalCompactions: pv(0),
      totalSubagentSessions: pv(0),
      estimatedCostUsd: pv(0.42, "estimated"),
      modelUsage: [
        {
          modelId: "claude-sonnet-5",
          sessions: 3,
          modelRequests: 10,
          inputTokens: 10000,
          outputTokens: 2000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          estimatedCostUsd: 0.42,
        },
      ],
    },
    tools: {
      mostUsedTools: [
        { toolName: "Read", calls: 8, failures: 1, failureRate: 0.125, averageDurationMs: 100 },
      ],
      toolFailureRate: pv(0.1),
      averageToolDurationMs: pv(150),
      repeatedReads: [],
      repeatedSearches: [],
      repeatedCommands: [],
      repeatedFailedCommands: [],
      largestToolInputsBytes: pv(2048),
      largestToolOutputsBytes: pv(4096),
      testCommandFrequency: pv(2),
      buildCommandFrequency: pv(1),
      broadTestRunCount: pv(1),
    },
    workflow: {
      filesChangedPerSession: pv(3),
      readToWriteRatio: pv(2.5),
      totalVerificationRuns: pv(2),
      sessionsEndingAfterSuccessfulVerification: pv(2),
      sessionsEndingWithKnownFailures: pv(0),
      changesAfterFinalVerification: pv(0),
      correctivePromptCount: pv(0),
      medianTimeToFirstEditMs: pv(60_000),
      medianTimeBetweenFinalEditAndVerificationMs: pv(30_000),
      sessionsWithChangesButNoVerification: pv(1),
      narrowVerificationOnlySessions: pv(0),
    },
    cost: {
      totalUsd: pv(0.42, "estimated"),
      byModel: [{ modelId: "claude-sonnet-5", usd: 0.42, provenance: "estimated" }],
      methodology: "registry",
    },
    completeness: {
      totalSessions: 3,
      complete: 2,
      partialTailMissing: 1,
      partialMetricsMissing: 0,
      partialPromptsMissing: 0,
    },
    completion: { total: 3, completed: 2, interrupted: 1, failed: 0, unknown: 0 },
    scanProvenance: { sourceId: "claude-code", importedSessions: 3, skippedSessions: 0 },
    security: { sensitivePathAccess: [], redactedSecretFindings: [] },
    recommendations: [
      {
        id: "rec:1",
        ruleId: "TOOLS-001",
        ruleVersion: 1,
        sessionId: "s1",
        projectId: "p1",
        category: "tools",
        severity: "medium",
        confidence: 0.74,
        status: "active",
        title: "Repeated unchanged file reads",
        summary: "src/big.ts read 3 times",
        explanation: "Re-reading suggests contents were not retained.",
        evidence: [],
        createdAt: "2026-07-09T10:05:00.000Z",
        updatedAt: "2026-07-09T10:05:00.000Z",
      },
    ],
    minimumRecommendationConfidence: 0.5,
  };
}

function mockFetch(url: string): Promise<Response> {
  const headers = { "content-type": "application/json" };
  let body: unknown;
  if (url.endsWith("/status"))
    body = {
      home: "/tmp/agentlens",
      configPath: "/c",
      dbPath: "/d",
      privacyMode: "redacted-content",
      sessions: 3,
      projects: 1,
      recommendations: 1,
    };
  else if (url.endsWith("/onboarding"))
    body = {
      initialized: true,
      hasData: true,
      privacyMode: "redacted-content",
      sources: [
        { id: "claude-code", adapter: "claude-code", displayName: "Claude Code", enabled: true },
      ],
      projectsCount: 1,
      sessionsCount: 3,
      exclusions: [],
      whatAgentLensReads: ["Claude Code transcript JSONL files"],
      whereDataRemains: "/tmp/agentlens",
    };
  else if (url.startsWith("/api/v1/metrics")) body = mockSnapshot();
  else if (url.startsWith("/api/v1/projects"))
    body = { items: [], total: 0, page: 1, limit: 200, hasMore: false };
  else body = {};
  return Promise.resolve({
    ok: true,
    status: 200,
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

describe("AgentLens dashboard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => mockFetch(input)),
    );
    window.location.hash = "#/overview";
  });

  it("renders the overview with the cost-estimate caveat and provenance tags", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Overview" })).toBeTruthy(),
    );
    // The mandatory honest-metrics caveat appears at least once.
    expect(screen.getAllByText(/Estimated — not an official billing value/).length).toBeGreaterThan(
      0,
    );
    // Provenance tags are rendered.
    expect(screen.getAllByText(/\bexact\b/).length).toBeGreaterThan(0);
    // The estimated cost stat value.
    expect(screen.getByText("$0.42")).toBeTruthy();
  });

  it("navigates to the sessions screen", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Overview" })).toBeTruthy(),
    );
    screen.getByRole("button", { name: "Sessions" }).click();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Sessions" })).toBeTruthy(),
    );
  });
});
