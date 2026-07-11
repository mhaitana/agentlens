/**
 * Configuration Doctor tests (spec §15.7–15.11, §21).
 *
 * Every test builds an isolated temp Claude home + project and passes them via
 * the inspector's override knobs — the developer's real `~/.claude` is never
 * touched (§21). No real transcripts are used.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectConfig } from "./inspect.js";
import { runChecks } from "./checks.js";
import { buildPatches, validatePatch } from "./patches.js";
import { applyPatch, rollbackPatch, reconstructAfter } from "./apply.js";
import { buildSkillDraft, buildHookDraft, writeDrafts } from "./drafts.js";
import { runDoctor } from "./doctor.js";
import { unifiedDiff } from "./diff.js";
import type { DoctorFinding } from "@agentlens/domain";

/* -------------------------------------------------------------------------- */
/* Fixture builder                                                            */
/* -------------------------------------------------------------------------- */

let claudeHome: string;
let projectPath: string;
let alHome: string;

beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "al-doc-claude-"));
  projectPath = mkdtempSync(join(tmpdir(), "al-doc-project-"));
  alHome = mkdtempSync(join(tmpdir(), "al-doc-home-"));
});

afterEach(() => {
  for (const d of [claudeHome, projectPath, alHome]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function write(dir: string, rel: string, content: string): string {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, { mode: 0o644 });
  return p;
}

function find(findings: DoctorFinding[], family: string, slug: string): DoctorFinding | undefined {
  return findings.find((f) => f.family === family && f.id.includes(`${family}:${slug}-`));
}

/** Narrow a `T | undefined` to `T`, failing the test loudly if absent (no `!`). */
function expectDefined<T>(v: T | undefined, msg: string): T {
  if (v === undefined) throw new Error(msg);
  return v;
}

/** A user settings.json with a no-timeout hook, a wildcard allow, and a bypass mode. */
function userSettings(): string {
  return JSON.stringify(
    {
      permissions: {
        allow: ["Bash(*)", "Bash(curl *)"],
        deny: [],
        defaultMode: "bypassPermissions",
      },
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
  );
}

/* -------------------------------------------------------------------------- */
/* Inspection                                                                 */
/* -------------------------------------------------------------------------- */

describe("inspectConfig", () => {
  it("parses user + project + local settings, hooks, permissions, plugins", () => {
    write(claudeHome, "settings.json", userSettings());
    write(
      projectPath,
      ".claude/settings.json",
      JSON.stringify(
        {
          permissions: { allow: ["Read(./.env)"], deny: [], ask: [] },
          enabledPlugins: { "other@mp": true },
        },
        null,
        2,
      ),
    );
    write(
      projectPath,
      ".claude/settings.local.json",
      JSON.stringify({ permissions: { deny: ["Bash(rm -rf *)"] } }, null, 2),
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    expect(snap.settingsFiles.length).toBe(3);
    expect(snap.hooks.length).toBe(1);
    expect(snap.hooks[0]?.event).toBe("PreToolUse");
    expect(snap.hooks[0]?.timeoutMs).toBeUndefined();
    expect(snap.permissions.some((p) => p.rule === "Bash(*)")).toBe(true);
    expect(snap.defaultModes.some((m) => m.mode === "bypassPermissions")).toBe(true);
    expect(snap.plugins.some((p) => p.id === "other@mp")).toBe(true);
  });

  it("collects CLAUDE.md, rules, skills, commands, agents, mcp", () => {
    write(claudeHome, "CLAUDE.md", "# User instructions\nBe concise.\n");
    write(claudeHome, "settings.json", "{}");
    write(projectPath, "CLAUDE.md", "# Project\nBuild: pnpm build. Test: pnpm test.\n");
    write(projectPath, ".claude/rules/code-style.md", "# Code style\nUse 2 spaces.\n");
    write(
      projectPath,
      ".claude/skills/my-skill/SKILL.md",
      "---\nname: my-skill\ndescription: Does a thing.\n---\nBody.\n",
    );
    write(projectPath, ".claude/commands/deploy.md", "---\ndescription: Deploys.\n---\n# Deploy\n");
    write(
      projectPath,
      ".claude/agents/reviewer.md",
      "---\nname: reviewer\ndescription: Reviews code.\ntools: [Read, Grep]\n---\n",
    );
    write(
      projectPath,
      ".mcp.json",
      JSON.stringify(
        { mcpServers: { fs: { command: "npx", args: ["-y", "fs-mcp"], env: { API_KEY: "x" } } } },
        null,
        2,
      ),
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    expect(snap.instructions.some((i) => i.scope === "user" && i.kind === "claude-md")).toBe(true);
    expect(snap.instructions.some((i) => i.kind === "rule")).toBe(true);
    expect(snap.skills.some((s) => s.name === "my-skill" && s.frontmatterValid)).toBe(true);
    expect(snap.commands.some((c) => c.name === "deploy")).toBe(true);
    expect(snap.agents.some((a) => a.name === "reviewer" && a.tools.includes("Read"))).toBe(true);
    expect(snap.mcpServers.some((m) => m.name === "fs" && m.envKeys.includes("API_KEY"))).toBe(
      true,
    );
  });

  it("records a diagnostic instead of throwing on malformed settings", () => {
    write(claudeHome, "settings.json", "{ not json");
    const snap = inspectConfig({ claudeHomeOverride: claudeHome });
    expect(snap.diagnostics.length).toBeGreaterThan(0);
    expect(snap.settingsFiles[0]?.parsed).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

describe("runChecks", () => {
  it("instructions: missing project CLAUDE.md", () => {
    write(claudeHome, "settings.json", "{}");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    expect(find(findings, "instructions", "missing-project")).toBeTruthy();
  });

  it("instructions: large file, missing build/test/verify + architecture, duplicate", () => {
    write(claudeHome, "settings.json", "{}");
    const big = "# Project\n" + "x".repeat(70_000);
    write(projectPath, "CLAUDE.md", big);
    write(projectPath, ".claude/CLAUDE.md", big);
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    expect(find(findings, "instructions", "large-file")).toBeTruthy();
    expect(find(findings, "instructions", "duplicate")).toBeTruthy();
    expect(find(findings, "instructions", "missing-build-test-verify")).toBeTruthy();
    expect(find(findings, "instructions", "missing-architecture")).toBeTruthy();
  });

  it("instructions: sensitive content in first line", () => {
    write(claudeHome, "settings.json", "{}");
    write(projectPath, "CLAUDE.md", "The deploy token is sk-" + "a".repeat(30) + "\n");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    expect(find(findings, "instructions", "sensitive-content")).toBeTruthy();
  });

  it("skills: duplicate + poor description + missing validation", () => {
    write(claudeHome, "settings.json", "{}");
    write(claudeHome, "skills/dup/SKILL.md", "---\nname: dup\ndescription: generate code\n---\n");
    write(
      projectPath,
      ".claude/skills/dup/SKILL.md",
      "---\nname: dup\ndescription: generate code\n---\n",
    );
    write(projectPath, ".claude/skills/bad/SKILL.md", "no frontmatter here");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    expect(find(findings, "skills", "duplicate-skill")).toBeTruthy();
    expect(find(findings, "skills", "poor-description")).toBeTruthy();
    expect(find(findings, "skills", "missing-validation")).toBeTruthy();
  });

  it("hooks: no-timeout, broad matcher, duplicate, slow", () => {
    write(
      claudeHome,
      "settings.json",
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { matcher: "*", hooks: [{ type: "command", command: "echo a" }] },
              { matcher: "*", hooks: [{ type: "command", command: "echo a" }] },
            ],
            PostToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "echo b", timeout: 30000 }] },
            ],
          },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({ claudeHomeOverride: claudeHome });
    const findings = runChecks(snap);
    expect(find(findings, "hooks", "no-timeout")).toBeTruthy();
    expect(find(findings, "hooks", "broad-matcher")).toBeTruthy();
    expect(find(findings, "hooks", "duplicate-hook")).toBeTruthy();
    expect(find(findings, "hooks", "slow-hook")).toBeTruthy();
  });

  it("agents: broad tools + missing limits", () => {
    write(claudeHome, "settings.json", "{}");
    write(
      claudeHome,
      "agents/wild.md",
      '---\nname: wild\ndescription: does everything\ntools: ["*"]\n---\n',
    );
    write(claudeHome, "agents/undescribed.md", "no frontmatter");
    const snap = inspectConfig({ claudeHomeOverride: claudeHome });
    const findings = runChecks(snap);
    expect(find(findings, "agents", "broad-tools")).toBeTruthy();
    expect(find(findings, "agents", "missing-limits")).toBeTruthy();
  });

  it("mcp: misconfigured + env secret names + untrusted command", () => {
    write(claudeHome, "settings.json", "{}");
    write(
      projectPath,
      ".mcp.json",
      JSON.stringify(
        {
          mcpServers: {
            broken: { foo: "bar" },
            ok: { command: "./local/run.sh", args: [], env: { API_TOKEN: "x" } },
          },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    expect(find(findings, "mcp", "misconfigured")).toBeTruthy();
    expect(find(findings, "mcp", "env-secret-names")).toBeTruthy();
    expect(find(findings, "mcp", "untrusted-command")).toBeTruthy();
  });

  it("permissions: bypass mode, wildcard allow, dangerous shell, sensitive-not-denied, never-matches, scope-conflict", () => {
    write(
      claudeHome,
      "settings.json",
      JSON.stringify(
        {
          permissions: {
            allow: ["Bash(*)", "Bash(rm -rf *)", "Bash(curl *)", "Read(./.env)", "Bash(npm run"],
            deny: [],
            defaultMode: "bypassPermissions",
          },
        },
        null,
        2,
      ),
    );
    write(
      projectPath,
      ".claude/settings.json",
      JSON.stringify(
        {
          permissions: { allow: ["Bash(npm run"], deny: ["Bash(npm run"] },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    expect(find(findings, "permissions", "bypass-mode")).toBeTruthy();
    expect(find(findings, "permissions", "wildcard-allow")).toBeTruthy();
    expect(find(findings, "permissions", "dangerous-shell")).toBeTruthy();
    expect(find(findings, "permissions", "network-allow")).toBeTruthy();
    expect(find(findings, "permissions", "sensitive-not-denied")).toBeTruthy();
    expect(find(findings, "permissions", "never-matches")).toBeTruthy();
    expect(find(findings, "permissions", "scope-conflict")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Patches                                                                    */
/* -------------------------------------------------------------------------- */

describe("buildPatches", () => {
  it("generates an append-only CLAUDE.md patch for missing-project with placeholders", () => {
    write(claudeHome, "settings.json", "{}");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const md = patches.find((p) => p.kind === "claude-md");
    expect(md).toBeTruthy();
    expect(md?.refused).toBe(false);
    expect(md?.automaticallyApplicable).toBe(false);
    expect(md?.validation.unrelatedPreserved).toBe(true);
    expect(md?.diff).toContain("+++ b/CLAUDE.md");
    // Placeholder, not invented content (§15.9 minimal / no fabricated content).
    expect(md?.diff).toContain("<replace");
    // Back-link from finding to patch.
    const f = find(findings, "instructions", "missing-project");
    expect(f?.patchId).toBe(md?.id);
  });

  it("generates a json-settings patch that adds hook timeouts, preserving unrelated keys", () => {
    write(
      claudeHome,
      "settings.json",
      JSON.stringify(
        {
          permissions: { allow: ["Bash(npm test)"] },
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }],
          },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({ claudeHomeOverride: claudeHome });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const hp = patches.find((p) => p.kind === "json-settings" && p.diff.includes("timeout"));
    expect(hp).toBeTruthy();
    expect(hp?.validation.noBypassPermissions).toBe(true);
    expect(hp?.validation.noExternalTransmission).toBe(true);
    expect(hp?.validation.unrelatedPreserved).toBe(true);
    // The existing permissions.allow key is preserved in the diff (context line).
    expect(hp?.diff).toContain("Bash(npm test)");
  });

  it("generates a permission-rule patch adding a deny for a sensitive path", () => {
    write(claudeHome, "settings.json", "{}");
    write(
      projectPath,
      ".claude/settings.json",
      JSON.stringify(
        {
          permissions: { allow: ["Read(./.env)"], deny: [], ask: [] },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const pp = patches.find((p) => p.kind === "permission-rule");
    expect(pp).toBeTruthy();
    expect(pp?.diff).toContain("Read(./.env)");
  });

  it("generates an mcp-removal patch that removes only the misconfigured server", () => {
    write(claudeHome, "settings.json", "{}");
    write(
      projectPath,
      ".mcp.json",
      JSON.stringify(
        {
          mcpServers: { broken: { foo: "bar" }, keep: { command: "npx", args: ["-y", "x"] } },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const mp = patches.find((p) => p.kind === "mcp-removal");
    expect(mp).toBeTruthy();
    expect(mp?.diff).toContain("broken");
    // The kept server is preserved (context line in diff).
    expect(mp?.diff).toContain("keep");
  });

  it("refuses to patch a settings file that is unparseable at patch-build time", () => {
    // Start with a parseable settings file containing a hook with no timeout,
    // which yields a no-timeout finding (a json-settings patch candidate).
    write(
      claudeHome,
      "settings.json",
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }],
          },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({ claudeHomeOverride: claudeHome });
    const findings = runChecks(snap);
    expect(findings.some((f) => f.id.startsWith("hooks:no-timeout"))).toBe(true);
    // Corrupt the file AFTER inspection. buildPatches re-reads the file from
    // disk and must refuse rather than clobber an unparseable settings file.
    write(claudeHome, "settings.json", "{ broken");
    const patches = buildPatches(findings, snap);
    const js = patches.find((p) => p.kind === "json-settings");
    expect(js).toBeTruthy();
    expect(js?.refused).toBe(true);
    expect(js?.refusalReason).toMatch(/unparseable/);
  });

  it("every generated patch is automaticallyApplicable:false and never enables bypass/external", () => {
    write(claudeHome, "settings.json", userSettings());
    write(
      projectPath,
      "CLAUDE.md",
      "# Project\nBuild: pnpm build. Test: pnpm test. Verify: pnpm typecheck. Architecture: monorepo.\n",
    );
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    for (const p of patches) {
      expect(p.automaticallyApplicable).toBe(false);
      if (!p.refused) {
        expect(p.validation.noBypassPermissions).toBe(true);
        expect(p.validation.noExternalTransmission).toBe(true);
      }
    }
  });
});

describe("validatePatch (safety)", () => {
  it("flags a diff that would enable bypass permissions", () => {
    const diff = unifiedDiff(
      "{}\n",
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }, null, 2) + "\n",
      "settings.json",
    );
    const v = validatePatch({
      kind: "json-settings",
      before: "{}\n",
      after: "x\n",
      addedLines: ['"defaultMode": "bypassPermissions"'],
    });
    expect(v.noBypassPermissions).toBe(false);
    expect(v.notes.some((n) => n.includes("bypass"))).toBe(true);
    expect(diff).toBeDefined();
  });

  it("flags a diff that would enable external transmission (enabledPlugins/mcpServers/curl)", () => {
    const v = validatePatch({
      kind: "json-settings",
      before: "",
      after: "",
      addedLines: ['"enabledPlugins": {', '"mcpServers": {', "curl https://ex.com"],
    });
    expect(v.noExternalTransmission).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Apply + rollback                                                           */
/* -------------------------------------------------------------------------- */

describe("applyPatch + rollbackPatch", () => {
  it("backs up, applies, validates, and rolls back a CLAUDE.md append", () => {
    write(claudeHome, "settings.json", "{}");
    write(projectPath, "CLAUDE.md", "# Project\nExisting content.\n");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const md = patches.find((p) => p.kind === "claude-md" && !p.refused);
    expect(md).toBeTruthy();
    const mdPatch = expectDefined(md, "claude-md patch");
    const before = readFileSync(join(projectPath, "CLAUDE.md"), "utf8");
    const result = applyPatch(mdPatch, alHome, "2026-07-11T00:00:00Z");
    expect(result.applied).toBe(true);
    expect(existsSync(result.backupPath ?? "")).toBe(true);
    const after = readFileSync(join(projectPath, "CLAUDE.md"), "utf8");
    expect(after.startsWith(before)).toBe(true); // append-only
    expect(after).toContain("Build, test, verify");
    // Rollback restores the original.
    const rb = rollbackPatch(mdPatch, alHome);
    expect(rb.restored).toBe(true);
    expect(readFileSync(join(projectPath, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("applies a json-settings timeout patch and rolls back", () => {
    write(
      claudeHome,
      "settings.json",
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }],
          },
        },
        null,
        2,
      ),
    );
    const snap = inspectConfig({ claudeHomeOverride: claudeHome });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const hp = patches.find(
      (p) => p.kind === "json-settings" && !p.refused && p.diff.includes("timeout"),
    );
    expect(hp).toBeTruthy();
    const hpPatch = expectDefined(hp, "json-settings timeout patch");
    const before = readFileSync(join(claudeHome, "settings.json"), "utf8");
    const result = applyPatch(hpPatch, alHome, "2026-07-11T00:00:00Z");
    expect(result.applied).toBe(true);
    const after = readFileSync(join(claudeHome, "settings.json"), "utf8");
    expect(after).toContain('"timeout": 2000');
    const rb = rollbackPatch(hpPatch, alHome);
    expect(rb.restored).toBe(true);
    expect(readFileSync(join(claudeHome, "settings.json"), "utf8")).toBe(before);
  });

  it("rollback removes a file that did not exist before (new-file patch)", () => {
    write(claudeHome, "settings.json", "{}");
    // No CLAUDE.md → missing-project patch creates it.
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const findings = runChecks(snap);
    const patches = buildPatches(findings, snap);
    const md = patches.find((p) => p.kind === "claude-md" && !p.refused);
    expect(md).toBeTruthy();
    const mdPatch = expectDefined(md, "claude-md new-file patch");
    const target = expectDefined(mdPatch.targetFile, "patch target file");
    expect(existsSync(target)).toBe(false);
    const result = applyPatch(mdPatch, alHome, "2026-07-11T00:00:00Z");
    expect(result.applied).toBe(true);
    expect(existsSync(target)).toBe(true);
    const rb = rollbackPatch(mdPatch, alHome);
    expect(rb.restored).toBe(true);
    expect(existsSync(target)).toBe(false); // sentinel backup → file removed
  });

  it("reconstructAfter round-trips a unified diff", () => {
    const before = '{\n  "a": 1\n}\n';
    const after = '{\n  "a": 1,\n  "b": 2\n}\n';
    const diff = unifiedDiff(before, after, "settings.json");
    expect(reconstructAfter(diff)).toBe(after);
  });
});

/* -------------------------------------------------------------------------- */
/* Drafts                                                                     */
/* -------------------------------------------------------------------------- */

describe("drafts", () => {
  it("builds a skill draft with every §15.10 component", () => {
    write(claudeHome, "settings.json", "{}");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const f = expectDefined(runChecks(snap)[0], "at least one finding");
    const draft = buildSkillDraft(f, snap);
    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(0);
    expect(draft.invocation.length).toBeGreaterThan(0);
    expect(draft.requiredInputs.length).toBeGreaterThan(0);
    expect(draft.responsibilities.length).toBeGreaterThan(0);
    expect(draft.workflow.length).toBeGreaterThan(0);
    expect(draft.verification.length).toBeGreaterThan(0);
    expect(draft.failureHandling.length).toBeGreaterThan(0);
    expect(draft.safetyConstraints.length).toBeGreaterThan(0);
    expect(draft.draftContent).toContain("---");
    expect(draft.draftContent).toContain("reviewable draft");
  });

  it("builds a hook draft with every §15.11 component and a narrow matcher", () => {
    write(claudeHome, "settings.json", "{}");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const f = expectDefined(runChecks(snap)[0], "at least one finding");
    const draft = buildHookDraft(f, snap);
    expect(draft.event).toBe("PreToolUse");
    expect(draft.matcher).not.toBe("*"); // narrow
    expect(draft.timeoutMs).toBeLessThanOrEqual(5000);
    expect(draft.hookConfig).toContain("PreToolUse");
    expect(draft.script.content).toContain("exit 0");
    expect(draft.crossPlatform.length).toBeGreaterThan(0);
    expect(draft.expectedInput.length).toBeGreaterThan(0);
    expect(draft.expectedOutput.length).toBeGreaterThan(0);
    expect(draft.failureBehaviour.length).toBeGreaterThan(0);
    expect(draft.rollback.length).toBeGreaterThan(0);
    expect(draft.tests.length).toBeGreaterThan(0);
  });

  it("writes drafts to the AgentLens exports dir, never into Claude config", () => {
    write(claudeHome, "settings.json", "{}");
    const snap = inspectConfig({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
    });
    const f = expectDefined(runChecks(snap)[0], "at least one finding");
    const skill = buildSkillDraft(f, snap);
    const hook = buildHookDraft(f, snap);
    const { skills, hooks } = writeDrafts(alHome, [skill], [hook]);
    expect(skills.length).toBe(1);
    expect(hooks.length).toBe(1);
    const skillPath = expectDefined(skills[0], "written skill path");
    expect(existsSync(skillPath)).toBe(true);
    expect(skillPath.startsWith(join(alHome, "exports", "drafts"))).toBe(true);
    // Nothing written into the Claude home.
    expect(existsSync(join(claudeHome, "skills"))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* runDoctor                                                                  */
/* -------------------------------------------------------------------------- */

describe("runDoctor", () => {
  it("produces a report with summary counts and back-linked patches", () => {
    write(claudeHome, "settings.json", userSettings());
    write(
      projectPath,
      "CLAUDE.md",
      "# Project\nBuild: pnpm build. Test: pnpm test. Verify: pnpm typecheck. Architecture: monorepo.\n",
    );
    const report = runDoctor({
      claudeHomeOverride: claudeHome,
      projectPathOverride: projectPath,
      nowIso: "2026-07-11T00:00:00Z",
    });
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.critical + report.summary.warning + report.summary.info).toBe(
      report.summary.total,
    );
    expect(report.generatedAt).toBe("2026-07-11T00:00:00Z");
    // At least one auto-fixable finding is linked to a patch.
    const linked = report.findings.some(
      (f) => f.patchId && report.patches.some((p) => p.id === f.patchId),
    );
    expect(linked).toBe(true);
    // Bypass-permission finding is present and NOT auto-fixable (manual-only).
    const bypass = report.findings.find((f) => f.id.includes("permissions:bypass-mode-"));
    expect(bypass?.fixability).toBe("manual-only");
    expect(bypass?.patchId).toBeUndefined();
  });
});
