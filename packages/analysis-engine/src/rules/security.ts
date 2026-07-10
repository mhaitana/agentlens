/**
 * SECURITY-001..002 deterministic rules (spec §13.10).
 *
 * Security rules surface evidence-backed findings derived from already-redacted
 * persisted data (§8.4): SECURITY-001 classifies the *redacted* path basename
 * (the raw path is never present); SECURITY-002 counts `[REDACTED:<label>]`
 * markers the redaction pipeline left in stored content. Neither exposes a
 * secret value — only the finding category/label and counts.
 */
import type { RecommendationRule } from "@agentlens/domain";
import {
  candidate,
  confidenceForCount,
  evidence,
  instructionRemediation,
  metric,
  threshold,
} from "./helpers.js";

/** SECURITY-001 Sensitive path access. */
export function security001(): RecommendationRule {
  return {
    id: "SECURITY-001",
    version: 1,
    category: "security",
    defaultThresholds: { minAccesses: 1 },
    async evaluate(ctx) {
      const findings = ctx.snapshot.security.sensitivePathAccess;
      if (findings.length === 0) return [];
      const min = threshold(ctx, "minAccesses", 1);
      const top = findings[0];
      if (!top || top.operations < min) return [];
      const confidence = confidenceForCount(top.operations, 0.6, 0.08, 0.85);
      return [
        candidate({
          ctx,
          ruleId: "SECURITY-001",
          ruleVersion: 1,
          category: "security",
          severity: "high",
          confidence,
          title: "Sensitive path access",
          summary: `Sensitive file "${top.redactedPath}" (${top.category}) accessed ${top.operations}× across ${top.sessions} session(s)`,
          explanation: `A likely-sensitive path (${top.category}) was accessed. The value is never stored or exposed — only the path category and access count. ${findings.length > 1 ? `${findings.length} sensitive paths detected; the most-accessed is shown.` : ""}`,
          evidence: [
            evidence(
              "sensitive-path-access",
              `Category ${top.category}, path "${top.redactedPath}"`,
              [
                metric("category", top.category, "heuristic"),
                metric("operations", top.operations, "exact"),
                metric("sessions", top.sessions, "exact"),
                metric("operationsSeen", top.operationsSeen.join(","), "exact"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "Confirm the access was intended. Avoid reading credential/secret files into context; use environment variables or a secrets manager instead.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** SECURITY-002 Potential secret in persisted content. */
export function security002(): RecommendationRule {
  return {
    id: "SECURITY-002",
    version: 1,
    category: "security",
    defaultThresholds: { minFindings: 1 },
    async evaluate(ctx) {
      const findings = ctx.snapshot.security.redactedSecretFindings;
      if (findings.length === 0) return [];
      const min = threshold(ctx, "minFindings", 1);
      const total = findings.reduce((a, f) => a + f.count, 0);
      if (total < min) return [];
      const top = findings[0];
      if (!top) return [];
      const confidence = confidenceForCount(total, 0.65, 0.07, 0.9);
      return [
        candidate({
          ctx,
          ruleId: "SECURITY-002",
          ruleVersion: 1,
          category: "security",
          severity: "critical",
          confidence,
          title: "Potential secret in persisted content",
          summary: `${total} likely-secret finding(s) redacted (${findings.map((f) => f.label).join(", ")})`,
          explanation: `The redaction pipeline detected and scrubbed likely secrets in persisted content. Only the finding category/label and counts are stored — the secret itself was never persisted. Review whether secrets are being pasted into prompts.`,
          evidence: [
            evidence(
              "redacted-secret",
              `${total} redacted findings across ${findings.length} detector(s)`,
              [
                metric("totalFindings", total, "exact"),
                metric("detectors", findings.length, "exact"),
                metric("topLabel", top.label, "exact"),
                metric("topCategory", top.category, "exact"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "Do not paste API keys, tokens or credentials into prompts. Provide them via environment variables or an approved secrets mechanism instead.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
