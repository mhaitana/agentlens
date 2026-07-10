/**
 * Live-update + hook-ingest route tests (spec §14.9, §14.10, §19.1).
 *
 * Covers: LiveBus pub/sub semantics, `buildLiveStatus` aggregation, the
 * `/api/v1/live` status snapshot, the token-gated hook ingest route, and that a
 * successful ingest broadcasts a `hook` LiveEvent to bus listeners. Uses
 * Fastify `inject` (no real port) + a temp SQLite home — never the developer's
 * real ~/.claude (§21). The SSE byte stream itself is exercised end-to-end in
 * the CLI observe-runtime integration test (a real socket is needed because the
 * route hijacks the reply for a long-lived connection).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@agentlens/database";
import { defaultConfig } from "@agentlens/config";
import { buildServer, generateRuntimeToken } from "./index.js";
import { LiveBus, buildLiveStatus, hookLiveEvent, otelLiveEvent, type LiveEvent } from "./live.js";
import type { ServerDeps } from "./deps.js";

function mkHome(): string {
  return mkdtempSync(join(tmpdir(), "agentlens-live-"));
}

async function makeDeps(
  home: string,
  bus?: LiveBus,
  otelPort?: number,
): Promise<{
  deps: ServerDeps;
  token: string;
}> {
  const dbObj = await openDatabase({ home, nowIso: new Date().toISOString(), inMemory: false });
  const token = generateRuntimeToken();
  const config = defaultConfig();
  const deps: ServerDeps = {
    db: dbObj.db,
    config,
    home,
    runtimeToken: token,
    port: 0,
    liveBus: bus,
    otelPort,
  };
  return { deps, token };
}

describe("LiveBus (§14.10)", () => {
  it("delivers broadcasts to every listener and swallows listener errors", () => {
    const bus = new LiveBus();
    const received: LiveEvent[] = [];
    bus.addListener((e) => received.push(e));
    const throwing = () => {
      throw new Error("boom");
    };
    bus.addListener(throwing);
    const event: LiveEvent = { type: "heartbeat", time: new Date().toISOString(), data: {} };
    bus.broadcast(event);
    expect(received).toEqual([event]);
    // A second listener still receives after the throwing one ran.
    const more: LiveEvent[] = [];
    bus.addListener((e) => more.push(e));
    bus.broadcast(event);
    expect(more).toEqual([event]);
  });

  it("unsubscribe stops further delivery", () => {
    const bus = new LiveBus();
    const received: LiveEvent[] = [];
    const off = bus.addListener((e) => received.push(e));
    off();
    bus.broadcast({ type: "heartbeat", time: new Date().toISOString(), data: {} });
    expect(received).toEqual([]);
  });
});

describe("live status + hook ingest routes (§14.9, §14.10)", () => {
  let home: string;
  let bus: LiveBus;
  let events: LiveEvent[];
  let token: string;
  let deps: ServerDeps;

  beforeEach(async () => {
    home = mkHome();
    bus = new LiveBus();
    events = [];
    bus.addListener((e) => events.push(e));
    const built = await makeDeps(home, bus, 4318);
    deps = built.deps;
    token = built.token;
  });
  afterEach(() => {
    bus.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("GET /api/v1/live returns a status snapshot with streaming + otel port + spool backlog", async () => {
    const app = await buildServer(deps);
    const res = await app.inject({ method: "GET", url: "/api/v1/live" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.streaming).toBe(true);
    expect(body.otel).toMatchObject({ running: true, port: 4318, events: 0 });
    expect(body.hooks).toMatchObject({ events: 0 });
    expect(body.spool).toMatchObject({ backlog: 0 });
    await app.close();
  });

  it("GET /api/v1/live reports spool backlog from the home event-spool dir", async () => {
    const spoolDir = join(home, "event-spool");
    mkdirSync(spoolDir, { recursive: true });
    writeFileSync(
      join(spoolDir, "2026-01-01T00-00-00-00000000.json"),
      JSON.stringify({
        v: 1,
        provenance: "claude-code-hook",
        receivedAt: "2026-01-01T00:00:00Z",
        payload: {},
      }),
    );
    const status = await buildLiveStatus({ db: deps.db, home, otelPort: 4318, apiPort: 0 });
    expect(status.spool.backlog).toBe(1);
  });

  it("POST /api/v1/hooks/event ingests + broadcasts a hook LiveEvent (token-gated)", async () => {
    const app = await buildServer(deps);
    const payload = {
      hook_event_name: "PostToolUse",
      session_id: "s-1",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/x" },
    };

    // Without a token → 401 (§19.1).
    const noToken = await app.inject({ method: "POST", url: "/api/v1/hooks/event", payload });
    expect(noToken.statusCode).toBe(401);

    // With the token → ingested + broadcast.
    const before = events.length;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hooks/event",
      headers: { "x-agentlens-token": token, "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.inserted).toBe(true);
    expect(body.hookEventName).toBe("PostToolUse");
    expect(body.delivery).toBe("online");
    // A hook LiveEvent was broadcast (counts + redacted name only, §3).
    const hookEvents = events.slice(before).filter((e) => e.type === "hook");
    expect(hookEvents).toHaveLength(1);
    expect(hookEvents[0].data).toMatchObject({
      hookEventName: "PostToolUse",
      inserted: true,
      delivery: "online",
    });
    await app.close();
  });

  it("a duplicate hook payload is deduped (inserted=false) and still broadcast", async () => {
    const app = await buildServer(deps);
    const payload = { hook_event_name: "Stop", session_id: "s-2" };
    const headers = { "x-agentlens-token": token, "content-type": "application/json" };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/hooks/event",
      headers,
      payload,
    });
    expect(first.json().inserted).toBe(true);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/hooks/event",
      headers,
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().inserted).toBe(false);
    await app.close();
  });

  it("GET /api/v1/hooks/health reports the ingested event count", async () => {
    const app = await buildServer(deps);
    await app.inject({
      method: "POST",
      url: "/api/v1/hooks/event",
      headers: { "x-agentlens-token": token, "content-type": "application/json" },
      payload: { hook_event_name: "SessionStart", session_id: "s-3" },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/hooks/health" });
    expect(res.json()).toMatchObject({ status: "ok", events: 1 });
    await app.close();
  });

  it("live event helpers carry counts only (no payload content)", () => {
    const hook = hookLiveEvent({
      id: "x",
      inserted: true,
      hookEventName: "Stop",
      payloadHash: "h",
      delivery: "online",
    });
    expect(hook.type).toBe("hook");
    expect(JSON.stringify(hook)).not.toContain("payload");
    const otel = otelLiveEvent({
      kind: "metric",
      received: 3,
      inserted: 2,
      deduped: 1,
      skipped: 0,
    });
    expect(otel.type).toBe("otel");
    expect(otel.data).toMatchObject({ kind: "metric", received: 3, inserted: 2 });
  });
});
