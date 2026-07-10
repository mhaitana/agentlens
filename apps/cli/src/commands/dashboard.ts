/**
 * `agentlens dashboard` (spec §13.8) — start the local API + serve the built
 * dashboard on loopback, open the browser, reuse a healthy existing
 * instance, handle occupied ports, and shut down cleanly.
 *
 * Lifecycle:
 *   1. Resolve the AgentLens home, open the DB, load config.
 *   2. If a runtime record exists and the recorded port is healthy, reuse it
 *      (print URL, optionally open browser, exit 0 — no new server).
 *   3. Otherwise pick a free loopback port, generate a runtime token, resolve
 *      the built dashboard dir, start the server, write a runtime record, and
 *      install SIGINT/SIGTERM/exit handlers that close the server + remove the
 *      record.
 *
 * The dashboard bundle is served by the local API (same-origin) with the
 * runtime token injected into index.html, so the browser dashboard can
 * authenticate mutating requests (§17, §19.1).
 */
import { Command } from "commander";
import pc from "picocolors";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { buildServer, generateRuntimeToken, pickFreePort } from "@agentlens/local-api";
import { resolveHome, openAgentLensDb, closeDatabase, loadConfig } from "../context.js";
import {
  probeHealthy,
  readRuntimeRecord,
  removeRuntimeRecord,
  writeRuntimeRecord,
} from "./dashboard-runtime.js";
import { startObservation } from "./observe-runtime.js";

const DEFAULT_PORT = 7531;

/**
 * Resolve the built dashboard directory. Honours `AGENTLENS_DASHBOARD_DIR`;
 * otherwise defaults to the sibling `apps/dashboard/dist` relative to this
 * CLI module (repo-layout). Returns null if no bundle is present so the
 * command can fall back to API-only mode with a clear message.
 */
export function resolveDashboardDir(): string | null {
  const override = process.env.AGENTLENS_DASHBOARD_DIR;
  if (override && existsSync(override)) return override;
  // This file ships at apps/cli/dist/commands/dashboard.js; the dashboard
  // bundle is at apps/dashboard/dist (sibling app).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, "..", "..", "dashboard", "dist");
  return existsSync(candidate) ? candidate : null;
}

/** Open a URL in the user's default browser (cross-platform, best-effort). */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const [bin, ...rest] = cmd;
    if (bin) spawn(bin, rest, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // best-effort; the URL is already printed for manual opening.
  }
}

export function makeDashboardCommand(): Command {
  return new Command("dashboard")
    .description("Start the local dashboard (loopback only) and open it in your browser.")
    .option("-p, --port <port>", "Preferred loopback port.", String(DEFAULT_PORT))
    .option("--no-open", "Do not open the browser automatically.")
    .option("--api-only", "Start the API without serving the dashboard bundle.")
    .option(
      "--observe",
      "Also start live collectors (hook ingestion + OTLP + spool). Opt-in (privacy-first, §3).",
    )
    .action(async (opts: { port: string; open: boolean; apiOnly: boolean; observe: boolean }) => {
      const home = resolveHome();
      const preferredPort = Number.parseInt(opts.port, 10) || DEFAULT_PORT;

      // --- reuse a healthy existing instance (§13.8) ---
      const existing = await readRuntimeRecord(home);
      if (existing && (await probeHealthy(existing.port))) {
        const url = `http://127.0.0.1:${existing.port}/`;
        process.stdout.write(pc.bold(pc.cyan("AgentLens dashboard\n")));
        process.stdout.write(pc.green("  Reusing running instance.\n"));
        process.stdout.write(`  ${pc.underline(url)}\n`);
        if (opts.open) openBrowser(url);
        return;
      }
      // Stale record: clear it so a fresh launch overwrites cleanly.
      if (existing) await removeRuntimeRecord(home);

      // --- start a new instance ---
      const db = await openAgentLensDb(home);
      const config = await loadConfig(home);
      const dashboardDir = opts.apiOnly ? undefined : resolveDashboardDir();

      // `--observe` starts the live collectors alongside the dashboard (§14.9).
      // Opt-in: observation requires an explicit action (privacy-first, §3).
      if (opts.observe) {
        const handle = await startObservation({
          home,
          db,
          config,
          apiPort: preferredPort,
          dashboardDir: dashboardDir ?? undefined,
        });
        const url = `http://127.0.0.1:${handle.apiPort}/`;
        await writeRuntimeRecord(home, {
          port: handle.apiPort,
          token: handle.token,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          otelPort: handle.otelPort,
        });
        process.stdout.write(pc.bold(pc.cyan("AgentLens dashboard (observing)\n")));
        process.stdout.write(`  ${pc.green("URL:")}    ${pc.underline(url)}\n`);
        process.stdout.write(`  ${pc.green("OTLP:")}   http://127.0.0.1:${handle.otelPort}\n`);
        process.stdout.write(`  ${pc.gray("home:")}   ${home}\n`);
        if (handle.stats.spoolDrained > 0)
          process.stdout.write(
            pc.green(`  Recovered ${handle.stats.spoolDrained} spooled event(s).\n`),
          );
        process.stdout.write(pc.gray("  Press Ctrl+C to stop.\n"));
        if (opts.open) openBrowser(url);

        let shuttingDown = false;
        const shutdown = async (signal: string) => {
          if (shuttingDown) return;
          shuttingDown = true;
          process.stdout.write(pc.gray(`\n  ${signal} received, shutting down…\n`));
          try {
            await handle.stop();
          } catch {
            // ignore
          }
          try {
            closeDatabase(db);
          } catch {
            // ignore
          }
          await removeRuntimeRecord(home);
          process.exit(0);
        };
        process.on("SIGINT", () => void shutdown("SIGINT"));
        process.on("SIGTERM", () => void shutdown("SIGTERM"));
        return;
      }

      const port = await pickFreePort(preferredPort);
      const token = generateRuntimeToken();

      if (!opts.apiOnly && !dashboardDir) {
        process.stdout.write(
          pc.yellow(
            "  Built dashboard not found; starting API-only mode.\n" +
              "  Build the dashboard first with `pnpm build` (apps/dashboard), or set\n" +
              "  AGENTLENS_DASHBOARD_DIR to a built dashboard directory.\n",
          ),
        );
      }

      const server = await buildServer({
        db: db.db,
        config,
        home,
        runtimeToken: token,
        dashboardDir: dashboardDir ?? undefined,
        port,
      });

      await server.listen({ port, host: "127.0.0.1" });

      const url = `http://127.0.0.1:${port}/`;
      await writeRuntimeRecord(home, {
        port,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });

      process.stdout.write(pc.bold(pc.cyan("AgentLens dashboard\n")));
      process.stdout.write(`  ${pc.green("URL:")}    ${pc.underline(url)}\n`);
      process.stdout.write(`  ${pc.gray("home:")}   ${home}\n`);
      process.stdout.write(
        `  ${pc.gray("mode:")}   ${dashboardDir ? "API + dashboard" : "API-only"}\n`,
      );
      process.stdout.write(pc.gray("  Press Ctrl+C to stop.\n"));
      if (opts.open) openBrowser(url);

      // --- clean shutdown (§13.8) ---
      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        process.stdout.write(pc.gray(`\n  ${signal} received, shutting down…\n`));
        try {
          await server.close();
        } catch {
          // ignore
        }
        try {
          closeDatabase(db);
        } catch {
          // ignore
        }
        await removeRuntimeRecord(home);
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
    });
}
