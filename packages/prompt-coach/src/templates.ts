/**
 * Repeated prompt-template detection (spec §15.5).
 *
 * Deterministic: normalises each prompt to a template key (lower-cased,
 * whitespace-collapsed, punctuation-trimmed, truncated to a prefix) and groups
 * prompts by that key. Templates occurring ≥ `minOccurrences` times are reported
 * as recurring patterns — candidates for a reusable skill or CLAUDE.md
 * instruction. Operates on already-redacted content only; prompts with no
 * retained content (metadata-only mode) are skipped.
 */
import type { RepeatedTemplate } from "@agentlens/domain";

/** A prompt with its redacted content and owning session. */
export interface PromptTemplateInput {
  content?: string;
  sessionId: string;
}

/** Prefix length used for the template key (enough to capture the opening ask). */
const TEMPLATE_PREFIX = 60;

/**
 * Normalise prompt text into a deterministic template key.
 *
 * Lower-cases, strips leading list markers, collapses whitespace, removes
 * trailing punctuation, and truncates to {@link TEMPLATE_PREFIX} characters.
 * Backtick file references are generalised to `<ref>` so the same ask against
 * different files still clusters.
 */
export function normaliseTemplateKey(content: string): string {
  let s = content.trim().toLowerCase();
  // Strip leading bullet/number markers.
  s = s.replace(/^\s*([-*]|\d+[.)])\s+/, "");
  // Generalise backtick file/symbol references.
  s = s.replace(/`[^`\n]+`/g, "<ref>");
  // Collapse all whitespace.
  s = s.replace(/\s+/g, " ");
  // Trim trailing punctuation.
  s = s.replace(/[.!?;,:]+$/g, "");
  return s.slice(0, TEMPLATE_PREFIX);
}

/**
 * Detect recurring prompt templates across a set of prompts.
 *
 * @param prompts prompts with redacted content + session id (content absent → skipped).
 * @param minOccurrences minimum occurrences for a template to be reported (default 2).
 */
export function detectRepeatedTemplates(
  prompts: PromptTemplateInput[],
  minOccurrences = 2,
): RepeatedTemplate[] {
  const groups = new Map<
    string,
    { occurrences: number; sessions: Set<string>; examplePrefix: string }
  >();

  for (const p of prompts) {
    if (!p.content || p.content.trim().length === 0) continue;
    const key = normaliseTemplateKey(p.content);
    if (key.length === 0) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.sessions.add(p.sessionId);
    } else {
      groups.set(key, {
        occurrences: 1,
        sessions: new Set<string>([p.sessionId]),
        examplePrefix: p.content.trim().slice(0, 80),
      });
    }
  }

  const result: RepeatedTemplate[] = [];
  for (const [templateKey, g] of groups) {
    if (g.occurrences < minOccurrences) continue;
    result.push({
      templateKey,
      occurrences: g.occurrences,
      sessions: g.sessions.size,
      examplePrefix: g.examplePrefix,
    });
  }
  // Sort by occurrences desc, then sessions desc, then key for determinism.
  result.sort(
    (a, b) =>
      b.occurrences - a.occurrences ||
      b.sessions - a.sessions ||
      a.templateKey.localeCompare(b.templateKey),
  );
  return result;
}
