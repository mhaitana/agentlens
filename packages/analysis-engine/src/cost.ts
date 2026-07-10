/**
 * Estimated-cost handling (spec §13.6).
 *
 * For each model request the cost is resolved through a priority chain:
 *   1. Claude-reported cost (the source supplied `estimatedCostUsd`).
 *   2. Provider telemetry estimate — not available in M1 (Phase 2).
 *   3. Versioned configurable price registry (token usage × price).
 *   4. Unknown — the model/price is ambiguous; we do not guess.
 *
 * Every figure this module produces is an ESTIMATE. Reports must label it
 * "Estimated — not an official billing value" (§3.4, §13.6). When pricing is
 * ambiguous the cost is `null` with provenance "unknown", never a fabricated
 * number.
 */

import { estimated, unknown, type ProvenancedValue } from "@agentlens/domain";
import {
  resolvePrice,
  estimateRequestCost,
  type PriceRegistry,
  DEFAULT_PRICE_REGISTRY,
} from "./price-registry.js";

/** Per-request usage + any source-reported cost, gathered by the caller. */
export interface CostRequestRow {
  modelId: string;
  /** Claude-reported cost in USD, when the source supplied one (rung 1). */
  reportedCostUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
}

/** How a single request's cost was derived. */
export type CostMethodology = "reported" | "telemetry" | "registry" | "unknown";

/** The cost of one request plus how it was derived. */
export interface RequestCost {
  modelId: string;
  usd: number | null;
  methodology: CostMethodology;
}

/** Summarise cost across a set of requests (a report window / project). */
export interface CostComputationResult {
  /** Per-request costs in input order (for backfill / detail). */
  perRequest: RequestCost[];
  /** Total USD across all requests; `null` when nothing could be costed. */
  total: ProvenancedValue<number | null>;
  /** Per-model totals with methodology. */
  byModel: Array<{ modelId: string; usd: number | null; provenance: CostMethodology }>;
  /** The weakest rung relied on for any costed request. */
  methodology: CostMethodology;
}

/**
 * Compute a cost summary by walking the §13.6 priority chain per request.
 *
 * `reported` always wins when present. Otherwise the registry is consulted
 * (rung 3). Telemetry (rung 2) is not available in M1. When neither yields a
 * figure the request contributes `null` with methodology "unknown" — its
 * tokens are still counted elsewhere, but its cost is not invented.
 */
export function computeCostSummary(
  rows: CostRequestRow[],
  registry: PriceRegistry = DEFAULT_PRICE_REGISTRY,
): CostComputationResult {
  const perRequest: RequestCost[] = [];

  for (const row of rows) {
    if (row.reportedCostUsd != null && Number.isFinite(row.reportedCostUsd)) {
      perRequest.push({ modelId: row.modelId, usd: row.reportedCostUsd, methodology: "reported" });
      continue;
    }
    const price = resolvePrice(row.modelId, registry);
    if (price) {
      const usd = estimateRequestCost(row, price);
      perRequest.push({ modelId: row.modelId, usd, methodology: "registry" });
      continue;
    }
    perRequest.push({ modelId: row.modelId, usd: null, methodology: "unknown" });
  }

  // Aggregate per model.
  const byModelMap = new Map<
    string,
    {
      usd: number | null;
      hasReported: boolean;
      hasRegistry: boolean;
      hasUnknown: boolean;
      anyCosted: boolean;
    }
  >();
  for (const r of perRequest) {
    let entry = byModelMap.get(r.modelId);
    if (!entry) {
      entry = {
        usd: 0,
        hasReported: false,
        hasRegistry: false,
        hasUnknown: false,
        anyCosted: false,
      };
      byModelMap.set(r.modelId, entry);
    }
    if (r.usd != null) {
      entry.usd = (entry.usd ?? 0) + r.usd;
      entry.anyCosted = true;
      if (r.methodology === "reported") entry.hasReported = true;
      else if (r.methodology === "registry") entry.hasRegistry = true;
    } else {
      entry.hasUnknown = true;
    }
  }

  const byModel: CostComputationResult["byModel"] = [];
  let anyReported = false;
  let anyRegistry = false;
  let anyUnknown = false;
  let totalCosted = 0;
  let total = 0;
  let anyCosted = false;

  for (const [modelId, entry] of byModelMap) {
    // Per-model provenance: prefer the strongest rung used.
    const prov: CostMethodology = entry.hasReported
      ? "reported"
      : entry.hasRegistry
        ? "registry"
        : "unknown";
    byModel.push({ modelId, usd: entry.anyCosted ? entry.usd : null, provenance: prov });
    if (entry.hasReported) anyReported = true;
    if (entry.hasRegistry) anyRegistry = true;
    if (entry.hasUnknown) anyUnknown = true;
    if (entry.anyCosted) {
      total += entry.usd ?? 0;
      totalCosted += 1;
      anyCosted = true;
    }
  }

  // Sort byModel by descending cost for stable, useful output.
  byModel.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || a.modelId.localeCompare(b.modelId));

  const methodology: CostMethodology = anyReported
    ? "reported"
    : anyRegistry
      ? "registry"
      : anyUnknown
        ? "unknown"
        : "unknown";

  const totalPv: ProvenancedValue<number | null> =
    rows.length === 0 || !anyCosted
      ? unknown<number>("No costed model usage in this window.")
      : estimated<number | null>(
          total,
          "Estimated from token usage × registry prices — not an official billing value.",
          totalCosted / rows.length,
        );

  return { perRequest, total: totalPv, byModel, methodology };
}

/** The label reports must show next to any estimated cost (§13.6). */
export const COST_ESTIMATE_LABEL = "Estimated — not an official billing value";

export { DEFAULT_PRICE_REGISTRY };
