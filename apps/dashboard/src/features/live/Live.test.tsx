/**
 * Live screen tests (spec §14.10, §19.4). Covers:
 *  - the "not running" banner when `/api/v1/live` reports `streaming:false`;
 *  - the collector/OTLP/hooks/spool indicators from the status snapshot;
 *  - the SSE-driven live event feed: a `status` seed + `hook`/`otel` events
 *    render as React text children (no HTML injection, §19.4).
 *
 * Fetch is mocked for `/live` + `/status`; `EventSource` is replaced with a
 * controllable mock so the test can dispatch SSE frames synchronously.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { Live } from "./Live.js";

function renderWithClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { "content-type": "application/json" },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const NOT_RUNNING = {
  status: "ok",
  streaming: false,
  collector: { running: false },
  otel: { running: false, port: undefined, events: 0 },
  hooks: { events: 0 },
  spool: { backlog: 0 },
  time: "2026-07-10T00:00:00.000Z",
};

const RUNNING = {
  status: "ok",
  streaming: true,
  collector: { running: true, port: 7531 },
  otel: { running: true, port: 4318, events: 2 },
  hooks: { events: 3 },
  spool: { backlog: 1 },
  time: "2026-07-10T00:00:00.000Z",
};

function mockFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input.endsWith("/status"))
        return Promise.resolve(
          jsonRes({
            home: "/tmp/agentlens",
            configPath: "/c",
            dbPath: "/d",
            privacyMode: "redacted-content",
            sessions: 0,
            projects: 0,
            recommendations: 0,
          }),
        );
      if (input.endsWith("/live")) return Promise.resolve(jsonRes(body));
      return Promise.resolve(jsonRes({}));
    }),
  );
}

/** A minimal, controllable EventSource mock. */
class MockEventSource {
  static instance: MockEventSource | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    MockEventSource.instance = this;
  }
  close() {
    this.closed = true;
  }
  open() {
    act(() => this.onopen?.(new Event("open")));
  }
  send(data: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent));
  }
  error() {
    act(() => this.onerror?.(new Event("error")));
  }
}

describe("Live screen (§14.10)", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    MockEventSource.instance = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.instance = null;
  });

  it("shows the not-running banner when streaming is false", async () => {
    mockFetch(NOT_RUNNING);
    renderWithClient(<Live />);
    await waitFor(() => expect(screen.getByText(/Live collection is not running/)).toBeTruthy());
    // The instruction names the command but executes nothing (§19.4).
    expect(screen.getByText(/agentlens observe/)).toBeTruthy();
  });

  it("renders collector/OTLP/hooks/spool indicators from the status snapshot", async () => {
    mockFetch(RUNNING);
    renderWithClient(<Live />);
    await waitFor(() => expect(screen.getByText("127.0.0.1:7531")).toBeTruthy());
    expect(screen.getByText("127.0.0.1:4318")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // hook events
    expect(screen.getByText("1")).toBeTruthy(); // spool backlog
  });

  it("streams the status seed + hook/otel events into the feed as text", async () => {
    mockFetch(RUNNING);
    renderWithClient(<Live />);
    // The hook opens the EventSource once streaming is known to be true.
    await waitFor(() => expect(MockEventSource.instance).not.toBeNull());
    const es = MockEventSource.instance as MockEventSource;
    es.open();
    // Seed status, then a hook + an otel event.
    es.send({ type: "status", time: "2026-07-10T00:00:01.000Z", data: { ...RUNNING } });
    es.send({
      type: "hook",
      time: "2026-07-10T00:00:02.000Z",
      data: { hookEventName: "PostToolUse", inserted: true, delivery: "online" },
    });
    es.send({
      type: "otel",
      time: "2026-07-10T00:00:03.000Z",
      data: { kind: "metric", received: 2, inserted: 2, deduped: 0, skipped: 0 },
    });

    // Hook event name renders as text (not HTML).
    expect(screen.getByText("PostToolUse")).toBeTruthy();
    // OTel feed row shows kind + inserted count.
    expect(screen.getByText(/metric · \+2/)).toBeTruthy();
    // Connection badge flips to connected after onopen.
    expect(screen.getAllByText("connected").length).toBeGreaterThan(0);
  });

  it("does not render event data as HTML (escaped text only, §19.4)", async () => {
    mockFetch(RUNNING);
    renderWithClient(<Live />);
    await waitFor(() => expect(MockEventSource.instance).not.toBeNull());
    const es = MockEventSource.instance as MockEventSource;
    es.open();
    // A payload carrying HTML markup must appear as inert text, not elements.
    es.send({
      type: "hook",
      time: "2026-07-10T00:00:04.000Z",
      data: { hookEventName: "<img src=x onerror=alert(1)>", inserted: true, delivery: "online" },
    });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
