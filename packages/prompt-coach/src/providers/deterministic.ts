/**
 * `deterministic` CoachingProvider (spec §15.5) — surfaces the on-device
 * deterministic layer through the same CoachingProvider interface, so callers
 * that want "no external model, but structured coaching output" get it without
 * any network call. Everything is labelled `generatedBy: "deterministic"`.
 */
import type {
  CoachingCallOptions,
  CoachingProvider,
  GeneratedRemediation,
  PromptMissingComponent,
  RedactedPromptAnalysisInput,
  RedactedRemediationInput,
  RedactedTaskClassificationInput,
  SemanticPromptAnalysis,
  TaskClassification,
} from "@agentlens/domain";
import { assessPrompt } from "../quality.js";
import { suggestImprovedStructure } from "../suggest.js";

const MISSING_LABELS: Record<PromptMissingComponent, string> = {
  objective: "a stated objective",
  target: "a named file/symbol target",
  acceptanceCriteria: "acceptance criteria (done-when)",
  verificationRequest: "an explicit verification request",
  scopeBoundary: "a scope boundary (what not to touch)",
  taskSplit: "splitting the bundled tasks into one prompt each",
};

/**
 * Deterministic task classification from structural features. Coarse and
 * conservative; confidence is a heuristic.
 */
function classifyDeterministic(
  content: string,
  features: RedactedPromptAnalysisInput["prompt"]["features"],
): TaskClassification {
  const f = features;
  let taskType = "other";
  let rationale = "No strong structural signal for a specific task type.";
  if (f.appearsCorrective || f.appearsReversal) {
    taskType = "debug";
    rationale = "Corrective/reversal phrasing suggests debugging prior work.";
  } else if (/review|audit|inspect|check|look at|read through/i.test(content)) {
    taskType = "review";
    rationale = "Review/inspection verbs detected.";
  } else if (/refactor|clean up|restructure|rename|move/i.test(content)) {
    taskType = "refactor";
    rationale = "Refactor/restructure verbs detected.";
  } else if (f.imperativeVerbCount > 0) {
    taskType = "implementation";
    rationale = "Imperative lead suggests an implementation task.";
  }
  const confidence = taskType === "other" ? 0.2 : 0.6;
  return {
    generatedBy: "deterministic",
    providerId: "deterministic",
    available: true,
    taskType,
    confidence,
    rationale,
  };
}

/** The `deterministic` provider: on-device, no network, no external advice. */
export function deterministicProvider(): CoachingProvider {
  return {
    id: "deterministic",
    external: false,
    async analysePrompt(
      input: RedactedPromptAnalysisInput,
      _options?: CoachingCallOptions,
    ): Promise<SemanticPromptAnalysis> {
      const { redactedContent, sequence, features } = input.prompt;
      const a = assessPrompt(redactedContent, sequence, features);
      return {
        generatedBy: "deterministic",
        providerId: "deterministic",
        available: true,
        qualityNotes: a.strengths,
        suggestedMissing: a.missingComponents.map((m) => MISSING_LABELS[m]),
      };
    },
    async classifyTask(
      input: RedactedTaskClassificationInput,
      _options?: CoachingCallOptions,
    ): Promise<TaskClassification> {
      const { redactedContent, features } = input.prompt;
      return classifyDeterministic(redactedContent, features);
    },
    async generateRemediation(
      input: RedactedRemediationInput,
      _options?: CoachingCallOptions,
    ): Promise<GeneratedRemediation> {
      const { redactedContent, sequence, features } = input.prompt;
      const s = suggestImprovedStructure(redactedContent, sequence, features);
      return {
        generatedBy: "deterministic",
        providerId: "deterministic",
        available: true,
        remediation: s.suggestedPrompt,
        steps: s.changes.map((c) => c.description),
      };
    },
  };
}
