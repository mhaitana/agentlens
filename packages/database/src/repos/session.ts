import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { Session } from "@agentlens/domain";
import { sessions } from "../schema.js";

type Db = LibSQLDatabase<Record<string, never>>;

/** Row shape inserted into the sessions table. */
export interface SessionRow {
  id: string;
  sourceSessionId: string;
  sourceId: string;
  projectId: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  activeDurationMs?: number | null;
  metricProvenance?: unknown;
  entryPoint: string;
  sourceVersion?: string | null;
  completionStatus: string;
  privacyMode: string;
  dataCompleteness: string[];
  promptCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;
  importProvenance: string;
}

/** Minimal session repository proving the Drizzle integration. Full repos
 *  (prompts, tool calls, file activity, …) are added in feature F001. */
export class SessionRepo {
  constructor(private readonly db: Db) {}

  async insert(row: SessionRow): Promise<void> {
    await this.db.insert(sessions).values({
      id: row.id,
      sourceSessionId: row.sourceSessionId,
      sourceId: row.sourceId,
      projectId: row.projectId,
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? null,
      durationMs: row.durationMs ?? null,
      activeDurationMs: row.activeDurationMs ?? null,
      metricProvenance: (row.metricProvenance as object) ?? null,
      entryPoint: row.entryPoint,
      sourceVersion: row.sourceVersion ?? null,
      completionStatus: row.completionStatus,
      privacyMode: row.privacyMode,
      dataCompleteness: row.dataCompleteness,
      promptCount: row.promptCount,
      modelRequestCount: row.modelRequestCount,
      toolCallCount: row.toolCallCount,
      compactionCount: row.compactionCount,
      subagentCount: row.subagentCount,
      importProvenance: row.importProvenance,
    });
  }

  async getById(id: string): Promise<SessionRow | undefined> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    const r = rows[0];
    if (!r) return undefined;
    return toRow(r);
  }

  async list(limit = 50): Promise<SessionRow[]> {
    const rows = await this.db.select().from(sessions).limit(limit);
    return rows.map(toRow);
  }
}

function toRow(r: typeof sessions.$inferSelect): SessionRow {
  return {
    id: r.id,
    sourceSessionId: r.sourceSessionId,
    sourceId: r.sourceId,
    projectId: r.projectId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    activeDurationMs: r.activeDurationMs,
    metricProvenance: r.metricProvenance,
    entryPoint: r.entryPoint,
    sourceVersion: r.sourceVersion,
    completionStatus: r.completionStatus,
    privacyMode: r.privacyMode,
    dataCompleteness: r.dataCompleteness as string[],
    promptCount: r.promptCount,
    modelRequestCount: r.modelRequestCount,
    toolCallCount: r.toolCallCount,
    compactionCount: r.compactionCount,
    subagentCount: r.subagentCount,
    importProvenance: r.importProvenance,
  };
}

export type { Session };
