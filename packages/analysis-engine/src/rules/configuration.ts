/**
 * CONFIG-001..002 deterministic rules (spec §15.4 "Security and configuration").
 *
 * Configuration-category rules read the snapshot's {@link ConfigurationSummary}
 * — a provider-neutral description of the AgentLens config state (never
 * secrets), threaded from the resolved config by the caller. They flag
 * *config-state* risks: overly broad retention / full-local mode / broad
 * exclusions, network binding beyond loopback, and external analysis enabled
 * without safeguards. Claude-Code-settings-derived signals (broad read
 * permissions, broad shell allow, dangerous auto-approval, untrusted MCP) are
 * doctor-scope (§15.13) and intentionally not represented here.
 *
 * Each rule emits at most one candidate. Remediations are instructions only —
 * AgentLens never edits the user's config without explicit approval (§3.5).
 */
import type { RecommendationRule } from "@agentlens/domain";
import { candidate, evidence, instructionRemediation, metric, threshold } from "./helpers.js";

/** CONFIG-001 Overly broad retention, full-local mode, or broad exclusions. */
export function config001(): RecommendationRule {
  return {
    id: "CONFIG-001",
    version: 1,
    category: "configuration",
    defaultThresholds: { maxRetentionDays: 365, minExclusions: 5 },
    async evaluate(ctx) {
      const cfg = ctx.snapshot.configuration;
      const reasons: string[] = [];
      if (cfg.privacyMode === "full-local") {
        reasons.push("privacy mode is full-local (full content stored locally)");
      }
      const maxRetention = threshold(ctx, "maxRetentionDays", 365);
      if (cfg.retentionDays > maxRetention) {
        reasons.push(`retention is ${cfg.retentionDays} days (>${maxRetention})`);
      }
      const minExclusions = threshold(ctx, "minExclusions", 5);
      if (cfg.broadExclusions || cfg.excludedProjectCount >= minExclusions) {
        reasons.push(
          cfg.broadExclusions
            ? "an exclusion pattern looks overly broad (wildcard/very short)"
            : `${cfg.excludedProjectCount} projects are excluded from analysis`,
        );
      }
      if (reasons.length === 0) return [];
      const confidence = Math.min(0.8, 0.45 + reasons.length * 0.15);
      return [
        candidate({
          ctx,
          ruleId: "CONFIG-001",
          ruleVersion: 1,
          category: "configuration",
          severity: cfg.privacyMode === "full-local" ? "high" : "medium",
          confidence,
          title: "Overly broad retention or exclusions",
          summary: reasons.join("; "),
          explanation: `The AgentLens configuration broadens what is kept or narrows what is analysed: ${reasons.join("; ")}. Full-local mode stores full content (still secret-scrubbed); long retention and broad exclusions reduce how much AgentLens can see or how little it forgets. Tighten retention to what you need, prefer the redacted-content mode, and narrow exclusions to specific projects rather than wide patterns.`,
          evidence: [
            evidence("configuration-state", "AgentLens config broadens retention/exclusions", [
              metric("privacyMode", cfg.privacyMode, "exact"),
              metric("retentionDays", cfg.retentionDays, "exact"),
              metric("excludedProjectCount", cfg.excludedProjectCount, "exact"),
              metric("broadExclusions", cfg.broadExclusions ? 1 : 0, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Review `agentlens config`: lower retention, prefer redacted-content mode, and replace broad exclusion patterns with specific project paths.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** CONFIG-002 Network binding beyond loopback or external analysis without safeguards. */
export function config002(): RecommendationRule {
  return {
    id: "CONFIG-002",
    version: 1,
    category: "configuration",
    defaultThresholds: {},
    async evaluate(ctx) {
      const cfg = ctx.snapshot.configuration;
      const reasons: string[] = [];
      if (cfg.bindsBeyondLoopback) {
        reasons.push(`dashboard binds to ${cfg.dashboardHost} (beyond loopback)`);
      }
      if (cfg.externalAnalysisEnabled && cfg.externalAnalysisExternal) {
        reasons.push(
          `external analysis is enabled with provider "${cfg.externalAnalysisProvider}"`,
        );
      }
      if (reasons.length === 0) return [];
      const confidence = Math.min(0.85, 0.5 + reasons.length * 0.2);
      return [
        candidate({
          ctx,
          ruleId: "CONFIG-002",
          ruleVersion: 1,
          category: "configuration",
          severity: "high",
          confidence,
          title: "Local-first boundary weakened",
          summary: reasons.join("; "),
          explanation: `A local-first tool should bind only to loopback and keep analysis on-device by default. ${reasons.join("; ")}. Binding beyond loopback exposes the local API to other machines; a non-deterministic analysis provider (local or remote model) processes content outside the deterministic on-device layer and warrants the §15.5 redaction + opt-in safeguards. Both can be legitimate, but each weakens the local-first boundary and should be an explicit, informed choice.`,
          evidence: [
            evidence("local-first-boundary", "Config weakens loopback/local-analysis boundary", [
              metric("dashboardHost", cfg.dashboardHost, "exact"),
              metric("bindsBeyondLoopback", cfg.bindsBeyondLoopback ? 1 : 0, "exact"),
              metric("externalAnalysisEnabled", cfg.externalAnalysisEnabled ? 1 : 0, "exact"),
              metric("externalAnalysisProvider", cfg.externalAnalysisProvider, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Prefer 127.0.0.1 for the dashboard host and keep external analysis disabled unless you have reviewed the redaction + opt-in safeguards.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
