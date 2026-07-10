#!/usr/bin/env node
/*
 * AgentLens plugin health check (spec §14.1). Verifies the plugin's hook
 * script is present and the local AgentLens collector is reachable, then prints
 * a short status and exits 0 (healthy) or 1 (collector unreachable).
 *
 *   node scripts/health.js
 *
 * Run by `agentlens integrate claude-code` and manually for diagnostics.
 */
"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { homedir, platform } = require("node:os");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, "..");
const VERSION = require(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json")).version || "0.0.0";

function resolveHome() {
  const env = (process.env.AGENTLENS_HOME || "").trim();
  if (env) return env;
  const p = platform();
  if (p === "darwin") return join(homedir(), "Library", "Application Support", "AgentLens");
  if (p === "win32")
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "AgentLens");
  const xdg = (process.env.XDG_DATA_HOME || "").trim();
  return join(xdg ? xdg : join(homedir(), ".local", "share"), "agentlens");
}

async function probeCollector(home) {
  try {
    const path = join(home, "runtime", "server.json");
    if (!existsSync(path))
      return { running: false, reason: "no runtime record (collector not running)" };
    const rec = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
    if (typeof rec.port !== "number") return { running: false, reason: "malformed runtime record" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`http://127.0.0.1:${rec.port}/api/v1/health`, {
        signal: controller.signal,
      });
      return { running: res.ok, port: rec.port };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { running: false, reason: String(e && e.message ? e.message : e) };
  }
}

async function main() {
  const home = resolveHome();
  const hookScript = join(PLUGIN_ROOT, "scripts", "hook.js");
  const hookPresent = existsSync(hookScript);
  const collector = await probeCollector(home);

  const lines = [
    `agentlens-claude plugin v${VERSION}`,
    `  plugin root: ${PLUGIN_ROOT}`,
    `  hook script: ${hookPresent ? "present" : "MISSING"}`,
    `  home:        ${home}`,
    `  collector:   ${collector.running ? `running on 127.0.0.1:${collector.port}` : "offline (" + (collector.reason || "unreachable") + ")"}`,
  ];
  process.stdout.write(lines.join("\n") + "\n");

  if (!hookPresent) process.exit(1);
  // An offline collector is not fatal — hooks spool offline and import later.
  // Exit 0 as long as the plugin itself is intact (§14.3 spool fallback).
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`agentlens health check failed: ${e}\n`);
  process.exit(1);
});
