/**
 * MODEL-001..003 deterministic rules (spec §15.4 model selection).
 *
 * Model-selection rules compare recorded model usage against the configurable
 * model catalogue (§15.4) — never against a hardcoded "model X is best" claim.
 * Tiers are *relative* and resolved from {@link AnalysisContext.modelCatalogue}
 * (falling back to the bundled default). A model not in the catalogue resolves
 * to `null` and the rule stays silent rather than guess a tier (§3.4 honest
 * metrics). Each rule emits at most one candidate.
 */
import type { ModelCatalogue, ModelUsageRow, RecommendationRule } from "@agentlens/domain";
import { resolveCatalogueEntry, DEFAULT_MODEL_CATALOGUE } from "../model-catalogue.js";
import { candidate, evidence, instructionRemediation, metric, num, threshold } from "./helpers.js";

/** The model usage row with the most requests (the "dominant" model), or null. */
function dominantModel(rows: ModelUsageRow[]): ModelUsageRow | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  if (!best) return null;
  for (const r of rows) {
    if (r && r.modelRequests > (best.modelRequests ?? 0)) best = r;
  }
  return best;
}

/** Resolve the catalogue to use (context override → bundled default). */
function catalogueOf(ctx: { modelCatalogue?: ModelCatalogue }): ModelCatalogue {
  return ctx.modelCatalogue ?? DEFAULT_MODEL_CATALOGUE;
}

