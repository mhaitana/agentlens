import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { scanState } from "../schema.js";

type Db = DrizzleDb;

export interface ScanStateRow {
  sourceId: string;
  uri: string;
  fileIdentity?: string | null;
  size?: number | null;
  mtime?: number | null;
  lastByteOffset?: number | null;
  lastLine?: number | null;
  rollingHash?: string | null;
  importVersion: number;
  updatedAt: string;
}

/** Incremental-import bookkeeping (spec §13.3). Keyed by (sourceId, uri). */
export class ScanStateRepo {
  constructor(private readonly db: Db) {}

  async get(sourceId: string, uri: string): Promise<ScanStateRow | undefined> {
    const rows = await this.db
      .select()
      .from(scanState)
      .where(and(eq(scanState.sourceId, sourceId), eq(scanState.uri, uri)))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : undefined;
  }

  async upsert(row: ScanStateRow): Promise<void> {
    await this.db
      .insert(scanState)
      .values({
        sourceId: row.sourceId,
        uri: row.uri,
        fileIdentity: row.fileIdentity ?? null,
        size: row.size ?? null,
        mtime: row.mtime ?? null,
        lastByteOffset: row.lastByteOffset ?? null,
        lastLine: row.lastLine ?? null,
        rollingHash: row.rollingHash ?? null,
        importVersion: row.importVersion,
        updatedAt: row.updatedAt,
      })
      .onConflictDoUpdate({
        target: [scanState.sourceId, scanState.uri],
        set: {
          fileIdentity: row.fileIdentity ?? null,
          size: row.size ?? null,
          mtime: row.mtime ?? null,
          lastByteOffset: row.lastByteOffset ?? null,
          lastLine: row.lastLine ?? null,
          rollingHash: row.rollingHash ?? null,
          importVersion: row.importVersion,
          updatedAt: row.updatedAt,
        },
      });
  }

  async delete(sourceId: string, uri: string): Promise<void> {
    await this.db
      .delete(scanState)
      .where(and(eq(scanState.sourceId, sourceId), eq(scanState.uri, uri)));
  }
}

function toRow(r: typeof scanState.$inferSelect): ScanStateRow {
  return {
    sourceId: r.sourceId,
    uri: r.uri,
    fileIdentity: r.fileIdentity,
    size: r.size,
    mtime: r.mtime,
    lastByteOffset: r.lastByteOffset,
    lastLine: r.lastLine,
    rollingHash: r.rollingHash,
    importVersion: r.importVersion,
    updatedAt: r.updatedAt,
  };
}
