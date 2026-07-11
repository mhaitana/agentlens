/**
 * Server dependencies (spec §17, §19.1).
 *
 * Everything the API needs is injected via {@link ServerDeps} so the server is
 * testable in isolation (tests pass an in-memory SQLite + temp home) and the
 * `agentlens dashboard` command owns the real lifecycle (open DB, load config,
 * generate a runtime token, resolve the built-dashboard directory).
 */
import type { DrizzleDb } from "@agentlens/database";
import type { AgentLensConfig } from "@agentlens/config";
import type { FastifyInstance } from "fastify";
import type { LiveBus } from "./live.js";

/** Lifecycle handles the API closes on shutdown. */
export interface ServerDeps {
  /** Drizzle handle for the local SQLite database. */
  db: DrizzleDb;
  /** Resolved AgentLens configuration. */
  config: AgentLensConfig;
  /** Resolved AgentLens data home (used to resolve paths in responses). */
  home: string;
  /**
   * Random runtime token guarding mutation endpoints (§17, §19.1). Generated
   * by the launcher and injected into the served dashboard so only same-origin
   * requests can read it. Never logged.
   */
  runtimeToken: string;
  /**
   * Absolute path to the built dashboard (`apps/dashboard/dist`), or undefined
   * when the dashboard is not being served (API-only mode). When set, the
   * server serves the static bundle at `/` and injects the runtime token +
   * API base URL into `index.html` at serve time.
   */
  dashboardDir?: string;
  /** Port to bind (loopback). The launcher picks a free port if occupied. */
  port: number;
  /** Optional override of the generated timestamp (tests). */
  now?: Date;
  /**
   * Live-update bus (Phase 2, §14.10). When present the server registers the
   * hook ingest routes, broadcasts ingests to SSE clients, and serves
   * `/api/v1/live/stream`. Absent in plain dashboard mode (no live collection).
   */
  liveBus?: LiveBus;
  /** Bound OTLP receiver port (Phase 2). Surfaced in `/api/v1/live` status. */
  otelPort?: number;
  /**
   * Optional extra route registrar (Phase 3). The `agentlens dashboard` launcher
   * uses this to register the `/api/v1/doctor*` routes from the CLI package
   * without creating an app→app circular dependency: the CLI owns the doctor
   * implementation and hands a registrar callback to the (depended-on) local
   * API. Called once during {@link buildServer}, after the core routes and
   * before the dashboard static handler. Absent in API-only / test contexts.
   */
  registerExtraRoutes?: (app: FastifyInstance, deps: ServerDeps) => void | Promise<void>;
}

/** Stable, versioned error shape (§17). */
export interface ApiError {
  /** Stable machine code, e.g. `bad_request`, `not_found`, `forbidden`. */
  code: string;
  /** Human-readable message (redacted; never echoes secrets/paths). */
  message: string;
  /** Optional field-level details for validation errors. */
  details?: unknown;
}
