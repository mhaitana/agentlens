/**
 * Doctor runner — orchestrates inspection → checks → patches → drafts into a
 * single provider-neutral {@link DoctorReport} (spec §15.7–15.11).
 *
 * Pure with respect to the user's Claude Code configuration: it reads (via
 * inspect) and computes, but writes nothing. Drafts are produced in memory and
 * only persisted by the command on explicit approval. This module is the seam
 * the CLI command and the API route both call.
 */
import type {
  DoctorReport,
  DoctorScope,
  GeneratedHookDraft,
  GeneratedSkillDraft,
} from "@agentlens/domain";
import { inspectConfig, type InspectOptions } from "./inspect.js";
import { runChecks } from "./checks.js";
import { buildPatches } from "./patches.js";
import { buildHookDraft, buildSkillDraft, isHookCandidate, isSkillCandidate } from "./drafts.js";

export interface DoctorRunOptions extends InspectOptions {
  nowIso: string;
}

/**
 * Run the Doctor end to end (read-only). Returns the full report with findings,
 * proposed patches, and generated skill/hook drafts.
 */
export function runDoctor(opts: DoctorRunOptions): DoctorReport {
  const snap = inspectConfig(opts);
  const findings = runChecks(snap);
  const patches = buildPatches(findings, snap);

  const skillDrafts: GeneratedSkillDraft[] = [];
  const hookDrafts: GeneratedHookDraft[] = [];
  for (const f of findings) {
    if (isSkillCandidate(f)) {
      skillDrafts.push(buildSkillDraft(f, snap));
    } else if (isHookCandidate(f, snap)) {
      hookDrafts.push(buildHookDraft(f, snap));
    }
  }

  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  const refusedPatches = patches.filter((p) => p.refused).length;

  const scopeKind: DoctorScope | "combined" = snap.projectPath ? "combined" : "user";

  return {
    scope: { kind: scopeKind, projectPath: snap.projectPath },
    generatedAt: opts.nowIso,
    findings,
    patches,
    skillDrafts,
    hookDrafts,
    summary: {
      total: findings.length,
      critical,
      warning,
      info,
      patches: patches.length,
      refusedPatches,
    },
    diagnostics: snap.diagnostics,
  };
}
