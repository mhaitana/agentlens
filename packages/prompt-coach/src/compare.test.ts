/**
 * Tests for the §15.6 prompt-comparison view (deterministic).
 */
import { describe, it, expect } from "vitest";
import { comparePrompt } from "./compare.js";

describe("comparePrompt (§15.6 deterministic comparison)", () => {
  it("returns all §15.6 view fields", () => {
    const c = comparePrompt("Review this and fix any issues.", 1);
    expect(c).toHaveProperty("original");
    expect(c).toHaveProperty("strengths");
    expect(c).toHaveProperty("ambiguities");
    expect(c).toHaveProperty("missingConstraints");
    expect(c).toHaveProperty("observedOutcome");
    expect(c).toHaveProperty("suggestedImprovedPrompt");
    expect(c).toHaveProperty("changeExplanations");
    expect(c).toHaveProperty("disclaimer");
    expect(c.provenance).toBe("heuristic");
  });

  it("shows the original prompt verbatim", () => {
    const c = comparePrompt("Review this and fix any issues.", 1);
    expect(c.original).toBe("Review this and fix any issues.");
  });

  it("derives observed-outcome lines from outcome evidence when none supplied", () => {
    const c = comparePrompt("fix it", 2, {
      correctivePromptsAfter: 3,
      reversalsAfter: 2,
      filesInspected: 38,
      verificationRan: false,
      observedOutcome: [],
    });
    expect(c.observedOutcome.some((o) => /38 file/i.test(o))).toBe(true);
    expect(c.observedOutcome.some((o) => /3 corrective/i.test(o))).toBe(true);
    expect(c.observedOutcome.some((o) => /2 implementation/i.test(o))).toBe(true);
    expect(c.observedOutcome.some((o) => /did not run/i.test(o))).toBe(true);
  });

  it("uses caller-supplied observed-outcome lines verbatim when present", () => {
    const c = comparePrompt("fix it", 2, {
      correctivePromptsAfter: 1,
      reversalsAfter: 0,
      filesInspected: 5,
      verificationRan: true,
      observedOutcome: ["Custom outcome line one.", "Custom line two."],
    });
    expect(c.observedOutcome).toEqual(["Custom outcome line one.", "Custom line two."]);
  });

  it("maps missing components to human-readable missing constraints", () => {
    const c = comparePrompt("fix it", 2);
    expect(c.missingConstraints.some((m) => /named file\/symbol target/i.test(m))).toBe(true);
    expect(c.missingConstraints.some((m) => /acceptance criteria/i.test(m))).toBe(true);
  });

  it("includes a disclaimer that the revision is not guaranteed better", () => {
    const c = comparePrompt("fix it", 2);
    expect(c.disclaimer).toMatch(/not guaranteed/i);
    expect(c.disclaimer).toMatch(/§15\.6/);
  });

  it("is deterministic — same input yields same output", () => {
    const a = comparePrompt("Fix the bug in `src/x.ts`", 2);
    const b = comparePrompt("Fix the bug in `src/x.ts`", 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
