/**
 * `agentlens telemetry` (spec §14.7, §16) — configure/status/print-env/remove
 * for Claude Code OpenTelemetry export to the local loopback AgentLens
 * receiver. Privacy defaults: only required telemetry is enabled; user prompts,
 * assistant responses, tool details/content, and raw API bodies are never
 * logged by default (§14.7, §14.11). Existing telemetry configuration is never
 * overwritten without a merge plan.
 */
import { Command } from "commander";
import pc from "picocolors";
import { loadConfig, saveConfig, type TelemetryConfig } from "@agentlens/config";
import { resolveHome } from "../context.js";
import { readRuntimeRecord } from "./dashboard-runtime.js";
import {
  minimalTelemetryConfig,
  buildEnvVars,
  envVarsToShell,
  envVarsToUnset,
  telemetryMergePlan,
  applyConfigure,
  applyRemoveConfig,
  writeEnvToClaudeSettings,
  removeEnvFromClaudeSettings,
  claudeSettingsEnvState,
  resolveClaudeHome,
  type EnvVar,
} from "../telemetry/telemetry.js";

export function makeTelemetryCommand(): Command {
  const telemetry = new Command("telemetry").description(
    "Configure Claude Code OpenTelemetry export to the local AgentLens receiver.",
  );

  telemetry
    .command("configure")
    .description(
      "Enable minimal local telemetry (privacy defaults: no prompt/response/tool/raw-body logging).",
    )
    .option("--otlp-port <port>", "Loopback OTLP receiver port (default 4318).")
    .option("--protocol <p>", "OTLP protocol: http/json | http/protobuf | grpc.", "http/json")
    .option(
      "--tool-details",
      "Opt in to tool detail logging (commands, MCP names). Off by default.",
    )
    .option("--traces", "Enable beta tracing. Off by default.")
    .option(
      "--write-claude-settings",
      "Also write the env vars into Claude Code settings.json (backed up first).",
    )
    .option("--dry-run", "Show the merge plan without writing anything.")
    .option("--claude-home <dir>", "Override the Claude Code home (~/.claude).")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: ConfigureOpts) => configureAction(opts));

  telemetry
    .command("status")
    .description("Show the current telemetry configuration and receiver state.")
    .option("--claude-home <dir>", "Override the Claude Code home (~/.claude).")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: CommonOpts) => statusAction(opts));

  telemetry
    .command("print-env")
    .description("Print the OTEL_* / CLAUDE_CODE_* env vars to export for Claude Code.")
    .option("--shell <shell>", "Output format: sh (default) or json.", "sh")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: PrintEnvOpts) => printEnvAction(opts));

  telemetry
    .command("remove")
    .description(
      "Disable telemetry in the AgentLens config (and optionally strip env vars from Claude settings).",
    )
    .option(
      "--write-claude-settings",
      "Also remove AgentLens-owned env vars from Claude Code settings.json.",
    )
    .option("--dry-run", "Show what would be removed without writing anything.")
    .option("--claude-home <dir>", "Override the Claude Code home (~/.claude).")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: RemoveOpts) => removeAction(opts));

  return telemetry;
}

interface CommonOpts {
  claudeHome?: string;
  json?: boolean;
}
interface ConfigureOpts extends CommonOpts {
  otlpPort?: string;
  protocol?: string;
  toolDetails?: boolean;
  traces?: boolean;
  writeClaudeSettings?: boolean;
  dryRun?: boolean;
}
interface PrintEnvOpts {
  shell?: string;
  json?: boolean;
}
interface RemoveOpts extends CommonOpts {
  writeClaudeSettings?: boolean;
  dryRun?: boolean;
}

async function liveOtelPort(agentLensHome: string): Promise<number | undefined> {
  const rec = await readRuntimeRecord(agentLensHome);
  return rec?.otelPort;
}

