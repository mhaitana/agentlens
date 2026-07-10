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
  type DrizzleDb,
} from "./client.js";

export { MIGRATIONS, type Migration } from "./migrations.js";

// Re-export query helpers so app layers can build typed queries against the
// schema without depending on drizzle-orm directly.
export { eq, and, inArray } from "drizzle-orm";

export { SessionRepo, type SessionRow } from "./repos/session.js";
export { SourceRepo, type SourceRow } from "./repos/source.js";
export { ProjectRepo, type ProjectRow } from "./repos/project.js";
export { ScanStateRepo, type ScanStateRow } from "./repos/scan-state.js";
