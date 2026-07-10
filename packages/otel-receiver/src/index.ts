/**
 * @agentlens/otel-receiver — receives OpenTelemetry (OTLP/HTTP JSON) metrics,
 * logs, and traces emitted by Claude Code's telemetry, redacts before
 * persistence, dedups retransmissions, and correlates to scanned sessions
 * (spec §14.6, §14.8, §14.4, §8.4).
 *
 * Runs as a dedicated loopback server (no runtime token — the exporter can't
 * authenticate) with strict content-type + size limits.
 */
export { parseOtlpJson, type OtelKind, type OtelRecord, type OtelParseResult } from "./parse.js";

export { OtelEventRepo, type OtelEventRow } from "./repo.js";

export {
  buildOtelReceiver,
  startOtelReceiver,
  type OtelReceiverOptions,
  type RunningOtelReceiver,
  type OtelIngestResult,
} from "./receiver.js";

export const OTEL_RECEIVER_VERSION = "1.0.0";
