/**
 * Read queries against the local SQLite database (spec §17 route data).
 *
 * The dashboard's API is read-mostly; these helpers run the Drizzle queries the
 * route handlers need (sessions with filter + pagination, the per-session
 * event timeline, projects, recommendations). They return *raw* rows — the
 * route layer applies read-side privacy gating (see privacy.ts) before
 * serialising, so content-bearing fields are stripped in metadata-only mode.
 */
import { asc, eq, desc, count, and, or, gte, lte, like, inArray } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { schema } from "@agentlens/database";

/** Filters accepted by the sessions list endpoint. */
export interface SessionQueryFilters {
  projectId?: string;
  modelId?: string;
  status?: string;
  /** ISO lower bound on `startedAt`. */
  since?: string;
  /** ISO upper bound on `startedAt`. */
  until?: string;
  /** Case-insensitive substring match on session id / project display name. */
  search?: string;
}

export interface SessionListRow {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  completionStatus: string;
  privacyMode: string;
  promptCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;
  entryPoint: string;
}

export interface ProjectListRow {
  id: string;
  displayName: string;
  redactedPath: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sessionCount: number;
}

/** Resolve a `search` filter to the set of project ids whose name matches. */
async function searchProjectIds(db: DrizzleDb, search: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(like(schema.projects.displayName, `%${search}%`));
  return rows.map((r) => r.id);
}

/** Build the where clause. `projectIds` extends `search` to project names. */
function buildSessionWhere(f: SessionQueryFilters, projectIds?: string[]) {
  const clauses = [];
  if (f.projectId) clauses.push(eq(schema.sessions.projectId, f.projectId));
  if (f.status) clauses.push(eq(schema.sessions.completionStatus, f.status));
  if (f.since) clauses.push(gte(schema.sessions.startedAt, f.since));
  if (f.until) clauses.push(lte(schema.sessions.startedAt, f.until));
  if (f.search) {
    const pidMatch =
      projectIds && projectIds.length > 0 ? [inArray(schema.sessions.projectId, projectIds)] : [];
    clauses.push(or(like(schema.sessions.id, `%${f.search}%`), ...pidMatch));
  }
  return and(...clauses);
}

/** Count sessions matching the filters (for pagination totals). */
export async function countSessions(db: DrizzleDb, f: SessionQueryFilters): Promise<number> {
  const projectIds = f.search ? await searchProjectIds(db, f.search) : undefined;
  const where = buildSessionWhere(f, projectIds);
  const rows = await db.select({ c: count() }).from(schema.sessions).where(where);
  return rows[0]?.c ?? 0;
}

/** List sessions matching the filters, ordered by most-recent first. */
export async function listSessions(
  db: DrizzleDb,
  f: SessionQueryFilters,
  page: number,
  limit: number,
): Promise<SessionListRow[]> {
  const projectIds = f.search ? await searchProjectIds(db, f.search) : undefined;
  const where = buildSessionWhere(f, projectIds);
  const offset = (page - 1) * limit;
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(where)
    .orderBy(desc(schema.sessions.startedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toSessionListRow);
}

function toSessionListRow(r: typeof schema.sessions.$inferSelect): SessionListRow {
  return {
    id: r.id,
    projectId: r.projectId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    completionStatus: r.completionStatus,
    privacyMode: r.privacyMode,
    promptCount: r.promptCount,
    modelRequestCount: r.modelRequestCount,
    toolCallCount: r.toolCallCount,
    compactionCount: r.compactionCount,
    subagentCount: r.subagentCount,
    entryPoint: r.entryPoint,
  };
}

/** Get a single session row by id, or undefined. */
export async function getSession(db: DrizzleDb, id: string) {
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).limit(1);
  return rows[0];
}

/** A unified timeline event for the session-detail screen (§13.9). */
export interface TimelineEvent {
  /** Sort key: the event timestamp (ISO). */
  timestamp: string;
  /** Discriminator: prompt | model_request | tool_call | file_activity |
   * command_run | verification_run | compaction. */
  kind: string;
  /** Sequence within the session for stable ordering of same-timestamp events. */
  sequence: number;
  /** The raw row (privacy-gated by the route layer). */
  data: unknown;
}

