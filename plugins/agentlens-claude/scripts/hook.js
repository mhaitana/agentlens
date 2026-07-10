#!/usr/bin/env node
/*
 * AgentLens Claude Code hook — observation-only capture client (spec §14.1, §14.3).
 *
 * Self-contained and dependency-free so the plugin distributes without a
 * node_modules tree. Runs in the Claude Code hook process:
 *
 *   1. Read the hook payload JSON from stdin (tolerant: malformed → "unknown").
 *   2. Secret-redact the payload inline (privacy floor; the collector re-runs
 *      the full redaction pipeline before DB persist — defense in depth, §8.4).
 *   3. Try to POST the redacted payload to the local AgentLens collector
 *      (port + token read from <home>/runtime/server.json) with a short timeout.
 *   4. On any failure (no collector, timeout, non-2xx), atomically spool the
 *      redacted payload to <home>/event-spool/ for later import (§14.3).
 *   5. ALWAYS exit 0. NEVER write to stdout (observation-only — stdout on
 *      SessionStart/UserPromptSubmit would be added to Claude's context, §14.1).
 *
 * This script never approves, denies, modifies, or blocks anything.
 */

"use strict";

const { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { homedir, platform } = require("node:os");
const { randomUUID } = require("node:crypto");

const DEBUG = process.env.AGENTLENS_HOOK_DEBUG === "1";
const STDIN_CAP = 2 * 1024 * 1024; // 2 MiB hard cap; larger payloads are truncated
const COLLECTOR_TIMEOUT_MS = 1500;

function debug(msg) {
  if (DEBUG) process.stderr.write(`[agentlens-hook] ${msg}\n`);
}

// --- AGENTLENS_HOME resolution (mirrors @agentlens/config resolveAgentLensHome) ---
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

// --- Inline secret detectors (subset of @agentlens/redaction detectors) ---
// Order matters: multi-line / more-specific first. Replacements are opaque
// placeholders; the original secret never reaches the spool or the collector.
const DETECTORS = [
  {
    label: "private-key",
    re: /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]* )?PRIVATE KEY-----/g,
  },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9]{20,}\b/g },
  { label: "slack-token", re: /\bxox[abps]-[A-Za-z0-9-]{10,}\b/g },
  { label: "stripe-key", re: /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{24,}\b/g },
  { label: "openai-anthropic-key", re: /\bsk-(?:proj|ant)-[A-Za-z0-9_-]{16,}\b/g },
  {
    label: "auth-header",
    re: /\b(?:authorization|bearer)\s*[:=]\s*['"]?(?:bearer\s+)?[A-Za-z0-9._~+/=-]{16,}['"]?/gi,
  },
  {
    label: "cloud-credential",
    re: /\b(?:aws_secret_access_key|aws_access_key_id|aws_session_token|azure_client_secret|google_application_credentials|gcp_service_account|digitalocean_token|gcp_api_key)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi,
  },
  {
    label: "connection-string",
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|amqps):\/\/[^\s'"<>]+/gi,
  },
  {
    label: "password",
    re: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[:=]\s*['"]?(\S{6,})['"]?/gi,
  },
  { label: "cookie", re: /\b(?:cookie|set-cookie)\s*[:=]\s*['"]?([^\s;'"]{6,})['"]?/gi },
];

function redactText(text) {
  let out = text;
  for (const d of DETECTORS) out = out.replace(d.re, () => `[REDACTED:${d.label}]`);
  return out;
}

// Redact a parsed object: stringify → strip secrets → parse back. Falls back to
// the redacted string if the result is not valid JSON (should not happen).
function redactPayload(obj) {
  const json = JSON.stringify(obj);
  const redacted = redactText(json);
  try {
    return JSON.parse(redacted);
  } catch {
    return { redacted };
  }
}

// --- stdin (async stream read; hard cap so a runaway payload can't exhaust memory) ---
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (text) => {
      if (!settled) {
        settled = true;
        resolve(text);
      }
    };
    process.stdin.on("data", (c) => {
      size += c.length;
      chunks.push(c);
      if (size >= STDIN_CAP) process.stdin.destroy();
    });
    process.stdin.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => finish(""));
    process.stdin.on("close", () => finish(Buffer.concat(chunks).toString("utf8")));
    // Defensive: never block Claude if no stdin arrives (shouldn't happen, but
    // a hung read must not stall the session). Short absolute deadline.
    setTimeout(() => finish(Buffer.concat(chunks).toString("utf8")), 2000);
  });
}

function parsePayload(raw) {
  if (!raw || raw.trim() === "") return { hook_event_name: "unknown", _empty: true };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return { hook_event_name: "unknown", _malformed: String(raw).slice(0, 4096) };
  } catch {
    return { hook_event_name: "unknown", _malformed: raw.slice(0, 4096) };
  }
}

// --- runtime record (port + token for the loopback collector) ---
function readRuntimeRecord(home) {
  try {
    const path = join(home, "runtime", "server.json");
    if (!existsSync(path)) return null;
    const rec = JSON.parse(readFileSync(path, "utf8"));
    if (typeof rec.port === "number" && typeof rec.token === "string") return rec;
    return null;
  } catch {
    return null;
  }
}

async function deliverOnline(redacted, record) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${record.port}/api/v1/hooks/event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agentlens-token": record.token,
      },
      body: JSON.stringify(redacted),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function spool(home, redacted, receivedAt) {
  const dir = join(home, "event-spool");
  mkdirSync(dir, { recursive: true });
  const name = `${receivedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
  const finalPath = join(dir, name);
  const tmpPath = join(dir, `.${name}.tmp`);
  const envelope = { v: 1, provenance: "claude-code-hook", receivedAt, payload: redacted };
  writeFileSync(tmpPath, JSON.stringify(envelope), { mode: 0o600 });
  renameSync(tmpPath, finalPath);
  debug(`spooled to ${finalPath}`);
}

async function main() {
  const receivedAt = new Date().toISOString();
  const raw = await readStdin();
  const payload = parsePayload(raw);
  const redacted = redactPayload(payload);
  const home = resolveHome();

  const record = readRuntimeRecord(home);
  if (record) {
    const ok = await deliverOnline(redacted, record);
    if (ok) {
      debug("delivered online");
      return;
    }
    debug("online delivery failed; falling back to spool");
  } else {
    debug("no runtime record; spooling");
  }
  spool(home, redacted, receivedAt);
}

main()
  .catch(() => {
    // Never let a hook failure block or break Claude Code (§14.1, §14.3).
  })
  .finally(() => {
    process.exit(0);
  });
