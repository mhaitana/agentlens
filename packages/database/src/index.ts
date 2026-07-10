/**
 * @agentlens/database — SQLite (libsql) + Drizzle schema, versioned migrations,
 * and repositories (spec §5.4, §10, §13.3).
 */

export * as schema from "./schema.js";
export {
  openDatabase,
  closeDatabase,
  migrateDatabase,
  splitStatements,
  LATEST_SCHEMA_VERSION,
  type Database,
} from "./client.js";

export { MIGRATIONS, type Migration } from "./migrations.js";

export { SessionRepo, type SessionRow } from "./repos/session.js";
