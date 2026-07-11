import { sha256 } from "@agentlens/shared";
import { eq, schema, type Database } from "@agentlens/database";
import { redactText, redactPath, redactCommand } from "@agentlens/redaction";
import { extractPromptFeatures } from "@agentlens/prompt-coach";
import type { NormalisedSourceEvent, ToolCallEvent } from "@agentlens/source-adapter";
import type { ImportPrivacy } from "./privacy.js";
import type { ReconstructedSession } from "./reconstruct.js";

/**
 * Transactional persistence of one reconstructed session (spec §13.3, §13.5,
 * §8.4). Redaction is applied here — at the persistence boundary — so nothing
 * raw reaches the database or the logs. Inserts are idempotent via
 * deterministic IDs + conflict strategies, so an interrupted/resumed scan can
 * re-run without duplicating rows.
 *
 * Deterministic ID scheme (stable across re-imports):
 *   sessionId      = sess:<sourceId>:<sourceSessionId>
 *   projectId      = proj:<sourceId>:<pathHash>
 *   promptId       = <sessionId>:p:<sequence>
 *   modelRequestId = <sessionId>:m:<sourceMessageId>   (fallback: <isoTimestamp>)
 *   toolCallId      = tc:<sourceId>:<toolUseId>   (fallback: <sessionId>:t:<isoTs>)
 *   fileActivityId     = <toolCallId>:file
 *   commandRunId      = <toolCallId>:cmd
 *   verificationRunId = <toolCallId>:verify
 *   compactionId   = <sessionId>:c:<isoTimestamp>
 */

export interface PersistInput {
  database: Database;
  sourceId: string;
  sourceSessionId: string;
  events: NormalisedSourceEvent[];
  privacy: ImportPrivacy;
  reconstructed: ReconstructedSession;
  /** Adapter version, recorded for import provenance. */
  adapterVersion: string;
  /** Parser version, recorded for reprocess decisions. */
  parserVersion: number;
  nowIso: string;
  /** Delete existing rows for this session before inserting (reprocess case). */
  deleteFirst: boolean;
}

export interface PersistCounts {
  prompts: number;
  modelRequests: number;
  toolCalls: number;
  fileActivity: number;
  commandRuns: number;
  verificationRuns: number;
  compactions: number;
}

export interface PersistResult {
  sessionId: string;
  projectId: string;
  counts: PersistCounts;
}

