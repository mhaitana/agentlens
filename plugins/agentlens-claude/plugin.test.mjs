/**
 * Plugin tests (spec §14.1, §14.11). Spawns the real hook script as a child
 * process with a controlled AGENTLENS_HOME so nothing touches the developer's
 * real ~/.claude or AgentLens home (§21).
 *
 * Covers: manifest validity, observation-only (no stdout), spool fallback when
 * the collector is offline, online POST when it is up, and secret redaction
 * before the payload leaves the hook process.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const PLUGIN_ROOT = import.meta.dirname;
const HOOK = join(PLUGIN_ROOT, "scripts", "hook.js");
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
const HOOKS = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));

function runHook(home, stdin, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: stdin,
    env: { ...process.env, AGENTLENS_HOME: home, ...env },
    encoding: "utf8",
    timeout: 10_000,
  });
}

// Async runner: spawns the hook without blocking the parent event loop. Needed
// for the "online POST" case — spawnSync freezes the parent's HTTP server so it
// can never accept the child's fetch, which would silently fall back to spool.
function runHookAsync(home, stdin, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { ...process.env, AGENTLENS_HOME: home, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => {
      child.stdin.end();
      resolve({ status: code, stdout, stderr });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe("plugin validates (§14.1, §14.11)", () => {
  it("has a valid manifest with the required fields", () => {
    expect(MANIFEST.name).toBe("agentlens-claude");
    expect(typeof MANIFEST.version).toBe("string");
    expect(MANIFEST.version.length).toBeGreaterThan(0);
    expect(MANIFEST.description.length).toBeGreaterThan(0);
  });

  it("declares hooks that all invoke the hook script", () => {
    const events = Object.keys(HOOKS.hooks);
    expect(events.length).toBeGreaterThanOrEqual(10);
    for (const [evt, entries] of Object.entries(HOOKS.hooks)) {
      for (const entry of entries) {
        for (const h of entry.hooks) {
          expect(h.type).toBe("command");
          expect(h.command).toContain("scripts/hook.js");
          expect(typeof h.timeout).toBe("number");
        }
      }
    }
    // §14.2 event coverage.
    for (const required of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SessionStart", "SessionEnd"]) {
      expect(events).toContain(required);
    }
  });
});

describe("hook script — observation-only capture (§14.1, §14.3, §14.11)", () => {
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentlens-plugin-"));
    mkdirSync(join(home, "event-spool"), { recursive: true });
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const SECRET_PAYLOAD = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "s1",
    cwd: "/tmp/proj",
    prompt: "please use token ghp_012345678901234567890123456789012345 to deploy",
  });

  it("spools when the collector is offline, redacts secrets, exits 0, writes no stdout", () => {
    const res = runHook(home, SECRET_PAYLOAD);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(""); // §14.1 observation-only: never add to Claude's context

    const spoolDir = join(home, "event-spool");
    expect(existsSync(spoolDir)).toBe(true);
    const files = readdirSync(spoolDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);
    const spooled = JSON.parse(readFileSync(join(spoolDir, files[0]), "utf8"));
    expect(spooled.v).toBe(1);
    expect(spooled.provenance).toBe("claude-code-hook");
    // Secret never reaches the spool.
    expect(JSON.stringify(spooled.payload)).not.toContain("ghp_012345678901234567890123456789012345");
    expect(JSON.stringify(spooled.payload)).toContain("[REDACTED:github-token]");
    expect(spooled.payload.hook_event_name).toBe("UserPromptSubmit");
  });

  it("POSTs to the collector when online and writes no spool, exits 0, no stdout", async () => {
    let received = null;
    let tokenSeen = null;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/v1/hooks/event" && req.method === "POST") {
          tokenSeen = req.headers["x-agentlens-token"];
          received = JSON.parse(body);
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404).end();
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    mkdirSync(join(home, "runtime"), { recursive: true });
    writeFileSync(
      join(home, "runtime", "server.json"),
      JSON.stringify({ port, token: "test-runtime-token", pid: 1, startedAt: "2026-07-10T00:00:00.000Z" }),
      { mode: 0o600 },
    );

    try {
      const res = await runHookAsync(home, SECRET_PAYLOAD);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe("");
      expect(received).not.toBeNull();
      expect(tokenSeen).toBe("test-runtime-token");
      expect(JSON.stringify(received)).not.toContain("ghp_");
      expect(JSON.stringify(received)).toContain("[REDACTED:github-token]");
      // No spool when delivery succeeded.
      expect(readdirSync(join(home, "event-spool")).length).toBe(0);
    } finally {
      server.close();
    }
  });

  it("falls back to spool when the collector port is unreachable", () => {
    mkdirSync(join(home, "runtime"), { recursive: true });
    writeFileSync(
      join(home, "runtime", "server.json"),
      JSON.stringify({ port: 1, token: "t", pid: 1, startedAt: "2026-07-10T00:00:00.000Z" }),
      { mode: 0o600 },
    );
    const res = runHook(home, SECRET_PAYLOAD);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    const files = readdirSync(join(home, "event-spool")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);
  });

  it("never throws on malformed stdin and still exits 0", () => {
    const res = runHook(home, "not json {{{");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});