/**
 * Data maintenance primitives (spec §3.2 "complete local deletion", §8
 * "configurable retention", §16 `privacy purge`).
 *
 * These run the destructive side of privacy controls: full purge, per-project
 * purge, and retention-based pruning of expired sessions. All three delete
 * child event rows before their parent session because the schema FKs use the
 * default `NO ACTION` (with `PRAGMA foreign_keys = ON`), so a session cannot
 * be removed while child rows reference it.
 *
 * The functions take a {@link DrizzleDb} and return counts so callers (CLI +
 * local API) can report what was removed. They never touch `config.json` or
 * the schema — only imported data.
 */
import { lt, and, or, isNull, isNotNull, eq, inArray, count, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "./client.js";
import * as schema from "./schema.js";

/** Tables that reference a session via `sessionId`, in deletion order. */
const SESSION_CHILDREN = [
  schema.recommendations,
  schema.compactions,
  schema.verificationRuns,
  schema.commandRuns,
  schema.fileActivity,
  schema.toolCalls,
  schema.modelRequests,
  schema.prompts,
] as const;

/**
 * Compute the ISO cutoff timestamp for a retention window: anything older than
 * `now - retentionDays` is expired. Exposed for tests + the CLI report.
 */
export function retentionCutoff(retentionDays: number, nowIso: string): string {
  const ms = Date.parse(nowIso);
  if (Number.isNaN(ms)) throw new Error(`Invalid nowIso: ${nowIso}`);
  return new Date(ms - retentionDays * 86_400_000).toISOString();
}

/** Count rows in a table (for pre-delete summaries). */
async function rowCount(db: DrizzleDb, t: Parameters<DrizzleDb["delete"]>[0]): Promise<number> {
  const rows = (await db.select({ n: count() }).from(t as never)) as unknown as Array<{
    n: number;
  }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Delete all imported data (every event table, sessions, projects, scan
 * state), keeping config + schema. Returns a summary of deleted row counts.
 */
export async function purgeAllData(db: DrizzleDb): Promise<PurgeSummary> {
  const summary: PurgeSummary = { sessions: 0, events: 0, projects: 0, recommendations: 0 };
  // Count before delete (the libsql ResultSet does not expose changes portably).
  summary.sessions = await rowCount(db, schema.sessions);
  summary.projects = await rowCount(db, schema.projects);
  summary.recommendations = await rowCount(db, schema.recommendations);
  for (const t of SESSION_CHILDREN) {
    summary.events += await rowCount(db, t);
  }
  // Children first (FK NO ACTION), then sessions/projects/scanState.
  for (const t of SESSION_CHILDREN) {
    await db.delete(t);
  }
  await db.delete(schema.recommendations);
  await db.delete(schema.sessions);
  await db.delete(schema.projects);
  await db.delete(schema.scanState);
  return summary;
}

/**
 * Delete all data belonging to a single project (sessions + their events + the
 * project row). Recommendations are removed if they reference the project or
 * any of its sessions. Returns a summary.
 */
export async function purgeProjectData(db: DrizzleDb, projectId: string): Promise<PurgeSummary> {
  const summary: PurgeSummary = { sessions: 0, events: 0, projects: 0, recommendations: 0 };
  const sessions = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.projectId, projectId));
  const ids = sessions.map((s) => s.id);
  summary.sessions = ids.length;
  if (ids.length === 0) {
    // Still drop the project row + any recommendations tied to the project id.
    const projRows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    summary.projects = projRows.length;
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.recommendations).where(eq(schema.recommendations.projectId, projectId));
    return summary;
  }
  for (const t of SESSION_CHILDREN) {
    await db.delete(t).where(inArray(t.sessionId, ids));
  }
  await db.delete(schema.recommendations).where(inArray(schema.recommendations.sessionId, ids));
  await db.delete(schema.sessions).where(eq(schema.sessions.projectId, projectId));
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  summary.projects = 1; // the targeted project row
  return summary;
}

/**
 * Prune sessions whose end (or start, when the session never ended) is older
 * than the retention cutoff, deleting their events + recommendations too.
 *
 * A session is expired when `endedAt < cutoff`, or — for sessions still
 * "in progress" (null endedAt) — when `startedAt < cutoff`. Returns the count
 * of sessions pruned.
 */
export async function pruneExpiredSessions(
  db: DrizzleDb,
  retentionDays: number,
  nowIso: string,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = retentionCutoff(retentionDays, nowIso);
  // Expired = ended before cutoff OR (no end AND started before cutoff).
  const expiredClause: SQL = and(
    or(
      and(isNotNull(schema.sessions.endedAt), lt(schema.sessions.endedAt, cutoff)),
      and(isNull(schema.sessions.endedAt), lt(schema.sessions.startedAt, cutoff)),
    ),
  ) as SQL;
  const expired = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(expiredClause);
  const ids = expired.map((s) => s.id);
  if (ids.length === 0) return 0;
  for (const t of SESSION_CHILDREN) {
    await db.delete(t).where(inArray(t.sessionId, ids));
  }
  await db.delete(schema.recommendations).where(inArray(schema.recommendations.sessionId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.id, ids));
  return ids.length;
}

export interface PurgeSummary {
  sessions: number;
  events: number;
  projects: number;
  recommendations: number;
}
