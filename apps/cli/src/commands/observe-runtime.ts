/**
 * Observation runtime (spec §14.9, §14.10, §20) — the engine behind
 * `agentlens observe` and the `--observe` dashboard mode.
 *
 * It composes the Phase 2 collectors into one local process:
 *   1. A `LiveBus` for fan-out to SSE clients.
 *   2. The token-gated local API server, with the hook ingest routes mounted
 *      and `/api/v1/live` + `/api/v1/live/stream` exposed.
 *   3. A dedicated loopback OTLP receiver (no token — the exporter can't send
 *      one, §14.6) on the configured OTLP port (or a free one).
 *   4. A one-shot spool drain + a polling watcher so events captured while the
 *      collector was down are recovered, and new spool files are ingested live.
 *   5. Debounced incremental analysis: after any hook/otel ingest, re-run
 *      `computeAnalytics` over a recent window. Recommendations persist
 *      idempotently (fingerprint dedup, §20), so this is safe to repeat.
 *
 * Everything is loopback-only and local-store-derived (§3). `startObservation`
 * returns handles + a single `stop()` for clean shutdown.
 */
import {
  buildServer,
  generateRuntimeToken,
  pickFreePort,
  LiveBus,
  hookLiveEvent,
  otelLiveEvent,
} from "@agentlens/local-api";
import { startOtelReceiver } from "@agentlens/otel-receiver";
import {
  ingestHookEvent,
  notifyIngest,
  drainSpool,
  type IngestDeps,
  type SpooledEvent,
} from "@agentlens/hook-collector";
import { computeAnalytics, defaultRules, type RuleOverrides } from "@agentlens/analysis-engine";
import type { AgentLensConfig } from "@agentlens/config";
import type { ReportFilters } from "@agentlens/domain";
import type { Database } from "@agentlens/database";
import type { RunningOtelReceiver } from "@agentlens/otel-receiver";

/** Options for starting observation. */
export interface ObservationOptions {
  home: string;
  db: Database;
  config: AgentLensConfig;
  /** Preferred API port (loopback). */
  apiPort: number;
  /** Preferred OTLP receiver port (default from config). */
  otelPort?: number;
  /** Built dashboard dir to serve (optional — API-only when omitted). */
  dashboardDir?: string;
  /** Override "now" (tests). */
  now?: Date;
  /** Spool poll interval ms (default 2000). */
  spoolPollMs?: number;
  /** Analysis debounce ms (default 1500). */
  analysisDebounceMs?: number;
}

/** Handles returned by `startObservation`; `stop()` tears everything down. */
export interface ObservationHandle {
  apiPort: number;
  otelPort: number;
  token: string;
  bus: LiveBus;
  server: Awaited<ReturnType<typeof buildServer>>;
  otel: RunningOtelReceiver;
  /** Live counters for terminal status. */
  stats: {
    hooksInserted: number;
    otelInserted: number;
    spoolDrained: number;
    analysisRuns: number;
    lastRecommendations: number;
  };
  stop: () => Promise<void>;
}

/**
 * Start the live collector. Resolves once the API + OTLP receiver are listening
 * and the initial spool drain has completed.
 */
