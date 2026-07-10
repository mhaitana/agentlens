/**
 * M1-11 — CLI smoke + integration test (spec §16, §25, §26).
 *
 * Spawns the *built* `agentlens` binary in an isolated temp AGENTLENS_HOME, runs
 * the full init → scan → report workflow against the synthetic Claude Code
 * fixtures, and verifies the M1 acceptance criteria:
 *   1. init + scan + report --period week run from an isolated home,
 *   2. reports render in terminal, JSON, and Markdown,
 *   3. a repeated scan produces no duplicate sessions,
 *   4. cost figures carry the "Estimated — not an official billing value" label,
 *   5. NO_COLOR (set in a fresh process) strips ANSI — verified by spawning,
 *   6. redaction-before-persist: the raw home path is never stored in plain.
 *
 * No test depends on the developer's real ~/.claude (§21): scan --path points
 * the adapter at an empty override + the fixtures dir only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeFixturesDir, repeatedReadsSession } from "@agentlens/test-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
/** Built CLI binary (repo-root-relative). */
const CLI_BIN = join(here, "..", "dist", "index.js");
/** On-disk SQLite for inspection of redaction-before-persist. */
const DB_PATH_PLACEHOLDER = "agentlens.sqlite";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Run the built CLI with a given AGENTLENS_HOME and args. */
function runAgentlens(home: string, args: string[], env: Record<string, string> = {}): SpawnResult {
  const res = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: join(here, "..", "..", ".."), // repo root, so --path resolves consistently
    env: { ...process.env, AGENTLENS_HOME: home, ...env },
    encoding: "utf8",
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status,
  };
}

let tempHome: string;

beforeAll(async () => {
  if (!CLI_BIN) throw new Error("CLI_BIN path not resolved");
  tempHome = await mkdtemp(join(tmpdir(), "agentlens-smoke-"));
});

afterAll(async () => {
  await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
});

