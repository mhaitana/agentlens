/**
 * Hook-event ingestion (spec §14.3, §14.9).
 *
 * `ingestHookEvent` is the pure server-side pipeline: parse (tolerant) →
 * re-redact (untrusted payload, §19) → dedup-insert. It is shared by the
 * loopback HTTP route (POST /api/v1/hooks/event, mounted on the token-gated
 * main API server) and the spool drainer (`agentlens observe`).
 *
 * The HTTP route is registered on the main Fastify instance whose global
 * security hook already enforces the runtime token for POST (§19.1) — the hook
 * script reads the token from the runtime record, so only a local AgentLens
 * collector with the matching token accepts events.
 */
import type { FastifyInstance } from "fastify";
import type { DrizzleDb } from "@agentlens/database";
import type { AgentLensConfig } from "@agentlens/config";
import { parseHookStdin } from "./parse.js";
import { redactHookEvent, buildHookRedactionOptions } from "./redact.js";
import { HookEventRepo } from "./repo.js";

export interface IngestDeps {
  db: DrizzleDb;
  config: AgentLensConfig;
  /**
   * Optional callback fired after a successful ingest (online or spool). The
   * live collector uses it to broadcast a Server-Sent Event to the dashboard
   * (spec §14.10). Never throws into the ingest path.
   */
  onIngest?: (result: IngestResult) => void;
}

export interface IngestResult {
  id: string;
  inserted: boolean;
  hookEventName: string;
  payloadHash: string;
  delivery: "online" | "spool";
}

/** Parse + redact + persist a raw hook stdin payload. Dedup by payloadHash. */
export async function ingestHookEvent(
  deps: IngestDeps,
  rawStdin: string,
  delivery: "online" | "spool",
  receivedAt: string,
): Promise<IngestResult> {
  const parsed = parseHookStdin(rawStdin, receivedAt);
  const options = buildHookRedactionOptions(deps.config);
  const redacted = redactHookEvent(parsed, options, deps.config.privacy.mode);
  const repo = new HookEventRepo(deps.db);
  const { id, inserted } = await repo.insert(redacted, delivery);
  return {
    id,
    inserted,
    hookEventName: redacted.hookEventName,
    payloadHash: redacted.payloadHash,
    delivery,
  };
}

/** Register the hook ingest + health routes on the (token-gated) API server. */
export function registerHookIngestRoutes(app: FastifyInstance, deps: IngestDeps): void {
  const repo = new HookEventRepo(deps.db);

  // POST /api/v1/hooks/event — the loopback collector endpoint the hook script
  // posts to. Body is the (claimed-redacted) hook payload; we re-redact before
  // persist (§19 untrusted). Token-gated by the global security hook.
  app.post("/api/v1/hooks/event", async (req, reply) => {
    if (!req.body || typeof req.body !== "object") {
      return reply
        .code(400)
        .send({ code: "bad_request", message: "Expected a JSON hook payload." });
    }
    const receivedAt = new Date().toISOString();
    const rawStdin = JSON.stringify(req.body);
    const result = await ingestHookEvent(deps, rawStdin, "online", receivedAt);
    safeNotify(deps, result);
    return reply.code(result.inserted ? 201 : 200).send(result);
  });

  // GET /api/v1/hooks/health — collector health for the live dashboard (§14.10).
  app.get("/api/v1/hooks/health", async () => {
    const total = await repo.total();
    return { status: "ok", events: total };
  });

  // GET /api/v1/hooks/events — recent hook events (live dashboard, §14.10).
  app.get("/api/v1/hooks/events", async (req) => {
    const limit = Math.min(
      200,
      Math.max(1, Number((req.query as { limit?: string }).limit ?? "50") || 50),
    );
    return repo.recent(limit);
  });
}

/** Fire onIngest without letting listener errors escape into the ingest path (§19). */
function safeNotify(deps: IngestDeps, result: IngestResult): void {
  if (!deps.onIngest) return;
  try {
    deps.onIngest(result);
  } catch {
    // Listener failures must never break ingestion or block the hook (§19).
  }
}

/**
 * Fire onIngest for a result produced outside the HTTP route (e.g. the spool
 * drainer). Same safe-wrapper semantics as the route path (§19).
 */
export function notifyIngest(deps: IngestDeps, result: IngestResult): void {
  safeNotify(deps, result);
}
