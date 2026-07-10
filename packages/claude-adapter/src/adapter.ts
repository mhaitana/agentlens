import { basename } from "node:path";
import type {
  DiscoveredSource,
  SourceCapabilities,
  SourceValidationResult,
} from "@agentlens/domain";
import type {
  DiscoveryContext,
  NormalisedSourceEvent,
  ScanInput,
  ScanProgress,
  SourceAdapter,
} from "@agentlens/source-adapter";
import { discoverTranscripts, type DiscoveredTranscript } from "./locations.js";
import { parseTranscriptStream } from "./parser/stream.js";
import { TranscriptNormaliser } from "./normalise.js";
import { ADAPTER_ID, ADAPTER_VERSION, PARSER_VERSION } from "./version.js";

/**
 * The Claude Code source adapter (spec §11, §13.1–13.2).
 *
 * Parse/normalise only — it never mutates transcript files, never persists
 * data, and never applies redaction (the importer does both). One
 * `DiscoveredSource` maps to one transcript `.jsonl` file (one session).
 */
export class ClaudeCodeAdapter implements SourceAdapter {
  readonly id = ADAPTER_ID;
  readonly displayName = "Claude Code";

  /** Override `~/.claude` (tests / non-standard installs). */
  constructor(private readonly claudeHomeOverride?: string) {}

  getCapabilities(): SourceCapabilities {
    return { discovery: true, streaming: true, live: false, costMetrics: true };
  }

  async discover(context: DiscoveryContext): Promise<DiscoveredSource[]> {
    const found = await discoverTranscripts({
      claudeHomeOverride: this.claudeHomeOverride,
      additionalDirectories: context.additionalDirectories,
      excludedProjects: context.excludedProjects,
      followSymlinks: context.followSymlinks,
    });
    return found;
  }

  async validateSource(source: DiscoveredSource): Promise<SourceValidationResult> {
    if (source.adapter !== ADAPTER_ID) {
      return { valid: false, diagnostics: [`adapter mismatch: ${source.adapter}`] };
    }
    return { valid: true, diagnostics: [] };
  }

  async *scan(input: ScanInput): AsyncIterable<NormalisedSourceEvent> {
    const sourceId = input.source.uri;
    const sourceSessionId = basename(input.source.uri, ".jsonl");
    const projectPath = (input.source as DiscoveredTranscript).projectHint ?? input.project;

    const normaliser = new TranscriptNormaliser({ sourceId, sourceSessionId, projectPath });
    let linesProcessed = 0;
    const progress = (p: Partial<ScanProgress>): void => {
      input.onProgress?.({ uri: sourceId, linesProcessed, diagnostics: [], done: false, ...p });
    };

    for await (const parsed of parseTranscriptStream(sourceId, {
      signal: input.signal,
      startOffset: input.startOffset,
    })) {
      linesProcessed = parsed.line;
      if (parsed.record) {
        for (const event of normaliser.push(parsed.record)) {
          if (inRange(event.timestamp, input.since, input.until)) {
            yield event;
          }
        }
      }
      if (parsed.line % 50 === 0) progress({ linesProcessed });
    }

    for (const event of normaliser.flush()) {
      if (inRange(event.timestamp, input.since, input.until)) {
        yield event;
      }
    }

    progress({ done: true, diagnostics: normaliser.getDiagnostics() });
  }
}

function inRange(ts: Date, since?: Date, until?: Date): boolean {
  if (since && ts.getTime() < since.getTime()) return false;
  if (until && ts.getTime() > until.getTime()) return false;
  return true;
}

export { ADAPTER_ID, ADAPTER_VERSION, PARSER_VERSION };
