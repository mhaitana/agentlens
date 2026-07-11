/**
 * Prompt comparison view (spec §15.6) — deterministic.
 *
 * Combines the quality assessment and the suggested improved structure with
 * optional outcome evidence for a selected prompt. The original is shown
 * verbatim (already redacted by the caller), alongside detected strengths,
 * ambiguities, missing constraints, observed outcome, the suggested improved
 * prompt, and an explanation of each change. The comparison never claims the
 * revised prompt guarantees better results (§15.6).
 */
import type {
  PromptComparison,
  PromptFeatures,
  PromptMissingComponent,
  PromptOutcomeEvidence,
  SuggestedChange,
} from "@agentlens/domain";
import { assessPrompt } from "./quality.js";
import { suggestImprovedStructure } from "./suggest.js";

const MISSING_LABELS: Record<PromptMissingComponent, string> = {
  objective: "a stated objective",
  target: "a named file/symbol target",
  acceptanceCriteria: "acceptance criteria (done-when)",
  verificationRequest: "an explicit verification request",
  scopeBoundary: "a scope boundary (what not to touch)",
  taskSplit: "splitting the bundled tasks into one prompt each",
};

const DEFAULT_DISCLAIMER =
  "This revision is a deterministic restructure of the signals detected in the original prompt; " +
  "it is not guaranteed to perform better (spec §15.6).";

/** Build observed-outcome lines from outcome evidence (§15.6 example style). */
function outcomeLines(outcome: PromptOutcomeEvidence): string[] {
  if (outcome.observedOutcome.length > 0) return outcome.observedOutcome;
  const lines: string[] = [];
  if (outcome.filesInspected > 0)
    lines.push(`${outcome.filesInspected} file(s) inspected/touched.`);
  if (outcome.correctivePromptsAfter > 0)
    lines.push(`${outcome.correctivePromptsAfter} corrective prompt(s) followed.`);
  if (outcome.reversalsAfter > 0)
    lines.push(`${outcome.reversalsAfter} implementation(s) reversed.`);
  lines.push(
    outcome.verificationRan
      ? "Verification ran."
      : "Verification did not run until requested separately.",
  );
  return lines;
}

/**
 * Build the §15.6 prompt-comparison view for a selected prompt.
 *
 * @param content original prompt text (already redacted by the caller).
 * @param sequence 1-based position within the session.
 * @param outcomeEvidence optional outcome evidence; defaults to "unknown".
 * @param features optional pre-extracted features; extracted when omitted.
 */
export function comparePrompt(
  content: string,
  sequence: number,
  outcomeEvidence?: PromptOutcomeEvidence,
  features?: PromptFeatures,
): PromptComparison {
  const f = features;
  const assessment = assessPrompt(content, sequence, f);
  const suggestion = suggestImprovedStructure(content, sequence, f);
  const outcome = outcomeEvidence ?? {
    correctivePromptsAfter: 0,
    reversalsAfter: 0,
    filesInspected: 0,
    verificationRan: false,
    observedOutcome: [],
  };

  const missingConstraints = suggestion.missingComponents.map((m) => MISSING_LABELS[m]);
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const uniqueMissing = missingConstraints.filter((m) =>
    seen.has(m) ? false : (seen.add(m), true),
  );

  const changeExplanations: SuggestedChange[] = suggestion.changes;

  return {
    original: content,
    strengths: assessment.strengths,
    ambiguities: assessment.ambiguities,
    missingConstraints: uniqueMissing,
    observedOutcome: outcomeLines(outcome),
    suggestedImprovedPrompt: suggestion.suggestedPrompt,
    changeExplanations,
    disclaimer: DEFAULT_DISCLAIMER,
    provenance: "heuristic",
  };
}
