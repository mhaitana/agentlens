/**
 * Session-detail timeline test (spec §13.9, §13.11 "Session timelines work").
 * Mocks the events endpoint and asserts the merged timeline renders all
 * privacy-gated event kinds — and that in metadata-only mode content is
 * absent (the API strips it; the dashboard renders only what it receives).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { SessionDetail } from "./SessionDetail.js";

function renderWithClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

function ev(
  kind: string,
  data: Record<string, unknown>,
  timestamp = "2026-07-09T10:00:10.000Z",
  sequence = 1,
) {
  return { timestamp, kind, sequence, data };
}

function res(body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, text: () => Promise.resolve(text) } as unknown as Response;
}

function fullEvents() {
  return [
    ev("prompt", {
      redactedContent: "Fix the login bug",
      characterCount: 17,
      approximateTokenCount: 4,
    }),
    ev("model_request", { modelId: "claude-sonnet-5", inputTokens: 1000, outputTokens: 40 }),
    ev("tool_call", {
      toolName: "Read",
      sanitisedInput: '{"file_path":"src/auth.ts"}',
      success: true,
      durationMs: 100,
    }),
    ev("tool_call", {
      toolName: "Bash",
      sanitisedInput: null,
      success: false,
      failureType: "command_failed",
      durationMs: 200,
    }),
    ev("file_activity", { operation: "write", redactedPath: "[REPO]/src/auth.ts", success: true }),
    ev("command_run", { redactedCommand: "pnpm test", family: "test", exitSuccess: true }),
    ev("verification_run", { kind: "tests", success: true, codeChangedAfter: false }),
    ev("compaction", {
      trigger: "auto",
      success: true,
      approximatePreCompactionTokens: 50000,
      approximatePostCompactionTokens: 8000,
    }),
  ];
}

function strippedEvents() {
  return [
    ev("prompt", { redactedContent: null, characterCount: 17, approximateTokenCount: 4 }),
    ev("command_run", { redactedCommand: null, family: "test", exitSuccess: true }),
  ];
}

function makeMock(events: () => ReturnType<typeof fullEvents>) {
  return vi.fn((url: string) => {
    if (url.endsWith("/sessions/sess-1"))
      return Promise.resolve(
        res({
          session: {
            id: "sess-1",
            completionStatus: "completed",
            startedAt: "2026-07-09T10:00:00.000Z",
            endedAt: "2026-07-09T11:00:00.000Z",
            durationMs: 3_600_000,
            modelId: "claude-sonnet-5",
            projectId: "proj-1",
          },
          project: { id: "proj-1", displayName: "agentlens-demo" },
        }),
      );
    if (url.endsWith("/sessions/sess-1/recommendations")) return Promise.resolve(res([]));
    if (url.endsWith("/sessions/sess-1/events")) return Promise.resolve(res(events()));
    return Promise.resolve(res({}));
  });
}

describe("SessionDetail timeline", () => {
  beforeEach(() => {
    window.location.hash = "#/session/sess-1";
  });

  it("renders every event kind from the merged timeline", async () => {
    vi.stubGlobal("fetch", makeMock(fullEvents));
    renderWithClient(<SessionDetail id="sess-1" />);
    await waitFor(() => expect(screen.getByText(/Fix the login bug/)).toBeTruthy());
    for (const label of [
      "Prompt",
      "Model request",
      "Tool call",
      "File activity",
      "Command",
      "Verification",
      "Compaction",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/failure: command_failed/)).toBeTruthy();
    expect(screen.getByText(/50\.0k → 8\.0k/)).toBeTruthy();
  });

  it("hides content fields when the API strips them (metadata-only)", async () => {
    vi.stubGlobal("fetch", makeMock(strippedEvents));
    renderWithClient(<SessionDetail id="sess-1" />);
    await waitFor(() =>
      expect(screen.getByText(/Content hidden \(metadata-only mode\)/)).toBeTruthy(),
    );
    expect(screen.getByText(/Command hidden \(metadata-only mode\)/)).toBeTruthy();
  });
});
