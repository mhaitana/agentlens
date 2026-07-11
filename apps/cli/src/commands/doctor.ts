/**
 * `agentlens doctor` (spec §15.7, §16) — read-only configuration health check
 * with optional, explicitly-approved safe patches.
 *
 * Modes:
 * - `agentlens doctor`               — read-only: inspect + report findings + proposed patches.
 * - `agentlens doctor --dry-run`     — same, but emphasises "show planned patches, write nothing".
 * - `agentlens doctor --fix`         — show the plan; apply ONLY with explicit approval
 *   (interactive y/N on a TTY, or the `--yes` flag). Without approval, nothing is written.
 * - `agentlens doctor --fix --yes`   — apply all non-refused patches + write draft skills/hooks.
 * - `agentlens doctor --json`        — machine-readable report (never applies without --yes).
 *
 * `--dry-run` never changes files. `--fix` never applies without explicit confirmation.
 * Patches are minimal, backed up, validated after applying, and rollback-supported (§3.5, §15.9).
 * The Doctor never auto-enables bypass permissions or external data transmission (§15.9).
 */
import { Command } from "commander";
import pc from "picocolors";
import readline from "node:readline";
import type { DoctorReport, PatchApplicationResult, ProposedPatch } from "@agentlens/domain";
import { resolveHome } from "../context.js";
import { runDoctor } from "../doctor/doctor.js";
import { applyPatch } from "../doctor/apply.js";
import { writeDrafts } from "../doctor/drafts.js";

export function makeDoctorCommand(): Command {
  const cmd = new Command("doctor")
    .description("Read-only Claude Code configuration health check with optional safe patches.")
    .option("--project <path>", "Inspect a specific project root in addition to user config.")
    .option("--dry-run", "Show proposed patches without writing anything.")
    .option("--fix", "Propose and (with approval) apply safe patches. Never auto-applies.")
    .option("--yes", "Explicit approval to apply patches with --fix (non-interactive consent).")
    .option("--claude-home <dir>", "Override the Claude Code home (~/.claude).")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: DoctorOpts) => {
      const home = resolveHome();
      const nowIso = new Date().toISOString();
      const report = runDoctor({
        claudeHomeOverride: opts.claudeHome,
        projectPathOverride: opts.project,
        nowIso,
      });

      const wantFix = Boolean(opts.fix);
      const dryRun = Boolean(opts.dryRun);

      if (opts.json) {
        // --json never applies without --yes (explicit, non-interactive consent).
        if (wantFix && !opts.yes) {
          const payload = {
            report,
            applied: [] as PatchApplicationResult[],
            note: "doctor --fix --json requires --yes to apply patches; this run made no changes.",
          };
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
          return;
        }
        if (wantFix && opts.yes) {
          const { applied, draftsWritten } = applyApproved(report, home, nowIso);
          process.stdout.write(JSON.stringify({ report, applied, draftsWritten }, null, 2) + "\n");
          return;
        }
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        return;
      }

      // Human output.
      printReport(report, dryRun || !wantFix);

      if (!wantFix) {
        if (!dryRun) {
          process.stdout.write(
            pc.dim(
              "  Read-only run. Use --dry-run to preview patches, --fix to propose applying them.\n",
            ),
          );
        }
        return;
      }

      // --fix: gather approvals.
      const applicable = report.patches.filter((p) => !p.refused && p.diff);
      if (applicable.length === 0) {
        process.stdout.write(pc.dim("  No auto-applicable patches to apply.\n"));
        return;
      }
      const approved = opts.yes
        ? true
        : await promptConfirm(`Apply ${applicable.length} patch(es) shown above? [y/N] `);
      if (!approved) {
        process.stdout.write(pc.yellow("  Not approved — no changes written.\n"));
        return;
      }
      const { applied, draftsWritten } = applyApproved(report, home, nowIso);
      printApplyResults(applied, draftsWritten);
    });

  return cmd;
}

interface DoctorOpts {
  project?: string;
  dryRun?: boolean;
  fix?: boolean;
  yes?: boolean;
  claudeHome?: string;
  json?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Application (only after explicit approval)                                 */
/* -------------------------------------------------------------------------- */

function applyApproved(
  report: DoctorReport,
  home: string,
  nowIso: string,
): { applied: PatchApplicationResult[]; draftsWritten: { skills: string[]; hooks: string[] } } {
  const applied: PatchApplicationResult[] = [];
  for (const patch of report.patches) {
    if (patch.refused || !patch.diff) continue;
    applied.push(applyPatch(patch, home, nowIso));
  }
  const draftsWritten = writeDrafts(home, report.skillDrafts, report.hookDrafts);
  return { applied, draftsWritten };
}

/* -------------------------------------------------------------------------- */
/* Interactive confirmation (TTY only; non-TTY returns false)                 */
/* -------------------------------------------------------------------------- */

function promptConfirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    process.stdout.write(
      pc.dim(`  ${prompt}(non-interactive terminal — re-run with --yes to apply)\n`),
    );
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^[yY]/.test(answer.trim()));
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Human rendering                                                            */
/* -------------------------------------------------------------------------- */

function severityColour(sev: DoctorReport["findings"][number]["severity"]): string {
  if (sev === "critical") return pc.red(pc.bold(sev));
  if (sev === "warning") return pc.yellow(sev);
  return pc.dim(sev);
}

