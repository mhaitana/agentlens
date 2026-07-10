import { describe, it, expect } from "vitest";
import {
  defaultConfig,
  validate,
  migrate,
  getConfigValue,
  setConfigValue,
  CURRENT_CONFIG_VERSION,
} from "./index.js";

describe("config defaults", () => {
  it("produces a complete config matching the spec example shape", () => {
    const cfg = defaultConfig();
    expect(cfg.version).toBe(CURRENT_CONFIG_VERSION);
    expect(cfg.privacy.mode).toBe("redacted-content");
    expect(cfg.privacy.retentionDays).toBe(90);
    expect(cfg.sources.claudeCode.enabled).toBe(true);
    expect(cfg.analysis.minimumRecommendationConfidence).toBe(0.65);
    expect(cfg.dashboard.host).toBe("127.0.0.1");
    expect(cfg.dashboard.port).toBe(47821);
    expect(cfg.externalAnalysis.enabled).toBe(false);
  });
});

describe("validate", () => {
  it("accepts a valid config", () => {
    const result = validate(defaultConfig());
    expect(result.ok).toBe(true);
    expect(result.config?.privacy.mode).toBe("redacted-content");
  });

  it("rejects an invalid privacy mode", () => {
    const bad = { ...defaultConfig(), privacy: { ...defaultConfig().privacy, mode: "leaky" } };
    const result = validate(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("migrate", () => {
  it("returns defaults for non-object input", () => {
    expect(migrate(null).privacy.mode).toBe("redacted-content");
  });

  it("preserves a valid version-1 config", () => {
    const cfg = defaultConfig();
    cfg.privacy.retentionDays = 30;
    expect(migrate(cfg).privacy.retentionDays).toBe(30);
  });

  it("fills defaults for a partial config", () => {
    const partial = { version: 1, privacy: { mode: "metadata-only" } };
    const migrated = migrate(partial);
    expect(migrated.privacy.mode).toBe("metadata-only");
    expect(migrated.sources.claudeCode.enabled).toBe(true);
    expect(migrated.dashboard.port).toBe(47821);
  });
});

describe("get / set", () => {
  it("reads nested values by dot path", () => {
    const cfg = defaultConfig();
    expect(getConfigValue(cfg, "privacy.mode")).toBe("redacted-content");
    expect(getConfigValue(cfg, "dashboard.port")).toBe(47821);
    expect(getConfigValue(cfg, "does.not.exist")).toBeUndefined();
  });

  it("sets nested values and coerces scalars", () => {
    const cfg = defaultConfig();
    const next = setConfigValue(cfg, "privacy.retentionDays", "42");
    expect(next.privacy.retentionDays).toBe(42);
  });

  it("rejects invalid values after set", () => {
    const cfg = defaultConfig();
    expect(() => setConfigValue(cfg, "privacy.mode", "bogus")).toThrow();
  });
});
