/**
 * Prompt Coach output types (spec §15.5, §15.6) — provider-neutral.
 *
 * The deterministic layer produces these without any external model. The
 * optional semantic layer (§15.5 `CoachingProvider`, Phase 3 task P3-4) reuses
 * several of the same shapes. Everything here is derived from already-redacted
 * prompt text and structural features only — no raw transcript shapes, no
 * secrets (§3.2, §11).
 *
 * All scores and assessments are labelled `provenance: "heuristic"`: they are
 * deterministic structural signals, never a claim of measured quality, and the
 * coach never claims a revised prompt guarantees better results (§15.6).
 */
import type { PromptFeatures } from "./prompt.js";

/** Quality dimensions the deterministic coach scores (§15.5). */
export type PromptQualityDimensionKey =
  "clarity" | "specificity" | "verifiability" | "scopeBoundedness" | "focus";

/** A missing prompt component the coach can suggest adding (§15.5). */
export type PromptMissingComponent =
  | "objective"
  | "target"
  | "acceptanceCriteria"
  | "verificationRequest"
  | "scopeBoundary"
  | "taskSplit";

/** A single scored quality dimension. */
export interface PromptQualityDimension {
  key: PromptQualityDimensionKey;
  label: string;
  /** Heuristic score in [0,1]. */
  score: number;
  provenance: "heuristic";
  rationale: string;
}

/** Structural evidence backing an assessment finding. */
export interface PromptQualityEvidence {
  kind: string;
  description: string;
  /** Named structural signals and their values. */
  signals: { label: string; value: number | boolean }[];
}

/** One change in a deterministically suggested improved prompt. */
export interface SuggestedChange {
  kind: "added" | "restructured" | "removed";
  description: string;
  /** Missing component the change addresses, if any. */
  component?: PromptMissingComponent;
}

/** A deterministic improved prompt structure (§15.5). */
export interface SuggestedStructure {
  /** Template-assembled improved prompt. Not a guarantee of better results. */
  suggestedPrompt: string;
  changes: SuggestedChange[];
  missingComponents: PromptMissingComponent[];
  provenance: "heuristic";
}

/** Deterministic prompt-quality assessment (§15.5). */
export interface PromptQualityAssessment {
  dimensions: PromptQualityDimension[];
  /** Heuristic mean of dimension scores, in [0,1]. */
  overallScore: number;
  strengths: string[];
  ambiguities: string[];
  missingComponents: PromptMissingComponent[];
  evidence: PromptQualityEvidence[];
  provenance: "heuristic";
}

/**
 * Outcome evidence for a selected prompt (§15.6 "relevant outcome evidence").
 * Caller-supplied from already-persisted, already-redacted session analytics;
 * the coach never reads raw transcripts.
 */
export interface PromptOutcomeEvidence {
  /** Corrective prompts at or after this prompt in the session. */
  correctivePromptsAfter: number;
  /** Implementations reversed at or after this prompt. */
  reversalsAfter: number;
  /** Files inspected/touched in the session (heuristic count). */
  filesInspected: number;
  /** Whether a recognised verification command ran after this prompt. */
  verificationRan: boolean;
  /** Redacted, caller-authored observed-outcome lines. */
  observedOutcome: string[];
}

/** The §15.6 prompt-comparison view for a selected prompt. */
export interface PromptComparison {
  /** Original prompt text (already redacted by the caller). */
  original: string;
  strengths: string[];
  ambiguities: string[];
  missingConstraints: string[];
  observedOutcome: string[];
  suggestedImprovedPrompt: string;
  changeExplanations: SuggestedChange[];
  /** Honest disclaimer: the revision is not guaranteed to perform better. */
  disclaimer: string;
  provenance: "heuristic";
}

/** A recurring prompt template detected across prompts (§15.5). */
export interface RepeatedTemplate {
  /** Deterministic normalised template key. */
  templateKey: string;
  /** Number of prompts matching the template. */
  occurrences: number;
  /** Distinct sessions the template appeared in. */
  sessions: number;
  /** Redacted example prefix illustrating the template. */
  examplePrefix: string;
}

// ---------------------------------------------------------------------------
// Optional semantic layer — CoachingProvider (spec §15.5).
//
// The deterministic layer above needs no provider. This interface is the opt-in
// semantic layer: a `none` provider (off), a `deterministic` provider (the
// on-device layer surfaced through the same interface), and external providers
// (OpenAI-compatible / local-model). External providers are DISABLED BY DEFAULT
// and may only be reached through the CoachingGateway, which enforces the
// §15.5 safeguards: disclose data categories → redact → preview → explicit
// opt-in → per-request cancellation → mark externally generated advice. The
// provider never receives raw transcripts — only a single redacted prompt and
// its structural features (§15.5 "Do not silently send entire transcripts").
// ---------------------------------------------------------------------------