/** MODEL-001 High-cost tier used for mechanical work. */
export function model001(): RecommendationRule {
  return {
    id: "MODEL-001",
    version: 1,
    category: "model",
    defaultThresholds: { minCostTier: 4, maxToolCallsPerSession: 6, minRequests: 3 },
    async evaluate(ctx) {
      const dom = dominantModel(ctx.snapshot.usage.modelUsage);
      if (!dom) return [];
      const entry = resolveCatalogueEntry(dom.modelId, catalogueOf(ctx));
      if (!entry) return [];
      const minCostTier = threshold(ctx, "minCostTier", 4);
      const maxToolCalls = threshold(ctx, "maxToolCallsPerSession", 6);
      const minRequests = threshold(ctx, "minRequests", 3);
      if (entry.costTier < minCostTier) return [];
      if (dom.modelRequests < minRequests) return [];
      const toolCallsPerSession = num(ctx.snapshot.usage.toolCallsPerSession) ?? 0;
      if (toolCallsPerSession > maxToolCalls) return [];
      const confidence = Math.min(0.6, 0.3 + Math.min(1, dom.modelRequests / minRequests) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "MODEL-001",
          ruleVersion: 1,
          category: "model",
          severity: "low",
          confidence,
          title: "High-cost model used for light work",
          summary: `${dom.modelId} (cost tier ${entry.costTier}) was the dominant model at ${toolCallsPerSession} tool calls/session`,
          explanation: `The most-used model sits in a high relative cost tier but the window's work was light (few tool calls per session). A lower-cost tier from the catalogue is typically sufficient for mechanical work. Tiers are relative and configurable — not an absolute claim about this model.`,
          evidence: [
            evidence("high-cost-light-work", "Premium-tier model dominant on low-activity work", [
              metric("dominantModel", dom.modelId, "reported"),
              metric("costTier", entry.costTier, "inferred"),
              metric("modelRequests", dom.modelRequests, "exact"),
              metric("toolCallsPerSession", toolCallsPerSession, "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "Use a lower-cost-tier model from the catalogue for mechanical/light work; reserve the high-cost tier for complex tasks.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** MODEL-002 Lower-capability tier struggling repeatedly. */
export function model002(): RecommendationRule {
  return {
    id: "MODEL-002",
    version: 1,
    category: "model",
    defaultThresholds: { maxCapabilityTier: 2, minFailureRate: 0.3, minFailedCommands: 2 },
    async evaluate(ctx) {
      const dom = dominantModel(ctx.snapshot.usage.modelUsage);
      if (!dom) return [];
      const entry = resolveCatalogueEntry(dom.modelId, catalogueOf(ctx));
      if (!entry) return [];
      const maxCap = threshold(ctx, "maxCapabilityTier", 2);
      const minFailRate = threshold(ctx, "minFailureRate", 0.3);
      const minFailed = threshold(ctx, "minFailedCommands", 2);
      if (entry.capabilityTier > maxCap) return [];
      const failureRate = num(ctx.snapshot.tools.toolFailureRate) ?? 0;
      const failedCommands = ctx.snapshot.tools.repeatedFailedCommands.reduce(
        (a, r) => a + r.occurrences,
        0,
      );
      if (failureRate < minFailRate && failedCommands < minFailed) return [];
      const confidence = Math.min(0.6, 0.3 + Math.min(1, failureRate) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "MODEL-002",
          ruleVersion: 1,
          category: "model",
          severity: "medium",
          confidence,
          title: "Lower-capability model struggling",
          summary: `${dom.modelId} (capability tier ${entry.capabilityTier}) with ${(failureRate * 100).toFixed(0)}% tool failure rate`,
          explanation: `The dominant model sits in a low relative capability tier and the window shows a high tool/command failure rate. Repeated failures on a complex task can indicate the task exceeds the tier's comfort range. Tiers are relative and configurable — not an absolute claim about this model.`,
          evidence: [
            evidence("low-capability-struggling", "Low-capability tier with repeated failures", [
              metric("dominantModel", dom.modelId, "reported"),
              metric("capabilityTier", entry.capabilityTier, "inferred"),
              metric("toolFailureRate", Number(failureRate.toFixed(2)), "inferred"),
              metric("repeatedFailedCommands", failedCommands, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "For complex tasks that fail repeatedly, consider a higher-capability-tier model from the catalogue, then step back down once the task is unblocked.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** MODEL-003 Large stale context repeatedly sent to a premium model. */
export function model003(): RecommendationRule {
  return {
    id: "MODEL-003",
    version: 1,
    category: "model",
    defaultThresholds: { minCapabilityTier: 4, minCacheReadShare: 0.6, minRequests: 3 },
    async evaluate(ctx) {
      const dom = dominantModel(ctx.snapshot.usage.modelUsage);
      if (!dom) return [];
      const entry = resolveCatalogueEntry(dom.modelId, catalogueOf(ctx));
      if (!entry) return [];
      const minCap = threshold(ctx, "minCapabilityTier", 4);
      const minShare = threshold(ctx, "minCacheReadShare", 0.6);
      const minRequests = threshold(ctx, "minRequests", 3);
      if (entry.capabilityTier < minCap) return [];
      if (dom.modelRequests < minRequests) return [];
      const cacheRead = num(ctx.snapshot.usage.cacheReadTokens) ?? 0;
      const input = num(ctx.snapshot.usage.inputTokens) ?? 0;
      const totalInput = cacheRead + input;
      if (totalInput === 0) return [];
      const cacheReadShare = cacheRead / totalInput;
      if (cacheReadShare < minShare) return [];
      const confidence = Math.min(0.6, 0.3 + Math.min(1, cacheReadShare) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "MODEL-003",
          ruleVersion: 1,
          category: "model",
          severity: "low",
          confidence,
          title: "Stale context sent to a premium model",
          summary: `${dom.modelId} (capability tier ${entry.capabilityTier}) with ${(cacheReadShare * 100).toFixed(0)}% cache-read input`,
          explanation: `A high-capability-tier model received mostly cached (stale) input. Premium tiers are most cost-effective on fresh, focused context; carrying stale context to them wastes the tier. A fresh session or a cheaper tier for the carried context is usually better. Tiers are relative and configurable.`,
          evidence: [
            evidence("stale-context-premium", "Premium tier with high cache-read share", [
              metric("dominantModel", dom.modelId, "reported"),
              metric("capabilityTier", entry.capabilityTier, "inferred"),
              metric("cacheReadShare", Number(cacheReadShare.toFixed(2)), "inferred"),
              metric("modelRequests", dom.modelRequests, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Start a fresh focused session for premium-tier work, or carry stale context on a lower-cost tier.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
