import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { sources } from "../schema.js";

type Db = DrizzleDb;

export interface SourceRow {
  id: string;
  adapter: string;
  displayName: string;
  version?: string | null;
  enabled: boolean;
}

/** Repository for the `sources` table (spec §10.1). */
export class SourceRepo {
  constructor(private readonly db: Db) {}

  async getById(id: string): Promise<SourceRow | undefined> {
    const rows = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    return rows[0] ? toRow(rows[0]) : undefined;
  }

  /** Insert or update by id (idempotent re-scan). */
  async upsert(row: SourceRow): Promise<void> {
    await this.db
      .insert(sources)
      .values({
        id: row.id,
        adapter: row.adapter,
        displayName: row.displayName,
        version: row.version ?? null,
        enabled: row.enabled,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          adapter: row.adapter,
          displayName: row.displayName,
          version: row.version ?? null,
          enabled: row.enabled,
        },
      });
  }
}

function toRow(r: typeof sources.$inferSelect): SourceRow {
  return {
    id: r.id,
    adapter: r.adapter,
    displayName: r.displayName,
    version: r.version,
    enabled: !!r.enabled,
  };
}
