/**
 * Configuration Doctor domain types (spec §15.7–15.11) — provider-neutral.
 *
 * The Doctor inspects coding-agent configuration (settings, instructions,
 * skills, commands, hooks, agents, MCP, plugins, permissions), reports
 * evidence-backed findings, and proposes *safe* patches. It never modifies
 * anything without explicit approval (§3.5): every patch carries
 * `automaticallyApplicable: false`, a destination file, an impact statement,
 * and a diff preview; applying backs up first, validates after, and supports
 * rollback.
 *
 * Nothing here is Claude-Code-specific. The `family`/`scope` vocabulary is
 * generic so future source adapters can reuse the same Doctor surface. All
 * findings carry structured evidence (§3 "evidence before advice") and every
 * token/size figure is labelled approximate unless sourced from exact
 * telemetry (§15.8 "honest metrics").
 */
import type { Confidence } from "./provenance.js";

/** Where a configuration artefact lives. */
export type DoctorScope = "user" | "project" | "local";

/** The six Doctor check families (spec §15.8). */
export type DoctorCheckFamily =
  "instructions" | "skills" | "hooks" | "agents" | "mcp" | "permissions";

/** Finding severity band. */
export type DoctorSeverity = "info" | "warning" | "critical";

/** Whether a finding can be addressed by a generated patch (never auto-applied). */
export type DoctorFixability =
  | "auto-fixable"
  /** A patch can be generated, but applying it would be unsafe/ambiguous — refuse. */
  | "manual-only"
  /** Informational; no patch is appropriate. */
  | "none";

/** One piece of structured evidence backing a Doctor finding (§3). */
export interface DoctorEvidence {
  /** Machine-queryable evidence kind (e.g. "large-file", "duplicate-skill"). */
  kind: string;
  /** Human-readable description of what was observed. */
  description: string;
  /** Concrete observed values (sizes, counts, names). */
  signals?: Array<{ label: string; value: string | number | boolean }>;
  /** Source file(s) the evidence was drawn from, when available. */
  references?: string[];
}

/** A single Doctor finding (§15.8). */
export interface DoctorFinding {
  /** Stable, kebab-case finding id, unique within a report. */
  id: string;
  family: DoctorCheckFamily;
  scope: DoctorScope;
  severity: DoctorSeverity;
  title: string;
  detail: string;
  evidence: DoctorEvidence[];
  /** Confidence in the finding (heuristic checks report a heuristic confidence). */
  confidence: Confidence;
  fixability: DoctorFixability;
  /** Id of the proposed patch that addresses this finding, if any. */
  patchId?: string;
}

/** The kind of patch a finding can produce (§15.9). */
export type PatchKind =
  | "json-settings"
  | "unified-diff"
  | "permission-rule"
  | "claude-md"
  | "skill"
  | "hook"
  | "agent"
  | "mcp-removal";

/** Validation result for a patch (run before proposing and again after applying). */
export interface PatchValidation {
  /** The patched configuration parses and is structurally valid. */
  parses: boolean;
  /** The patch did not enable bypass-permission modes. */
  noBypassPermissions: boolean;
  /** The patch did not enable external data transmission. */
  noExternalTransmission: boolean;
  /** No unrelated keys/comments were removed. */
  unrelatedPreserved: boolean;
  /** Human-readable validation notes. */
  notes: string[];
}

/**
 * A proposed patch (§15.9, §3.5). Never applied without explicit approval;
 * `automaticallyApplicable` is always false. Carries the diff, the destination
 * file, an impact explanation, and a pre-apply validation snapshot.
 */
export interface ProposedPatch {
  /** Stable patch id, referenced by DoctorFinding.patchId. */
  id: string;
  kind: PatchKind;
  /** Destination file the patch writes to, when applicable. */
  targetFile?: string;
  /** One-line summary of the change. */
  summary: string;
  /** Plain-language impact explanation shown before approval (§3.5 step 2). */
  impact: string;
  /** The patch payload: a unified-diff string, a JSON settings fragment, or draft content. */
  diff: string;
  /** Finding ids this patch addresses. */
  addresses: string[];
  /** Always false — the Doctor never auto-applies (§3.5). */
  automaticallyApplicable: false;
  /** Validation snapshot computed on the proposed patch (before applying). */
  validation: PatchValidation;
  /** Whether the patch was refused as unsafe/ambiguous (§15.9). */
  refused: boolean;
  /** Reason when refused. */
  refusalReason?: string;
}

/** A reviewable draft skill (§15.10). Never installed without approval. */
export interface GeneratedSkillDraft {
  /** Stable draft id. */
  id: string;
  name: string;
  description: string;
  /** Invocation guidance for the user. */
  invocation: string;
  /** Required inputs. */
  requiredInputs: string[];
  /** Bounded responsibilities (what the skill does and does not do). */
  responsibilities: string[];
  /** Step-by-step workflow. */
  workflow: string[];
  /** Verification requirements. */
  verification: string[];
  /** Failure handling. */
  failureHandling: string[];
  /** Safety constraints. */
  safetyConstraints: string[];
  /** Supporting scripts (only when necessary), as {path, content}. */
  scripts?: Array<{ path: string; content: string }>;
  /** The finding that prompted the draft. */
  findingId: string;
  /** The full draft file content (front matter + body), reviewable as-is. */
  draftContent: string;
}

/** A reviewable draft hook (§15.11). Never installed without approval. */
export interface GeneratedHookDraft {
  /** Stable draft id. */
  id: string;
  /** Narrow event selection (e.g. "PreToolUse"). */
  event: string;
  /** Narrow matcher. */
  matcher: string;
  /** The hooks.json fragment registering the hook. */
  hookConfig: string;
  /** Safe script {path, content}. */
  script: { path: string; content: string };
  /** Timeout in milliseconds. */
  timeoutMs: number;
  /** Cross-platform considerations. */
  crossPlatform: string[];
  /** Expected stdin input. */
  expectedInput: string;
  /** Expected output / exit behaviour. */
  expectedOutput: string;
  /** Failure behaviour. */
  failureBehaviour: string;
  /** Rollback instructions. */
  rollback: string[];
  /** Inline tests for the script. */
  tests: string;
  /** The finding that prompted the draft. */
  findingId: string;
}

/** A snapshot of inspected configuration (provider-neutral). */
export interface DoctorReport {
  /** Scope the report was run for (project path when --project was given). */
  scope: { kind: DoctorScope | "combined"; projectPath?: string };
  /** When the report was generated (ISO). */
  generatedAt: string;
  findings: DoctorFinding[];
  patches: ProposedPatch[];
  skillDrafts: GeneratedSkillDraft[];
  hookDrafts: GeneratedHookDraft[];
  /** Summary counts by severity. */
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    patches: number;
    refusedPatches: number;
  };
  /** Non-fatal diagnostics from tolerant parsing (§12 — never fail a whole scan for one malformed file). */
  diagnostics: Array<{ path: string; message: string }>;
}

/** Result of applying a patch (§3.5 steps 4–7). */
export interface PatchApplicationResult {
  patchId: string;
  applied: boolean;
  /** Backup file written before applying (for rollback). */
  backupPath?: string;
  targetFile?: string;
  /** Post-apply validation. */
  validation: PatchValidation;
  /** Rollback hint shown to the user. */
  rollbackHint: string;
}

/** Result of rolling back a previously applied patch. */
export interface RollbackResult {
  patchId: string;
  restored: boolean;
  backupPath?: string;
  targetFile?: string;
  /** Validation after restore. */
  validation: PatchValidation;
}
