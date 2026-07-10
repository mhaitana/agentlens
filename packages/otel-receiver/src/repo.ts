/**
 * OTLP event persistence (spec §14.6). Dedup by `payloadHash` so retransmissions
 * from the exporter's retry logic don't duplicate rows. Correlation to a scanned
 * session is filled in lazily (§14.4).
 */
import { eq, desc, count } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { schema } from "@agentlens/database";
import { randomId } from "@agentlens/shared";
import type { OtelKind, OtelRecord } from "./parse.js";

export interface OtelEventRow {
  id: string;
  kind: string;
  sourceSessionId: string | null;
  name: string | null;
  timestamp: string;
  payload: unknown;
  payloadHash: string;
  receivedAt: string;
  correlatedSessionId: string | null;
  correlationConfidence: number | null;
  provenance: string;
}

export class OtelEventRepo {
  constructor(private readonly db: DrizzleDb) {}

  async insert(
    record: OtelRecord,
    redactedPayload: Record<string, unknown>,
    payloadHash: string,
    receivedAt: string,
    provenance = "claude-code-otlp",
  ): Promise<{ id: string; inserted: boolean }> {
    const existing = await this.db
      .select({ id: schema.otelEvents.id })
      .from(schema.otelEvents)
      .where(eq(schema.otelEvents.payloadHash, payloadHash))
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (row) return { id: row.id, inserted: false };
    }

    const id = randomId();
    await this.db.insert(schema.otelEvents).values({
      id,
      kind: record.kind,
      sourceSessionId: record.sourceSessionId ?? null,
      name: record.name ?? null,
      timestamp: record.timestamp ?? receivedAt,
      payload: redactedPayload,
      payloadHash,
      receivedAt,
      correlatedSessionId: null,
      correlationConfidence: null,
      provenance,
    });
    return { id, inserted: true };
  }

  async setCorrelation(
    id: string,
    sessionId: string | null,
    confidence: number | null,
  ): Promise<void> {
    await this.db
      .update(schema.otelEvents)
      .set({ correlatedSessionId: sessionId, correlationConfidence: confidence })
      .where(eq(schema.otelEvents.id, id));
  }

  async recent(limit = 50): Promise<OtelEventRow[]> {
    const rows = await this.db
      .select()
      .from(schema.otelEvents)
      .orderBy(desc(schema.otelEvents.receivedAt))
      .limit(limit);
    return rows as unknown as OtelEventRow[];
  }

  async total(): Promise<number> {
    const rows = (await this.db
      .select({ n: count() })
      .from(schema.otelEvents)) as unknown as Array<{
      n: number;
    }>;
    return Number(rows[0]?.n ?? 0);
  }

  async totalByKind(kind: OtelKind): Promise<number> {
    const rows = (await this.db
      .select({ n: count() })
      .from(schema.otelEvents)
      .where(eq(schema.otelEvents.kind, kind))) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }
}
