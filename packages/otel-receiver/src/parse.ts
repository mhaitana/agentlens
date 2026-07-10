/**
 * Tolerant OTLP/JSON parsing (spec §14.6, §14.8, §12).
 *
 * Claude Code emits OpenTelemetry via the standard OTLP exporter. We accept
 * OTLP/JSON (`application/json`) — the user configures the exporter protocol to
 * `http/json` via `agentlens telemetry print-env` (§14.7). Protobuf is rejected
 * with a clear 415 so the receiver needs no protobuf dependency.
 *
 * Parsers are defensive: missing/extra fields, unknown metric instruments, and
 * malformed records are skipped (counted) rather than aborting the batch (§14.2
 * "tolerate missing/new/removed fields"). Do not assume every version emits
 * every field (§14.8).
 */

export type OtelKind = "metric" | "log" | "trace";

/** A normalised OTLP record, ready for redaction + persistence. */
export interface OtelRecord {
  kind: OtelKind;
  /** Metric/log/trace name. */
  name?: string;
  /** ISO timestamp derived from the record's time field, or undefined. */
  timestamp?: string;
  /** Source session id, when attributable from resource attributes. */
  sourceSessionId?: string;
  /** The normalised record body (redacted before persist). */
  body: Record<string, unknown>;
  /** Parser diagnostics. */
  diagnostics: string[];
}

export interface OtelParseResult {
  records: OtelRecord[];
  /** Count of records skipped due to malformed structure. */
  skipped: number;
  diagnostics: string[];
}

/** Parse an OTLP/JSON body of a given kind. Never throws. */
export function parseOtlpJson(kind: OtelKind, body: string): OtelParseResult {
  const diagnostics: string[] = [];
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return { records: [], skipped: 0, diagnostics: ["OTLP body is not valid JSON"] };
  }
  if (!root || typeof root !== "object") {
    return { records: [], skipped: 0, diagnostics: ["OTLP body is not a JSON object"] };
  }

  const obj = root as Record<string, unknown>;
  const records: OtelRecord[] = [];
  let skipped = 0;

  if (kind === "metric") {
    const groups = asArray(obj["resourceMetrics"]);
    for (const g of groups) {
      const resource = (g as Record<string, unknown>)?.["resource"] as
        Record<string, unknown> | undefined;
      const sessionId = sessionIdFromResource(resource);
      const scopes = asArray((g as Record<string, unknown>)?.["scopeMetrics"]);
      for (const s of scopes) {
        const metrics = asArray((s as Record<string, unknown>)?.["metrics"]);
        for (const m of metrics) {
          if (!m || typeof m !== "object") {
            skipped++;
            continue;
          }
          const rec = m as Record<string, unknown>;
          records.push({
            kind,
            name: asString(rec["name"]),
            timestamp: isoFromUnixNano(asNumber(rec["timeUnixNano"])),
            sourceSessionId: sessionId,
            body: rec,
            diagnostics: [],
          });
        }
      }
    }
  } else if (kind === "log") {
    const groups = asArray(obj["resourceLogs"]);
    for (const g of groups) {
      const resource = (g as Record<string, unknown>)?.["resource"] as
        Record<string, unknown> | undefined;
      const sessionId = sessionIdFromResource(resource);
      const scopes = asArray((g as Record<string, unknown>)?.["scopeLogs"]);
      for (const s of scopes) {
        const logRecords = asArray((s as Record<string, unknown>)?.["logRecords"]);
        for (const lr of logRecords) {
          if (!lr || typeof lr !== "object") {
            skipped++;
            continue;
          }
          const rec = lr as Record<string, unknown>;
          records.push({
            kind,
            name: asString(rec["name"]) ?? "log",
            timestamp: isoFromUnixNano(asNumber(rec["timeUnixNano"])),
            sourceSessionId: sessionId,
            body: rec,
            diagnostics: [],
          });
        }
      }
    }
  } else {
    const groups = asArray(obj["resourceSpans"]);
    for (const g of groups) {
      const resource = (g as Record<string, unknown>)?.["resource"] as
        Record<string, unknown> | undefined;
      const sessionId = sessionIdFromResource(resource);
      const scopes = asArray((g as Record<string, unknown>)?.["scopeSpans"]);
      for (const s of scopes) {
        const spans = asArray((s as Record<string, unknown>)?.["spans"]);
        for (const sp of spans) {
          if (!sp || typeof sp !== "object") {
            skipped++;
            continue;
          }
          const rec = sp as Record<string, unknown>;
          records.push({
            kind,
            name: asString(rec["name"]),
            timestamp: isoFromUnixNano(asNumber(rec["startTimeUnixNano"])),
            sourceSessionId: sessionId,
            body: rec,
            diagnostics: [],
          });
        }
      }
    }
  }

  if (records.length === 0 && skipped === 0) {
    diagnostics.push(`no ${kind} records found in body`);
  }
  return { records, skipped, diagnostics };
}

/** Extract a session id from OTLP resource attributes if present. */
function sessionIdFromResource(resource: Record<string, unknown> | undefined): string | undefined {
  if (!resource) return undefined;
  const attrs = resource["attributes"];
  if (!Array.isArray(attrs)) return undefined;
  for (const attr of attrs) {
    if (!attr || typeof attr !== "object") continue;
    const a = attr as Record<string, unknown>;
    const key = asString(a["key"]);
    if (
      key === "session.id" ||
      key === "claude.session_id" ||
      key === "session_id" ||
      key === "claude_code.session.id"
    ) {
      const value = a["value"] as Record<string, unknown> | undefined;
      return asString(value?.["stringValue"]) ?? asString(value?.["intValue"]);
    }
  }
  return undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

/** Convert a unix-nanosecond value to an ISO string, or undefined. */
function isoFromUnixNano(nano: number | undefined): string | undefined {
  if (nano === undefined || !Number.isFinite(nano) || nano <= 0) return undefined;
  const ms = Math.floor(nano / 1_000_000);
  return new Date(ms).toISOString();
}