async function configureAction(opts: ConfigureOpts): Promise<void> {
  const agentLensHome = resolveHome();
  const config = await loadConfig(agentLensHome);
  const overrides: Partial<TelemetryConfig> = {};
  if (opts.otlpPort) overrides.otlpPort = Number(opts.otlpPort);
  if (opts.protocol) overrides.protocol = opts.protocol as TelemetryConfig["protocol"];
  if (opts.toolDetails) overrides.logToolDetails = true;
  if (opts.traces) overrides.tracesEnabled = true;
  const next = minimalTelemetryConfig(overrides);
  const plan = telemetryMergePlan(config.telemetry, next);

  if (opts.json) {
    const result: Record<string, unknown> = { plan, next };
    if (opts.writeClaudeSettings) {
      const livePort = await liveOtelPort(agentLensHome);
      const vars = buildEnvVars(next, livePort);
      result.claudeSettings = writeEnvToClaudeSettings(
        resolveClaudeHome(opts.claudeHome),
        agentLensHome,
        vars,
        Boolean(opts.dryRun),
      );
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  process.stdout.write(pc.bold(pc.cyan("Telemetry configure — merge plan\n")));
  for (const e of plan) {
    if (e.change === "none") continue;
    const tag = e.sensitive ? pc.yellow(" (sensitive)") : "";
    process.stdout.write(`  ${e.key}: ${fmt(e.before)} → ${fmt(e.after)} [${e.change}]${tag}\n`);
  }
  const sensitiveOn = [
    next.logUserPrompts,
    next.logAssistantResponses,
    next.logToolDetails,
    next.logToolContent,
    next.logRawApiBodies,
  ].some(Boolean);
  if (!sensitiveOn)
    process.stdout.write(
      pc.green("  Privacy: no prompt/response/tool/raw-body content is logged.\n"),
    );
  if (next.tracesEnabled) process.stdout.write(pc.yellow("  Tracing enabled (beta).\n"));

  if (opts.dryRun) {
    process.stdout.write(pc.dim("  Dry run — nothing written.\n"));
    return;
  }
  const updated = applyConfigure(config, next);
  await saveConfig(agentLensHome, updated);
  process.stdout.write(pc.green("  AgentLens telemetry config saved.\n"));

  if (opts.writeClaudeSettings) {
    const livePort = await liveOtelPort(agentLensHome);
    const vars = buildEnvVars(next, livePort);
    const res = writeEnvToClaudeSettings(
      resolveClaudeHome(opts.claudeHome),
      agentLensHome,
      vars,
      false,
    );
    process.stdout.write(`  Claude settings: ${res.settingsPath}\n`);
    if (res.backedUp) process.stdout.write(pc.dim(`  backup: ${res.backedUp}\n`));
    process.stdout.write(
      `  wrote ${res.writtenKeys.length} env var(s), preserved ${res.preservedKeys.length} other(s).\n`,
    );
    process.stdout.write(pc.dim(`  Rollback: ${res.rollbackHint}\n`));
  } else {
    process.stdout.write(
      pc.dim(
        "  To activate: run `agentlens telemetry print-env` and export the vars (or re-run with --write-claude-settings).\n",
      ),
    );
  }
}

async function statusAction(opts: CommonOpts): Promise<void> {
  const agentLensHome = resolveHome();
  const config = await loadConfig(agentLensHome);
  const livePort = await liveOtelPort(agentLensHome);
  const envState = claudeSettingsEnvState(resolveClaudeHome(opts.claudeHome));
  const t = config.telemetry;
  const status = {
    enabled: t.enabled,
    otlpPort: t.otlpPort,
    protocol: t.protocol,
    endpoint: t.endpoint,
    receiverRunning: livePort != null,
    liveOtelPort: livePort ?? null,
    sensitive: {
      logUserPrompts: t.logUserPrompts,
      logAssistantResponses: t.logAssistantResponses,
      logToolDetails: t.logToolDetails,
      logToolContent: t.logToolContent,
      logRawApiBodies: t.logRawApiBodies,
    },
    tracesEnabled: t.tracesEnabled,
    claudeSettingsEnvPresent: envState.present,
    claudeSettingsEnvOther: envState.other,
  };
  if (opts.json) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    return;
  }
  process.stdout.write(pc.bold(pc.cyan("AgentLens telemetry status\n")));
  process.stdout.write(`  enabled:          ${t.enabled ? pc.green("yes") : pc.red("no")}\n`);
  process.stdout.write(
    `  otlp port:        ${t.otlpPort}${livePort != null ? pc.green(` (receiver running on ${livePort})`) : pc.dim(" (receiver not running)")}\n`,
  );
  process.stdout.write(`  protocol:         ${t.protocol}\n`);
  process.stdout.write(`  endpoint:         ${t.endpoint}\n`);
  process.stdout.write(
    `  traces (beta):    ${t.tracesEnabled ? pc.yellow("enabled") : "disabled"}\n`,
  );
  process.stdout.write(pc.bold("  sensitive content logging (all off by default):\n"));
  for (const [k, v] of Object.entries(status.sensitive)) {
    process.stdout.write(`    ${k}: ${v ? pc.yellow("on") : pc.green("off")}\n`);
  }
  process.stdout.write(
    `  Claude settings env: ${envState.present.length} AgentLens key(s) present, ${envState.other.length} other preserved\n`,
  );
}

async function printEnvAction(opts: PrintEnvOpts): Promise<void> {
  const agentLensHome = resolveHome();
  const config = await loadConfig(agentLensHome);
  const livePort = await liveOtelPort(agentLensHome);
  const vars: EnvVar[] = buildEnvVars(config.telemetry, livePort);
  if (vars.length === 0) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ enabled: false, vars: [] }, null, 2) + "\n");
    } else {
      process.stdout.write(
        pc.dim("# Telemetry is disabled. Run `agentlens telemetry configure` first.\n"),
      );
    }
    return;
  }
  if (opts.json || opts.shell === "json") {
    process.stdout.write(JSON.stringify({ enabled: true, vars }, null, 2) + "\n");
    return;
  }
  process.stdout.write(envVarsToShell(vars) + "\n");
}

