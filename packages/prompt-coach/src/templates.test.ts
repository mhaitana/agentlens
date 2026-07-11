/**
 * Tests for repeated prompt-template detection (spec §15.5).
 */
import { describe, it, expect } from "vitest";
import { detectRepeatedTemplates, normaliseTemplateKey } from "./templates.js";
import type { RepeatedTemplate } from "@agentlens/domain";

/** Get the nth template, throwing if absent (avoids non-null assertions). */
function nth(t: RepeatedTemplate[], i: number): RepeatedTemplate {
  const r = t[i];
  if (!r) throw new Error(`template ${i} missing`);
  return r;
}

describe("detectRepeatedTemplates (§15.5)", () => {
  it("clusters identical opening asks across sessions", () => {
    const t = detectRepeatedTemplates([
      { content: "Review this and fix any issues.", sessionId: "s1" },
      { content: "review this and fix any issues!", sessionId: "s2" },
      { content: "Review this and fix any issues", sessionId: "s2" },
    ]);
    expect(t).toHaveLength(1);
    expect(nth(t, 0).occurrences).toBe(3);
    expect(nth(t, 0).sessions).toBe(2);
  });

  it("generalises file references so the same ask clusters across targets", () => {
    const t = detectRepeatedTemplates([
      { content: "Fix the bug in `src/auth.ts`", sessionId: "s1" },
      { content: "fix the bug in `src/billing.ts`", sessionId: "s2" },
    ]);
    expect(t).toHaveLength(1);
    expect(nth(t, 0).occurrences).toBe(2);
  });

  it("respects minOccurrences and skips singletons", () => {
    const t = detectRepeatedTemplates(
      [
        { content: "Fix the bug in `src/a.ts`", sessionId: "s1" },
        { content: "Add a brand new feature here", sessionId: "s2" },
      ],
      2,
    );
    expect(t).toHaveLength(0);
  });

  it("skips prompts with no retained content (metadata-only safe)", () => {
    const t = detectRepeatedTemplates([
      { content: undefined, sessionId: "s1" },
      { content: "   ", sessionId: "s2" },
      { content: "Fix the bug in `src/a.ts`", sessionId: "s3" },
    ]);
    expect(t).toHaveLength(0);
  });

  it("sorts by occurrences desc then sessions desc, deterministically", () => {
    const t = detectRepeatedTemplates([
      { content: "common ask one", sessionId: "s1" },
      { content: "common ask one", sessionId: "s2" },
      { content: "common ask one", sessionId: "s3" },
      { content: "rare ask two", sessionId: "s1" },
      { content: "rare ask two", sessionId: "s1" },
    ]);
    expect(nth(t, 0).templateKey).toContain("common ask one");
    expect(nth(t, 0).occurrences).toBe(3);
    expect(nth(t, 1).occurrences).toBe(2);
    expect(nth(t, 1).sessions).toBe(1);
  });

  it("normaliseTemplateKey is deterministic and lower-cases", () => {
    expect(normaliseTemplateKey("  Fix  The BUG in `x.ts`... ")).toBe("fix the bug in <ref>");
  });
});
