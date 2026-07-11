/**
 * Generated skill + hook drafts (spec §15.10, §15.11).
 *
 * Drafts are produced deterministically from a Doctor finding — no LLM. They are
 * presented as *reviewable drafts*: written to the AgentLens exports directory
 * (or printed) and never installed into the user's Claude Code configuration
 * without explicit approval (§3.5). The skill/hook content uses bracketed
 * placeholders where user judgement is required; AgentLens never invents
 * project-specific content.
 *
 * §15.11: "Do not use an LLM hook for work that can be deterministic." Generated
 * hook scripts are plain, deterministic shell/node snippets.
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { GeneratedHookDraft, GeneratedSkillDraft } from "@agentlens/domain";
import type { ClaudeConfigSnapshot, HookEntry } from "./inspect.js";
import type { DoctorFinding } from "@agentlens/domain";

/* -------------------------------------------------------------------------- */
/* Skill drafts (§15.10)                                                      */
/* -------------------------------------------------------------------------- */

let draftSeq = 0;
function nextDraftId(prefix: string): string {
  return `${prefix}-${++draftSeq}`;
}

function resetDraftSeq(): void {
  draftSeq = 0;
}

/**
 * Build a reviewable skill draft from a "repeated workflow" finding. The draft
 * includes every §15.10 component: name, description, invocation, required
 * inputs, bounded responsibilities, step-by-step workflow, verification,
 * failure handling, safety constraints, and supporting scripts only when
 * necessary (none by default — deterministic skills rarely need scripts).
 */
export function buildSkillDraft(
  finding: DoctorFinding,
  snap: ClaudeConfigSnapshot,
): GeneratedSkillDraft {
  resetDraftSeq();
  const name = deriveSkillName(finding, snap);
  const responsibilities = [
    "Performs a single, well-bounded workflow end to end.",
    "Does NOT modify Claude Code settings, permissions, or hooks.",
    "Does NOT transmit data externally.",
  ];
  const workflow = [
    "1. Confirm the required inputs are present; stop and report if not.",
    "2. Execute the workflow steps in order, surfacing progress.",
    "3. Run the verification step(s) before declaring success.",
    "4. Report a concise summary of what changed and what was verified.",
  ];
  const verification = [
    "Run the project's test command and report pass/fail.",
    "Run the project's typecheck/lint command if available.",
    "Do not claim success unless verification passed.",
  ];
  const failureHandling = [
    "On a failed step, stop and report the failure with the command output.",
    "Do not retry destructive operations automatically.",
    "Leave the working tree in a recoverable state; suggest rollback if needed.",
  ];
  const safetyConstraints = [
    "Never run commands outside the workflow's declared scope.",
    "Never commit or push without explicit user approval.",
    "Never read or print secrets, env values, or auth headers.",
  ];
  const requiredInputs = ["<describe the inputs this skill needs>"];

  const draftContent = renderSkillMarkdown({
    name,
    description: finding.detail,
    invocation: `Invoke this skill when: ${finding.title}. Provide the required inputs listed below.`,
    requiredInputs,
    responsibilities,
    workflow,
    verification,
    failureHandling,
    safetyConstraints,
  });

  return {
    id: nextDraftId("skill"),
    name,
    description: finding.detail,
    invocation: `Invoke this skill when: ${finding.title}.`,
    requiredInputs,
    responsibilities,
    workflow,
    verification,
    failureHandling,
    safetyConstraints,
    scripts: undefined,
    findingId: finding.id,
    draftContent,
  };
}

function deriveSkillName(_finding: DoctorFinding, snap: ClaudeConfigSnapshot): string {
  // Derive a kebab-case name from the dominant command verb if available.
  const verb = snap.commands[0]?.name.split(/[-_]/)[0];
  const base = verb ? `${verb}-workflow` : "repeated-workflow";
  return `agentlens-draft-${base}`;
}

interface SkillRenderInput {
  name: string;
  description: string;
  invocation: string;
  requiredInputs: string[];
  responsibilities: string[];
  workflow: string[];
  verification: string[];
  failureHandling: string[];
  safetyConstraints: string[];
}

function renderSkillMarkdown(input: SkillRenderInput): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${input.name}`);
  lines.push("description: <Replace with a one-line description of when to invoke this skill.>");
  lines.push("---");
  lines.push("");
  lines.push(`# ${input.name}`);
  lines.push("");
  lines.push("## Invocation");
  lines.push(input.invocation);
  lines.push("");
  lines.push("## Required inputs");
  for (const r of input.requiredInputs) lines.push(`- ${r}`);
  lines.push("");
  lines.push("## Bounded responsibilities");
  for (const r of input.responsibilities) lines.push(`- ${r}`);
  lines.push("");
  lines.push("## Workflow");
  for (const w of input.workflow) lines.push(w);
  lines.push("");
  lines.push("## Verification requirements");
  for (const v of input.verification) lines.push(`- ${v}`);
  lines.push("");
  lines.push("## Failure handling");
  for (const f of input.failureHandling) lines.push(`- ${f}`);
  lines.push("");
  lines.push("## Safety constraints");
  for (const s of input.safetyConstraints) lines.push(`- ${s}`);
  lines.push("");
  lines.push("<!-- Generated by AgentLens as a reviewable draft. Edit before use. -->");
  return lines.join("\n") + "\n";
}

