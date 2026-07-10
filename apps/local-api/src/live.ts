/**
 * Live-update bus + status aggregator (spec §14.10, §14.9).
 *
 * `LiveBus` is a tiny in-process pub/sub. Ingest paths (hook HTTP route, spool
 * drainer, OTLP receiver) call `broadcast` after a successful persist; the SSE
 * route (`/api/v1/live/stream`) attaches a per-connection listener that pushes
 * each event to the dashboard. Listener errors are swallowed so a misbehaving
 * client can never break ingestion (§19).
 *
 * `buildLiveStatus` snapshots the collector state the dashboard's Live view
 * renders: which collectors are running, the OTLP port, hook + otel event
 * counts, and the spool backlog. All values are derived from local stores only
 * (privacy-first, §3); no payload content is included — only counts and the
 * redacted hook-event name.
 */
import { HookEventRepo, spoolBacklog } from "@agentlens/hook-collector";
import { OtelEventRepo } from "@agentlens/otel-receiver";
import type { DrizzleDb } from "@agentlens/database";

/** A single live event pushed to dashboard SSE clients. */
export interface LiveEvent {
  /** Event discriminator: hook ingest | otel ingest | status snapshot | heartbeat. */
  type: "hook" | "otel" | "status" | "heartbeat";
  /** ISO timestamp the event was produced. */
  time: string;
  /** Structured, redacted payload (counts + names only — never raw content). */
  data: Record<string, unknown>;
}

/** A listener subscribed to the bus. */
export interface LiveListener {
  (event: LiveEvent): void;
}

/** In-process pub/sub for live collector events. */
export class LiveBus {
  private listeners = new Set<LiveListener>();

  /** Subscribe; returns an unsubscribe function. */
  addListener(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Remove a previously-added listener. */
  removeListener(listener: LiveListener): void {
    this.listeners.delete(listener);
  }

  /** Broadcast an event to every listener, swallowing listener errors (§19). */
  broadcast(event: LiveEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A slow/crashing client must never break the ingest path (§19).
      }
    }
  }

  /** Drop all listeners (shutdown). */
  close(): void {
    this.listeners.clear();
  }
}

export interface LiveStatusDeps {
  db: DrizzleDb;
  home: string;
  /** Bound OTLP receiver port, or undefined when the receiver isn't running. */
  otelPort?: number;
  /** Bound API port (the collector). */
  apiPort?: number;
}

/** Snapshot the collector state for the dashboard Live view (§14.10). */
export async function buildLiveStatus(deps: LiveStatusDeps): Promise<{
  collector: { running: boolean; port?: number };
  otel: { running: boolean; port?: number; events: number };
  hooks: { events: number };
  spool: { backlog: number };
  time: string;
}> {
  const hookTotal = await new HookEventRepo(deps.db).total();
  const otelTotal = await new OtelEventRepo(deps.db).total();
  const backlog = await spoolBacklog(deps.home);
  return {
    collector: { running: deps.apiPort != null, port: deps.apiPort },
    otel: { running: deps.otelPort != null, port: deps.otelPort, events: otelTotal },
    hooks: { events: hookTotal },
    spool: { backlog },
    time: new Date().toISOString(),
  };
}

/** Build a `hook` LiveEvent from an ingest result (counts + redacted name only). */
export function hookLiveEvent(
  result: {
    id: string;
    inserted: boolean;
    hookEventName: string;
    payloadHash: string;
    delivery: "online" | "spool";
  },
  now = new Date(),
): LiveEvent {
  return {
    type: "hook",
    time: now.toISOString(),
    data: {
      hookEventName: result.hookEventName,
      inserted: result.inserted,
      delivery: result.delivery,
    },
  };
}

/** Build an `otel` LiveEvent from an OTLP ingest summary. */
export function otelLiveEvent(
  summary: { kind: string; received: number; inserted: number; deduped: number; skipped: number },
  now = new Date(),
): LiveEvent {
  return {
    type: "otel",
    time: now.toISOString(),
    data: {
      kind: summary.kind,
      received: summary.received,
      inserted: summary.inserted,
      deduped: summary.deduped,
      skipped: summary.skipped,
    },
  };
}

/** Build a `status` LiveEvent carrying a live-status snapshot. */
export function statusLiveEvent(status: Awaited<ReturnType<typeof buildLiveStatus>>): LiveEvent {
  return { type: "status", time: status.time, data: status };
}

/** Build a `heartbeat` LiveEvent (keeps the SSE connection alive). */
export function heartbeatLiveEvent(now = new Date()): LiveEvent {
  return { type: "heartbeat", time: now.toISOString(), data: {} };
}