describe("M1-11 CLI smoke (spec §25, §26)", () => {
  it("init creates the data home, config, and database", () => {
    const r = runAgentlens(tempHome, ["init"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("AgentLens initialised");
    expect(r.stdout).toContain(tempHome);
  });

  it("scan --path imports the synthetic fixtures (discovered ≥ 1, imported ≥ 1)", () => {
    const r = runAgentlens(tempHome, ["scan", "--path", claudeCodeFixturesDir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Scan complete");
    // "1 discovered, 1 imported, 0 skipped"
    expect(r.stdout).toMatch(/1 discovered/);
    expect(r.stdout).toMatch(/1 imported/);
  });

  it("status reports one session locally", () => {
    const r = runAgentlens(tempHome, ["status"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/sessions:\s+1/);
    expect(r.stdout).toMatch(/projects:\s+1/);
  });

  it("report --period week (terminal) contains §13.7 sections + the cost disclaimer", () => {
    const r = runAgentlens(tempHome, ["report", "--period", "week"]);
    expect(r.status).toBe(0);
    for (const section of [
      "Summary",
      "Usage",
      "Verification quality",
      "Tool efficiency",
      "Data completeness",
      "Privacy mode",
      "Scan provenance",
    ]) {
      expect(r.stdout).toContain(section);
    }
    expect(r.stdout).toContain("Estimated — not an official billing value");
  });

  it("report --format json parses and carries the cost disclaimer field", () => {
    const r = runAgentlens(tempHome, ["report", "--format", "json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      costDisclaimer: string;
      usage: { totalSessions: { value: number } };
    };
    expect(parsed.costDisclaimer).toBe("Estimated — not an official billing value");
    expect(parsed.usage.totalSessions.value).toBeGreaterThanOrEqual(1);
  });

  it("report --format markdown is well-formed and carries no ANSI escapes", () => {
    const r = runAgentlens(tempHome, ["report", "--format", "markdown"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("# AgentLens report");
    expect(r.stdout).toContain("## Usage");
    expect(r.stdout).toContain("Estimated — not an official billing value");
    expect(r.stdout).not.toContain("\u001b[");
  });

  it("a repeated scan produces no duplicates (skips the unchanged file)", () => {
    const before = runAgentlens(tempHome, ["scan", "--json", "--path", claudeCodeFixturesDir]);
    expect(before.status).toBe(0);
    const beforeSummary = JSON.parse(before.stdout) as {
      imported: number;
      skipped: number;
      discovered: number;
    };
    expect(beforeSummary.discovered).toBe(1);
    expect(beforeSummary.imported).toBe(0); // already imported → skipped
    expect(beforeSummary.skipped).toBe(1);

    // Session count is still one.
    const status = runAgentlens(tempHome, ["status"]);
    expect(status.stdout).toMatch(/sessions:\s+1/);
  });

  it("--force re-imports the unchanged file (imported = 1)", () => {
    const r = runAgentlens(tempHome, [
      "scan",
      "--json",
      "--force",
      "--path",
      claudeCodeFixturesDir,
    ]);
    expect(r.status).toBe(0);
    const summary = JSON.parse(r.stdout) as { imported: number; discovered: number };
    expect(summary.discovered).toBe(1);
    expect(summary.imported).toBe(1); // forced re-import
    // Still only one session row (idempotent inserts, §13.3).
    const status = runAgentlens(tempHome, ["status"]);
    expect(status.stdout).toMatch(/sessions:\s+1/);
  });

  it("NO_COLOR (fresh process) strips ANSI from the terminal report", () => {
    // picocolors resolves colour support once at module load, so this must be a
    // separate process with NO_COLOR set before launch (§16).
    const r = runAgentlens(tempHome, ["report", "--period", "week"], { NO_COLOR: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("AgentLens report");
    expect(r.stdout).not.toContain("\u001b[");
  });

  it("redaction-before-persist: the developer's real home path is never stored in the DB", async () => {
    // In the default redacted-content mode, paths under the developer's real
    // home are anonymised to [HOME]/[REPO]. The real home prefix must therefore
    // never appear verbatim in the SQLite file. (Secrets/auth headers are never
    // persisted in any mode — covered by F001 unit tests; here we assert the
    // home-path redaction guarantee at rest. The synthetic fixture uses a
    // non-real `/home/user/...` cwd that is private-by-construction.)
    const dbFile = join(tempHome, DB_PATH_PLACEHOLDER);
    const buf = await readFile(dbFile);
    const text = buf.toString("utf8");
    const home = homedir();
    expect(home.length).toBeGreaterThan(0);
    expect(text).not.toContain(home);
  });

  it("config path + privacy paths print the expected locations", () => {
    const cp = runAgentlens(tempHome, ["config", "path"]);
    expect(cp.status).toBe(0);
    expect(cp.stdout.trim()).toBe(join(tempHome, "config.json"));

    const pp = runAgentlens(tempHome, ["privacy", "paths"]);
    expect(pp.status).toBe(0);
    expect(pp.stdout).toContain(tempHome);

    const ps = runAgentlens(tempHome, ["privacy", "status"]);
    expect(ps.status).toBe(0);
    expect(ps.stdout).toContain("redacted-content"); // default mode
  });

  it("privacy export + purge + retain exercise the local deletion controls (§3.2, §8, §16)", () => {
    // export writes a JSON file under <home>/exports/ and reports the path.
    const exp = runAgentlens(tempHome, ["privacy", "export", "--json"]);
    expect(exp.status).toBe(0);
    const expBody = JSON.parse(exp.stdout) as { file: string; sessions: number };
    expect(expBody.file).toContain(join(tempHome, "exports"));
    expect(expBody.sessions).toBeGreaterThanOrEqual(1);

    // retain with the default 90-day window prunes nothing here (fixture is recent).
    const ret = runAgentlens(tempHome, ["privacy", "retain", "--json"]);
    expect(ret.status).toBe(0);
    expect((JSON.parse(ret.stdout) as { pruned: number }).pruned).toBe(0);

    // purge deletes all imported data; status afterwards shows zero sessions.
    const purge = runAgentlens(tempHome, ["privacy", "purge", "--json"]);
    expect(purge.status).toBe(0);
    const purgeBody = JSON.parse(purge.stdout) as {
      purged: boolean;
      scope: string;
      summary: { sessions: number };
    };
    expect(purgeBody.scope).toBe("all");
    expect(purgeBody.summary.sessions).toBeGreaterThanOrEqual(1);

    const after = runAgentlens(tempHome, ["status"]);
    expect(after.stdout).toMatch(/sessions:\s+0/);
  });

  it("--help is non-interactive and exits 0", () => {
    const r = runAgentlens(tempHome, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("agentlens");
    expect(r.stdout).toContain("scan");
    expect(r.stdout).toContain("report");
  });

  it("dashboard --help is non-interactive and exits 0", () => {
    const r = runAgentlens(tempHome, ["dashboard", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dashboard");
    expect(r.stdout).toContain("--no-open");
    expect(r.stdout).toContain("--port");
  });

  it("observe --help is non-interactive and exits 0 (spec §16, §14.9)", () => {
    const r = runAgentlens(tempHome, ["observe", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("observe");
    expect(r.stdout).toContain("--otel-port");
    expect(r.stdout).toContain("--json");
  });
});

describe("F003 rules smoke (spec §13.10, §26)", () => {
  let ruleHome: string;
  let ruleFixturesDir: string;

  beforeAll(async () => {
    ruleHome = await mkdtemp(join(tmpdir(), "agentlens-rules-"));
    // Write a synthetic repeated-reads transcript into a temp project dir so the
    // rule-triggering fixture is fully isolated from the M1-11 on-disk fixtures.
    ruleFixturesDir = await mkdtemp(join(tmpdir(), "agentlens-rules-fixtures-"));
    const projectDir = join(ruleFixturesDir, "-home-user-project-x");
    await mkdir(projectDir, { recursive: true });
    const { jsonl } = repeatedReadsSession();
    await writeFile(join(projectDir, "session-0001.jsonl"), jsonl + "\n", "utf8");
    // init the isolated home.
    const init = runAgentlens(ruleHome, ["init"]);
    expect(init.status).toBe(0);
  });

  afterAll(async () => {
    await Promise.all([
      rm(ruleHome, { recursive: true, force: true }).catch(() => undefined),
      rm(ruleFixturesDir, { recursive: true, force: true }).catch(() => undefined),
    ]);
  });

  it("scan imports the repeated-reads fixture", () => {
    const r = runAgentlens(ruleHome, ["scan", "--path", ruleFixturesDir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Scan complete");
  });

  it("report surfaces a TOOLS-001 recommendation through the full pipeline", () => {
    const r = runAgentlens(ruleHome, ["report", "--period", "month", "--format", "json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      recommendations: Array<{ ruleId: string; id: string }>;
    };
    expect(Array.isArray(parsed.recommendations)).toBe(true);
    const ids = parsed.recommendations.map((rec) => rec.ruleId);
    expect(ids).toContain("TOOLS-001");
    for (const rec of parsed.recommendations) {
      expect(rec.id).toMatch(/^rec:/);
    }
  });

  it("rules list enumerates all 16 rules", () => {
    const r = runAgentlens(ruleHome, ["rules", "list", "--json"]);
    expect(r.status).toBe(0);
    const list = JSON.parse(r.stdout) as Array<{ id: string; enabled: boolean }>;
    expect(list).toHaveLength(16);
    expect(list[0]?.id).toBe("TOOLS-001");
    expect(list.every((entry) => entry.enabled)).toBe(true);
  });

  it("rules disable + enable round-trips through config", () => {
    const off = runAgentlens(ruleHome, ["rules", "disable", "TOOLS-001"]);
    expect(off.status).toBe(0);
    const list = runAgentlens(ruleHome, ["rules", "list", "--json"]);
    const parsed = JSON.parse(list.stdout) as Array<{ id: string; enabled: boolean }>;
    expect(parsed.find((m) => m.id === "TOOLS-001")?.enabled).toBe(false);
    // Disabling TOOLS-001 removes it from the next report.
    const rep = runAgentlens(ruleHome, ["report", "--period", "month", "--format", "json"]);
    const rj = JSON.parse(rep.stdout) as { recommendations: Array<{ ruleId: string }> };
    expect(rj.recommendations.map((r2) => r2.ruleId)).not.toContain("TOOLS-001");
    // Re-enable restores it.
    const on = runAgentlens(ruleHome, ["rules", "enable", "TOOLS-001"]);
    expect(on.status).toBe(0);
  });
});

describe("M2-6 dashboard launch (spec §13.8)", () => {
  let dashHome: string;

  beforeAll(async () => {
    dashHome = await mkdtemp(join(tmpdir(), "agentlens-dash-e2e-"));
    // init so the DB + config exist before launching the dashboard.
    const init = runAgentlens(dashHome, ["init"]);
    expect(init.status).toBe(0);
  });

  afterAll(async () => {
    await rm(dashHome, { recursive: true, force: true }).catch(() => undefined);
  });

  /** Spawn the dashboard and resolve once stdout contains the URL line. */
  function startDashboard(home: string): {
    child: ChildProcess;
    port: Promise<number>;
  } {
    const child = spawn(
      process.execPath,
      [CLI_BIN, "dashboard", "--no-open", "--api-only", "--port", "0"],
      { cwd: join(here, "..", "..", ".."), env: { ...process.env, AGENTLENS_HOME: home } },
    );
    let buf = "";
    const port = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("dashboard did not print URL in time")),
        20_000,
      );
      child.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = buf.match(/127\.0\.0\.1:(\d+)/);
        if (m && m[1]) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`dashboard exited before printing URL (code=${code})`));
      });
    });
    return { child, port };
  }

  it("starts the API on loopback, serves health, reuses a running instance, and shuts down cleanly", async () => {
    const { child, port: portPromise } = startDashboard(dashHome);
    const port = await portPromise;
    expect(port).toBeGreaterThan(0);

    // Health endpoint reachable on loopback (§13.8 "Start the local API").
    const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(health.ok).toBe(true);
    const healthBody = (await health.json()) as { status: string };
    expect(healthBody.status).toBe("ok");

    // Runtime record was written (§13.8 reuse support).
    expect(existsSync(join(dashHome, "runtime", "server.json"))).toBe(true);

    // A second launch reuses the healthy existing instance (§13.8).
    const reuse = runAgentlens(dashHome, ["dashboard", "--no-open"]);
    expect(reuse.status).toBe(0);
    expect(reuse.stdout).toContain("Reusing running instance");

    // Clean shutdown on SIGTERM removes the runtime record (§13.8).
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
    expect(code).toBe(0);
    // Give the filesystem a moment, then the record should be gone.
    expect(existsSync(join(dashHome, "runtime", "server.json"))).toBe(false);
  }, 30_000);
});
