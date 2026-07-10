/**
 * Hook-event redaction (spec §8.4, §14.3, §19).
 *
 * Hook payloads are untrusted (§19): even though the plugin hook script already
 * redacts secrets before POST/spool, the collector re-applies the full
 * @agentlens/redaction pipeline before persistence so a malformed or hostile
 * payload can never land a secret in the database or logs. The result carries a
 * stable hash of the *redacted* payload (never the original) for dedup + correlation.
 */
import { homedir } from "node:os";
import {
  redactText,
  redactPath,
  compileCustomPatterns,
  type RedactionOptions,
} from "@agentlens/redaction";
import { sha256, stableStringify } from "@agentlens/shared";
import type { AgentLensConfig } from "@agentlens/config";
import type { ParsedHookEvent } from "./parse.js";

/** A hook event after redaction, ready to persist. */
export interface RedactedHookEvent {
  hookEventName: string;
  known: boolean;
  sourceSessionId?: string;
  promptId?: string;
  toolName?: string;
  agentId?: string;
  agentType?: string;
  /** Redacted cwd path (e.g. "[HOME]/projects/x"). */
  cwdRedactedPath?: string;
  /** Stable hash of the redacted cwd (correlates to a project by path). */
  cwdHash?: string;
  /** Fully-redacted passthrough payload (JSON-safe object). */
  redactedPayload: Record<string, unknown>;
  /** Stable hash of the redacted payload (dedup + correlation). */
  payloadHash: string;
  receivedAt: string;
  timestamp: string;
  diagnostics: string[];
}

/**
 * Build redaction options from the active config. In `metadata-only` mode the
 * content-bearing fields (prompt, tool_input, tool_response) are dropped; the
 * envelope is still redacted. In `redacted-content` (default) and `full-local`,
 * content is retained but secret/path redaction always runs — secrets are never
 * persisted in any mode (§3.2, §8.3).
 */
export function buildHookRedactionOptions(
  config: AgentLensConfig,
  repoPath?: string,
): RedactionOptions {
  const mode = config.privacy.mode;
  return {
    redactEmails: config.privacy.redactEmails,
    redactHomePath: mode === "redacted-content" ? true : config.privacy.redactHomePath,
    homePath: homedir(),
    repoPath,
    anonymiseRepoPath: mode === "redacted-content",
    customPatterns: compileCustomPatterns(config.privacy.customPatterns ?? []),
  };
}

/** Redact a parsed hook event into a persistable {@link RedactedHookEvent}. */
export function redactHookEvent(
  parsed: ParsedHookEvent,
  options: RedactionOptions,
  mode: AgentLensConfig["privacy"]["mode"],
): RedactedHookEvent {
  const raw = stripContentForMode(parsed.raw, mode);

  // Redact the whole envelope as text so secrets anywhere in the payload
  // (paths, tool_input nested values, …) are stripped before persistence.
  const envelope = stableStringify(raw);
  const redacted = redactText(envelope, options);
  let redactedPayload: Record<string, unknown>;
  try {
    redactedPayload = JSON.parse(redacted.redacted) as Record<string, unknown>;
  } catch {
    // redactText only swaps substrings; JSON stays valid. Guard anyway.
    redactedPayload = { redacted: redacted.redacted };
  }

  let cwdRedactedPath: string | undefined;
  let cwdHash: string | undefined;
  if (parsed.cwd) {
    const rp = redactPath(parsed.cwd, { ...options, anonymiseRepoPath: false });
    cwdRedactedPath = rp.redactedPath;
    cwdHash = rp.pathHash;
  }

  return {
    hookEventName: parsed.hookEventName,
    known: parsed.known,
    sourceSessionId: parsed.sourceSessionId,
    promptId: parsed.promptId,
    toolName: parsed.toolName,
    agentId: parsed.agentId,
    agentType: parsed.agentType,
    cwdRedactedPath,
    cwdHash,
    redactedPayload,
    payloadHash: sha256(redacted.redacted),
    receivedAt: parsed.receivedAt,
    timestamp: parsed.timestamp,
    diagnostics: parsed.diagnostics,
  };
}

/**
 * In `metadata-only` mode drop content-bearing fields so no prompt text or tool
 * I/O is persisted (§8.1). Keep the envelope + structural metadata. Unknown
 * event names keep their (already-opaque) `_malformed` marker truncated, since
 * that is diagnostic metadata, not user content.
 */
function stripContentForMode(
  raw: Record<string, unknown>,
  mode: AgentLensConfig["privacy"]["mode"],
): Record<string, unknown> {
  if (mode !== "metadata-only") return { ...raw };
  const drop = new Set([
    "prompt",
    "tool_input",
    "tool_response",
    "message",
    "last_assistant_message",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (drop.has(k)) {
      out[k] = typeof v === "string" ? `[metadata-only: ${v.length} chars]` : "[metadata-only]";
    } else {
      out[k] = v;
    }
  }
  return out;
}
