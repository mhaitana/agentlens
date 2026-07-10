/**
 * Event → session correlation (spec §14.4).
 *
 * Live hook and OTLP events arrive out of band from transcript scanning, so we
 * correlate them to a scanned session after the fact. Where an exact id match
 * is possible (Claude `session_id` == a session's `sourceSessionId`) we record
 * confidence 1.0. Otherwise we infer by project path + time window and record a
 * lower confidence, so downstream consumers can distinguish exact from
 * inferred relationships (§3.4 honest metrics, §14.4).
 */
import { eq, and, gte, lte, desc } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { schema } from "@agentlens/database";

export interface CorrelationInput {
  /** Source-native session id from the live event (Claude `session_id`). */
  sourceSessionId?: string;
  /** Redacted cwd path hash (matches a project's `pathHash`). */
  cwdHash?: string;
  /** Event timestamp (ISO). */
  timestamp: string;
  /** Adapter to match against (default "claude-code"). */
  adapter?: string;
}

export interface CorrelationResult {
  sessionId: string;
  /** 0–1; 1.0 = exact id match, <1 = inferred. */
  confidence: number;
  /** How the match was made, for diagnostics. */
  basis: "exact-session-id" | "path-and-time" | "path-nearest" | "time-nearest";
}

/** Time window for inferred correlation: events within ±1h of a session. */
const TIME_WINDOW_MS = 60 * 60 * 1000;

/**
 * Find the best session for a live event. Returns null when nothing plausible
 * exists (the event stays uncorrelated until a later scan produces a session).
 */
export async function correlateEventToSession(
  db: DrizzleDb,
  input: CorrelationInput,
): Promise<CorrelationResult | null> {
  const adapter = input.adapter ?? "claude-code";

  // 1. Exact: source-session id matches a scanned session of this source.
  if (input.sourceSessionId) {
    const rows = await db
      .select({ id: schema.sessions.id, startedAt: schema.sessions.startedAt })
      .from(schema.sessions)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.sessions.sourceId))
      .where(
        and(
          eq(schema.sources.adapter, adapter),
          eq(schema.sessions.sourceSessionId, input.sourceSessionId),
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      const row = rows[0];
      if (row) return { sessionId: row.id, confidence: 1.0, basis: "exact-session-id" };
    }
  }

  // 2. Inferred by project path + time window.
  if (input.cwdHash) {
    const projects = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.pathHash, input.cwdHash))
      .limit(1);
    if (projects.length > 0) {
      const project = projects[0];
      if (!project) return null;
      const projectId = project.id;
      const ts = Date.parse(input.timestamp);
      if (!Number.isNaN(ts)) {
        const since = new Date(ts - TIME_WINDOW_MS).toISOString();
        const until = new Date(ts + TIME_WINDOW_MS).toISOString();
        const inWindow = await db
          .select({ id: schema.sessions.id })
          .from(schema.sessions)
          .where(
            and(
              eq(schema.sessions.projectId, projectId),
              gte(schema.sessions.startedAt, since),
              lte(schema.sessions.startedAt, until),
            ),
          )
          .orderBy(schema.sessions.startedAt)
          .limit(1);
        if (inWindow.length > 0) {
          const hit = inWindow[0];
          if (hit) return { sessionId: hit.id, confidence: 0.7, basis: "path-and-time" };
        }
      }
      // Nearest session in that project as a last resort.
      const nearest = await db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.projectId, projectId))
        .orderBy(desc(schema.sessions.startedAt))
        .limit(1);
      if (nearest.length > 0) {
        const hit = nearest[0];
        if (hit) return { sessionId: hit.id, confidence: 0.4, basis: "path-nearest" };
      }
    }
  }

  // 3. Time-only nearest (very weak; only when we have a timestamp and nothing else).
  if (!Number.isNaN(Date.parse(input.timestamp))) {
    const ts = Date.parse(input.timestamp);
    const since = new Date(ts - TIME_WINDOW_MS).toISOString();
    const until = new Date(ts + TIME_WINDOW_MS).toISOString();
    const any = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(gte(schema.sessions.startedAt, since), lte(schema.sessions.startedAt, until)))
      .orderBy(schema.sessions.startedAt)
      .limit(1);
    if (any.length > 0) {
      const hit = any[0];
      if (hit) return { sessionId: hit.id, confidence: 0.25, basis: "time-nearest" };
    }
  }

  return null;
}
