/**
 * Deterministic suggested improved prompt structure (spec §15.5).
 *
 * Assembles a structured prompt template from the signals already detected in
 * the original — objective, target, acceptance criteria, verification request,
 * and scope boundary. Missing components are inserted as *explicit, bracketed
 * placeholders* the user fills in, never invented content. This is a structural
 * restructure, not a semantic rewrite, and it is never claimed to guarantee
 * better results (§15.6).
 */
import type {
  PromptFeatures,
  SuggestedChange,
  SuggestedStructure,
  PromptMissingComponent,
} from "@agentlens/domain";
import { extractPromptFeatures } from "./features.js";

/** First imperative-led line, if any (the most likely objective statement). */
function primaryObjectiveLine(lines: string[]): string | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const first = line
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    if (first && IMPERATIVE_LEADS.has(first)) return line.replace(/\s+/g, " ").trim();
  }
  return null;
}

/** First non-empty line trimmed to its first sentence (fallback objective). */
function fallbackObjective(content: string): string {
  const firstLine =
    content
      .split(/\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const sentenceEnd = firstLine.search(/[.!?]/);
  const text = sentenceEnd >= 0 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;
  return text.replace(/\s+/g, " ").trim();
}

// Reuse a small imperative set for objective detection (kept local to avoid a
// cross-file cycle with the exported IMPERATIVE_VERBS set).
const IMPERATIVE_LEADS = new Set([
  "add",
  "build",
  "change",
  "check",
  "clean",
  "create",
  "delete",
  "fix",
  "implement",
  "make",
  "move",
  "refactor",
  "remove",
  "rename",
  "replace",
  "run",
  "test",
  "update",
  "write",
  "install",
  "configure",
  "generate",
  "scan",
  "lint",
  "format",
  "deploy",
  "migrate",
  "edit",
]);

/** Extract backtick file/symbol references from the prompt. */
function fileReferences(content: string): string[] {
  const spans = content.match(/`[^`\n]+`/g) ?? [];
  return spans.filter((s) => /[./]/.test(s)).map((s) => s.trim());
}

/** List-item lines (bulleted/numbered) for task-split suggestions. */
function listItems(content: string): string[] {
  return content
    .split(/\n/)
    .map((l) => l.replace(/^\s*([-*]|\d+[.)])\s+/, "").trim())
    .filter((l) => l.length > 0);
}

/**
 * Produce a deterministic improved prompt structure.
 *
 * @param content prompt text (already redacted by the caller in production).
 * @param sequence 1-based position within the session.
 * @param features optional pre-extracted features; extracted when omitted.
 */
export function suggestImprovedStructure(
  content: string,
  sequence: number,
  features?: PromptFeatures,
): SuggestedStructure {
  const f = features ?? extractPromptFeatures(content, sequence);
  const lines = content.split(/\n/);
  const changes: SuggestedChange[] = [];
  const missing: PromptMissingComponent[] = [];
  const parts: string[] = [];

  // --- Objective ---
  if (f.multipleIndependentTasks) {
    missing.push("taskSplit");
    const items = listItems(content);
    if (items.length >= 2) {
      parts.push(`This prompt bundles ${items.length} tasks. Run them as separate prompts:`);
      for (const item of items) parts.push(`  • ${item}`);
      changes.push({
        kind: "restructured",
        description: "Split the bundled tasks into one objective per prompt.",
        component: "taskSplit",
      });
    } else {
      parts.push(`[State the single objective for this prompt.]`);
      missing.push("objective");
      changes.push({
        kind: "added",
        description: "Added an objective placeholder (none detected).",
        component: "objective",
      });
    }
  } else {
    const obj = primaryObjectiveLine(lines) ?? fallbackObjective(content);
    if (obj.length === 0) {
      parts.push(`[State the objective for this prompt.]`);
      missing.push("objective");
      changes.push({
        kind: "added",
        description: "Added an objective placeholder.",
        component: "objective",
      });
    } else {
      parts.push(obj);
    }
  }

  // --- Target ---
  const refs = fileReferences(content);
  if (refs.length > 0) {
    parts.push(`Target: ${refs.join(", ")}.`);
  } else {
    parts.push(`Target: [name the file/symbol(s) to change].`);
    missing.push("target");
    changes.push({
      kind: "added",
      description: "Added a target placeholder — no file/symbol was named.",
      component: "target",
    });
  }

  // --- Acceptance criteria ---
  if (f.referencesAcceptanceCriteria) {
    parts.push(`Done when: [keep the acceptance criteria already stated above].`);
  } else {
    parts.push(`Done when: [state the measurable acceptance criteria].`);
    missing.push("acceptanceCriteria");
    changes.push({
      kind: "added",
      description: "Added an acceptance-criteria placeholder.",
      component: "acceptanceCriteria",
    });
  }

  // --- Verification ---
  if (f.requestsVerification) {
    parts.push(`Verify: [keep the verification step already requested].`);
  } else {
    parts.push(`Verify: run the relevant test/typecheck/lint and report the result.`);
    missing.push("verificationRequest");
    changes.push({
      kind: "added",
      description: "Added an explicit verification step.",
      component: "verificationRequest",
    });
  }

  // --- Scope boundary ---
  if (f.hasScopeMarkers) {
    parts.push(`Scope: [keep the scope boundary already stated].`);
  } else {
    parts.push(`Scope: only modify the target above; leave unrelated files unchanged.`);
    missing.push("scopeBoundary");
    changes.push({
      kind: "added",
      description: "Added a scope boundary (what not to touch).",
      component: "scopeBoundary",
    });
  }

  return {
    suggestedPrompt: parts.join("\n"),
    changes,
    missingComponents: missing,
    provenance: "heuristic",
  };
}