/* -------------------------------------------------------------------------- */
/* Hook drafts (§15.11)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a reviewable hook draft from a "repeated deterministic action" finding.
 * The draft includes every §15.11 component: narrow event, narrow matcher, safe
 * script, timeout, cross-platform notes, expected input/output, failure
 * behaviour, rollback, and inline tests.
 */
export function buildHookDraft(
  finding: DoctorFinding,
  _snap: ClaudeConfigSnapshot,
): GeneratedHookDraft {
  resetDraftSeq();
  const event = "PreToolUse";
  const matcher = "Bash"; // narrow — never "*"
  const scriptPath = "scripts/agentlens-draft-hook.sh";
  const scriptContent = [
    "#!/usr/bin/env bash",
    "# AgentLens draft hook — deterministic, observation-only. Edit before use.",
    "# Reads one JSON object from stdin, performs a narrow check, exits 0/2.",
    "set -euo pipefail",
    'input="$(cat)"',
    "# Parse only the fields this hook needs; tolerate missing keys.",
    '# e.g. command="$(printf %s "$input" | jq -r ".tool_input.command // empty")"',
    "# Deterministic check goes here. Do not invoke an LLM (spec §15.11).",
    "exit 0",
    "",
  ].join("\n");
  const hookConfig = JSON.stringify(
    {
      hooks: {
        [event]: [
          {
            matcher,
            hooks: [{ type: "command", command: `bash ${scriptPath}`, timeout: 2000 }],
          },
        ],
      },
    },
    null,
    2,
  );
  const tests = [
    "# Inline test (run: bash scripts/agentlens-draft-hook.test.sh)",
    "# Feed a sample stdin and assert the exit code.",
    'echo \'{"tool_input":{"command":"ls"}}\' | bash scripts/agentlens-draft-hook.sh',
    "test $? -eq 0 && echo pass || echo fail",
  ].join("\n");
  return {
    id: nextDraftId("hook"),
    event,
    matcher,
    hookConfig,
    script: { path: scriptPath, content: scriptContent },
    timeoutMs: 2000,
    crossPlatform: [
      "bash is available on macOS/Linux; on Windows use Git Bash or rewrite in Node.",
      "Avoid GNU-only flags; prefer POSIX-compatible invocations.",
    ],
    expectedInput:
      'A single JSON object on stdin with the tool_input for the matched tool (e.g. {"tool_input":{"command":"..."}}).',
    expectedOutput:
      "Exit 0 to allow, exit 2 to block with a stderr message shown to the user. No stdout required.",
    failureBehaviour:
      "On unexpected input, exit 2 with a clear stderr message; never hang. The timeout (2s) bounds runtime.",
    rollback: [
      `Remove the hooks block from settings.json (the draft is in ${scriptPath}).`,
      "Delete the script file. No other state is modified.",
    ],
    tests,
    findingId: finding.id,
  };
}

/* -------------------------------------------------------------------------- */
/* Writing drafts to disk (exports dir) — reviewable, never installed          */
/* -------------------------------------------------------------------------- */

/**
 * Write skill/hook drafts to <home>/exports/drafts/ so the user can review them.
 * Never writes into the user's Claude Code configuration (§3.5). Returns the
 * paths written.
 */
export function writeDrafts(
  home: string,
  skillDrafts: GeneratedSkillDraft[],
  hookDrafts: GeneratedHookDraft[],
): { skills: string[]; hooks: string[] } {
  const draftsDir = join(home, "exports", "drafts");
  mkdirSync(draftsDir, { recursive: true });
  const skills: string[] = [];
  const hooks: string[] = [];
  for (const s of skillDrafts) {
    const path = join(draftsDir, `${s.name}.md`);
    writeFileSync(path, s.draftContent, { mode: 0o644 });
    skills.push(path);
  }
  for (const h of hookDrafts) {
    const cfgPath = join(draftsDir, `hook-${h.id}.json`);
    writeFileSync(cfgPath, h.hookConfig + "\n", { mode: 0o644 });
    const scriptPath = join(draftsDir, `hook-${h.id}.sh`);
    writeFileSync(scriptPath, h.script.content, { mode: 0o755 });
    const testPath = join(draftsDir, `hook-${h.id}.test.sh`);
    writeFileSync(testPath, h.tests + "\n", { mode: 0o644 });
    hooks.push(cfgPath);
  }
  return { skills, hooks };
}

/** Whether a finding should produce a skill draft. */
export function isSkillCandidate(finding: DoctorFinding): boolean {
  return finding.family === "skills" && finding.id.includes("repeated-workflow");
}

/** Whether a finding should produce a hook draft (deterministic repeated action). */
export function isHookCandidate(finding: DoctorFinding, snap: ClaudeConfigSnapshot): boolean {
  // Suggest a hook when a deterministic, repeated post-action check is missing
  // and no similar hook already exists.
  if (finding.family !== "hooks") return false;
  const hasSimilar = snap.hooks.some((h: HookEntry) => h.event === "PostToolUse");
  return !hasSimilar && finding.id.includes("broad-matcher");
}