export async function startObservation(opts: ObservationOptions): Promise<ObservationHandle> {
  const bus = new LiveBus();
  const stats = {
    hooksInserted: 0,
    otelInserted: 0,
    spoolDrained: 0,
    analysisRuns: 0,
    lastRecommendations: 0,
  };

  // --- incremental analysis (debounced, §20) -----------------------------
  // After any hook/otel ingest, re-run analytics over a recent window.
  // Recommendations persist idempotently (fingerprint dedup), so repeats are
  // safe and only affected rules effectively run.
  const analysisTimer = { current: null as NodeJS.Timeout | null };
  const scheduleAnalysis = () => {
    if (analysisTimer.current) clearTimeout(analysisTimer.current);
    analysisTimer.current = setTimeout(() => {
      analysisTimer.current = null;
      void runIncrementalAnalysis().catch(() => {
        // Analysis failures must never break the collector (§19).
      });
    }, opts.analysisDebounceMs ?? 1500);
  };

  const runIncrementalAnalysis = async () => {
    const filters: ReportFilters = { period: "day" };
    const snapshot = await computeAnalytics(opts.db.db, filters, {
      minimumRecommendationConfidence: opts.config.analysis.minimumRecommendationConfidence,
      privacyMode: opts.config.privacy.mode,
      rules: defaultRules(),
      ruleOverrides: opts.config.analysis.ruleOverrides as RuleOverrides,
      now: opts.now,
    });
    stats.analysisRuns++;
    stats.lastRecommendations = snapshot.recommendations.length;
    bus.broadcast({
      type: "status",
      time: new Date().toISOString(),
      data: { analysisRuns: stats.analysisRuns, recommendations: stats.lastRecommendations },
    });
  };

  // React to any hook/otel event on the bus by scheduling analysis + bumping
  // counters. (The HTTP hook route and the OTLP receiver broadcast here.)
  bus.addListener((event) => {
    if (event.type === "hook") {
      if (event.data.inserted === true) stats.hooksInserted++;
      scheduleAnalysis();
    } else if (event.type === "otel") {
      const inserted = typeof event.data.inserted === "number" ? event.data.inserted : 0;
      stats.otelInserted += inserted;
      if (inserted > 0) scheduleAnalysis();
    }
  });

  // --- OTLP receiver (loopback, no token) --------------------------------
  const otel = await startOtelReceiver({
    db: opts.db.db,
    config: opts.config,
    preferredPort: opts.otelPort ?? opts.config.telemetry.otlpPort,
    onIngest: (summary) => bus.broadcast(otelLiveEvent(summary)),
  });

  // --- API server (token-gated, with hook routes + live SSE) --------------
  const apiPort = await pickFreePort(opts.apiPort);
  const token = generateRuntimeToken();
  const server = await buildServer({
    db: opts.db.db,
    config: opts.config,
    home: opts.home,
    runtimeToken: token,
    dashboardDir: opts.dashboardDir,
    port: apiPort,
    now: opts.now,
    liveBus: bus,
    otelPort: otel.port,
  });
  await server.listen({ port: apiPort, host: "127.0.0.1" });

  // --- spool drain (recover events captured while the collector was down) -
  const ingestDeps: IngestDeps = {
    db: opts.db.db,
    config: opts.config,
    onIngest: (result) => bus.broadcast(hookLiveEvent(result)),
  };
  const initialDrain = await drainSpool(opts.home, async (event: SpooledEvent) => {
    const result = await ingestHookEvent(
      ingestDeps,
      JSON.stringify(event.payload),
      "spool",
      event.receivedAt,
    );
    notifyIngest(ingestDeps, result);
  });
  stats.spoolDrained = initialDrain.removed;

  // --- spool watcher (poll for new files while running) -------------------
  const spoolPollMs = opts.spoolPollMs ?? 2000;
  const spoolTimer = setInterval(async () => {
    try {
      const drained = await drainSpool(opts.home, async (event: SpooledEvent) => {
        const result = await ingestHookEvent(
          ingestDeps,
          JSON.stringify(event.payload),
          "spool",
          event.receivedAt,
        );
        notifyIngest(ingestDeps, result);
      });
      stats.spoolDrained += drained.removed;
    } catch {
      // best-effort; next tick retries
    }
  }, spoolPollMs);
  spoolTimer.unref?.();

  // --- shutdown ----------------------------------------------------------
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (analysisTimer.current) clearTimeout(analysisTimer.current);
    clearInterval(spoolTimer);
    try {
      await otel.close();
    } catch {
      // ignore
    }
    try {
      await server.close();
    } catch {
      // ignore
    }
    bus.close();
  };

  return {
    apiPort,
    otelPort: otel.port,
    token,
    bus,
    server,
    otel,
    stats,
    stop,
  };
}
