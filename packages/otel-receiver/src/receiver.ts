/**
 * OTLP/HTTP receiver (spec §14.6).
 *
 * A dedicated loopback Fastify server — separate from the token-gated API —
 * because Claude Code's OTLP exporter cannot send our runtime token. It binds
 * 127.0.0.1 only (§19.1, §14.6 "never expose externally by default"), enforces a
 * strict request-size limit, accepts only `application/json` OTLP/JSON
 * (rejecting protobuf with a 415 + guidance to set `http/json`), redacts before
 * persistence (§8.4), dedups retransmissions, and exposes health/readiness.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { createServer as createNetServer } from "node:net";
import type { DrizzleDb } from "@agentlens/database";
import type { AgentLensConfig } from "@agentlens/config";
import { redactText, compileCustomPatterns } from "@agentlens/redaction";
import { sha256, stableStringify } from "@agentlens/shared";
import { homedir } from "node:os";
import { parseOtlpJson, type OtelKind } from "./parse.js";
import { OtelEventRepo } from "./repo.js";

export interface OtelIngestResult {
  ok: true;
  kind: OtelKind;
  received: number;
  inserted: number;
  deduped: number;
  skipped: number;
  diagnostics: unknown;
}

export interface OtelReceiverOptions {
  db: DrizzleDb;
  config: AgentLensConfig;
  /** Preferred loopback port; 0 = OS-assigned. */
  preferredPort?: number;
  /** Max request body size (bytes). Default 512 KiB. */
  bodyLimit?: number;
  /**
   * Optional callback fired after each OTLP ingest. The live collector uses it
   * to broadcast a Server-Sent Event (§14.10). Never throws into the request.
   */
  onIngest?: (result: OtelIngestResult) => void;
}

export interface RunningOtelReceiver {
  port: number;
  host: string;
  close: () => Promise<void>;
}

/** Strict per-request body limit for OTLP (§14.6, §19.1). */
const DEFAULT_OTLP_BODY_LIMIT = 512 * 1024;

/** Accept only OTLP/JSON; reject protobuf with a clear, actionable error. */
function assertJsonContentType(contentType: string | undefined): string | null {
  if (!contentType) return "missing Content-Type";
  const ct = contentType.toLowerCase();
  if (ct.includes("application/json")) return null;
  if (ct.includes("protobuf")) {
    return "protobuf OTLP is not supported — set OTEL_EXPORTER_OTLP_PROTOCOL=http/json (see `agentlens telemetry print-env`)";
  }
  return `unsupported Content-Type: ${contentType}`;
}

/** Build a Fastify instance with the OTLP routes (not yet listening). */
export async function buildOtelReceiver(opts: OtelReceiverOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: opts.bodyLimit ?? DEFAULT_OTLP_BODY_LIMIT,
    requestTimeout: 10_000,
  });

  // Accept the protobuf content-type so it reaches the route handler, which
  // returns a 415 carrying actionable guidance. Without this Fastify would 415
  // earlier with a generic message and the user wouldn't know to switch the
  // exporter protocol to http/json (§14.6).
  app.addContentTypeParser("application/x-protobuf", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  const repo = new OtelEventRepo(opts.db);
  const redactionOptions = {
    redactEmails: opts.config.privacy.redactEmails,
    redactHomePath: opts.config.privacy.redactHomePath,
    homePath: homedir(),
    repoPath: undefined,
    anonymiseRepoPath: false,
    customPatterns: compileCustomPatterns(opts.config.privacy.customPatterns ?? []),
  };

  const ingest = async (kind: OtelKind, body: string) => {
    const result = parseOtlpJson(kind, body);
    const receivedAt = new Date().toISOString();
    let inserted = 0;
    let deduped = 0;
    for (const record of result.records) {
      const envelope = stableStringify(record.body);
      const redacted = redactText(envelope, redactionOptions);
      let redactedPayload: Record<string, unknown>;
      try {
        redactedPayload = JSON.parse(redacted.redacted) as Record<string, unknown>;
      } catch {
        redactedPayload = { redacted: redacted.redacted };
      }
      const payloadHash = sha256(redacted.redacted);
      const r = await repo.insert(record, redactedPayload, payloadHash, receivedAt);
      if (r.inserted) inserted++;
      else deduped++;
    }
    const summary: OtelIngestResult = {
      ok: true,
      kind,
      received: result.records.length,
      inserted,
      deduped,
      skipped: result.skipped,
      diagnostics: result.diagnostics,
    };
    if (opts.onIngest) {
      try {
        opts.onIngest(summary);
      } catch {
        // Listener failures must never break the OTLP response (§19).
      }
    }
    return summary;
  };

  app.get("/health", () => ({ status: "ok" }));
  app.get("/ready", async () => ({ status: "ready", events: await repo.total() }));

  const register = (path: string, kind: OtelKind) => {
    app.post(path, async (req, reply) => {
      const ctError = assertJsonContentType(req.headers["content-type"]);
      if (ctError) {
        return reply.code(415).send({ code: "unsupported_media_type", message: ctError });
      }
      if (!req.body || typeof req.body !== "object") {
        return reply.code(400).send({ code: "bad_request", message: "Expected a JSON OTLP body." });
      }
      const body = JSON.stringify(req.body);
      const result = await ingest(kind, body);
      return reply.code(result.inserted > 0 ? 201 : 200).send(result);
    });
  };
  register("/v1/metrics", "metric");
  register("/v1/logs", "log");
  register("/v1/traces", "trace");

  return app;
}

/** Build, bind to loopback, and return the running receiver. */
export async function startOtelReceiver(opts: OtelReceiverOptions): Promise<RunningOtelReceiver> {
  const app = await buildOtelReceiver(opts);
  const port = await resolvePort(opts.preferredPort ?? 0);
  await app.listen({ port, host: "127.0.0.1" });
  return {
    port,
    host: "127.0.0.1",
    close: async () => {
      await app.close();
    },
  };
}

/** Reuse the API launcher's port-selection behaviour on loopback. */
async function resolvePort(preferred: number): Promise<number> {
  if (preferred > 0) {
    const free = await new Promise<boolean>((resolve) => {
      const s = createNetServer();
      s.unref();
      s.once("error", () => resolve(false));
      s.listen(preferred, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (free) return preferred;
  }
  return new Promise<number>((resolve, reject) => {
    const s = createNetServer();
    s.unref();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === "object" && addr ? addr.port : preferred));
    });
  });
}