/** Where a coaching result came from. */
export type CoachingGenerationSource = "none" | "deterministic" | "external";

/** A single prompt, already redacted, handed to a provider. */
export interface RedactedPromptPayload {
  /** Already-redacted prompt text (secrets/path markers scrubbed, §8.4). */
  redactedContent: string;
  /** 1-based position within the session. */
  sequence: number;
  /** Structural features extracted by the deterministic layer. */
  features: PromptFeatures;
}

/** Per-call options for a provider invocation (cancellation, etc.). */
export interface CoachingCallOptions {
  /** Abort signal for per-request cancellation (§15.5 step 5). */
  signal?: AbortSignal;
}

/** Input to `CoachingProvider.analysePrompt`. */
export interface RedactedPromptAnalysisInput {
  prompt: RedactedPromptPayload;
}

/** Semantic analysis of a prompt, beyond the deterministic layer. */
export interface SemanticPromptAnalysis {
  generatedBy: CoachingGenerationSource;
  providerId: string;
  /** False when the provider is "none" or the call was disabled/cancelled. */
  available: boolean;
  qualityNotes: string[];
  suggestedMissing: string[];
  /**
   * Required to be surfaced to the user when `generatedBy === "external"`
   * (§15.5 step 6: clearly mark externally generated advice).
   */
  externalDisclaimer?: string;
}

/** Input to `CoachingProvider.classifyTask`. */
export interface RedactedTaskClassificationInput {
  prompt: RedactedPromptPayload;
}

/** Task classification for a prompt. */
export interface TaskClassification {
  generatedBy: CoachingGenerationSource;
  providerId: string;
  available: boolean;
  /** Coarse task type, e.g. "implementation" | "refactor" | "review" | "debug" | "other". */
  taskType: string;
  /** Confidence in [0,1]; heuristic for the deterministic provider. */
  confidence: number;
  rationale: string;
  externalDisclaimer?: string;
}

/** Input to `CoachingProvider.generateRemediation`. */
export interface RedactedRemediationInput {
  prompt: RedactedPromptPayload;
}

/** A generated remediation suggestion for a prompt. */
export interface GeneratedRemediation {
  generatedBy: CoachingGenerationSource;
  providerId: string;
  available: boolean;
  /** The remediation text (a deterministic restructure or external suggestion). */
  remediation: string;
  /** Ordered remediation steps, if any. */
  steps: string[];
  externalDisclaimer?: string;
}

/**
 * Optional semantic coaching provider (spec §15.5). Implementations:
 * `none`, `deterministic`, OpenAI-compatible, local-model. External providers
 * must only be reached via the CoachingGateway so the §15.5 safeguards hold.
 */
export interface CoachingProvider {
  readonly id: string;
  /** True when this provider sends content off-device (§15.5 external). */
  readonly external: boolean;
  analysePrompt(
    input: RedactedPromptAnalysisInput,
    options?: CoachingCallOptions,
  ): Promise<SemanticPromptAnalysis>;
  classifyTask(
    input: RedactedTaskClassificationInput,
    options?: CoachingCallOptions,
  ): Promise<TaskClassification>;
  generateRemediation(
    input: RedactedRemediationInput,
    options?: CoachingCallOptions,
  ): Promise<GeneratedRemediation>;
}

/** Categories of data an external coaching request would send (§15.5 step 1). */
export type CoachingDataCategory =
  "redacted-prompt-text" | "structural-features" | "session-sequence";

/**
 * Disclosure shown to the user BEFORE any external send (§15.5 steps 1–3):
 * exactly what categories of data will be sent, to which endpoint/model, plus a
 * preview of the redacted payload. The user must explicitly approve before the
 * gateway sends anything.
 */
export interface CoachingRequestDisclosure {
  providerId: string;
  external: boolean;
  endpoint?: string;
  model?: string;
  dataCategories: CoachingDataCategory[];
  /** Plain-language summary of what will be sent and where. */
  summary: string;
  /** Truncated preview of the redacted payload the user is consenting to. */
  preview: string;
}

/**
 * Outcome of a gateway analysis call. `status` communicates the §15.5 flow
 * state so the caller can react (e.g. prompt for opt-in, report cancellation).
 */
export type CoachingGatewayStatus = "ok" | "disabled" | "not-approved" | "cancelled" | "error";

/** Result envelope from the CoachingGateway. */
export interface CoachingGatewayResult<T> {
  status: CoachingGatewayStatus;
  result: T;
  /** Disclosure that was (or would be) shown for an external send. */
  disclosure?: CoachingRequestDisclosure;
  /** Error message when status === "error". */
  error?: string;
}
