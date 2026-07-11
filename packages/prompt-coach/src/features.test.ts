/**
 * Tests for deterministic prompt-feature extraction (spec §10.4, §15.5).
 *
 * The extractor is pure + deterministic — no external model — so these are
 * direct unit tests over text. Heuristics are conservative: a feature is only
 * flagged on a concrete textual signal.
 */
import { describe, it, expect } from "vitest";
import { extractPromptFeatures } from "./features.js";

describe("extractPromptFeatures (§15.5 deterministic)", () => {
  it("flags the opening prompt as beginning a new task", () => {
    const f = extractPromptFeatures("Add a login form", 1);
    expect(f.beginsNewTask).toBe(true);
    expect(extractPromptFeatures("now fix the button", 2).beginsNewTask).toBe(false);
  });

  it("detects file references in backtick spans", () => {
    const f = extractPromptFeatures("Update `src/auth.ts` and `README.md`", 1);
    expect(f.fileReferenceCount).toBe(2);
  });

  it("counts imperative-verb leads", () => {
    const f = extractPromptFeatures("Add a route\nFix the tests\nUpdate docs", 1);
    expect(f.imperativeVerbCount).toBe(3);
  });

  it("detects references to acceptance criteria", () => {
    const f = extractPromptFeatures("Implement the feature. Done when all tests pass.", 1);
    expect(f.referencesAcceptanceCriteria).toBe(true);
    expect(extractPromptFeatures("Implement the feature.", 1).referencesAcceptanceCriteria).toBe(
      false,
    );
  });

  it("detects a verification request", () => {
    const f = extractPromptFeatures("Implement it, then run the tests", 1);
    expect(f.requestsVerification).toBe(true);
  });

  it("flags multiple independent tasks (≥2 list items)", () => {
    const f = extractPromptFeatures("- Add a route\n- Fix the tests", 1);
    expect(f.multipleIndependentTasks).toBe(true);
  });

  it("counts vague references and flags a correction", () => {
    const f = extractPromptFeatures("no, I meant fix the auth bug, not that", 2);
    expect(f.appearsCorrective).toBe(true);
    expect(f.ambiguousReferenceCount).toBeGreaterThanOrEqual(1);
  });

  it("does not flag corrections on the opening prompt", () => {
    // sequence === 1 cannot be corrective.
    const f = extractPromptFeatures("no, fix this", 1);
    expect(f.appearsCorrective).toBe(false);
  });

  it("reports length and never equates length with quality", () => {
    const short = extractPromptFeatures("Fix it", 2);
    const long = extractPromptFeatures("Fix the bug in the auth module".repeat(50), 2);
    expect(short.length).toBeLessThan(long.length);
    // Both have the same structural signal (one imperative) regardless of length.
    expect(short.imperativeVerbCount).toBe(long.imperativeVerbCount);
  });

  it("is deterministic — same input yields same output", () => {
    const a = extractPromptFeatures("Add a login form. Done when tests pass.", 1);
    const b = extractPromptFeatures("Add a login form. Done when tests pass.", 1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("detects scope-bounding markers", () => {
    expect(extractPromptFeatures("Fix the bug, only touch `src/a.ts`", 1).hasScopeMarkers).toBe(
      true,
    );
    expect(extractPromptFeatures("Fix the bug in the auth module", 1).hasScopeMarkers).toBe(false);
  });

  it("detects reversal phrases regardless of sequence", () => {
    expect(extractPromptFeatures("Revert the last deploy", 1).appearsReversal).toBe(true);
    expect(extractPromptFeatures("now undo that change", 3).appearsReversal).toBe(true);
    expect(extractPromptFeatures("Add a login form", 1).appearsReversal).toBe(false);
  });

  it("computes a bounded complexity score in [0,1]", () => {
    const simple = extractPromptFeatures("Fix it", 1);
    const complex = extractPromptFeatures(
      "- add a route\n- fix the tests\n- update docs\n then run lint; and verify the build.",
      1,
    );
    expect(simple.complexityScore).toBeGreaterThanOrEqual(0);
    expect(simple.complexityScore).toBeLessThanOrEqual(1);
    expect(complex.complexityScore).toBeGreaterThan(simple.complexityScore);
  });
});
