/**
 * Fastify server factory (spec §17, §19.1).
 *
 * `createServer` builds a loopback-only Fastify instance with the security
 * hooks, stable error handler, and the full /api/v1/* route tree. When a
 * `dashboardDir` is provided it also serves the built dashboard bundle and
 * injects the runtime token + API base URL into the SPA shell so the
 * same-origin dashboard can authenticate mutating requests.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { ServerDeps } from "./deps.js";
import { installErrorHandler } from "./errors.js";
import { installSecurity } from "./security.js";
import { registerRoutes } from "./routes.js";

/** Per-file content types for the minimal static handler. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

export interface RunningServer {
  port: number;
  host: string;
  /** Resolve when the server has closed. */
  close: () => Promise<void>;
}

/** Build (but do not start) the Fastify instance. Used by tests + the launcher. */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_000_000, // 1 MB (§19.1 request-body limits)
    requestTimeout: 30_000,
  });

  installSecurity(app, deps.runtimeToken);
  installErrorHandler(app);
  registerRoutes(app, deps);
  // Phase 3 seam: let the launcher (CLI) register extra routes — e.g. the
  // `/api/v1/doctor*` routes backed by the CLI's doctor implementation —
  // before the dashboard static catch-all so static/parametric routing wins.
  if (deps.registerExtraRoutes) await deps.registerExtraRoutes(app, deps);

  // --- dashboard static serving (same-origin) ---
  const dashboardDir = deps.dashboardDir;
  if (dashboardDir && existsSync(dashboardDir)) {
    const indexHtml = await loadDashboardIndex(dashboardDir, deps.runtimeToken);
    const assetsRoot = join(dashboardDir, "assets");

    // Serve the SPA shell at the root and for any non-/api route (client-side
    // routing). Static assets under /assets are served directly.
    // Cache headers: hashed /assets files are immutable (safe to cache long-term),
    // but the SPA shell must NEVER be cached — a cached index.html references old
    // asset hashes and breaks (404) across any reinstall/redeploy that changes them.
    app.get("/assets/*", async (req, reply) => {
      const rel = (req.params as { "*": string })["*"];
      const file = join(assetsRoot, rel);
      const safe = file.startsWith(assetsRoot);
      if (!safe || !existsSync(file))
        return reply.code(404).send({ code: "not_found", message: "Asset not found." });
      const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
      reply.header("content-type", contentType);
      reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.send(await readFile(file));
    });

    // Vite also emits vite.svg etc. at the root in some setups — serve known
    // static files by extension from the dashboard dir, falling back to the SPA.
    app.get("/*", async (req, reply) => {
      const path = (req.params as { "*": string })["*"];
      if (path.startsWith("api/")) return; // let /api routes handle it
      const ext = extname(path).toLowerCase();
      if (ext && ext !== ".html") {
        const file = join(dashboardDir, path);
        if (file.startsWith(dashboardDir) && existsSync(file)) {
          reply.header("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
          reply.header("cache-control", "no-cache");
          return reply.send(await readFile(file));
        }
      }
      // SPA shell — never cache, so a stale index.html can't reference old asset hashes.
      reply.header("content-type", "text/html; charset=utf-8");
      reply.header("cache-control", "no-store");
      return reply.send(indexHtml);
    });
  }

  return app;
}

/** Read the built dashboard's index.html and inject the runtime bootstrap. */
async function loadDashboardIndex(dashboardDir: string, runtimeToken: string): Promise<string> {
  const html = await readFile(join(dashboardDir, "index.html"), "utf-8");
  // Embed JSON inside a <script> tag safely (defense-in-depth, §19.1/§19.4): the
  // token is hex-only today, but escape `<`, `>`, and `&` so a future change to the
  // token source can never break out of the script context.
  const safeJson = JSON.stringify({ apiBase: "/api/v1", token: runtimeToken })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const bootstrap = `<script>window.__AGENTLENS__ = ${safeJson};</script>`;
  // Inject right before </head>; fall back to prepending if no head tag.
  if (html.includes("</head>")) return html.replace("</head>", `${bootstrap}</head>`);
  return `${bootstrap}${html}`;
}

/**
 * Build and start the server on the configured loopback port. Resolves with
 * the bound port (useful when the launcher picks a free port) and a `close`
 * handle.
 */
export async function startServer(deps: ServerDeps): Promise<RunningServer> {
  const app = await buildServer(deps);
  await app.listen({ port: deps.port, host: "127.0.0.1" });
  return {
    port: deps.port,
    host: "127.0.0.1",
    close: async () => {
      await app.close();
    },
  };
}
