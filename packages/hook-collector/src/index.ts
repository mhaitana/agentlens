/**
 * @agentlens/hook-collector — ingests Claude Code hook events (PreToolUse,
 * PostToolUse, Stop, …) via a loopback HTTP endpoint and the local spool,
 * redacts before persistence, dedups, and correlates to scanned sessions
 * (spec §14.2, §14.3, §14.4, §8.4).
 *
 * The plugin's hook script (plugins/agentlens-claude) is the capture client; this
 * package is the server side: tolerant parse, redaction, dedup-persist, spool
 * drain, correlation, and the loopback ingest route.
 */
export { parseHookStdin, KNOWN_HOOK_EVENTS, type ParsedHookEvent } from "./parse.js";

export { redactHookEvent, buildHookRedactionOptions, type RedactedHookEvent } from "./redact.js";

export { HookEventRepo, type HookEventRow } from "./repo.js";

export {
  spoolDir,
  spoolBacklog,
  writeSpool,
  readSpool,
  drainSpool,
  watchSpool,
  type SpooledEvent,
} from "./spool.js";

export {
  ingestHookEvent,
  registerHookIngestRoutes,
  notifyIngest,
  type IngestDeps,
  type IngestResult,
} from "./ingest.js";

export {
  correlateEventToSession,
  type CorrelationInput,
  type CorrelationResult,
} from "./correlate.js";

export const HOOK_COLLECTOR_VERSION = "1.0.0";
