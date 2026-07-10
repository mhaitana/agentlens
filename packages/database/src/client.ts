import { createClient, type Client as LibSqlClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { ensureDataDirs, databasePath, restrictFile } from "@agentlens/config";
import * as schema from "./schema.js";
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from "./migrations.js";

/** Bundled libsql client + drizzle instance. */
export interface Database {
  client: LibSqlClient;
  db: LibSQLDatabase<typeof schema>;
  path: string;
}

/**
 * Open (or create) the AgentLens database and run pending migrations.
 *
 * @param home AgentLens data home (config resolves the SQLite path inside it).
 * @param nowIso ISO timestamp recorded for migration application.
 * @param inMemory when true, use an ephemeral in-memory database (tests).
 */
export async function openDatabase(opts: {
  home: string;
  nowIso: string;
  inMemory?: boolean;
}): Promise<Database> {
  const path = opts.inMemory ? ":memory:" : databasePath(opts.home);

  if (!opts.inMemory) {
    await ensureDataDirs(opts.home);
  }

  const client = createClient({
    url: opts.inMemory ? ":memory:" : `file:${path}`,
  });

  await applyPragmas(client, opts.inMemory ?? false);
  await migrateDatabase(client, opts.nowIso);

  if (!opts.inMemory) {
    await restrictFile(path, 0o600).catch(() => undefined);
  }

  const db = drizzle(client, { schema });
  return { client, db, path };
}

/** Close the underlying client. */
export async function closeDatabase(database: Database): Promise<void> {
  await database.client.close();
}

async function applyPragmas(client: LibSqlClient, inMemory: boolean): Promise<void> {
  // Foreign keys are enforced per-connection (SQLite default off).
  await safeExec(client, "PRAGMA foreign_keys = ON;");
  if (!inMemory) {
    // WAL where supported; ignored on in-memory databases.
    await safeExec(client, "PRAGMA journal_mode = WAL;").catch(() => undefined);
  }
}

/** Apply all migrations newer than the recorded schema version. */
export async function migrateDatabase(client: LibSqlClient, nowIso: string): Promise<void> {
  await safeExec(
    client,
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL);",
  );
  const current = await currentVersion(client);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    for (const stmt of splitStatements(migration.sql)) {
      await client.execute(stmt);
    }
    await client.execute({
      sql: "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
      args: [migration.version, nowIso],
    });
  }
}

async function currentVersion(client: LibSqlClient): Promise<number> {
  const result = await client.execute("SELECT MAX(version) AS v FROM schema_version;");
  const row = result.rows[0] as { v?: number | bigint | null } | undefined;
  const v = row?.v;
  if (v === null || v === undefined) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

async function safeExec(client: LibSqlClient, sql: string): Promise<void> {
  await client.execute(sql);
}

/** Split a multi-statement SQL string into individual statements. Our DDL
 *  contains no quoted semicolons, so a naive split is sufficient and safe. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export { LATEST_SCHEMA_VERSION };
