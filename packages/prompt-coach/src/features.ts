/**
 * Deterministic prompt-feature extraction (spec §10.4, §15.5).
 *
 * Structural features are extracted with deterministic heuristics only — no
 * external model. The features feed both the analytics snapshot's prompt
 * aggregates (§15.4 prompt-effectiveness rules) and the Prompt Coach's quality
 * dimensions (§15.5). Heuristics are deliberately conservative: a feature is
 * only flagged when there is a concrete textual signal, so counts are lower
 * bounds and every metric downstream is labelled "heuristic".
 */
import type { PromptFeatures } from "@agentlens/domain";

/** Imperative verbs that signal a direct instruction (first word of a line). */
const IMPERATIVE_VERBS = new Set([
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

/** Vague pronouns / open references that often point at an unclear target. */
const VAGUE_REFERENCES =
  /\b(it|this|that|these|those|here|there|the issue|the bug|the file|the code|the function)\b/gi;

/** Phrases that suggest the prompt corrects or reverses prior work. */
const CORRECTION_PHRASES =
  /\b(no,?\s*i meant|not that|wrong|actually,? no|stop|undo|revert|don'?t|do not|instead|rather|wait,? no|that'?s not right|fix that|try again|let'?s try again)\b/gi;

/** Acceptance-criteria signal phrases. */
const ACCEPTANCE_CRITERIA_PHRASES =
  /\b(acceptance criteri(a|on)|definition of done|done when|success (looks like|means)|must (pass|satisfy)|should (pass|satisfy)|verify (that|by)|all tests pass|green (build|ci)|exit code 0|exit-code 0)\b/gi;

/** Verification-request signal phrases. */
const VERIFICATION_REQUEST_PHRASES =
  /\b(run (?:\w+ ){0,3}?(?:tests?|suite|lint|typecheck|build)|run lint|run typecheck|run the build|verify|check (that|it|the)|make sure|confirm|ensure|prove (it|that)|smoke test|e2e|qa (it|this)?|don'?t forget to (run|verify|check)|typecheck)\b/gi;

/** Scope-bounding markers that limit the blast radius of a task (§15.5). */
const SCOPE_MARKER_PHRASES =
  /\b(only\b|just\b|limit (it )?to|within\b|scope(d)? to|restrict(ed)? to|don'?t (touch|modify|change|edit) |leave .* unchanged|no other (files|changes|modifications)|touch(ing)? only|confine(d)? to)\b/gi;

/** Reversal phrases — undo/rollback of prior work, distinct from correction. */
const REVERSAL_PHRASES =
  /\b(undo|revert|roll ?back|rollback|go back to|put .* back|back out|restore(d)? (to|the)|re-apply|revert (this|that|the last))\b/gi;

/**
 * Extract structural features from a prompt. Pure + deterministic.
 *
 * @param content prompt text (already redacted by the caller in production —
 *   the extractor reads structure only and never transmits text).
 * @param sequence 1-based position of the prompt within its session (1 = the
 *   opening prompt, which "begins a new task").
 */
export function extractPromptFeatures(content: string, sequence: number): PromptFeatures {
  const characterCount = content.length;

  // Backtick spans that look like paths (contain "/" or an extension).
  const codeSpans = content.match(/`[^`\n]+`/g) ?? [];
  const fileReferenceCount = codeSpans.filter((s) => /[./]/.test(s)).length;

  // Imperative-verb count: lines whose first word is an imperative.
  let imperativeVerbCount = 0;
  const lines = content.split(/\n/);
  for (const line of lines) {
    const first = line
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    if (first && IMPERATIVE_VERBS.has(first)) imperativeVerbCount += 1;
  }

  // Numbered/bulleted independent task markers (1. / - / * at line start).
  const listItems = lines.filter((l) => /^\s*([-*]|\d+[.)])\s+\S/.test(l)).length;

  const appearsCorrective = sequence > 1 && CORRECTION_PHRASES.test(content);
  // Reset lastIndex for stateful regexes reused below.
  CORRECTION_PHRASES.lastIndex = 0;

  const referencesAcceptanceCriteria = ACCEPTANCE_CRITERIA_PHRASES.test(content);
  ACCEPTANCE_CRITERIA_PHRASES.lastIndex = 0;

  const requestsVerification = VERIFICATION_REQUEST_PHRASES.test(content);
  VERIFICATION_REQUEST_PHRASES.lastIndex = 0;

  const hasScopeMarkers = SCOPE_MARKER_PHRASES.test(content);
  SCOPE_MARKER_PHRASES.lastIndex = 0;

  // Reversal is textual only (not sequence-gated): a rollback can be the
  // opening request ("revert the last deploy"). Correction stays gated.
  const appearsReversal = REVERSAL_PHRASES.test(content);
  REVERSAL_PHRASES.lastIndex = 0;

  // Multiple independent tasks: ≥2 list items OR ≥2 distinct imperative leads.
  const multipleIndependentTasks = listItems >= 2 || imperativeVerbCount >= 2;

  const vagueMatches = content.match(VAGUE_REFERENCES) ?? [];
  const ambiguousReferenceCount = vagueMatches.length;

  // Complexity proxy: structural density of imperatives + list items + clauses.
  const clauseSeparators = (content.match(/[.!?;]\s+|\s+and\s+|\s+then\s+|\n/g) ?? []).length;
  const complexitySignals = imperativeVerbCount + listItems + Math.min(clauseSeparators, 4);
  const complexityScore = Math.min(1, complexitySignals / 6);

  return {
    appearsCorrective,
    beginsNewTask: sequence === 1,
    referencesAcceptanceCriteria,
    requestsVerification,
    multipleIndependentTasks,
    imperativeVerbCount,
    fileReferenceCount,
    ambiguousReferenceCount,
    hasScopeMarkers,
    appearsReversal,
    complexityScore,
    length: characterCount,
  };
}

// Re-exported so callers can reuse the verb set (e.g. tests).
export { IMPERATIVE_VERBS };