/** Build the merged timeline for a session, ordered by timestamp. */
export async function sessionTimeline(db: DrizzleDb, sessionId: string): Promise<TimelineEvent[]> {
  const [prompts, modelRequests, toolCalls, fileActivity, commandRuns, verifications, compactions] =
    await Promise.all([
      db
        .select()
        .from(schema.prompts)
        .where(eq(schema.prompts.sessionId, sessionId))
        .orderBy(asc(schema.prompts.sequence)),
      db
        .select()
        .from(schema.modelRequests)
        .where(eq(schema.modelRequests.sessionId, sessionId))
        .orderBy(asc(schema.modelRequests.timestamp)),
      db
        .select()
        .from(schema.toolCalls)
        .where(eq(schema.toolCalls.sessionId, sessionId))
        .orderBy(asc(schema.toolCalls.startedAt)),
      db
        .select()
        .from(schema.fileActivity)
        .where(eq(schema.fileActivity.sessionId, sessionId))
        .orderBy(asc(schema.fileActivity.timestamp)),
      db
        .select()
        .from(schema.commandRuns)
        .where(eq(schema.commandRuns.sessionId, sessionId))
        .orderBy(asc(schema.commandRuns.timestamp)),
      db
        .select()
        .from(schema.verificationRuns)
        .where(eq(schema.verificationRuns.sessionId, sessionId))
        .orderBy(asc(schema.verificationRuns.timestamp)),
      db
        .select()
        .from(schema.compactions)
        .where(eq(schema.compactions.sessionId, sessionId))
        .orderBy(asc(schema.compactions.timestamp)),
    ]);

  const events: TimelineEvent[] = [];
  for (const p of prompts)
    events.push({ timestamp: p.timestamp, kind: "prompt", sequence: p.sequence * 10, data: p });
  for (const m of modelRequests)
    events.push({ timestamp: m.timestamp, kind: "model_request", sequence: 1, data: m });
  for (const t of toolCalls)
    events.push({ timestamp: t.startedAt, kind: "tool_call", sequence: 2, data: t });
  for (const fa of fileActivity)
    events.push({ timestamp: fa.timestamp, kind: "file_activity", sequence: 3, data: fa });
  for (const c of commandRuns)
    events.push({ timestamp: c.timestamp, kind: "command_run", sequence: 4, data: c });
  for (const v of verifications)
    events.push({ timestamp: v.timestamp, kind: "verification_run", sequence: 5, data: v });
  for (const co of compactions)
    events.push({ timestamp: co.timestamp, kind: "compaction", sequence: 6, data: co });

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence);
  return events;
}

/** List projects with per-project session counts. */
export async function listProjects(db: DrizzleDb): Promise<ProjectListRow[]> {
  const rows = await db
    .select({
      id: schema.projects.id,
      displayName: schema.projects.displayName,
      redactedPath: schema.projects.redactedPath,
      firstSeenAt: schema.projects.firstSeenAt,
      lastSeenAt: schema.projects.lastSeenAt,
      sessionCount: count(schema.sessions.id),
    })
    .from(schema.projects)
    .leftJoin(schema.sessions, eq(schema.sessions.projectId, schema.projects.id))
    .groupBy(schema.projects.id)
    .orderBy(desc(schema.projects.lastSeenAt));
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    redactedPath: r.redactedPath,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    sessionCount: Number(r.sessionCount ?? 0),
  }));
}

/** Active recommendations (status = active), newest first. */
export async function listRecommendations(db: DrizzleDb, projectId?: string) {
  const where = projectId
    ? and(
        eq(schema.recommendations.status, "active"),
        eq(schema.recommendations.projectId, projectId),
      )
    : eq(schema.recommendations.status, "active");
  return db
    .select()
    .from(schema.recommendations)
    .where(where)
    .orderBy(desc(schema.recommendations.createdAt));
}

/** The distinct models seen in model_requests (for the session filter UI). */
export async function listModels(db: DrizzleDb): Promise<string[]> {
  const rows = await db
    .select({ modelId: schema.modelRequests.modelId })
    .from(schema.modelRequests);
  return Array.from(new Set(rows.map((r) => r.modelId))).sort();
}
