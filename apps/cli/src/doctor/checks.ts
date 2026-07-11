/**
 * Configuration Doctor check families (spec §15.8).
 *
 * Each check is a pure function over the inspected {@link ClaudeConfigSnapshot}
 * and returns evidence-backed {@link DoctorFinding}s. No check reads the
 * filesystem, the database, or the network — everything it needs is in the
 * snapshot. Checks are tolerant and heuristic: they never throw on malformed
 * input, and they label every token/size estimate approximate (§15.8, §3.4).
 *
 * Findings carry a `fixability` hint so the patch generator (§15.9) knows which
 * findings it may address. No finding is ever auto-applied (§3.5).
 */
import type {
  Confidence,
  DoctorCheckFamily,
  DoctorFinding,
  DoctorFixability,
  DoctorScope,
} from "@agentlens/domain";
import type {
  ClaudeConfigSnapshot,
  HookEntry,
  InstructionFile,
  McpServerEntry,
  PermissionEntry,
  SkillEntry,
} from "./inspect.js";

/* -------------------------------------------------------------------------- */
/* Finding builder                                                            */
/* -------------------------------------------------------------------------- */

let counter = 0;
function resetCounter(): void {
  counter = 0;
}

/** Build a finding with a deterministic, family-prefixed id. */
function finding(
  family: DoctorCheckFamily,
  scope: DoctorScope,
  slug: string,
  partial: Omit<DoctorFinding, "id" | "family" | "scope">,
): DoctorFinding {
  const seq = ++counter;
  const id = `${family}:${slug}-${seq}`;
  return { id, family, scope, ...partial };
}

/** Heuristic confidence defaults per family (structural checks, not measured). */
const CONF = {
  high: 0.8 as Confidence,
  mod: 0.6 as Confidence,
  low: 0.4 as Confidence,
};

/* -------------------------------------------------------------------------- */
/* Instructions (§15.8)                                                       */
/* -------------------------------------------------------------------------- */

/** Bytes above which an instruction file is "extremely large" (heuristic). */
const LARGE_INSTRUCTION_BYTES = 64 * 1024;
/** Lines above which an instruction file is "extremely large" (heuristic). */
const LARGE_INSTRUCTION_LINES = 600;

