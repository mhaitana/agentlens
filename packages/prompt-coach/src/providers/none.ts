/**
 * `none` CoachingProvider (spec §15.5) — the default. External/semantic
 * analysis is off; every method returns an "unavailable" result so callers can
 * treat the semantic layer uniformly without special-casing the off state.
 *
 * This provider never sends anything anywhere; there is no external call.
 */
import type {
  CoachingCallOptions,
  CoachingProvider,
  GeneratedRemediation,
  RedactedPromptAnalysisInput,
  RedactedRemediationInput,
  RedactedTaskClassificationInput,
  SemanticPromptAnalysis,
  TaskClassification,
} from "@agentlens/domain";

/** A shared "unavailable" semantic analysis result. */
function unavailableAnalysis(): SemanticPromptAnalysis {
  return {
    generatedBy: "none",
    providerId: "none",
    available: false,
    qualityNotes: [],
    suggestedMissing: [],
  };
}

function unavailableClassification(): TaskClassification {
  return {
    generatedBy: "none",
    providerId: "none",
    available: false,
    taskType: "unknown",
    confidence: 0,
    rationale: "External analysis is disabled (provider: none).",
  };
}

function unavailableRemediation(): GeneratedRemediation {
  return {
    generatedBy: "none",
    providerId: "none",
    available: false,
    remediation: "",
    steps: [],
  };
}

/** The `none` provider: semantic analysis off, nothing is ever sent. */
export function noneProvider(): CoachingProvider {
  return {
    id: "none",
    external: false,
    async analysePrompt(_input: RedactedPromptAnalysisInput, _options?: CoachingCallOptions) {
      return unavailableAnalysis();
    },
    async classifyTask(_input: RedactedTaskClassificationInput, _options?: CoachingCallOptions) {
      return unavailableClassification();
    },
    async generateRemediation(_input: RedactedRemediationInput, _options?: CoachingCallOptions) {
      return unavailableRemediation();
    },
  };
}
