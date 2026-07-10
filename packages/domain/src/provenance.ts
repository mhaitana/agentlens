/**
 * Honest-metrics primitives (spec §3.4). Every metric AgentLens surfaces must
 * record how it was derived so an estimate is never presented as a measured
 * value, and so reports can label inferred/heuristic numbers accordingly.
 */

/**
 * How a value was obtained.
 *
 * - `exact`       — computed exactly from recorded data (e.g. tool-call count).
 * - `reported`    — supplied verbatim by the source (e.g. Claude-reported cost).
 * - `inferred`    — derived indirectly from evidence with high reliability.
 * - `estimated`   — approximated from a model/registry (e.g. token cost from a
 *                   price table); never an official billing value.
 * - `heuristic`   — produced by a rule-of-thumb (e.g. prompt-quality score).
 * - `unknown`     — the source did not provide enough to determine it.
 */
export type MetricProvenance =
  "exact" | "reported" | "inferred" | "estimated" | "heuristic" | "unknown";

/** A value paired with a description of where it came from. */
export interface ProvenancedValue<T> {
  value: T;
  provenance: MetricProvenance;
  /** Optional human-readable explanation of the derivation. */
  note?: string;
  /** 0..1 confidence in the value, where the concept applies. */
  confidence?: Confidence;
}

/** Confidence score in the range [0, 1]. */
export type Confidence = number;

export const FULL_CONFIDENCE: Confidence = 1;
export const ZERO_CONFIDENCE: Confidence = 0;

/** Coarse confidence band for display (spec §18.3). */
export type ConfidenceBand = "high" | "moderate" | "low";

export function confidenceBand(c: Confidence): ConfidenceBand {
  if (c >= 0.8) return "high";
  if (c >= 0.5) return "moderate";
  return "low";
}

/** Helper to tag an exact value concisely. */
export function exact<T>(value: T, note?: string): ProvenancedValue<T> {
  return { value, provenance: "exact", note };
}

/** Helper to tag a reported value concisely. */
export function reported<T>(value: T, note?: string): ProvenancedValue<T> {
  return { value, provenance: "reported", note };
}

/** Helper to tag an estimated value concisely. */
export function estimated<T>(
  value: T,
  note?: string,
  confidence?: Confidence,
): ProvenancedValue<T> {
  return { value, provenance: "estimated", note, confidence };
}

/** Helper to mark a value as unavailable. */
export function unknown<T = null>(note?: string): ProvenancedValue<T | null> {
  return { value: null, provenance: "unknown", note };
}