async function removeAction(opts: RemoveOpts): Promise<void> {
  const agentLensHome = resolveHome();
  const config = await loadConfig(agentLensHome);
  const result: Record<string, unknown> = { before: { enabled: config.telemetry.enabled } };
  if (opts.dryRun) {
    result.dryRun = true;
  } else {
    const updated = applyRemoveConfig(config);
    await saveConfig(agentLensHome, updated);
    result.after = { enabled: false };
  }
  let unset: EnvVar[] = [];
  if (opts.writeClaudeSettings) {
    const res = removeEnvFromClaudeSettings(
      resolveClaudeHome(opts.claudeHome),
      agentLensHome,
      Boolean(opts.dryRun),
    );
    result.claudeSettings = res;
    unset = buildEnvVars(config.telemetry, await liveOtelPort(agentLensHome));
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    pc.bold(
      pc.cyan(
        opts.dryRun ? "Telemetry remove — dry run\n" : "Telemetry removed from AgentLens config.\n",
      ),
    ),
  );
  if (opts.writeClaudeSettings) {
    const res = result.claudeSettings as {
      removedKeys: string[];
      preservedKeys: number | string[];
      backedUp: string | null;
      rollbackHint: string;
      settingsPath: string;
    };
    process.stdout.write(`  Claude settings: ${res.settingsPath}\n`);
    if (res.backedUp) process.stdout.write(pc.dim(`  backup: ${res.backedUp}\n`));
    process.stdout.write(
      `  removed ${res.removedKeys.length} AgentLens env key(s); preserved ${Array.isArray(res.preservedKeys) ? res.preservedKeys.length : res.preservedKeys} other(s).\n`,
    );
    process.stdout.write(pc.dim(`  Rollback: ${res.rollbackHint}\n`));
  }
  if (unset.length > 0) {
    process.stdout.write(pc.dim("  To unset in your shell:\n"));
    process.stdout.write(envVarsToUnset(unset) + "\n");
  }
}

function fmt(v: unknown): string {
  return String(v);
}