function instructionFindings(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const projectMds = snap.instructions.filter(
    (f) => f.scope === "project" && f.kind === "claude-md",
  );
  // Missing project instructions.
  if (snap.projectPath && projectMds.length === 0) {
    out.push(
      finding("instructions", "project", "missing-project", {
        severity: "warning",
        title: "No project instructions (CLAUDE.md)",
        detail:
          "No CLAUDE.md was found in the project. AgentLens observed Claude Code often benefits from a project instruction file describing build, test, verification and architecture.",
        evidence: [
          {
            kind: "missing-file",
            description: `No CLAUDE.md under ${snap.projectPath} or its .claude/ directory.`,
            references: [snap.projectPath],
          },
        ],
        confidence: CONF.mod,
        fixability: "auto-fixable",
      }),
    );
  }
  // Extremely large instruction files.
  for (const f of snap.instructions) {
    if (f.bytes >= LARGE_INSTRUCTION_BYTES || f.lines >= LARGE_INSTRUCTION_LINES) {
      out.push(
        finding("instructions", f.scope, "large-file", {
          severity: "warning",
          title: "Extremely large instruction file",
          detail: `${f.path} is ${f.bytes} bytes / ${f.lines} lines (approximate token cost ${f.approxTokens}, chars/4 heuristic — not a measured value). Large always-on files inflate context on every session.`,
          evidence: [
            {
              kind: "large-file",
              description: `Instruction file exceeds heuristic size threshold (${LARGE_INSTRUCTION_BYTES} bytes or ${LARGE_INSTRUCTION_LINES} lines).`,
              signals: [
                { label: "bytes", value: f.bytes },
                { label: "lines", value: f.lines },
                { label: "approxTokens", value: f.approxTokens },
                { label: "tokenEstimateProvenance", value: "heuristic" },
              ],
              references: [f.path],
            },
          ],
          confidence: CONF.high,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Duplicate instructions (identical content hash).
  const byHash = new Map<string, InstructionFile[]>();
  for (const f of snap.instructions) {
    const arr = byHash.get(f.contentHash) ?? [];
    arr.push(f);
    byHash.set(f.contentHash, arr);
  }
  for (const [, group] of byHash) {
    if (group.length > 1) {
      const first = group[0];
      if (!first) continue;
      out.push(
        finding("instructions", first.scope, "duplicate", {
          severity: "warning",
          title: "Duplicate instruction files",
          detail: `${group.length} instruction files share identical content (sha256 prefix ${first.contentHash}). Duplicates waste context and risk drift.`,
          evidence: [
            {
              kind: "duplicate-instructions",
              description: "Files with identical content hashes.",
              signals: [{ label: "count", value: group.length }],
              references: group.map((g) => g.path),
            },
          ],
          confidence: CONF.high,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Conflicting instructions (same scope, same kind, differing content).
  const scoped = new Map<string, InstructionFile[]>();
  for (const f of snap.instructions) {
    if (f.kind !== "claude-md") continue;
    const key = `${f.scope}:${f.kind}`;
    const arr = scoped.get(key) ?? [];
    arr.push(f);
    scoped.set(key, arr);
  }
  for (const [, group] of scoped) {
    if (group.length > 1) {
      const hashes = new Set(group.map((g) => g.contentHash));
      if (hashes.size > 1) {
        const first = group[0];
        if (!first) continue;
        out.push(
          finding("instructions", first.scope, "conflicting", {
            severity: "warning",
            title: "Conflicting project instructions",
            detail: `Multiple CLAUDE.md files exist in the same scope with differing content (e.g. CLAUDE.md and .claude/CLAUDE.md). Claude Code merges them; conflicting guidance can produce inconsistent behaviour.`,
            evidence: [
              {
                kind: "conflicting-instructions",
                description: "Same-scope CLAUDE.md files with different content hashes.",
                signals: [{ label: "files", value: group.length }],
                references: group.map((g) => g.path),
              },
            ],
            confidence: CONF.mod,
            fixability: "manual-only",
          }),
        );
      }
    }
  }
  // Highly specialised instructions loaded globally (user-scope file referencing project-specific paths).
  for (const f of snap.instructions) {
    if (f.scope !== "user") continue;
    const looksProjectSpecific =
      /\/(src|lib|app|packages|components)\//.test(f.firstLine) ||
      /\b(turbo|pnpm|next\.config|vite\.config)\b/i.test(f.firstLine);
    if (looksProjectSpecific) {
      out.push(
        finding("instructions", "user", "global-specialised", {
          severity: "info",
          title: "Project-specific instructions loaded globally",
          detail: `${f.path} (user scope) appears to contain project-specific guidance. Loading it globally applies it to every project.`,
          evidence: [
            {
              kind: "global-specialised",
              description: "User-scope instruction references project-specific paths/tools.",
              signals: [{ label: "firstLine", value: f.firstLine }],
              references: [f.path],
            },
          ],
          confidence: CONF.low,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Missing build/test/verification commands.
  if (projectMds.length > 0) {
    const corpus = projectMds
      .map((m) => m.firstLine)
      .join(" ")
      .toLowerCase();
    const hasBuild = /\b(build|compile|tsc|webpack|vite|rollup)\b/.test(corpus);
    const hasTest = /\b(test|vitest|jest|pytest|cargo test|lint)\b/.test(corpus);
    const hasVerify = /\b(verify|check|typecheck|smoke|e2e|qa)\b/.test(corpus);
    if (!hasBuild || !hasTest || !hasVerify) {
      const missing: string[] = [];
      if (!hasBuild) missing.push("build");
      if (!hasTest) missing.push("test");
      if (!hasVerify) missing.push("verification");
      out.push(
        finding("instructions", "project", "missing-build-test-verify", {
          severity: "info",
          title: "Project instructions omit build/test/verification commands",
          detail: `CLAUDE.md does not mention: ${missing.join(", ")}. Documenting these helps the agent verify its own work.`,
          evidence: [
            {
              kind: "missing-commands",
              description:
                "Keyword scan of project CLAUDE.md found no build/test/verification commands.",
              signals: missing.map((m) => ({ label: "missing", value: m })),
            },
          ],
          confidence: CONF.low,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Missing architecture overview / repository boundaries.
  if (projectMds.length > 0) {
    const corpus = projectMds
      .map((m) => m.firstLine)
      .join(" ")
      .toLowerCase();
    if (!/\b(architecture|structure|monorepo|workspace|packages|modules)\b/.test(corpus)) {
      out.push(
        finding("instructions", "project", "missing-architecture", {
          severity: "info",
          title: "Project instructions omit architecture overview",
          detail:
            "CLAUDE.md does not describe architecture or repository boundaries. An overview reduces misdirected edits.",
          evidence: [
            {
              kind: "missing-architecture",
              description: "Keyword scan found no architecture/boundary terms.",
            },
          ],
          confidence: CONF.low,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Sensitive content (instruction files mentioning secrets/keys).
  for (const f of snap.instructions) {
    if (
      /\b(AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,}|xoxb-|ghp_|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/.test(
        f.firstLine,
      ) ||
      /\b(password|secret|api[_-]?key|token)\s*[:=]\s*\S+/i.test(f.firstLine)
    ) {
      out.push(
        finding("instructions", f.scope, "sensitive-content", {
          severity: "critical",
          title: "Possible secret in instruction file",
          detail: `${f.path} first line matches a known secret/key pattern. Instruction files are read into context and may be committed — never embed secrets.`,
          evidence: [
            {
              kind: "sensitive-content",
              description: "First-line scan matched a secret/key regex.",
              references: [f.path],
            },
          ],
          confidence: CONF.mod,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Stale file references (instructions referencing paths that don't exist).
  for (const f of snap.instructions) {
    const refMatch = /`([A-Za-z0-9_./-]+\.(ts|js|py|go|rs|md|json))`/.exec(f.firstLine);
    if (refMatch && snap.projectPath) {
      const candidate = refMatch[1] ?? "";
      // Only flag if it looks like a project-relative path with a directory.
      if (candidate.includes("/")) {
        out.push(
          finding("instructions", f.scope, "stale-ref", {
            severity: "info",
            title: "Instruction file may reference a stale path",
            detail: `${f.path} references \`${candidate}\` in its first line. Verify the path still exists; stale references mislead the agent.`,
            evidence: [
              {
                kind: "stale-reference",
                description: `First line references ${candidate}.`,
                references: [f.path],
              },
            ],
            confidence: CONF.low,
            fixability: "manual-only",
          }),
        );
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Skills + commands (§15.8)                                                  */
/* -------------------------------------------------------------------------- */

function skillCommandFindings(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  // Duplicate skills (same name across scopes or within).
  const byName = new Map<string, SkillEntry[]>();
  for (const s of snap.skills) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }
  for (const [, group] of byName) {
    if (group.length > 1) {
      const first = group[0];
      if (!first) continue;
      out.push(
        finding("skills", first.scope, "duplicate-skill", {
          severity: "warning",
          title: "Duplicate skill",
          detail: `Skill "${first.name}" is defined ${group.length} times. Claude Code may shadow or duplicate work.`,
          evidence: [
            {
              kind: "duplicate-skill",
              description: "Multiple SKILL.md entries share a name.",
              signals: [{ label: "count", value: group.length }],
              references: group.map((g) => g.path),
            },
          ],
          confidence: CONF.high,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Poorly scoped descriptions (empty or very long).
  for (const s of snap.skills) {
    if (!s.frontmatterValid || s.description.length === 0) {
      out.push(
        finding("skills", s.scope, "poor-description", {
          severity: "warning",
          title: "Skill has a missing or invalid description",
          detail: `${s.path}: frontmatter is missing a name/description. Skills rely on their description for invocation; a poor one causes accidental or missed invocations.`,
          evidence: [
            {
              kind: "poor-skill-description",
              description: "SKILL.md frontmatter missing name or description.",
              references: [s.path],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    } else if (s.description.length > 280) {
      out.push(
        finding("skills", s.scope, "verbose-description", {
          severity: "info",
          title: "Skill description is very long",
          detail: `${s.path}: description is ${s.description.length} chars. Overly long descriptions can cause accidental invocation.`,
          evidence: [
            {
              kind: "verbose-skill-description",
              description: "Skill description exceeds 280 chars.",
              signals: [{ label: "chars", value: s.description.length }],
              references: [s.path],
            },
          ],
          confidence: CONF.low,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Skills never used — the Doctor has no usage telemetry by default, so this is
  // only reported when a usage hint is attached to the snapshot (future hook
  // data). Without it we do NOT invent a "never used" claim (§3 evidence first).
  // Missing validation around generated actions: skills whose workflow text
  // never mentions verification.
  for (const s of snap.skills) {
    // We only have the description here; flag skills whose description implies
    // code generation but mentions no verification.
    const desc = s.description.toLowerCase();
    if (
      /\b(generate|create|write|scaffold|build)\b/.test(desc) &&
      !/\b(verify|test|check|validate|review)\b/.test(desc)
    ) {
      out.push(
        finding("skills", s.scope, "missing-validation", {
          severity: "info",
          title: "Generating skill lacks stated verification",
          detail: `${s.path}: description implies generation without mentioning verification. Generated actions should be verified.`,
          evidence: [
            {
              kind: "missing-validation",
              description: "Skill description implies generation but no verification keyword.",
              references: [s.path],
            },
          ],
          confidence: CONF.low,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Repeated workflows suitable for a skill: heuristically, many commands with a
  // shared verb prefix suggest a repeatable workflow worth a skill.
  if (snap.commands.length >= 6) {
    const verbs = new Map<string, number>();
    for (const c of snap.commands) {
      const v = c.name.split(/[-_]/)[0] ?? "";
      if (v) verbs.set(v, (verbs.get(v) ?? 0) + 1);
    }
    let repeated = false;
    for (const [, n] of verbs) if (n >= 3) repeated = true;
    if (repeated) {
      out.push(
        finding("skills", "project", "repeated-workflow", {
          severity: "info",
          title: "Repeated workflows may suit a skill",
          detail: `${snap.commands.length} commands found, with shared verb prefixes. Repeated multi-step workflows are often better captured as a skill with bounded responsibilities and verification.`,
          evidence: [
            {
              kind: "repeated-workflow",
              description:
                "Several commands share a verb prefix, suggesting a repeatable workflow.",
              signals: [{ label: "commandCount", value: snap.commands.length }],
            },
          ],
          confidence: CONF.low,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Hooks (§15.8)                                                              */
/* -------------------------------------------------------------------------- */

function hookFindings(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  // Duplicate hooks (same event+matcher+command).
  const seen = new Map<string, HookEntry[]>();
  for (const h of snap.hooks) {
    const key = `${h.event}|${h.matcher}|${h.command}`;
    const arr = seen.get(key) ?? [];
    arr.push(h);
    seen.set(key, arr);
  }
  for (const [, group] of seen) {
    if (group.length > 1) {
      const first = group[0];
      if (!first) continue;
      out.push(
        finding("hooks", first.scope, "duplicate-hook", {
          severity: "warning",
          title: "Duplicate hook",
          detail: `Hook on ${first.event} (matcher "${first.matcher}") is registered ${group.length} times with the same command.`,
          evidence: [
            {
              kind: "duplicate-hook",
              description: "Identical event/matcher/command registered repeatedly.",
              signals: [
                { label: "count", value: group.length },
                { label: "event", value: first.event },
              ],
              references: group.map((g) => g.sourcePath),
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Blocking / slow hooks: no timeout set, or a very long timeout.
  for (const h of snap.hooks) {
    if (h.timeoutMs === undefined) {
      out.push(
        finding("hooks", h.scope, "no-timeout", {
          severity: "warning",
          title: "Hook has no timeout",
          detail: `Hook on ${h.event} has no timeout. A hung hook blocks Claude Code. Set a short timeout (spec §19: hooks must be near-zero-latency).`,
          evidence: [
            {
              kind: "hook-no-timeout",
              description: "Hook entry missing a timeout field.",
              signals: [
                { label: "event", value: h.event },
                { label: "matcher", value: h.matcher },
              ],
              references: [h.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    } else if (h.timeoutMs > 10_000) {
      out.push(
        finding("hooks", h.scope, "slow-hook", {
          severity: "warning",
          title: "Hook timeout is high",
          detail: `Hook on ${h.event} has a ${h.timeoutMs}ms timeout. Hooks should be near-zero-latency (§19); long timeouts can block the agent.`,
          evidence: [
            {
              kind: "hook-slow-timeout",
              description: "Hook timeout exceeds 10s.",
              signals: [
                { label: "timeoutMs", value: h.timeoutMs },
                { label: "event", value: h.event },
              ],
              references: [h.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Unsafe broad matchers: matcher "*" on PreToolUse/PostToolUse fires on every tool call.
  for (const h of snap.hooks) {
    if (
      (h.matcher === "*" || h.matcher === "") &&
      (h.event === "PreToolUse" || h.event === "PostToolUse")
    ) {
      out.push(
        finding("hooks", h.scope, "broad-matcher", {
          severity: "warning",
          title: "Hook uses an unsafe broad matcher",
          detail: `Hook on ${h.event} uses matcher "${h.matcher}", firing on every tool call. Use a narrow matcher (e.g. "Bash" or "Write") to avoid overhead and unexpected behaviour.`,
          evidence: [
            {
              kind: "broad-matcher",
              description: "PreToolUse/PostToolUse hook with wildcard matcher.",
              signals: [
                { label: "event", value: h.event },
                { label: "matcher", value: h.matcher },
              ],
              references: [h.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Hooks that modify behaviour unexpectedly: PostToolUse hooks running commands
  // that look like they rewrite files (sed/tee/redirect) without the user knowing.
  for (const h of snap.hooks) {
    if (/\b(sed\s+-i|tee\b|>>?\s*\/|perl\s+-i|awk\s+.*>)/.test(h.command)) {
      out.push(
        finding("hooks", h.scope, "behaviour-modifying", {
          severity: "warning",
          title: "Hook may modify files unexpectedly",
          detail: `Hook on ${h.event} runs a command that appears to rewrite files ("${h.command.slice(0, 80)}"). Review whether this side effect is intended and disclosed.`,
          evidence: [
            {
              kind: "behaviour-modifying-hook",
              description: "Hook command matches a file-rewrite pattern.",
              signals: [{ label: "event", value: h.event }],
              references: [h.sourcePath],
            },
          ],
          confidence: CONF.low,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Hook scripts that no longer exist (command references a path that's gone).
  for (const h of snap.hooks) {
    const m = /\b([A-Za-z0-9_./-]+\/[A-Za-z0-9_-]+\.(?:sh|js|ts|py))\b/.exec(h.command);
    if (m) {
      // We can only check existence for absolute or project-relative paths we can resolve.
      // Without a project root we record a soft hint rather than a hard "missing" claim.
      out.push(
        finding("hooks", h.scope, "script-ref", {
          severity: "info",
          title: "Hook references a script path — verify it exists",
          detail: `Hook on ${h.event} references "${m[1]}". Ensure the script exists and is executable; a missing hook script can fail silently or noisily.`,
          evidence: [
            {
              kind: "hook-script-reference",
              description: "Hook command references an external script.",
              signals: [
                { label: "script", value: m[1] ?? "" },
                { label: "event", value: h.event },
              ],
              references: [h.sourcePath],
            },
          ],
          confidence: CONF.low,
          fixability: "manual-only",
        }),
      );
    }
  }
  // AgentLens hook health: count AgentLens-owned hooks.
  const alHooks = snap.hooks.filter((h) => /agentlens/i.test(h.command));
  const firstAl = alHooks[0];
  if (firstAl && alHooks.length > 0) {
    const missingTimeout = alHooks.some((h) => h.timeoutMs === undefined);
    if (missingTimeout) {
      out.push(
        finding("hooks", firstAl.scope, "agentlens-health", {
          severity: "info",
          title: "AgentLens hook health: missing timeout",
          detail: `${alHooks.length} AgentLens-owned hook(s) registered; at least one has no timeout. AgentLens hooks should be near-zero-latency (§19).`,
          evidence: [
            {
              kind: "agentlens-hook-health",
              description: "AgentLens-owned hook missing a timeout.",
              signals: [{ label: "agentlensHooks", value: alHooks.length }],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Agents / subagents (§15.8)                                                 */
/* -------------------------------------------------------------------------- */

function agentFindings(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  // Overly broad tool access: agents declaring tools: ["*"] or no tools (inherits all).
  for (const a of snap.agents) {
    const broad = a.tools.includes("*") || a.tools.length === 0;
    if (broad) {
      out.push(
        finding("agents", a.scope, "broad-tools", {
          severity: "warning",
          title: "Agent has overly broad tool access",
          detail: `${a.path}: ${a.tools.length === 0 ? "no tools allowlist (inherits all tools)" : 'tools include "*"'}. Bound an agent's tools to its responsibilities to limit blast radius.`,
          evidence: [
            {
              kind: "agent-broad-tools",
              description: "Agent tools allowlist is absent or wildcard.",
              signals: [
                {
                  label: "tools",
                  value: a.tools.length === 0 ? "(inherits all)" : a.tools.join(","),
                },
              ],
              references: [a.path],
            },
          ],
          confidence: CONF.mod,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Missing limits: agents with no description of bounded scope.
  for (const a of snap.agents) {
    if (!a.frontmatterValid || a.description.length === 0) {
      out.push(
        finding("agents", a.scope, "missing-limits", {
          severity: "warning",
          title: "Agent missing name/description (limits)",
          detail: `${a.path}: frontmatter missing name/description. Without a clear description an agent may be invoked accidentally.`,
          evidence: [
            {
              kind: "agent-missing-description",
              description: "Agent frontmatter missing name or description.",
              references: [a.path],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Agent descriptions that cause accidental invocation: very short/generic descriptions.
  for (const a of snap.agents) {
    if (a.description.length > 0 && a.description.length < 20) {
      out.push(
        finding("agents", a.scope, "accidental-invocation", {
          severity: "info",
          title: "Agent description may cause accidental invocation",
          detail: `${a.path}: description is very short ("${a.description}"). Generic descriptions increase accidental invocation.`,
          evidence: [
            {
              kind: "agent-short-description",
              description: "Agent description under 20 chars.",
              signals: [{ label: "chars", value: a.description.length }],
              references: [a.path],
            },
          ],
          confidence: CONF.low,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Excessive subagent overhead: many agents defined.
  if (snap.agents.length >= 12) {
    out.push(
      finding("agents", "user", "excessive-overhead", {
        severity: "info",
        title: "Many agents defined (excessive subagent overhead)",
        detail: `${snap.agents.length} agents are defined. Each agent is a routing candidate; too many increase dispatch overhead and accidental invocation.`,
        evidence: [
          {
            kind: "agent-count",
            description: "Agent count is high.",
            signals: [{ label: "agents", value: snap.agents.length }],
          },
        ],
        confidence: CONF.low,
        fixability: "manual-only",
      }),
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* MCP (§15.8)                                                                */
/* -------------------------------------------------------------------------- */

function mcpFindings(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const byName = new Map<string, McpServerEntry[]>();
  for (const s of snap.mcpServers) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }
  // Configured but possibly unused — without usage telemetry we do NOT assert
  // "unused" (§3 evidence first); we only flag servers with no obvious value
  // signal when env looks empty AND command is missing (misconfiguration).
  for (const [, group] of byName) {
    const s = group[0];
    if (!s) continue;
    if (s.transport === "unknown" && !s.command && !s.url) {
      out.push(
        finding("mcp", s.scope, "misconfigured", {
          severity: "warning",
          title: "MCP server entry is misconfigured",
          detail: `MCP server "${s.name}" has no command, url, or recognised transport. It is configured but cannot start.`,
          evidence: [
            {
              kind: "mcp-misconfigured",
              description: "MCP entry lacks command/url/transport.",
              signals: [{ label: "name", value: s.name }],
              references: [s.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Broad permissions / unknown or untrusted command paths.
  for (const s of snap.mcpServers) {
    if (s.command) {
      const looksUntrusted = /^\.?\//.test(s.command) || s.command.includes("~/");
      const looksNpx = /\bnpx\b/.test(s.command) || /\bunpx\b/.test(s.command);
      if (looksUntrusted) {
        out.push(
          finding("mcp", s.scope, "untrusted-command", {
            severity: "warning",
            title: "MCP server uses a relative/home command path",
            detail: `MCP server "${s.name}" runs "${s.command}". Relative or ~/ paths can resolve unexpectedly; prefer an absolute path or a package manager entry.`,
            evidence: [
              {
                kind: "mcp-untrusted-command",
                description: "MCP command is a relative or home-dir path.",
                signals: [
                  { label: "command", value: s.command },
                  { label: "name", value: s.name },
                ],
                references: [s.sourcePath],
              },
            ],
            confidence: CONF.mod,
            fixability: "manual-only",
          }),
        );
      }
      if (looksNpx) {
        out.push(
          finding("mcp", s.scope, "npx-fetch", {
            severity: "info",
            title: "MCP server fetches on demand via npx",
            detail: `MCP server "${s.name}" uses npx, which fetches packages at run time. Pin a version to avoid supply-chain drift.`,
            evidence: [
              {
                kind: "mcp-npx",
                description: "MCP command uses npx without a pinned version.",
                signals: [{ label: "command", value: s.command }],
                references: [s.sourcePath],
              },
            ],
            confidence: CONF.low,
            fixability: "manual-only",
          }),
        );
      }
    }
  }
  // Environment values likely containing secrets — we only see env-var NAMES,
  // never values (§3.2). Flag names that look like secrets.
  for (const s of snap.mcpServers) {
    // Match secret-looking tokens separated by `_` or `-` (or string edges).
    // `\b` alone misses names like API_TOKEN because `_` is a word char, so we
    // treat `_`/`-` as separators explicitly (§3.2: only names are seen, never values).
    const suspicious = s.envKeys.filter((k) =>
      /(?:^|[_-])(token|secret|key|password|passwd|auth|credential|api[_-]?key)(?:$|[_-])/i.test(k),
    );
    if (suspicious.length > 0) {
      out.push(
        finding("mcp", s.scope, "env-secret-names", {
          severity: "info",
          title: "MCP server reads secret-looking env vars",
          detail: `MCP server "${s.name}" reads env vars named: ${suspicious.join(", ")}. (Values are never read by AgentLens — only names, §3.2.) Ensure they come from a secret store, not a committed .env.`,
          evidence: [
            {
              kind: "mcp-env-secret-names",
              description: "MCP env var names match a secret pattern (values not inspected).",
              signals: suspicious.map((k) => ({ label: "envName", value: k })),
              references: [s.sourcePath],
            },
          ],
          confidence: CONF.mod,
          fixability: "manual-only",
        }),
      );
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Permissions (§15.8)                                                        */
/* -------------------------------------------------------------------------- */

function permissionFindings(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  // Bypass-permission modes.
  for (const m of snap.defaultModes) {
    if (/\b(bypassPermissions|bypass)/i.test(m.mode)) {
      out.push(
        finding("permissions", m.scope, "bypass-mode", {
          severity: "critical",
          title: "Bypass-permissions mode is enabled",
          detail: `settings defaultMode="${m.mode}" bypasses permission prompts. AgentLens will never auto-enable this (§15.9). Consider removing it.`,
          evidence: [
            {
              kind: "bypass-permission-mode",
              description: "settings.permissions.defaultMode bypasses permissions.",
              signals: [{ label: "mode", value: m.mode }],
              references: [m.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "manual-only",
        }),
      );
    }
  }
  const allows = snap.permissions.filter((p) => p.effect === "allow");
  const denies = snap.permissions.filter((p) => p.effect === "deny");
  // Broad wildcard allow rules.
  for (const p of allows) {
    if (/^Bash\(\s*\*\s*\)$/.test(p.rule)) {
      out.push(
        finding("permissions", p.scope, "wildcard-allow", {
          severity: "critical",
          title: "Broad wildcard allow rule",
          detail: `Permission rule "${p.rule}" allows all Bash commands. Prefer narrow patterns like Bash(npm run *).`,
          evidence: [
            {
              kind: "broad-wildcard-allow",
              description: "Wildcard allow on Bash.",
              signals: [{ label: "rule", value: p.rule }],
              references: [p.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Dangerous shell patterns allowed.
  for (const p of allows) {
    if (
      /^Bash\(/.test(p.rule) &&
      /\b(rm\s+-rf\b|sudo\b|:(){|mkfs|dd\s+if=|>\s*\/dev\/sd|chmod\s+[0-7]{3,4}\s+\/)/.test(p.rule)
    ) {
      out.push(
        finding("permissions", p.scope, "dangerous-shell", {
          severity: "critical",
          title: "Dangerous shell pattern allowed",
          detail: `Permission rule "${p.rule}" allows a destructive shell pattern. Review whether this broad allow is necessary.`,
          evidence: [
            {
              kind: "dangerous-shell-pattern",
              description: "Allow rule matches a destructive command pattern.",
              signals: [{ label: "rule", value: p.rule }],
              references: [p.sourcePath],
            },
          ],
          confidence: CONF.high,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Network commands broadly allowed.
  for (const p of allows) {
    if (
      /^Bash\(/.test(p.rule) &&
      /\b(curl|wget|ssh|scp|nc|netcat)\b/.test(p.rule) &&
      /\*/.test(p.rule)
    ) {
      out.push(
        finding("permissions", p.scope, "network-allow", {
          severity: "warning",
          title: "Network command broadly allowed",
          detail: `Permission rule "${p.rule}" broadly allows a network command. Network access can exfiltrate data; scope it to specific hosts/commands.`,
          evidence: [
            {
              kind: "network-broad-allow",
              description: "Wildcard allow on a network command.",
              signals: [{ label: "rule", value: p.rule }],
              references: [p.sourcePath],
            },
          ],
          confidence: CONF.mod,
          fixability: "manual-only",
        }),
      );
    }
  }
  // Sensitive paths not denied.
  const sensitivePaths = [".env", "settings.local.json", "id_rsa", ".npmrc", ".pypirc"];
  for (const path of sensitivePaths) {
    const denied = denies.some((d) => d.rule.includes(path));
    const allowed = allows.some((a) => a.rule.includes(path));
    if (!denied && allowed) {
      out.push(
        finding("permissions", "project", "sensitive-not-denied", {
          severity: "warning",
          title: `Sensitive path "${path}" is allowed but not denied`,
          detail: `"${path}" appears in an allow rule but no deny rule protects it. Add a deny rule (deny → ask → allow evaluation) to safeguard secrets.`,
          evidence: [
            {
              kind: "sensitive-path-not-denied",
              description: "Sensitive path allowed without a deny rule.",
              signals: [{ label: "path", value: path }],
            },
          ],
          confidence: CONF.mod,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Rules that never match: permission rules with unbalanced parens.
  for (const p of snap.permissions) {
    const open = (p.rule.match(/\(/g) ?? []).length;
    const close = (p.rule.match(/\)/g) ?? []).length;
    if (open !== close && !p.rule.startsWith("defaultMode=")) {
      out.push(
        finding("permissions", p.scope, "never-matches", {
          severity: "info",
          title: "Permission rule may never match (malformed)",
          detail: `Permission rule "${p.rule}" has unbalanced parentheses and likely never matches. Claude Code permission rules use the form Tool(specifier).`,
          evidence: [
            {
              kind: "rule-never-matches",
              description: "Permission rule has unbalanced parentheses.",
              signals: [
                { label: "rule", value: p.rule },
                { label: "openParens", value: open },
                { label: "closeParens", value: close },
              ],
              references: [p.sourcePath],
            },
          ],
          confidence: CONF.mod,
          fixability: "auto-fixable",
        }),
      );
    }
  }
  // Conflicts across scopes: same rule allow in one scope, deny in another.
  const byRule = new Map<string, PermissionEntry[]>();
  for (const p of snap.permissions) {
    if (p.rule.startsWith("defaultMode=")) continue;
    const arr = byRule.get(p.rule) ?? [];
    arr.push(p);
    byRule.set(p.rule, arr);
  }
  for (const [rule, group] of byRule) {
    const effects = new Set(group.map((g) => g.effect));
    if (effects.size > 1) {
      const first = group[0];
      if (!first) continue;
      out.push(
        finding("permissions", first.scope, "scope-conflict", {
          severity: "warning",
          title: "Permission rule conflicts across scopes",
          detail: `Rule "${rule}" appears with different effects (${[...effects].join(", ")}). Deny wins, but the conflict suggests accidental configuration.`,
          evidence: [
            {
              kind: "permission-scope-conflict",
              description: "Same rule with differing effects across scopes.",
              signals: [
                { label: "rule", value: rule },
                { label: "effects", value: [...effects].join(",") },
              ],
              references: group.map((g) => g.sourcePath),
            },
          ],
          confidence: CONF.high,
          fixability: "manual-only",
        }),
      );
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Aggregator                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Run all Doctor check families over a snapshot (§15.8). Pure and deterministic.
 */
export function runChecks(snap: ClaudeConfigSnapshot): DoctorFinding[] {
  resetCounter();
  return [
    ...instructionFindings(snap),
    ...skillCommandFindings(snap),
    ...hookFindings(snap),
    ...agentFindings(snap),
    ...mcpFindings(snap),
    ...permissionFindings(snap),
  ];
}

/** Re-export the fixability type for the patch generator. */
export type { DoctorFixability };