export async function persistSession(input: PersistInput): Promise<PersistResult> {
  const { database, sourceId, sourceSessionId, events, privacy, reconstructed } = input;
  const sessionId = `sess:${sourceId}:${sourceSessionId}`;

  // Derive the project path from the session-start event (if any).
  const start = events.find((e) => e.kind === "session-start");
  const rawProjectPath = start?.projectPath;
  const project = redactProjectPath(rawProjectPath, sourceId, privacy);
  const projectId = project.id;

  const counts: PersistCounts = {
    prompts: 0,
    modelRequests: 0,
    toolCalls: 0,
    fileActivity: 0,
    commandRuns: 0,
    verificationRuns: 0,
    compactions: 0,
  };

  // Pre-shape all child rows (redaction applied here, before any DB touch).
  const promptRows: (typeof schema.prompts.$inferInsert)[] = [];
  const modelRequestRows: (typeof schema.modelRequests.$inferInsert)[] = [];
  const toolCallRows: (typeof schema.toolCalls.$inferInsert)[] = [];
  const fileActivityRows: (typeof schema.fileActivity.$inferInsert)[] = [];
  const commandRunRows: (typeof schema.commandRuns.$inferInsert)[] = [];
  const verificationRows: (typeof schema.verificationRuns.$inferInsert)[] = [];
  const compactionRows: (typeof schema.compactions.$inferInsert)[] = [];

  for (const event of events) {
    switch (event.kind) {
      case "prompt": {
        const stored = privacy.storeContent
          ? redactText(event.content, privacy.options).redacted
          : null;
        const features = extractPromptFeatures(event.content, event.sequence);
        promptRows.push({
          id: `${sessionId}:p:${event.sequence}`,
          sessionId,
          sequence: event.sequence,
          timestamp: event.timestamp.toISOString(),
          redactedContent: stored,
          contentHash: event.contentHash,
          characterCount: event.content.length,
          approximateTokenCount: Math.ceil(event.content.length / 4),
          features,
        });
        counts.prompts++;
        break;
      }
      case "model-request": {
        const ts = event.timestamp.toISOString();
        const promptId =
          event.promptSequence != null ? `${sessionId}:p:${event.promptSequence}` : null;
        // Prefer the source-native message id (unique per API response) so two
        // requests sharing a second-precision timestamp don't collide.
        const modelRequestId = `${sessionId}:m:${event.sourceMessageId ?? ts}`;
        modelRequestRows.push({
          id: modelRequestId,
          sessionId,
          promptId,
          timestamp: ts,
          modelId: event.modelId,
          modelFamily: event.modelFamily ?? null,
          inputTokens: event.inputTokens ?? null,
          outputTokens: event.outputTokens ?? null,
          cacheReadTokens: event.cacheReadTokens ?? null,
          cacheCreationTokens: event.cacheCreationTokens ?? null,
          estimatedCostUsd: null, // deferred (§13.6 / F009)
          durationMs: event.durationMs ?? null,
          effort: event.effort ?? null,
          querySource: event.querySource ?? "user",
          agentAttribution: event.agentAttribution ?? null,
          skillAttribution: event.skillAttribution ?? null,
          pluginAttribution: event.pluginAttribution ?? null,
          mcpAttribution: event.mcpAttribution ?? null,
          metricProvenance: { tokens: "reported", cost: "unknown" },
        });
        counts.modelRequests++;
        break;
      }
      case "tool-call": {
        const id = toolCallId(sourceId, event);
        const ts = event.timestamp.toISOString();
        const promptId =
          event.promptSequence != null ? `${sessionId}:p:${event.promptSequence}` : null;

        // File activity (only when the tool touched a file).
        if (event.file) {
          const fp = redactFilePath(event.file.rawPath, privacy);
          fileActivityRows.push({
            id: `${id}:file`,
            sessionId,
            toolCallId: id,
            redactedPath: fp.redactedPath ?? null,
            pathHash: fp.pathHash,
            timestamp: ts,
            operation: event.file.operation,
            success: event.success,
            contentSizeBytes: event.file.contentSizeBytes ?? null,
            interveningModification: null,
          });
          counts.fileActivity++;
        }

        // Command + verification (only when the tool ran a shell command).
        if (event.command) {
          const cr = redactCommandRow(event.command.rawCommand, privacy);
          commandRunRows.push({
            id: `${id}:cmd`,
            sessionId,
            toolCallId: id,
            executable: event.command.executable,
            family: event.command.family,
            redactedCommand: cr.redactedCommand,
            normalisedHash: cr.normalisedHash,
            classification: event.command.classification,
            scope: event.command.scope,
            exitSuccess: event.command.exitSuccess,
            durationMs: event.durationMs ?? null,
            outputSizeBytes: event.command.outputSizeBytes ?? null,
            failureSignature: privacy.storeContent
              ? (event.command.failureSignature ?? null)
              : null,
            gitCommitId: event.command.gitCommitId ?? null,
            timestamp: ts,
          });
          counts.commandRuns++;

          if (event.verification) {
            verificationRows.push({
              id: `${id}:verify`,
              sessionId,
              commandRunId: `${id}:cmd`,
              kind: event.verification.kind,
              timestamp: ts,
              success: event.success,
              codeChangedAfter: false, // unknown at import time; filled by later analysis
            });
            counts.verificationRuns++;
          }
        }

        const sanitisedInput = privacy.storeContent
          ? redactText(event.rawInput ?? "", privacy.options).redacted || null
          : null;

        toolCallRows.push({
          id,
          sessionId,
          toolUseId: event.toolUseId ?? null,
          toolName: event.toolName,
          startedAt: ts,
          endedAt: event.durationMs != null ? ts : null,
          durationMs: event.durationMs ?? null,
          success: event.success,
          failureType: event.failureType ?? "unknown",
          permissionOutcome: event.permissionOutcome ?? "unknown",
          sanitisedInput,
          inputSizeBytes: event.inputSizeBytes ?? null,
          outputSizeBytes: event.outputSizeBytes ?? null,
          promptId,
          modelRequestId: null, // tool→model linkage deferred
          subagentAttribution: event.subagentAttribution ?? null,
          sourceProvenance: importProvenance(input.adapterVersion, input.parserVersion),
        });
        counts.toolCalls++;
        break;
      }
      case "compaction": {
        const ts = event.timestamp.toISOString();
        compactionRows.push({
          id: `${sessionId}:c:${ts}`,
          sessionId,
          timestamp: ts,
          trigger: event.trigger,
          success: event.success,
          durationMs: event.durationMs ?? null,
          approximatePreCompactionTokens: event.preCompactionTokens ?? null,
          approximatePostCompactionTokens: event.postCompactionTokens ?? null,
          sourceProvenance: importProvenance(input.adapterVersion, input.parserVersion),
        });
        counts.compactions++;
        break;
      }
      default:
        // session-start / session-end / unknown are not persisted as rows.
        break;
    }
  }

  const provenance = importProvenance(input.adapterVersion, input.parserVersion);

  await database.db.transaction(async (tx) => {
    if (input.deleteFirst) {
      // Delete children before parent (FK order). Idempotent reprocess.
      await tx.delete(schema.fileActivity).where(eq(schema.fileActivity.sessionId, sessionId));
      await tx
        .delete(schema.verificationRuns)
        .where(eq(schema.verificationRuns.sessionId, sessionId));
      await tx.delete(schema.commandRuns).where(eq(schema.commandRuns.sessionId, sessionId));
      await tx.delete(schema.toolCalls).where(eq(schema.toolCalls.sessionId, sessionId));
      await tx.delete(schema.modelRequests).where(eq(schema.modelRequests.sessionId, sessionId));
      await tx.delete(schema.prompts).where(eq(schema.prompts.sessionId, sessionId));
      await tx.delete(schema.compactions).where(eq(schema.compactions.sessionId, sessionId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    }

    // Source + project (shared across sessions; upsert).
    await tx
      .insert(schema.sources)
      .values({
        id: sourceId,
        adapter: "claude-code",
        displayName: "Claude Code",
        version: input.adapterVersion,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: schema.sources.id,
        set: { displayName: "Claude Code", version: input.adapterVersion, enabled: true },
      });

    await tx
      .insert(schema.projects)
      .values({
        id: projectId,
        sourceId,
        displayName: project.displayName,
        pathHash: project.pathHash,
        redactedPath: project.redactedPath ?? null,
        repositoryRemoteHash: null,
        firstSeenAt: input.nowIso,
        lastSeenAt: input.nowIso,
      })
      .onConflictDoUpdate({
        target: schema.projects.id,
        set: {
          displayName: project.displayName,
          redactedPath: project.redactedPath ?? null,
          lastSeenAt: input.nowIso,
        },
      });

    // Session row (upsert so an appended tail refreshes the aggregate counts).
    await tx
      .insert(schema.sessions)
      .values({
        id: sessionId,
        sourceSessionId,
        sourceId,
        projectId,
        startedAt: reconstructed.startedAt,
        endedAt: reconstructed.endedAt ?? null,
        durationMs: reconstructed.durationMs ?? null,
        activeDurationMs: null, // inferred later by analysis (§10.6)
        metricProvenance: sessionProvenance(reconstructed),
        entryPoint: reconstructed.entryPoint,
        sourceVersion: reconstructed.sourceVersion ?? null,
        completionStatus: reconstructed.completionStatus,
        privacyMode: privacy.mode,
        dataCompleteness: reconstructed.dataCompleteness,
        promptCount: reconstructed.promptCount,
        modelRequestCount: reconstructed.modelRequestCount,
        toolCallCount: reconstructed.toolCallCount,
        compactionCount: reconstructed.compactionCount,
        subagentCount: reconstructed.subagentCount,
        importProvenance: provenance,
      })
      .onConflictDoUpdate({
        target: schema.sessions.id,
        set: {
          endedAt: reconstructed.endedAt ?? null,
          durationMs: reconstructed.durationMs ?? null,
          metricProvenance: sessionProvenance(reconstructed),
          sourceVersion: reconstructed.sourceVersion ?? null,
          completionStatus: reconstructed.completionStatus,
          dataCompleteness: reconstructed.dataCompleteness,
          promptCount: reconstructed.promptCount,
          modelRequestCount: reconstructed.modelRequestCount,
          toolCallCount: reconstructed.toolCallCount,
          compactionCount: reconstructed.compactionCount,
          subagentCount: reconstructed.subagentCount,
          importProvenance: provenance,
        },
      });

    // Children: idempotent no-op on conflict (deterministic IDs).
    for (const row of promptRows) {
      await tx
        .insert(schema.prompts)
        .values(row)
        .onConflictDoNothing({ target: schema.prompts.id });
    }
    for (const row of modelRequestRows) {
      await tx
        .insert(schema.modelRequests)
        .values(row)
        .onConflictDoNothing({ target: schema.modelRequests.id });
    }
    for (const row of toolCallRows) {
      await tx
        .insert(schema.toolCalls)
        .values(row)
        .onConflictDoNothing({ target: schema.toolCalls.id });
    }
    for (const row of fileActivityRows) {
      await tx
        .insert(schema.fileActivity)
        .values(row)
        .onConflictDoNothing({ target: schema.fileActivity.id });
    }
    for (const row of commandRunRows) {
      await tx
        .insert(schema.commandRuns)
        .values(row)
        .onConflictDoNothing({ target: schema.commandRuns.id });
    }
    for (const row of verificationRows) {
      await tx
        .insert(schema.verificationRuns)
        .values(row)
        .onConflictDoNothing({ target: schema.verificationRuns.id });
    }
    for (const row of compactionRows) {
      await tx
        .insert(schema.compactions)
        .values(row)
        .onConflictDoNothing({ target: schema.compactions.id });
    }
  });

  return { sessionId, projectId, counts };
}

// ---------------------------------------------------------------------------
// Redaction helpers (mode-aware). Secret detection always runs.
// ---------------------------------------------------------------------------

function importProvenance(adapterVersion: string, parserVersion: number): string {
  return `claude-code@${adapterVersion}/parser@${parserVersion}`;
}

function sessionProvenance(r: ReconstructedSession): object {
  return {
    durationMs: r.durationMs != null ? "reported" : "unknown",
    tokens: "reported", // from Claude's usage field
    cost: "unknown", // not computed in F001
  };
}

interface ProjectRef {
  id: string;
  displayName: string;
  pathHash: string;
  redactedPath?: string;
}

function redactProjectPath(
  rawPath: string | undefined,
  sourceId: string,
  privacy: ImportPrivacy,
): ProjectRef {
  if (!rawPath) {
    // No cwd recorded — use a stable synthetic project so sessions are still
    // grouped (rather than orphaned). pathHash is a hash, not a path, so it
    // reveals nothing.
    const pathHash = sha256("path:__unknown__");
    return {
      id: `proj:${sourceId}:${pathHash}`,
      displayName: "unknown project",
      pathHash,
      redactedPath: undefined,
    };
  }
  const rp = redactPath(rawPath, privacy.options);
  const displayName = rp.redactedPath ?? rawPath;
  return {
    id: `proj:${sourceId}:${rp.pathHash}`,
    displayName,
    pathHash: rp.pathHash,
    redactedPath: privacy.storeContent ? rp.redactedPath : undefined,
  };
}

function redactFilePath(
  rawPath: string | undefined,
  privacy: ImportPrivacy,
): { redactedPath?: string; pathHash: string } {
  if (!rawPath) {
    return { pathHash: sha256("path:__none__") };
  }
  const rp = redactPath(rawPath, privacy.options);
  return {
    redactedPath: privacy.storeContent ? rp.redactedPath : undefined,
    pathHash: rp.pathHash,
  };
}

function redactCommandRow(
  rawCommand: string,
  privacy: ImportPrivacy,
): { redactedCommand: string; normalisedHash: string } {
  if (!privacy.storeContent) {
    // Metadata-only: never persist command text (§8.1). The hash is still
    // computed from the redacted command so repetition detection works; only
    // the executable label is kept as the (non-revealing) stored string.
    const cr = redactCommand(rawCommand, privacy.options);
    return { redactedCommand: "[metadata-only]", normalisedHash: cr.normalisedHash };
  }
  const cr = redactCommand(rawCommand, privacy.options);
  return { redactedCommand: cr.redactedCommand, normalisedHash: cr.normalisedHash };
}

function toolCallId(sourceId: string, event: ToolCallEvent): string {
  if (event.toolUseId) return `tc:${sourceId}:${event.toolUseId}`;
  return `tc:${sourceId}:t:${event.timestamp.toISOString()}`;
}
