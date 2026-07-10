import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { projects } from "../schema.js";

type Db = DrizzleDb;

export interface ProjectRow {
  id: string;
  sourceId: string;
  displayName: string;
  pathHash: string;
  redactedPath?: string | null;
  repositoryRemoteHash?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Repository for the `projects` table (spec §10.2). */
export class ProjectRepo {
  constructor(private readonly db: Db) {}

  async getByPathHash(sourceId: string, pathHash: string): Promise<ProjectRow | undefined> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.sourceId, sourceId), eq(projects.pathHash, pathHash)))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : undefined;
  }

  async upsert(row: ProjectRow): Promise<void> {
    await this.db
      .insert(projects)
      .values({
        id: row.id,
        sourceId: row.sourceId,
        displayName: row.displayName,
        pathHash: row.pathHash,
        redactedPath: row.redactedPath ?? null,
        repositoryRemoteHash: row.repositoryRemoteHash ?? null,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          displayName: row.displayName,
          redactedPath: row.redactedPath ?? null,
          lastSeenAt: row.lastSeenAt,
        },
      });
  }
}

function toRow(r: typeof projects.$inferSelect): ProjectRow {
  return {
    id: r.id,
    sourceId: r.sourceId,
    displayName: r.displayName,
    pathHash: r.pathHash,
    redactedPath: r.redactedPath,
    repositoryRemoteHash: r.repositoryRemoteHash,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
  };
}
