import { createReadStream, type ReadStream } from "node:fs";
import { parseLine, type ParsedLine, type ParserDiagnostic } from "./schema.js";

export interface StreamOptions {
  /** Cancellation. */
  signal?: AbortSignal;
  /** Resume reading at this byte offset (spec §13.3). */
  startOffset?: number;
}

/**
 * Stream a Claude Code transcript JSONL file line-by-line without loading it
 * all into memory (spec §13.2).
 *
 * Yields one {@link ParsedLine} per physical line, with byte offsets relative
 * to the file. An incomplete final line (no trailing newline) is still yielded
 * so the caller can decide whether to process or wait; its `terminated` flag
 * will be false. Malformed JSON and unknown record types produce diagnostics
 * but never abort the stream.
 */
export async function* parseTranscriptStream(
  filePath: string,
  opts: StreamOptions = {},
): AsyncIterable<ParsedLine> {
  const start = Math.max(0, Math.floor(opts.startOffset ?? 0));
  const stream = createReadStream(filePath, { start, autoClose: true });
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => stream.destroy(new Error("aborted")), {
      once: true,
    });
  }

  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  /** File offset of the first byte in `pending`. */
  let pendingStart = start;
  let lineNo = 0;

  try {
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      pending = pending.length ? Buffer.concat([pending, buf]) : buf;

      let pos = 0;
      let lineStart = pendingStart;
      while (true) {
        const nl = pending.indexOf(0x0a, pos);
        if (nl < 0) break;
        const lineBytes = pending.subarray(pos, nl);
        lineNo++;
        const text = lineBytes.toString("utf8");
        const parsed = parseLine(text, lineNo);
        parsed.byteOffset = lineStart;
        parsed.endByteOffset = lineStart + lineBytes.length + 1; // include newline
        yield parsed;
        lineStart += lineBytes.length + 1;
        pos = nl + 1;
      }

      // Keep the trailing partial line in the buffer.
      pending = pending.subarray(pos);
      pendingStart = lineStart;
    }

    // Incomplete final line (no trailing newline).
    if (pending.length > 0) {
      lineNo++;
      const text = pending.toString("utf8");
      const parsed = parseLine(text, lineNo);
      parsed.byteOffset = pendingStart;
      parsed.endByteOffset = pendingStart + pending.length; // no newline
      yield parsed;
    }
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
}

/** Drain a stream into an array of parsed lines + aggregated diagnostics. */
export async function collectStream(
  filePath: string,
  opts: StreamOptions = {},
): Promise<{ lines: ParsedLine[]; diagnostics: ParserDiagnostic[] }> {
  const lines: ParsedLine[] = [];
  const diagnostics: ParserDiagnostic[] = [];
  for await (const parsed of parseTranscriptStream(filePath, opts)) {
    lines.push(parsed);
    if (parsed.diagnostics.length) diagnostics.push(...parsed.diagnostics);
  }
  return { lines, diagnostics };
}

export { parseLine, type ReadStream };
