import { open } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { DiscoveredSource, SourceCapabilities } from "@agentlens/domain";
import type { DiscoveryContext, ParserDiagnostic, SourceAdapter } from "@agentlens/source-adapter";
import { ADAPTER_ID, ADAPTER_VERSION, PARSER_VERSION } from "@agentlens/claude-adapter";
import type { Database } from "@agentlens/database";
import { ScanStateRepo } from "@agentlens/database";
import { decideImport, type IncrementalDecision } from "./incremental.js";
import { reconstructSession } from "./reconstruct.js";
import { persistSession, type PersistCounts } from "./persist.js";
import type { ImportPrivacy } from "./privacy.js";
import { redactPath } from "@agentlens/redaction";

/**
 * The import pipeline orchestrator (spec §13.3, §13.5).
 *
 * For each discovered source: stat the file → decide skip/re-import/append →
 * stream-parse + normalise → reconstruct → redact-at-boundary → persist in one
 * transaction → update scan_state. F001 always re-reads from byte 0; duplicate
 * events are de-duplicated by deterministic IDs + `onConflictDoNothing`, so an
 * interrupted scan resumes cleanly without orphaning tool results.
 */

export interface PipelineOptions {
  database: Database;
  adapter: SourceAdapter;
  privacy: ImportPrivacy;
  discovery: DiscoveryContext;
  since?: Date;
  until?: Date;
  /** Restrict to a single project path. */
  project?: string;
  dryRun: boolean;
  /** Re-import every discovered file even if unchanged (spec §16 --force). */
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: PipelineProgress) => void;
}

export type PipelinePhase = "discover" | "decide" | "scan" | "persist" | "skip" | "done";

export interface PipelineProgress {
  uri: string;
  phase: PipelinePhase;
  linesProcessed?: number;
  diagnostics?: ParserDiagnostic[];
  done: boolean;
}

export interface PipelineFileResult {
  uri: string;
  sourceSessionId: string;
  decision: IncrementalDecision;
  counts?: PersistCounts;
  sessionId?: string;
  diagnostics: ParserDiagnostic[];
}

export interface PipelineResult {
  discovered: number;
  imported: number;
  skipped: number;
  files: PipelineFileResult[];
}

const HEAD_BYTES = 64 * 1024;

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const scanStateRepo = new ScanStateRepo(opts.database.db);
  const files: PipelineFileResult[] = [];

  const emit = (uri: string, phase: PipelinePhase, extra: Partial<PipelineProgress>): void => {
    opts.onProgress?.({ uri, phase, done: false, ...extra });
  };

  emit("", "discover", {});
  const discovered = await opts.adapter.discover(opts.discovery);
  let imported = 0;
  let skipped = 0;

  for (const source of discovered) {
    if (opts.signal?.aborted) break;
    const result = await importOne(source, opts, scanStateRepo, emit);
    files.push(result);
    if (result.decision.skip) skipped++;
    else if (!opts.dryRun) imported++;
  }

  emit("", "done", { done: true });
  return { discovered: discovered.length, imported, skipped, files };
}

async function importOne(
  source: DiscoveredSource,
  opts: PipelineOptions,
  scanStateRepo: ScanStateRepo,
  emit: (uri: string, phase: PipelinePhase, extra: Partial<PipelineProgress>) => void,
): Promise<PipelineFileResult> {
  const uri = source.uri;
  const sourceSessionId = basename(uri, ".jsonl");
  const diagnostics: ParserDiagnostic[] = [];
  // One stable source row per adapter (spec §10.1): "claude-code".
  const sourceId = ADAPTER_ID;

  // Stat the file for incremental decision + scan_state bookkeeping.
  let size = 0;
  let mtime = 0;
  let headHash = "";
  try {
    const stat = await fileStat(uri);
    size = stat.size;
    mtime = stat.mtimeMs;
    headHash = await headSha256(uri, stat.size);
  } catch (err) {
    diagnostics.push({ level: "error", uri, message: `stat failed: ${messageOf(err)}` });
    return {
      uri,
      sourceSessionId,
      decision: { skip: true, delete: false, reason: `stat failed: ${messageOf(err)}` },
      diagnostics,
    };
  }

  // Non-revealing storage key for scan_state: a path hash, not the raw path.
  // The raw uri is used only in memory to (re-)read the file; nothing about the
  // developer's home directory is ever persisted (§8.4 redaction-before-persist).
  const storageKey = redactPath(uri, opts.privacy.options).pathHash;

  const state = await scanStateRepo.get(sourceId, storageKey);
  let decision = decideImport({ state, size, mtime, headHash, parserVersion: PARSER_VERSION });
  // --force overrides the incremental decision: re-import even if unchanged.
  if (opts.force) decision = { skip: false, delete: true, reason: "forced re-import" };
  emit(uri, "decide", {});

  if (decision.skip) {
    emit(uri, "skip", { done: true });
    return { uri, sourceSessionId, decision, diagnostics };
  }

  // Stream-parse + normalise. F001 re-reads from byte 0 (idempotent inserts).
  const events = [];
  let lastLine = state?.lastLine ?? 0;
  for await (const event of opts.adapter.scan({
    source,
    since: opts.since,
    until: opts.until,
    project: opts.project,
    dryRun: opts.dryRun,
    signal: opts.signal,
    onProgress: (p) => {
      if (p.uri)
        emit(p.uri, "scan", { linesProcessed: p.linesProcessed, diagnostics: p.diagnostics });
      if (p.done) {
        lastLine = p.linesProcessed;
        if (p.diagnostics.length) diagnostics.push(...p.diagnostics);
      }
    },
  })) {
    events.push(event);
  }
  emit(uri, "scan", { linesProcessed: lastLine });

  const reconstructed = reconstructSession(events);

  let counts: PersistCounts | undefined;
  let sessionId: string | undefined;
  if (!opts.dryRun) {
    emit(uri, "persist", {});
    const persisted = await persistSession({
      database: opts.database,
      sourceId,
      sourceSessionId,
      events,
      privacy: opts.privacy,
      reconstructed,
      adapterVersion: ADAPTER_VERSION,
      parserVersion: PARSER_VERSION,
      nowIso: new Date().toISOString(),
      deleteFirst: decision.delete,
    });
    counts = persisted.counts;
    sessionId = persisted.sessionId;

    // Record scan_state so the next run can skip / detect changes.
    await scanStateRepo.upsert({
      sourceId,
      uri: storageKey,
      fileIdentity: headHash,
      size,
      mtime,
      lastByteOffset: size,
      lastLine,
      rollingHash: headHash,
      importVersion: PARSER_VERSION,
      updatedAt: new Date().toISOString(),
    });
  }

  emit(uri, "done", { done: true });
  return { uri, sourceSessionId, decision, counts, sessionId, diagnostics };
}

interface FileStat {
  size: number;
  mtimeMs: number;
}

async function fileStat(path: string): Promise<FileStat> {
  const fh = await open(path, "r");
  try {
    const st = await fh.stat();
    return { size: st.size, mtimeMs: st.mtimeMs };
  } finally {
    await fh.close();
  }
}

/** sha256 of the first {@link HEAD_BYTES} of the file, for replacement detection. */
async function headSha256(path: string, size: number): Promise<string> {
  const fh = await open(path, "r");
  try {
    const len = Math.min(HEAD_BYTES, size);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return createHash("sha256").update(buf).digest("hex");
  } finally {
    await fh.close();
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { ADAPTER_ID, PARSER_VERSION };
export type { SourceCapabilities };
