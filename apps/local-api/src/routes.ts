/**
 * Versioned route tree under `/api/v1/*` (spec §17).
 *
 * All routes are registered against a Fastify instance with the security + error
 * handlers already installed. Read routes apply read-side privacy gating (see
 * privacy.ts) so content-bearing fields are stripped in `metadata-only` mode.
 * Mutating routes are guarded by the runtime token (see security.ts).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { homedir } from "node:os";
import type { ServerDeps } from "./deps.js";
import { badRequest, notFound } from "./errors.js";
import { clampPage, paginate } from "./pagination.js";
import {
  countSessions,
  listSessions,
  getSession,
  sessionTimeline,
  listProjects,
  listRecommendations,
  type SessionQueryFilters,
} from "./queries.js";
import { gatePrompt, gateToolCall, gateCommandRun, gateFileActivity } from "./privacy.js";
import {
  computeCoachingOverview,
  listCoachingPrompts,
  getCoachingPromptDetail,
} from "./coaching.js";
import {
  type LiveBus,
  buildLiveStatus,
  hookLiveEvent,
  statusLiveEvent,
  heartbeatLiveEvent,
} from "./live.js";
import {
  computeAnalytics,
  defaultRules,
  RULE_METADATA,
  type RuleOverrides,
} from "@agentlens/analysis-engine";
import type { ReportFilters, ReportPeriod } from "@agentlens/domain";
import {
  ProjectRepo,
  SessionRepo,
  schema,
  eq,
  purgeAllData,
  purgeProjectData,
  pruneExpiredSessions,
} from "@agentlens/database";
import { redactPath } from "@agentlens/redaction";
import { databasePath, configPath } from "@agentlens/config";
import {
  getConfigValue,
  setConfigValue,
  saveConfig,
  buildConfigurationSummary,
} from "@agentlens/config";
import { registerHookIngestRoutes } from "@agentlens/hook-collector";

const PERIODS = ["day", "week", "month", "all"] as const;

const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const SessionListQuerySchema = PageQuerySchema.extend({
  projectId: z.string().optional(),
  modelId: z.string().optional(),
  status: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  search: z.string().optional(),
});

const MetricsQuerySchema = z.object({
  period: z.enum(PERIODS).optional(),
  projectId: z.string().optional(),
  project: z.string().optional(), // path (resolved to id via path-hash)
  sessionId: z.string().optional(),
});

/** Build redaction options sufficient for path-hashing (mirrors buildPrivacy). */
function pathHashOptions(deps: ServerDeps, repoPath: string) {
  const mode = deps.config.privacy.mode;
  return {
    redactEmails: deps.config.privacy.redactEmails,
    redactHomePath: mode === "redacted-content" ? true : deps.config.privacy.redactHomePath,
    homePath: homedir(),
    repoPath,
    anonymiseRepoPath: mode === "redacted-content",
    customPatterns: [],
  };
}

