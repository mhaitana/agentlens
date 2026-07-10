/**
 * `agentlens observe` (spec §14.9, §16) — start the live collector: the local
 * API (with hook ingestion + `/api/v1/live` SSE), the loopback OTLP receiver,
 * the spool drain/watcher, and debounced incremental analysis. Loopback only;
 * never exposes collectors externally (§19.1). Clean SIGINT/SIGTERM shutdown.
 *
 * Mirrors `dashboard`'s reuse-healthy-instance behaviour: if a runtime record
 * exists and the recorded API port is healthy, the running collector is reused
 * (URL printed, no new process). Otherwise a fresh collector is started and a
 * runtime record (including the OTLP port) is written.
 */
import { Command } from "commander";
import pc from "picocolors";
import { resolveDashboardDir, openBrowser } from "./dashboard.js";
import {
  probeHealthy,
  readRuntimeRecord,
  removeRuntimeRecord,
  writeRuntimeRecord,
} from "./dashboard-runtime.js";
import { startObservation } from "./observe-runtime.js";
import { resolveHome, openAgentLensDb, closeDatabase, loadConfig } from "../context.js";

const DEFAULT_PORT = 7531;

export function makeObserveCommand(): Command {
  return new Command("observe")
    .description(
      "Start live observation: hook ingestion + OTLP receiver + spool drain + incremental analysis.",
    )
    .option("-p, --port <port>", "Preferred loopback API port.", String(DEFAULT_PORT))
    .option("--otel-port <port>", "Preferred loopback OTLP receiver port (default from config).")
    .option("--no-open", "Do not open the dashboard browser automatically.")
    .option("--api-only", "Run the API + collectors without serving the dashboard bundle.")
    .option("--json", "Emit machine-readable JSON describing the running collector.")
    .action(async (opts: ObserveOpts) => observeAction(opts));
}

interface ObserveOpts {
  port: string;
  otelPort?: string;
  open: boolean;
  apiOnly: boolean;
  json: boolean;
}

async function observeAction(opts: ObserveOpts): Promise<void> {
  const home = resolveHome();

  // --- reuse a healthy existing collector (§13.8) ---
  const existing = await readRuntimeRecord(home);
  if (existing && (await probeHealthy(existing.port))) {
    const url = `http://127.0.0.1:${existing.port}/`;
    const otelLine = existing.otelPort
      ? `\n  ${pc.gray("OTLP:")}  http://127.0.0.1:${existing.otelPort}`
      : "";
    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          { reused: true, apiPort: existing.port, otelPort: existing.otelPort ?? null, url },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    process.stdout.write(pc.bold(pc.cyan("AgentLens observe\n")));
    process.stdout.write(pc.green("  Reusing running collector.\n"));
    process.stdout.write(`  ${pc.underline(url)}${otelLine}\n`);
    if (opts.open) openBrowser(url);
    return;
  }
  if (existing) await removeRuntimeRecord(home);

  // --- start a fresh collector ---
  const db = await openAgentLensDb(home);
  const config = await loadConfig(home);
  const apiPort = Number.parseInt(opts.port, 10) || DEFAULT_PORT;
  const otelPort = opts.otelPort ? Number.parseInt(opts.otelPort, 10) : undefined;
  const dashboardDir = opts.apiOnly ? undefined : resolveDashboardDir();

  if (!opts.apiOnly && !dashboardDir) {
    process.stdout.write(
      pc.yellow(
        "  Built dashboard not found; running API-only.\n" +
          "  Build the dashboard with `pnpm build` (apps/dashboard), or set\n" +
          "  AGENTLENS_DASHBOARD_DIR.\n",
      ),
    );
  }

  const handle = await startObservation({
    home,
    db,
    config,
    apiPort,
    otelPort,
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

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          reused: false,
          apiPort: handle.apiPort,
          otelPort: handle.otelPort,
          url,
          spoolDrained: handle.stats.spoolDrained,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(pc.bold(pc.cyan("AgentLens observe\n")));
    process.stdout.write(`  ${pc.green("API:")}    ${pc.underline(url)}\n`);
    process.stdout.write(`  ${pc.green("OTLP:")}   http://127.0.0.1:${handle.otelPort}\n`);
    process.stdout.write(`  ${pc.gray("home:")}   ${home}\n`);
    process.stdout.write(
      `  ${pc.gray("mode:")}   ${dashboardDir ? "API + dashboard" : "API-only"}\n`,
    );
    if (handle.stats.spoolDrained > 0) {
      process.stdout.write(
        pc.green(`  Recovered ${handle.stats.spoolDrained} spooled event(s).\n`),
      );
    }
    process.stdout.write(pc.dim("  Hooks post to /api/v1/hooks/event (token-gated).\n"));
    process.stdout.write(
      pc.dim("  OTLP endpoint: /v1/metrics, /v1/logs, /v1/traces (http/json).\n"),
    );
    process.stdout.write(pc.gray("  Press Ctrl+C to stop.\n"));
    if (opts.open && dashboardDir) openBrowser(url);
  }

  // --- clean shutdown ---
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!opts.json) process.stdout.write(pc.gray(`\n  ${signal} received, shutting down…\n`));
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
    if (!opts.json) {
      process.stdout.write(
        pc.gray(
          `  hooks inserted: ${handle.stats.hooksInserted} | otel inserted: ${handle.stats.otelInserted} | analysis runs: ${handle.stats.analysisRuns}\n`,
        ),
      );
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
