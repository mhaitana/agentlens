/**
 * Playwright global setup (spec §21.4, §26, §21 "no real ~/.claude").
 *
 * Owns the full E2E lifecycle: create an isolated AGENTLENS_HOME, `agentlens
 * init` + `agentlens scan` two synthetic fixtures (the default session plus a
 * repeated-reads session that triggers a TOOLS-001 recommendation), then spawn
 * `agentlens dashboard` on a fixed loopback port against that home and wait
 * for health. The returned function is Playwright's global teardown: it kills
 * the server and cleans the temp home + fixture dirs.
 *
 * Only synthetic fixtures are imported (§21); the developer's real ~/.claude
 * is never touched.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repeatedReadsSession } from "@agentlens/test-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(here, "..", "..", "cli", "dist", "index.js");
const FIXTURES = join(here, "..", "..", "..", "packages", "test-fixtures", "claude-code");
const PORT = Number(process.env.AGENTLENS_E2E_PORT ?? 7391);

function runCli(home: string, args: string[]): void {
  const res = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: join(here, "..", "..", ".."),
    env: { ...process.env, AGENTLENS_HOME: home },
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(
      `agentlens ${args.join(" ")} failed (status ${res.status})\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
    );
  }
}

async function waitForHealth(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dashboard did not become healthy on port ${port} within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  if (!existsSync(CLI_BIN)) {
    throw new Error("CLI not built — run `pnpm build` before `pnpm test:e2e`.");
  }

  // 1. Isolated home + seed real data (default session + a repeated-reads one).
  const home = mkdtempSync(join(tmpdir(), "agentlens-e2e-"));
  runCli(home, ["init"]);
  runCli(home, ["scan", "--path", FIXTURES]);
  const rrDir = mkdtempSync(join(tmpdir(), "agentlens-e2e-rr-"));
  const rrProject = join(rrDir, "-home-user-project-x");
  mkdirSync(rrProject, { recursive: true });
  const { jsonl } = repeatedReadsSession();
  writeFileSync(join(rrProject, "session-0001.jsonl"), jsonl + "\n", "utf8");
  runCli(home, ["scan", "--path", rrDir]);

  // 1b. Controlled Claude home for the Configuration Doctor (§21: no test may
  // depend on the developer's real ~/.claude). Seed a no-timeout hook so the
  // Doctor screen has a deterministic finding + a safe json-settings patch,
  // then point the dashboard at it via AGENTLENS_CLAUDE_HOME (inspect.ts
  // honours this override). Backups from an E2E apply land under home/, not here.
  const claudeHome = mkdtempSync(join(tmpdir(), "agentlens-e2e-claude-"));
  writeFileSync(
    join(claudeHome, "settings.json"),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "echo agentlens-check" }],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  // 2. Boot the dashboard (full SPA + API) against the seeded home.
  const server: ChildProcess = spawn(
    process.execPath,
    [CLI_BIN, "dashboard", "--no-open", "--port", String(PORT)],
    {
      cwd: join(here, "..", "..", ".."),
      env: { ...process.env, AGENTLENS_HOME: home, AGENTLENS_CLAUDE_HOME: claudeHome },
      stdio: "ignore",
    },
  );
  server.unref();
  await waitForHealth(PORT);

  // 3. Teardown: kill the server, clean temp dirs.
  return async () => {
    server.kill("SIGTERM");
    rmSync(home, { recursive: true, force: true });
    rmSync(rrDir, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  };
}
