/**
 * Deterministic prompt-quality assessment (spec §15.5).
 *
 * Scores five quality dimensions purely from structural features — no external
 * model. Scores are heuristic (deterministic functions of the features) and are
 * always labelled as such. The coach never claims a score is a measured quality
 * value (§3.4 honest metrics) and never compares against invented industry
 * averages (§15.3).
 */
import type {
  PromptFeatures,
  PromptQualityAssessment,
  PromptQualityDimension,
  PromptQualityDimensionKey,
  PromptQualityEvidence,
  PromptMissingComponent,
} from "@agentlens/domain";
import { extractPromptFeatures } from "./features.js";

/** Clamp a value into [0,1]. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Round to 2 decimals for stable, readable scores. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Assess a prompt's quality deterministically.
 *
 * @param content prompt text (already redacted by the caller in production).
 * @param sequence 1-based position within the session.
 * @param features optional pre-extracted features; extracted when omitted.
 */
export function assessPrompt(
  content: string,
  sequence: number,
  features?: PromptFeatures,
): PromptQualityAssessment {
  const f = features ?? extractPromptFeatures(content, sequence);

  // --- Clarity: imperative lead + low vagueness + bounded length. ---
  const vague = f.ambiguousReferenceCount;
  const vaguePenalty = clamp01(vague / 6);
  const imperativeSignal = f.imperativeVerbCount > 0 ? 1 : 0.4;
  const lengthSignal = f.length === 0 ? 0.2 : clamp01(Math.min(f.length, 240) / 60);
  const clarity = clamp01(imperativeSignal * 0.5 + lengthSignal * 0.3 + (1 - vaguePenalty) * 0.2);

  // --- Specificity: concrete file/symbol references, low vagueness. ---
  const refSignal = clamp01(f.fileReferenceCount / 2);
  const specificity = clamp01(refSignal * 0.6 + (1 - vaguePenalty) * 0.4);

  // --- Verifiability: acceptance criteria + verification request. ---
  const verifiability = clamp01(
    (f.referencesAcceptanceCriteria ? 0.55 : 0) + (f.requestsVerification ? 0.45 : 0),
  );

  // --- Scope-boundedness: scope markers and not multi-task. ---
  const scopeSignal = f.hasScopeMarkers ? 0.6 : 0.3;
  const multiTaskPenalty = f.multipleIndependentTasks ? 0.35 : 0;
  const scopeBoundedness = clamp01(scopeSignal - multiTaskPenalty + 0.1);

  // --- Focus: not corrective, not a reversal, single objective. ---
  const focus = clamp01(
    (f.appearsCorrective ? 0 : 0.4) +
      (f.appearsReversal ? 0 : 0.3) +
      (f.multipleIndependentTasks ? 0 : 0.3),
  );

  const dimensions: PromptQualityDimension[] = [
    {
      key: "clarity",
      label: "Clarity",
      score: round2(clarity),
      provenance: "heuristic",
      rationale:
        vague > 0
          ? `${vague} vague reference(s) reduce clarity; imperative lead ${f.imperativeVerbCount > 0 ? "present" : "absent"}.`
          : `Imperative lead ${f.imperativeVerbCount > 0 ? "present" : "absent"}; no vague references detected.`,
    },
    {
      key: "specificity",
      label: "Specificity",
      score: round2(specificity),
      provenance: "heuristic",
      rationale: `${f.fileReferenceCount} file/symbol reference(s); ${vague} vague reference(s).`,
    },
    {
      key: "verifiability",
      label: "Verifiability",
      score: round2(verifiability),
      provenance: "heuristic",
      rationale: `Acceptance criteria ${f.referencesAcceptanceCriteria ? "present" : "absent"}; verification request ${f.requestsVerification ? "present" : "absent"}.`,
    },
    {
      key: "scopeBoundedness",
      label: "Scope-boundedness",
      score: round2(scopeBoundedness),
      provenance: "heuristic",
      rationale: f.multipleIndependentTasks
        ? "Multiple independent tasks bundled — scope is broad."
        : f.hasScopeMarkers
          ? "Scope-bounding markers present."
          : "No explicit scope boundary detected.",
    },
    {
      key: "focus",
      label: "Focus",
      score: round2(focus),
      provenance: "heuristic",
      rationale:
        [
          f.appearsCorrective ? "appears corrective" : null,
          f.appearsReversal ? "appears to reverse prior work" : null,
          f.multipleIndependentTasks ? "bundles several tasks" : null,
        ]
          .filter(Boolean)
          .join("; ") || "Single, non-corrective objective.",
    },
  ];

  const overallScore = round2(dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length);
  // overallScore is derived from the (rounded) dimension scores above so it is
  // exactly the displayed mean — no hidden precision mismatch.

  // --- Strengths / ambiguities / missing components (deterministic). ---
  const strengths: string[] = [];
  if (f.imperativeVerbCount > 0)
    strengths.push("Starts with an imperative verb (direct instruction).");
  if (f.fileReferenceCount > 0)
    strengths.push(`Names ${f.fileReferenceCount} concrete file/symbol target(s).`);
  if (f.referencesAcceptanceCriteria) strengths.push("States acceptance criteria / done-when.");
  if (f.requestsVerification) strengths.push("Requests an explicit verification step.");
  if (f.hasScopeMarkers) strengths.push("Includes scope-bounding language.");
  if (f.length > 0 && !f.multipleIndependentTasks) strengths.push("A single, focused objective.");

  const ambiguities: string[] = [];
  if (vague > 0)
    ambiguities.push(`${vague} vague reference(s) ("this", "the issue", …) — target is unclear.`);
  if (f.fileReferenceCount === 0 && f.length > 0) ambiguities.push("No file/symbol target named.");
  if (!f.referencesAcceptanceCriteria) ambiguities.push("No acceptance criteria stated.");
  if (!f.requestsVerification) ambiguities.push("No verification step requested.");
  if (f.multipleIndependentTasks)
    ambiguities.push("Several independent tasks bundled in one prompt.");
  if (!f.hasScopeMarkers) ambiguities.push("No explicit scope boundary (what not to touch).");

  const missingComponents: PromptMissingComponent[] = [];
  if (f.imperativeVerbCount === 0 && f.length > 0) missingComponents.push("objective");
  if (f.fileReferenceCount === 0 && f.length > 0) missingComponents.push("target");
  if (!f.referencesAcceptanceCriteria) missingComponents.push("acceptanceCriteria");
  if (!f.requestsVerification) missingComponents.push("verificationRequest");
  if (!f.hasScopeMarkers) missingComponents.push("scopeBoundary");
  if (f.multipleIndependentTasks) missingComponents.push("taskSplit");

  const evidence: PromptQualityEvidence[] = [
    {
      kind: "structural-features",
      description: "Deterministic structural signals extracted from the prompt (§15.5).",
      signals: [
        { label: "imperativeVerbCount", value: f.imperativeVerbCount },
        { label: "fileReferenceCount", value: f.fileReferenceCount },
        { label: "ambiguousReferenceCount", value: f.ambiguousReferenceCount },
        { label: "referencesAcceptanceCriteria", value: f.referencesAcceptanceCriteria },
        { label: "requestsVerification", value: f.requestsVerification },
        { label: "hasScopeMarkers", value: f.hasScopeMarkers },
        { label: "multipleIndependentTasks", value: f.multipleIndependentTasks },
        { label: "appearsCorrective", value: f.appearsCorrective },
        { label: "appearsReversal", value: f.appearsReversal },
        { label: "complexityScore", value: f.complexityScore },
        { label: "length", value: f.length },
      ],
    },
  ];

  return {
    dimensions,
    overallScore,
    strengths,
    ambiguities,
    missingComponents,
    evidence,
    provenance: "heuristic",
  };
}

/** Dimension labels by key, for downstream rendering. */
export const DIMENSION_LABELS: Record<PromptQualityDimensionKey, string> = {
  clarity: "Clarity",
  specificity: "Specificity",
  verifiability: "Verifiability",
  scopeBoundedness: "Scope-boundedness",
  focus: "Focus",
};
