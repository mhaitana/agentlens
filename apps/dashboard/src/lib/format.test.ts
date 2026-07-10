import { describe, it, expect } from "vitest";
import {
  COST_ESTIMATE_LABEL,
  confidenceBand,
  confidenceLabel,
  formatCost,
  formatDuration,
  formatNumber,
  formatPct,
  formatTokens,
  provenanceLabel,
} from "./format.js";

describe("honest-metrics formatters (§3.4)", () => {
  it("always flags cost as estimated", () => {
    expect(COST_ESTIMATE_LABEL).toMatch(/Estimated — not an official billing value/);
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.001)).toBe("<$0.01");
    expect(formatCost(null)).toBe("—");
  });

  it("formats numbers with thousands separators", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(null)).toBe("—");
  });

  it("compacts token counts", () => {
    expect(formatTokens(1_200_000)).toBe("1.20M");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(42)).toBe("42");
  });

  it("formats durations", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(754_000)).toBe("12m 34s");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats percentages from 0..1", () => {
    expect(formatPct(0.871)).toBe("87%");
    expect(formatPct(null)).toBe("—");
  });

  it("labels provenance kinds", () => {
    expect(provenanceLabel("exact")).toBe("exact");
    expect(provenanceLabel("estimated")).toBe("estimated");
    expect(provenanceLabel(undefined)).toBe("unknown");
  });

  it("bands confidence into high/moderate/low (§18.3)", () => {
    expect(confidenceBand(0.9)).toBe("high");
    expect(confidenceBand(0.6)).toBe("moderate");
    expect(confidenceBand(0.3)).toBe("low");
    expect(confidenceLabel("high")).toBe("High confidence");
  });
});
