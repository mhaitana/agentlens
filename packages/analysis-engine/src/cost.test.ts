import { describe, it, expect } from "vitest";
import { computeCostSummary, COST_ESTIMATE_LABEL, type CostRequestRow } from "./cost.js";
import {
  resolvePrice,
  estimateRequestCost,
  buildPriceRegistry,
  DEFAULT_PRICE_REGISTRY,
  type ModelPrice,
} from "./price-registry.js";

const SONNET: ModelPrice = {
  modelId: "claude-sonnet-5",
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,
  cacheWritePerMillion: 3.75,
};

describe("cost priority chain (§13.6)", () => {
  it("uses Claude-reported cost when present (rung 1)", () => {
    const rows: CostRequestRow[] = [
      { modelId: "claude-sonnet-5", reportedCostUsd: 0.5, inputTokens: 100, outputTokens: 50 },
    ];
    const result = computeCostSummary(rows);
    expect(result.perRequest[0]?.methodology).toBe("reported");
    expect(result.perRequest[0]?.usd).toBe(0.5);
    expect(result.methodology).toBe("reported");
    expect(result.total.value).toBe(0.5);
    expect(result.total.provenance).toBe("estimated");
  });

  it("falls back to the price registry when no reported cost (rung 3)", () => {
    const rows: CostRequestRow[] = [
      {
        modelId: "claude-sonnet-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ];
    const result = computeCostSummary(rows);
    expect(result.perRequest[0]?.methodology).toBe("registry");
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(result.perRequest[0]?.usd).toBeCloseTo(18, 6);
    expect(result.methodology).toBe("registry");
  });

  it("reports unknown for an unrecognised model (rung 4) — never guesses", () => {
    const rows: CostRequestRow[] = [
      { modelId: "claude-mystery-9", inputTokens: 1000, outputTokens: 1000 },
    ];
    const result = computeCostSummary(rows);
    expect(result.perRequest[0]?.methodology).toBe("unknown");
    expect(result.perRequest[0]?.usd).toBeNull();
    expect(result.byModel[0]?.usd).toBeNull();
    expect(result.methodology).toBe("unknown");
  });

  it("mixes methodologies and labels the weakest rung used", () => {
    const rows: CostRequestRow[] = [
      { modelId: "claude-sonnet-5", reportedCostUsd: 0.2, inputTokens: 10, outputTokens: 5 },
      { modelId: "claude-sonnet-5", inputTokens: 1000, outputTokens: 500 },
      { modelId: "claude-mystery-9", inputTokens: 100, outputTokens: 100 },
    ];
    const result = computeCostSummary(rows);
    expect(result.perRequest).toHaveLength(3);
    expect(result.methodology).toBe("reported");
    const sonnet = result.byModel.find((b) => b.modelId === "claude-sonnet-5");
    // Some sonnet requests were reported → per-model provenance "reported".
    expect(sonnet?.provenance).toBe("reported");
    expect(sonnet?.usd).toBeGreaterThan(0.2);
  });

  it("exposes the 'not an official billing value' label", () => {
    expect(COST_ESTIMATE_LABEL).toMatch(/not an official billing value/i);
  });

  it("returns a total with provenance 'unknown' when nothing can be costed", () => {
    const result = computeCostSummary([
      { modelId: "claude-mystery-9", inputTokens: 10, outputTokens: 10 },
    ]);
    expect(result.total.value).toBeNull();
    expect(result.total.provenance).toBe("unknown");
  });

  it("returns an empty/unknown summary for no rows", () => {
    const result = computeCostSummary([]);
    expect(result.total.value).toBeNull();
    expect(result.byModel).toEqual([]);
    expect(result.methodology).toBe("unknown");
  });
});

describe("price registry", () => {
  it("resolves an exact model id", () => {
    expect(resolvePrice("claude-sonnet-5")?.modelId).toBe("claude-sonnet-5");
  });

  it("resolves a dated snapshot to its family via prefix match", () => {
    expect(resolvePrice("claude-sonnet-5-20251001")?.modelId).toBe("claude-sonnet-5");
    expect(resolvePrice("claude-haiku-4-5-20251001")?.modelId).toBe("claude-haiku-4-5");
  });

  it("returns null for an unknown model (ambiguous pricing)", () => {
    expect(resolvePrice("claude-mystery-9")).toBeNull();
    expect(resolvePrice(null)).toBeNull();
    expect(resolvePrice(undefined)).toBeNull();
  });

  it("user overrides win over bundled defaults", () => {
    const registry = buildPriceRegistry([
      {
        ...SONNET,
        inputPerMillion: 99,
        outputPerMillion: 99,
        cacheReadPerMillion: 99,
        cacheWritePerMillion: 99,
      },
    ]);
    const price = resolvePrice("claude-sonnet-5", registry);
    expect(price?.inputPerMillion).toBe(99);
  });

  it("estimateRequestCost converts per-million rates to per-token", () => {
    const usd = estimateRequestCost(
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      SONNET,
    );
    expect(usd).toBeCloseTo(3, 6);
  });

  it("treats missing token fields as zero (only costs what was measured)", () => {
    const usd = estimateRequestCost({}, SONNET);
    expect(usd).toBe(0);
  });

  it("the bundled registry is non-empty and versioned", () => {
    expect(DEFAULT_PRICE_REGISTRY.version).toBeGreaterThan(0);
    expect(Object.keys(DEFAULT_PRICE_REGISTRY.defaults).length).toBeGreaterThan(0);
  });
});
