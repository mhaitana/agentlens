/**
 * Privacy screen interactive controls (M2-7, spec §8, §13.9).
 *
 * Verifies the dashboard surfaces the active privacy mode, requires an
 * explicit opt-in confirmation before switching to full-local (§8.3), and
 * POSTs each edit to /api/v1/settings with the runtime token. No real
 * ~/.claude or transcript data is involved (§21).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Privacy } from "./Privacy.js";

function privacyBody() {
  return {
    mode: "redacted-content",
    retentionDays: 90,
    redactEmails: true,
    redactHomePath: true,
    customPatterns: [],
    excludedProjects: ["/Users/you/secret-project"],
    dataLocation: "/tmp/agentlens",
    storedDataCategories: ["sessions, prompts, tool calls"],
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Record of settings POSTs so assertions can inspect what was sent. */
const settingsCalls: Array<{ key: string; value: unknown }> = [];

function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { "content-type": "application/json" };
  let body: unknown = {};
  const status = 200;
  if (url.endsWith("/privacy")) {
    body = privacyBody();
  } else if (url.endsWith("/settings") && init?.method === "POST") {
    const payload = JSON.parse(String(init.body)) as { key: string; value: unknown };
    settingsCalls.push(payload);
    body = { ok: true, key: payload.key };
  } else {
    body = {};
  }
  return Promise.resolve({
    ok: true,
    status,
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

describe("Privacy screen (M2-7)", () => {
  beforeEach(() => {
    settingsCalls.length = 0;
    window.__AGENTLENS__ = { apiBase: "/api/v1", token: "test-token" };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => mockFetch(input, init)),
    );
  });

  function renderPrivacy() {
    const qc = makeClient();
    render(
      <QueryClientProvider client={qc}>
        <Privacy />
      </QueryClientProvider>,
    );
  }

  it("renders the active mode badge, retention window, and the existing exclusion", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getAllByText("redacted-content").length).toBeGreaterThan(0));
    expect(screen.getByText(/Auto-delete data older than 90 days/)).toBeTruthy();
    expect(screen.getByText("/Users/you/secret-project")).toBeTruthy();
  });

  it("switching to metadata-only POSTs privacy.mode without a confirmation dialog", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getAllByText("redacted-content").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "metadata-only" } });
    await waitFor(() => {
      expect(
        settingsCalls.some((c) => c.key === "privacy.mode" && c.value === "metadata-only"),
      ).toBe(true);
    });
    // No opt-in confirmation dialog should have appeared for non-full-local.
    expect(screen.queryByText("Enable full-local mode?")).toBeNull();
  });

  it("switching to full-local shows the §8.3 strong-warning opt-in and only POSTs after confirming", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getAllByText("redacted-content").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "full-local" } });

    // The strong-warning confirmation appears (§8.3 explicit opt-in).
    const dialog = await screen.findByText("Enable full-local mode?");
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/never persists environment-variable secrets/)).toBeTruthy();
    // Not yet sent — opt-in required.
    expect(settingsCalls.some((c) => c.key === "privacy.mode")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "I understand — enable full-local" }));
    await waitFor(() => {
      expect(settingsCalls.some((c) => c.key === "privacy.mode" && c.value === "full-local")).toBe(
        true,
      );
    });
  });

  it("saving the retention window POSTs privacy.retentionDays as a number", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getAllByText("redacted-content").length).toBeGreaterThan(0));
    const input = screen.getByLabelText("Retention window (days)");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(settingsCalls.some((c) => c.key === "privacy.retentionDays" && c.value === 30)).toBe(
        true,
      );
    });
  });

  it("adding an exclusion POSTs the full updated list to sources.claudeCode.excludedProjects", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getByText("/Users/you/secret-project")).toBeTruthy());
    const input = screen.getByLabelText("Add an excluded project path");
    fireEvent.change(input, { target: { value: "/tmp/other" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      const call = settingsCalls.find((c) => c.key === "sources.claudeCode.excludedProjects") as
        { value: string[] } | undefined;
      expect(call).toBeTruthy();
      expect(call?.value).toEqual(["/Users/you/secret-project", "/tmp/other"]);
    });
  });

  it("removing an exclusion POSTs the list without that entry", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getByText("/Users/you/secret-project")).toBeTruthy());
    fireEvent.click(
      screen.getByRole("button", { name: "Remove exclusion /Users/you/secret-project" }),
    );
    await waitFor(() => {
      const call = settingsCalls.find((c) => c.key === "sources.claudeCode.excludedProjects") as
        { value: string[] } | undefined;
      expect(call?.value).toEqual([]);
    });
  });

  it("toggling email redaction POSTs privacy.redactEmails", async () => {
    renderPrivacy();
    await waitFor(() => expect(screen.getByText("Email redaction")).toBeTruthy());
    const checkbox = screen.getByText("Email redaction").closest("label")!.querySelector("input")!;
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(settingsCalls.some((c) => c.key === "privacy.redactEmails")).toBe(true);
    });
  });
});
