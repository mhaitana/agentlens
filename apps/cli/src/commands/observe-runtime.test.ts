/**
 * `agentlens observe` runtime integration test (spec §14.9, §14.10, §14.6).
 *
 * Starts a real loopback collector (API + OTLP receiver + spool drain +
 * debounced analysis) on OS-assigned ports and exercises the full live path
 * end-to-end against a temp home + in-file SQLite — never the developer's real
 * ~/.claude (§21):
 *   - a pre-existing spool file is drained + ingested + broadcast on startup;
 *   - an OTLP/JSON metrics POST is received, redacted, persisted, and broadcast;
 *   - GET /api/v1/live returns the running collector status;
 *   - the SSE stream (/api/v1/live/stream) delivers an initial status event;
 *   - debounced incremental analysis runs after an ingest;
 *   - stop() tears everything down cleanly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import { writeSpool } from "@agentlens/hook-collector";
import { startObservation, type ObservationHandle } from "./observe-runtime.js";

function mkHome(): string {
  return mkdtempSync(join(tmpdir(), "agentlens-observe-"));
}

async function readSseChunk(url: string, timeoutMs = 3000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`SSE fetch failed: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    // Read until we have at least one `data:` line, then stop.
    while (!acc.includes("data:")) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      if (acc.includes("\n\n")) break;
    }
    controller.abort();
    return acc;
  } finally {
    clearTimeout(timer);
  }
}

describe("agentlens observe runtime (§14.9, §14.10)", () => {
  let home: string;
  let handle: ObservationHandle | null;

  beforeEach(() => {
    home = mkHome();
    handle = null;
  });
  afterEach(async () => {
    if (handle) await handle.stop();
    rmSync(home, { recursive: true, force: true });
  });

  async function start(
    overrides: { analysisDebounceMs?: number } = {},
  ): Promise<ObservationHandle> {
    const db = await openDatabase({ home, nowIso: new Date().toISOString(), inMemory: false });
    const config = defaultConfig();
    return startObservation({
      home,
      db,
      config,
      apiPort: 0, // OS-assigned loopback port
      otelPort: 0, // OS-assigned loopback port
      analysisDebounceMs: overrides.analysisDebounceMs ?? 50,
      spoolPollMs: 200,
    });
  }

  it("drains a pre-existing spool file on startup and broadcasts a hook event", async () => {
    // Write a spooled event BEFORE starting the collector.
    await writeSpool(home, {
      v: 1,
      provenance: "claude-code-hook",
      receivedAt: "2026-07-10T00:00:00Z",
      payload: { hook_event_name: "Stop", session_id: "s-pre" },
    });

    handle = await start();
    // The initial drain removes the spool file (spoolDrained) and the ingested
    // hook is broadcast to the bus — the internal listener bumps hooksInserted
    // only on a received `hook` event, proving the broadcast path.
    expect(handle.stats.spoolDrained).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(handle.stats.hooksInserted).toBeGreaterThanOrEqual(1);
  });

  it("receives an OTLP/JSON metrics batch, persists it, and broadcasts an otel event", async () => {
    handle = await start();
    const before = handle.stats.otelInserted;
    const seenOtel: boolean[] = [];
    handle.bus.addListener((e) => seenOtel.push(e.type === "otel"));

    const metrics = {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "session.id", value: { stringValue: "s-otel" } }],
          },
          scopeMetrics: [
            {
              metrics: [
                { name: "claude_code.token.usage", timeUnixNano: "1752000000000000000" },
                { name: "claude_code.tool.invocations", timeUnixNano: "1752000001000000000" },
              ],
            },
          ],
        },
      ],
    };
    const res = await fetch(`http://127.0.0.1:${handle.otelPort}/v1/metrics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metrics),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { inserted: number };
    expect(body.inserted).toBe(2);

    // Counter advanced + an otel event was broadcast.
    await new Promise((r) => setTimeout(r, 60));
    expect(handle.stats.otelInserted).toBeGreaterThanOrEqual(before + 2);
    expect(seenOtel).toContain(true);
  });

  it("OTLP receiver rejects protobuf with an actionable 415", async () => {
    handle = await start();
    const res = await fetch(`http://127.0.0.1:${handle.otelPort}/v1/metrics`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf" },
      body: Buffer.from("not-json"),
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("http/json");
  });

  it("GET /api/v1/live reports the running collector + otel port", async () => {
    handle = await start();
    const res = await fetch(`http://127.0.0.1:${handle.apiPort}/api/v1/live`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      status: string;
      streaming: boolean;
      otel: { running: boolean; port: number };
    };
    expect(body.status).toBe("ok");
    expect(body.streaming).toBe(true);
    expect(body.otel.running).toBe(true);
    expect(body.otel.port).toBe(handle.otelPort);
  });

  it("the SSE stream delivers an initial status event", async () => {
    handle = await start();
    const chunk = await readSseChunk(`http://127.0.0.1:${handle.apiPort}/api/v1/live/stream`);
    expect(chunk).toContain("data:");
    const line = chunk.split("\n").find((l) => l.startsWith("data:"));
    expect(line).toBeDefined();
    const payload = JSON.parse((line as string).slice("data:".length).trim()) as {
      type: string;
      data: unknown;
    };
    expect(payload.type).toBe("status");
  });

  it("runs debounced incremental analysis after an ingest", async () => {
    handle = await start({ analysisDebounceMs: 40 });
    // Trigger an OTLP ingest to schedule analysis.
    await fetch(`http://127.0.0.1:${handle.otelPort}/v1/metrics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceMetrics: [
          {
            scopeMetrics: [
              { metrics: [{ name: "claude_code.x", timeUnixNano: "1752000000000000000" }] },
            ],
          },
        ],
      }),
    });
    // Wait past the debounce for the analysis run to complete.
    await new Promise((r) => setTimeout(r, 250));
    expect(handle.stats.analysisRuns).toBeGreaterThanOrEqual(1);
  });

  it("hook ingest via the API is token-gated and broadcasts", async () => {
    handle = await start();
    const url = `http://127.0.0.1:${handle.apiPort}/api/v1/hooks/event`;
    // No token → 401.
    const noToken = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }),
    });
    expect(noToken.status).toBe(401);
    // With token → 201.
    const ok = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentlens-token": handle.token },
      body: JSON.stringify({ hook_event_name: "Stop", session_id: "s-1" }),
    });
    expect(ok.status).toBe(201);
  });

  it("spool watcher picks up a file written after startup", async () => {
    handle = await start({ analysisDebounceMs: 50 });
    const before = handle.stats.spoolDrained;
    // Write a new spool file while the collector is running.
    await writeSpool(home, {
      v: 1,
      provenance: "claude-code-hook",
      receivedAt: "2026-07-10T00:00:01Z",
      payload: { hook_event_name: "PostToolUse", session_id: "s-watch" },
    });
    // The poll loop (200ms) should drain it within a short wait.
    await new Promise((r) => setTimeout(r, 600));
    expect(handle.stats.spoolDrained).toBeGreaterThan(before);
  });

  it("stop() closes the API and OTLP receiver (subsequent requests fail)", async () => {
    handle = await start();
    const apiPort = handle.apiPort;
    const otelPort = handle.otelPort;
    await handle.stop();
    handle = null; // prevent double-stop in afterEach
    await expect(fetch(`http://127.0.0.1:${apiPort}/api/v1/live`)).rejects.toThrow();
    await expect(
      fetch(`http://127.0.0.1:${otelPort}/v1/metrics`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    ).rejects.toThrow();
  });
});
