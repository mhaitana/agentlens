/**
 * Tests for the deterministic suggested improved prompt structure (spec §15.5).
 *
 * The suggestion is a structural restructure with explicit placeholders for
 * missing components — never invented content — and is never claimed to
 * guarantee better results.
 */
import { describe, it, expect } from "vitest";
import { suggestImprovedStructure } from "./suggest.js";

describe("suggestImprovedStructure (§15.5 deterministic)", () => {
  it("restructures a complete prompt and records no missing components", () => {
    const s = suggestImprovedStructure(
      "Implement refresh-token rotation in `src/auth.ts`. Done when tests pass. Run the auth tests. Only modify `src/auth.ts`.",
      1,
    );
    expect(s.missingComponents).toEqual([]);
    expect(s.suggestedPrompt).toContain("Target: `src/auth.ts`");
    expect(s.provenance).toBe("heuristic");
  });

  it("inserts bracketed placeholders for every missing component", () => {
    const s = suggestImprovedStructure("fix it", 2);
    expect(s.suggestedPrompt).toContain("[name the file/symbol(s) to change]");
    expect(s.suggestedPrompt).toContain("[state the measurable acceptance criteria]");
    expect(s.suggestedPrompt).toContain("run the relevant test/typecheck/lint");
    expect(s.suggestedPrompt).toContain("only modify the target above");
    expect(s.missingComponents).toContain("target");
    expect(s.missingComponents).toContain("acceptanceCriteria");
    expect(s.missingComponents).toContain("verificationRequest");
    expect(s.missingComponents).toContain("scopeBoundary");
  });

  it("records a change explanation for each added/restructured component", () => {
    const s = suggestImprovedStructure("fix it", 2);
    const kinds = s.changes.map((c) => c.kind);
    expect(kinds).toContain("added");
    // Each change references a missing component.
    for (const c of s.changes) {
      if (c.kind === "added") expect(c.component).toBeTruthy();
    }
  });

  it("splits a multi-task prompt into one-per-prompt and flags taskSplit", () => {
    const s = suggestImprovedStructure("- add a route\n- fix the tests\n- update docs", 1);
    expect(s.missingComponents).toContain("taskSplit");
    expect(s.suggestedPrompt).toContain("separate prompts");
    expect(s.suggestedPrompt).toContain("• add a route");
    expect(s.suggestedPrompt).toContain("• fix the tests");
  });

  it("uses the first imperative line as the objective when present", () => {
    const s = suggestImprovedStructure("Add a login form with email validation", 1);
    expect(s.suggestedPrompt.split("\n")[0]).toContain("Add a login form with email validation");
  });

  it("is deterministic — same input yields same output", () => {
    const a = suggestImprovedStructure("Fix the bug in `src/x.ts`", 2);
    const b = suggestImprovedStructure("Fix the bug in `src/x.ts`", 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never claims the revision guarantees better results", () => {
    const s = suggestImprovedStructure("fix it", 2);
    expect(JSON.stringify(s)).not.toMatch(/guarantee/i);
  });
});