function printReport(report: DoctorReport, previewOnly: boolean): void {
  const head = previewOnly
    ? pc.bold(pc.cyan("AgentLens configuration doctor — read-only report\n"))
    : pc.bold(pc.cyan("AgentLens configuration doctor — fix plan (no changes yet)\n"));
  process.stdout.write(head);
  if (report.scope.projectPath) {
    process.stdout.write(pc.dim(`  project: ${report.scope.projectPath}\n`));
  }
  process.stdout.write(
    `  findings: ${report.summary.total} (${pc.red(`${report.summary.critical} critical`)}, ${pc.yellow(`${report.summary.warning} warning`)}, ${report.summary.info} info)\n`,
  );
  process.stdout.write(
    `  proposed patches: ${report.summary.patches}` +
      (report.summary.refusedPatches > 0
        ? pc.dim(` (${report.summary.refusedPatches} refused as unsafe/ambiguous)`)
        : "") +
      "\n",
  );
  if (report.diagnostics.length > 0) {
    process.stdout.write(pc.dim(`  parse diagnostics: ${report.diagnostics.length} (non-fatal)\n`));
  }
  process.stdout.write("\n");

  if (report.findings.length === 0) {
    process.stdout.write(pc.green("  No findings. Configuration looks healthy.\n\n"));
    return;
  }

  for (const f of report.findings) {
    process.stdout.write(
      `  ${severityColour(f.severity)} ${pc.bold(`[${f.family}]`)} ${f.title} ${pc.dim(`(${f.scope})`)}\n`,
    );
    process.stdout.write(pc.dim(`    ${wrap(f.detail, 4)}\n`));
    if (f.patchId) {
      const patch = report.patches.find((p) => p.id === f.patchId);
      if (patch) {
        process.stdout.write(
          pc.dim(`    patch: ${patch.id} [${patch.kind}]${patch.refused ? " (refused)" : ""}\n`),
        );
      }
    } else if (f.fixability === "manual-only") {
      process.stdout.write(pc.dim("    patch: manual-only (AgentLens will not auto-edit)\n"));
    }
  }

  // Patch diff previews.
  const showable = report.patches.filter((p) => !p.refused && p.diff);
  if (showable.length > 0) {
    process.stdout.write("\n");
    process.stdout.write(pc.bold(pc.cyan("Proposed patches (diffs)\n")));
    for (const p of showable) printPatchDiff(p);
  }
  const refused = report.patches.filter((p) => p.refused);
  if (refused.length > 0) {
    process.stdout.write("\n");
    process.stdout.write(pc.bold(pc.yellow("Refused patches (review manually)\n")));
    for (const p of refused) {
      process.stdout.write(`  ${pc.dim(p.id)} ${p.summary}: ${p.refusalReason ?? ""}\n`);
    }
  }

  if (report.skillDrafts.length > 0 || report.hookDrafts.length > 0) {
    process.stdout.write("\n");
    process.stdout.write(pc.bold(pc.cyan("Generated drafts (reviewable; not installed)\n")));
    for (const s of report.skillDrafts) {
      process.stdout.write(`  skill draft: ${s.name} (for ${s.findingId})\n`);
    }
    for (const h of report.hookDrafts) {
      process.stdout.write(
        `  hook draft:  ${h.id} — ${h.event}/${h.matcher} (for ${h.findingId})\n`,
      );
    }
  }

  process.stdout.write("\n");
  if (previewOnly) {
    process.stdout.write(
      pc.dim("  No files were changed. Use --fix (with approval) to apply patches.\n"),
    );
  }
}

function printPatchDiff(patch: ProposedPatch): void {
  process.stdout.write(
    `\n  ${pc.bold(patch.id)} [${patch.kind}] → ${patch.targetFile ?? "(no target)"}\n`,
  );
  process.stdout.write(pc.dim(`    summary: ${patch.summary}\n`));
  process.stdout.write(pc.dim(`    impact:  ${wrap(patch.impact, 4)}\n`));
  const diffLines = patch.diff.split(/\r?\n/);
  for (const line of diffLines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      process.stdout.write(pc.dim(`    ${line}\n`));
    } else if (line.startsWith("+")) {
      process.stdout.write(pc.green(`    ${line}\n`));
    } else if (line.startsWith("-")) {
      process.stdout.write(pc.red(`    ${line}\n`));
    } else {
      process.stdout.write(pc.dim(`    ${line}\n`));
    }
  }
}

function printApplyResults(
  applied: PatchApplicationResult[],
  draftsWritten: { skills: string[]; hooks: string[] },
): void {
  process.stdout.write(pc.bold(pc.green("Applied approved patches\n")));
  for (const r of applied) {
    const status = r.applied ? pc.green("applied") : pc.red("not applied");
    process.stdout.write(`  ${pc.bold(r.patchId)} ${status} → ${r.targetFile ?? "(none)"}\n`);
    if (r.backupPath) process.stdout.write(pc.dim(`    backup: ${r.backupPath}\n`));
    const v = r.validation;
    process.stdout.write(
      pc.dim(
        `    validation: parses=${v.parses} noBypass=${v.noBypassPermissions} noExternal=${v.noExternalTransmission} preserved=${v.unrelatedPreserved}\n`,
      ),
    );
    process.stdout.write(pc.dim(`    rollback: ${r.rollbackHint}\n`));
  }
  if (draftsWritten.skills.length > 0 || draftsWritten.hooks.length > 0) {
    process.stdout.write(pc.bold(pc.cyan("\nDrafts written (reviewable)\n")));
    for (const s of draftsWritten.skills) process.stdout.write(`  skill: ${s}\n`);
    for (const h of draftsWritten.hooks) process.stdout.write(`  hook: ${h}\n`);
  }
}

function wrap(text: string, indent: number): string {
  const width = Math.max(40, (process.stdout.columns ?? 80) - indent);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line.trim()) lines.push(line.trim());
  const pad = " ".repeat(indent);
  return lines.join("\n" + pad);
}