/** Register every /api/v1/* route. */
export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { db } = deps;
  // `config` and `mode` are intentionally `let`: POST /settings reassigns them
  // (and deps.config) so all route-handler closures observe the updated
  // values on subsequent requests without a server restart.
  let config = deps.config;
  let mode = config.privacy.mode;

  // --- hook ingestion (Phase 2, §14.9) -----------------------------------
  // Registered on every server so the loopback collector endpoint is available
  // whenever a hook is configured; the route is token-gated by the global
  // security hook (POST). When a live bus is present, each successful ingest is
  // broadcast to SSE clients (§14.10).
  const liveBus: LiveBus | undefined = deps.liveBus;
  registerHookIngestRoutes(app, {
    db,
    config: deps.config,
    onIngest: liveBus ? (result) => liveBus.broadcast(hookLiveEvent(result)) : undefined,
  });

  // --- health -------------------------------------------------------------
  app.get("/api/v1/health", () => ({
    status: "ok",
    version: "v1",
    time: new Date().toISOString(),
  }));

  // --- status -------------------------------------------------------------
  app.get("/api/v1/status", async () => {
    const sessions = await new SessionRepo(db).list(1);
    const projects = await listProjects(db);
    const recs = await listRecommendations(db);
    return {
      home: deps.home,
      configPath: configPath(deps.home),
      dbPath: databasePath(deps.home),
      privacyMode: mode,
      sessions: sessions.length,
      projects: projects.length,
      recommendations: recs.length,
    };
  });

  // --- onboarding ---------------------------------------------------------
  app.get("/api/v1/onboarding", async () => {
    const sources = await db.select().from(schema.sources);
    const projects = await listProjects(db);
    const sessions = await new SessionRepo(db).list(1);
    return {
      initialized: true,
      hasData: sessions.length > 0,
      privacyMode: mode,
      sources: sources.map((s) => ({
        id: s.id,
        adapter: s.adapter,
        displayName: s.displayName,
        enabled: s.enabled,
      })),
      projectsCount: projects.length,
      sessionsCount: await countSessions(db, {}),
      exclusions: config.sources.claudeCode.excludedProjects ?? [],
      whatAgentLensReads: [
        "Claude Code transcript JSONL files (session/event records)",
        "Hook events and OpenTelemetry telemetry (Phase 2, opt-in)",
      ],
      whereDataRemains: deps.home,
    };
  });

  // --- scans (read-only status for Phase 1; scanning is via `agentlens scan`) ---
  app.get("/api/v1/scans", async () => {
    const sources = await db.select().from(schema.sources);
    const scanState = await db.select().from(schema.scanState);
    return { sources, scanState, note: "Trigger scans with `agentlens scan` (CLI)." };
  });

  // --- projects ----------------------------------------------------------
  app.get("/api/v1/projects", async (req) => {
    const q = PageQuerySchema.parse(req.query);
    const params = clampPage(q.page, q.limit);
    const all = await listProjects(db);
    const offset = (params.page - 1) * params.limit;
    const items = all.slice(offset, offset + params.limit);
    return paginate(items, params, all.length);
  });

  app.get("/api/v1/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const all = await listProjects(db);
    const project = all.find((p) => p.id === id);
    if (!project) return notFound(`Project ${id} not found`);
    reply.send(project);
    return reply;
  });

  // --- sessions -----------------------------------------------------------
  app.get("/api/v1/sessions", async (req) => {
    const q = SessionListQuerySchema.parse(req.query);
    const params = clampPage(q.page, q.limit);
    const filters: SessionQueryFilters = {
      projectId: q.projectId,
      modelId: q.modelId,
      status: q.status,
      since: q.since,
      until: q.until,
      search: q.search,
    };
    const total = await countSessions(db, filters);
    const items = await listSessions(db, filters, params.page, params.limit);
    return paginate(items, params, total);
  });

  app.get("/api/v1/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await getSession(db, id);
    if (!session) return notFound(`Session ${id} not found`);
    const projects = await listProjects(db);
    const project = projects.find((p) => p.id === session.projectId);
    reply.send({ session, project: project ?? null });
    return reply;
  });

  app.get("/api/v1/sessions/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await getSession(db, id);
    if (!session) return notFound(`Session ${id} not found`);
    const events = await sessionTimeline(db, id);
    // Apply read-side privacy gating to content-bearing kinds.
    reply.send(
      events.map((e) => {
        if (e.kind === "prompt")
          return { ...e, data: gatePrompt(mode, e.data as Parameters<typeof gatePrompt>[1]) };
        if (e.kind === "tool_call")
          return { ...e, data: gateToolCall(mode, e.data as Parameters<typeof gateToolCall>[1]) };
        if (e.kind === "command_run")
          return {
            ...e,
            data: gateCommandRun(mode, e.data as Parameters<typeof gateCommandRun>[1]),
          };
        if (e.kind === "file_activity")
          return {
            ...e,
            data: gateFileActivity(mode, e.data as Parameters<typeof gateFileActivity>[1]),
          };
        return e;
      }),
    );
    return reply;
  });

  app.get("/api/v1/sessions/:id/recommendations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(schema.recommendations)
      .where(eq(schema.recommendations.sessionId, id))
      .orderBy(schema.recommendations.createdAt);
    reply.send(rows);
    return reply;
  });

  // --- events (global recent stream, privacy-gated) ----------------------
  app.get("/api/v1/events", async (req) => {
    const q = PageQuerySchema.extend({ sessionId: z.string().optional() }).parse(req.query);
    if (!q.sessionId)
      throw badRequest("sessionId is required (use /sessions/:id/events for a full timeline).");
    const events = await sessionTimeline(db, q.sessionId);
    return events.map((e) => {
      if (e.kind === "prompt")
        return { ...e, data: gatePrompt(mode, e.data as Parameters<typeof gatePrompt>[1]) };
      if (e.kind === "tool_call")
        return { ...e, data: gateToolCall(mode, e.data as Parameters<typeof gateToolCall>[1]) };
      if (e.kind === "command_run")
        return { ...e, data: gateCommandRun(mode, e.data as Parameters<typeof gateCommandRun>[1]) };
      if (e.kind === "file_activity")
        return {
          ...e,
          data: gateFileActivity(mode, e.data as Parameters<typeof gateFileActivity>[1]),
        };
      return e;
    });
  });

  // --- prompts -----------------------------------------------------------
  app.get("/api/v1/prompts", async (req) => {
    const q = z.object({ sessionId: z.string() }).parse(req.query);
    const rows = await db
      .select()
      .from(schema.prompts)
      .where(eq(schema.prompts.sessionId, q.sessionId))
      .orderBy(schema.prompts.sequence);
    return rows.map((r) => gatePrompt(mode, r));
  });

  // --- metrics (full analytics snapshot) ---------------------------------
  app.get("/api/v1/metrics", async (req) => {
    const q = MetricsQuerySchema.parse(req.query);
    const filters: ReportFilters = { period: (q.period ?? "week") as ReportPeriod };
    if (q.sessionId) {
      filters.sessionId = q.sessionId;
    } else if (q.projectId) {
      filters.projectId = q.projectId;
    } else if (q.project) {
      const pathHash = redactPath(q.project, pathHashOptions(deps, q.project)).pathHash;
      const project = await new ProjectRepo(db).getByPathHash("claude-code", pathHash);
      if (!project) throw notFound(`No imported project matches path "${q.project}".`);
      filters.projectId = project.id;
    }
    return computeAnalytics(db, filters, {
      minimumRecommendationConfidence: config.analysis.minimumRecommendationConfidence,
      privacyMode: config.privacy.mode,
      rules: defaultRules(),
      ruleOverrides: config.analysis.ruleOverrides as RuleOverrides,
      // §15.4 configuration-state summary for configuration-category rules.
      configurationSummary: buildConfigurationSummary(config),
      now: deps.now,
    });
  });

  // --- recommendations ----------------------------------------------------
  app.get("/api/v1/recommendations", async (req) => {
    const q = z.object({ projectId: z.string().optional() }).parse(req.query);
    return listRecommendations(db, q.projectId);
  });

  // Dismiss / restore a recommendation (§13.9 "Dismiss and restore actions").
  // Token-gated mutations; only the lifecycle status changes — evidence is
  // preserved so a restore returns the full recommendation.
  app.post("/api/v1/recommendations/:id/dismiss", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(schema.recommendations)
      .set({ status: "dismissed", updatedAt: new Date().toISOString() })
      .where(eq(schema.recommendations.id, id));
    reply.send({ id, status: "dismissed" });
    return reply;
  });

  app.post("/api/v1/recommendations/:id/restore", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(schema.recommendations)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(schema.recommendations.id, id));
    reply.send({ id, status: "active" });
    return reply;
  });

  // Resolve / reopen a recommendation (§15.13 "dismissal and resolution
  // persist"). Token-gated mutations. A resolved recommendation reappears only
  // on NEW evidence (a changed fingerprint) — see persist.ts; reopening simply
  // returns it to active on the existing evidence.
  app.post("/api/v1/recommendations/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(schema.recommendations)
      .set({ status: "resolved", updatedAt: new Date().toISOString() })
      .where(eq(schema.recommendations.id, id));
    reply.send({ id, status: "resolved" });
    return reply;
  });

  app.post("/api/v1/recommendations/:id/reopen", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db
      .update(schema.recommendations)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(schema.recommendations.id, id));
    reply.send({ id, status: "active" });
    return reply;
  });

  // --- coaching (Phase 3, §15.12) ----------------------------------------
  // GET /api/v1/coaching/overview — top opportunities, improvements over time,
  // repeated behaviours, estimated avoidable usage (labelled estimated), and
  // verification / prompt-quality / model-allocation trends. Derived from
  // normalised persisted rows + the deterministic prompt-coach layer only — no
  // external model (§15.5; external semantic analysis stays disabled by default).
  app.get("/api/v1/coaching/overview", async () => computeCoachingOverview(db, config, deps));

  // GET /api/v1/coaching/prompts — recent prompts with deterministic quality
  // scores (§15.5). Content is gated by the active privacy mode.
  app.get("/api/v1/coaching/prompts", async (req) => {
    const q = PageQuerySchema.parse(req.query);
    const params = clampPage(q.page, q.limit);
    const { items, total } = await listCoachingPrompts(db, mode, params.page, params.limit);
    return paginate(items, params, total);
  });

  // GET /api/v1/coaching/prompts/:id — Prompt Coach detail (§15.6): assessment,
  // suggested structure, outcome-correlated comparison, recurring templates,
  // and a personal-baseline comparison for the owning session.
  app.get("/api/v1/coaching/prompts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await getCoachingPromptDetail(db, mode, id);
    if (!detail) return notFound(`Prompt ${id} not found`);
    reply.send(detail);
    return reply;
  });

  // --- rules -------------------------------------------------------------
  app.get("/api/v1/rules", () => {
    const overrides = config.analysis.ruleOverrides ?? {};
    return RULE_METADATA.map((m) => {
      const o = overrides[m.id] as { enabled?: boolean } | undefined;
      const enabled = o?.enabled === false ? false : true;
      return { ...m, enabled };
    });
  });

  // --- privacy -----------------------------------------------------------
  app.get("/api/v1/privacy", () => ({
    mode,
    retentionDays: config.privacy.retentionDays,
    redactEmails: config.privacy.redactEmails,
    redactHomePath: config.privacy.redactHomePath,
    customPatterns: config.privacy.customPatterns,
    excludedProjects: config.sources.claudeCode.excludedProjects ?? [],
    dataLocation: deps.home,
    storedDataCategories: [
      "sessions, prompts, model requests, tool calls, file activity, command runs, verification runs, compactions, recommendations",
    ],
  }));

  app.post("/api/v1/privacy/purge", async (req, reply) => {
    // Delete all imported data (keep config + schema). Mutation is token-gated.
    // Optional `?projectId=` restricts the purge to a single project (§16).
    const query = req.query as { projectId?: string };
    if (query.projectId) {
      const summary = await purgeProjectData(db, query.projectId);
      reply.send({ purged: true, scope: "project", projectId: query.projectId, summary });
      return reply;
    }
    const summary = await purgeAllData(db);
    reply.send({ purged: true, scope: "all", summary });
    return reply;
  });

  app.post("/api/v1/privacy/retain", async (_req, reply) => {
    // Prune sessions older than the configured retention window (§8, §13.11
    // "Retention and deletion work"). Mutation is token-gated.
    const pruned = await pruneExpiredSessions(
      db,
      config.privacy.retentionDays,
      new Date().toISOString(),
    );
    reply.send({ pruned, retentionDays: config.privacy.retentionDays });
    return reply;
  });

  app.post("/api/v1/privacy/export", async (_req, reply) => {
    const sessions = await listSessions(db, {}, 1, 10000);
    const projects = await listProjects(db);
    const recs = await listRecommendations(db);
    reply.send({
      exportedAt: new Date().toISOString(),
      privacyMode: mode,
      sessions,
      projects,
      recommendations: recs,
    });
    return reply;
  });

  // --- settings ----------------------------------------------------------
  app.get("/api/v1/settings", () => ({
    privacy: config.privacy,
    sources: config.sources,
    analysis: config.analysis,
    dashboard: config.dashboard,
  }));

  app.post("/api/v1/settings", async (req, reply) => {
    const body = z.object({ key: z.string().min(1), value: z.unknown() }).parse(req.body);
    const next = setConfigValue(config, body.key, body.value);
    await saveConfig(deps.home, next);
    // Reflect the change in the in-memory deps so subsequent GET /privacy,
    // /settings, /status reads return the updated value without a restart.
    deps.config = next;
    config = next;
    mode = next.privacy.mode;
    reply.send({ ok: true, key: body.key });
    return reply;
  });

  // --- live (Phase 2, §14.10) -------------------------------------------
  // GET /api/v1/live — collector status snapshot (counts + spool backlog + the
  // OTLP port). Derived from local stores only; no payload content (§3).
  app.get("/api/v1/live", async () => {
    const status = await buildLiveStatus({
      db,
      home: deps.home,
      otelPort: deps.otelPort,
      apiPort: deps.port,
    });
    return { status: "ok", streaming: liveBus != null, ...status };
  });

  // GET /api/v1/live/stream — Server-Sent Events. Same-origin only: GET needs
  // no token, and the origin check + no-CORS policy (security.ts) blocks
  // cross-origin EventSource reads (§17, §19.1). We hijack the reply so Fastify
  // leaves the long-lived socket to us; the connection timeout (0 = none) keeps
  // it open. Each connection subscribes to the live bus and gets a heartbeat.
  if (liveBus) {
    app.get("/api/v1/live/stream", async (req, reply) => {
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const writeEvent = (event: { type: string; data: unknown }) => {
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Seed the new client with a status snapshot so the Live view renders
      // immediately, before the first ingest.
      const initial = await buildLiveStatus({
        db,
        home: deps.home,
        otelPort: deps.otelPort,
        apiPort: deps.port,
      });
      writeEvent(statusLiveEvent(initial));

      const unsubscribe = liveBus.addListener((event) => writeEvent(event));

      const heartbeat = setInterval(() => {
        try {
          writeEvent(heartbeatLiveEvent());
        } catch {
          // socket gone; the close handler will clean up
        }
      }, 15_000);

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Hijacked: do not return a body — Fastify must not finalize the reply.
      return reply;
    });
  }

  // Expose getConfigValue for completeness (read single config value).
  app.get("/api/v1/settings/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    const value = getConfigValue(config, key);
    reply.send({ key, value });
    return reply;
  });
}
