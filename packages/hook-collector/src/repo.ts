/**
 * Hook-event persistence (spec §14.3). Rows are deduplicated by `payloadHash`:
 * a retransmitted hook event (loopback retry after a spool drain) is a no-op
 * rather than a duplicate. Correlation to a scanned session is filled in
 * lazily by the correlation step (§14.4) — the repo only stores the link.
 */
import { eq, desc, count } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { schema } from "@agentlens/database";
import { randomId } from "@agentlens/shared";
import type { RedactedHookEvent } from "./redact.js";

/** Persisted hook-event row. */
export interface HookEventRow {
  id: string;
  sourceSessionId: string | null;
  hookEventName: string;
  timestamp: string;
  cwdHash: string | null;
  toolName: string | null;
  payload: unknown;
  payloadHash: string;
  delivery: string;
  receivedAt: string;
  correlatedSessionId: string | null;
  correlationConfidence: number | null;
  provenance: string;
}

export class HookEventRepo {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Insert a redacted hook event, skipping if `payloadHash` already exists.
   * Returns the row id and whether it was newly inserted (dedup signal).
   */
  async insert(
    event: RedactedHookEvent,
    delivery: "online" | "spool",
    provenance = "claude-code-hook",
  ): Promise<{ id: string; inserted: boolean }> {
    const existing = await this.db
      .select({ id: schema.hookEvents.id })
      .from(schema.hookEvents)
      .where(eq(schema.hookEvents.payloadHash, event.payloadHash))
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (row) return { id: row.id, inserted: false };
    }

    const id = randomId();
    await this.db.insert(schema.hookEvents).values({
      id,
      sourceSessionId: event.sourceSessionId ?? null,
      hookEventName: event.hookEventName,
      timestamp: event.timestamp,
      cwdHash: event.cwdHash ?? null,
      toolName: event.toolName ?? null,
      payload: event.redactedPayload,
      payloadHash: event.payloadHash,
      delivery,
      receivedAt: event.receivedAt,
      correlatedSessionId: null,
      correlationConfidence: null,
      provenance,
    });
    return { id, inserted: true };
  }

  /** Attach (or revise) the inferred session correlation for an event. */
  async setCorrelation(
    id: string,
    correlatedSessionId: string | null,
    confidence: number | null,
  ): Promise<void> {
    await this.db
      .update(schema.hookEvents)
      .set({ correlatedSessionId, correlationConfidence: confidence })
      .where(eq(schema.hookEvents.id, id));
  }

  /** Recent events newest-first (for the live dashboard). */
  async recent(limit = 50): Promise<HookEventRow[]> {
    const rows = await this.db
      .select()
      .from(schema.hookEvents)
      .orderBy(desc(schema.hookEvents.receivedAt))
      .limit(limit);
    return rows as unknown as HookEventRow[];
  }

  /** Total count (for the live dashboard + acceptance checks). */
  async total(): Promise<number> {
    const rows = (await this.db
      .select({ n: count() })
      .from(schema.hookEvents)) as unknown as Array<{
      n: number;
    }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** Events for a source session id (correlation verification). */
  async bySourceSession(sourceSessionId: string): Promise<HookEventRow[]> {
    const rows = await this.db
      .select()
      .from(schema.hookEvents)
      .where(eq(schema.hookEvents.sourceSessionId, sourceSessionId))
      .orderBy(schema.hookEvents.receivedAt);
    return rows as unknown as HookEventRow[];
  }
}
