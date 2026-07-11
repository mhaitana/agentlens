/**
 * Tests for the deterministic Prompt Coach quality assessment (spec §15.5).
 *
 * Pure + deterministic — no external model. Scores are heuristic functions of
 * structural features; these tests assert behaviour, not exact magic numbers
 * where brittle, and pin determinism + invariants.
 */
import { describe, it, expect } from "vitest";
import { assessPrompt, DIMENSION_LABELS } from "./quality.js";
import { extractPromptFeatures } from "./features.js";
import type { PromptQualityAssessment, PromptQualityDimensionKey } from "@agentlens/domain";

/** Narrow a dimension by key without a non-null assertion. */
function dim(a: PromptQualityAssessment, key: PromptQualityDimensionKey) {
  const d = a.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`dimension ${key} missing`);
  return d;
}

describe("assessPrompt (§15.5 deterministic quality)", () => {
  it("scores all five dimensions, each in [0,1] and labelled heuristic", () => {
    const a = assessPrompt("Review this and fix any issues.", 1);
    expect(a.dimensions).toHaveLength(5);
    const keys = a.dimensions.map((d) => d.key);
    expect(keys).toEqual(["clarity", "specificity", "verifiability", "scopeBoundedness", "focus"]);
    for (const d of a.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(1);
      expect(d.provenance).toBe("heuristic");
      expect(d.label).toBe(DIMENSION_LABELS[d.key]);
    }
    expect(a.provenance).toBe("heuristic");
  });

  it("overallScore is the mean of dimension scores and in [0,1]", () => {
    const a = assessPrompt("Add a login form. Done when tests pass. Run the tests.", 1);
    const mean = a.dimensions.reduce((s, d) => s + d.score, 0) / a.dimensions.length;
    // overallScore is the 2-decimal rounded mean of the (rounded) dimension scores.
    expect(a.overallScore).toBe(Math.round(mean * 100) / 100);
    expect(a.overallScore).toBeGreaterThanOrEqual(0);
    expect(a.overallScore).toBeLessThanOrEqual(1);
  });

  it("a vague, targetless prompt scores low specificity and reports ambiguities", () => {
    const a = assessPrompt("fix it and make it better", 2);
    const spec = dim(a, "specificity");
    expect(spec.score).toBeLessThan(0.5);
    expect(a.ambiguities.some((x) => /vague reference/i.test(x))).toBe(true);
    expect(a.ambiguities.some((x) => /no file\/symbol target/i.test(x))).toBe(true);
  });

  it("a well-structured prompt scores high verifiability and reports strengths", () => {
    const a = assessPrompt(
      "Implement the refresh-token rotation in `src/auth.ts`. Done when all tests pass. Run the auth test suite and typecheck. Only modify `src/auth.ts`.",
      1,
    );
    const ver = dim(a, "verifiability");
    expect(ver.score).toBe(1);
    expect(a.strengths.some((s) => /acceptance criteria/i.test(s))).toBe(true);
    expect(a.strengths.some((s) => /verification/i.test(s))).toBe(true);
    expect(a.strengths.some((s) => /scope-bounding/i.test(s))).toBe(true);
  });

  it("lists missing components deterministically", () => {
    const a = assessPrompt("fix it", 2);
    expect(a.missingComponents).toContain("target");
    expect(a.missingComponents).toContain("acceptanceCriteria");
    expect(a.missingComponents).toContain("verificationRequest");
    expect(a.missingComponents).toContain("scopeBoundary");
  });

  it("a corrective/reversal prompt scores low focus", () => {
    const a = assessPrompt("no, I meant undo the last change, not that", 2);
    const focus = dim(a, "focus");
    expect(focus.score).toBeLessThanOrEqual(0.3);
  });

  it("bundles multiple tasks → low scope-boundedness + taskSplit missing", () => {
    const a = assessPrompt("- add a route\n- fix the tests\n- update docs", 1);
    const scope = dim(a, "scopeBoundedness");
    expect(scope.score).toBeLessThan(0.5);
    expect(a.missingComponents).toContain("taskSplit");
  });

  it("evidence lists the structural signals backing the assessment", () => {
    const a = assessPrompt("Update `src/a.ts`", 1);
    expect(a.evidence.length).toBeGreaterThan(0);
    const first = a.evidence[0];
    if (!first) throw new Error("evidence missing");
    const labels = first.signals.map((s) => s.label);
    expect(labels).toContain("imperativeVerbCount");
    expect(labels).toContain("fileReferenceCount");
    expect(labels).toContain("hasScopeMarkers");
    expect(labels).toContain("appearsReversal");
    expect(labels).toContain("complexityScore");
  });

  it("accepts pre-extracted features and is deterministic", () => {
    const f = extractPromptFeatures("Add a form. Done when tests pass.", 1);
    const a1 = assessPrompt("Add a form. Done when tests pass.", 1, f);
    const a2 = assessPrompt("Add a form. Done when tests pass.", 1, f);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
  });

  it("never compares against invented industry averages (no baseline field)", () => {
    const a = assessPrompt("fix it", 2);
    expect(a).not.toHaveProperty("industryAverage");
    expect(a).not.toHaveProperty("benchmark");
  });
});
