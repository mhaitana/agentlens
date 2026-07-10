/**
 * Integrate claude-code unit tests (spec §14.5, §14.11, §21).
 *
 * Every test uses temp dirs for both the AgentLens home and the Claude home
 * (`AGENTLENS_CLAUDE_HOME`), and a stub `claude` binary via `AGENTLENS_CLAUDE_BIN`,
 * so nothing touches the developer's real `~/.claude`. Covers: detection,
 * plan, dry-run, install (settings + known_marketplaces + marketplace dir +
 * validation), preservation of unrelated hooks/plugins, status, removal
 * (only AgentLens-owned keys removed), and rollback backups.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyInstall,
  applyRemove,
  buildInstallPlan,
  buildStatus,
  marketplaceRoot,
  claudeSettingsPath,
  knownMarketplacesPath,
  MARKETPLACE_NAME,
  ENABLED_PLUGIN_KEY,
} from "./claude-code.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(here, "..", "..", "..", "..", "plugins", "agentlens-claude");

function stubClaudeBin(dir: string): string {
  const binPath = join(dir, "claude-stub");
  if (process.platform === "win32") {
    writeFileSync(`${binPath}.bat`, "@echo off\necho 1.2.3\n", { mode: 0o755 });
    return `${binPath}.bat`;
  }
  writeFileSync(binPath, "#!/bin/sh\necho '1.2.3'\n", { mode: 0o755 });
  return binPath;
}

describe("integrate claude-code (§14.5, §14.11)", () => {
  let alHome: string;
  let claudeHome: string;
  let bin: string;

  beforeEach(() => {
    alHome = mkdtempSync(join(tmpdir(), "al-int-"));
    claudeHome = mkdtempSync(join(tmpdir(), "al-claude-"));
    bin = stubClaudeBin(claudeHome);
  });
  afterEach(() => {
    rmSync(alHome, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  });

  const opts = () => ({
    claudeHomeOverride: claudeHome,
    pluginSourceDirOverride: PLUGIN_DIR,
    claudeBinOverride: bin,
  });

  it("detects the stubbed claude binary and version", () => {
    const plan = buildInstallPlan(claudeHome, alHome, opts());
    expect(plan.detected.found).toBe(true);
    expect(plan.detected.version).toBe("1.2.3");
  });

  it("plan is non-mutating and reports no registration initially", () => {
    const plan = buildInstallPlan(claudeHome, alHome, opts());
    expect(plan.alreadyRegistered).toBe(false);
    expect(plan.settingsAdds).toContain(`extraKnownMarketplaces.${MARKETPLACE_NAME}`);
    expect(plan.settingsAdds).toContain(`enabledPlugins.${ENABLED_PLUGIN_KEY}`);
    expect(existsSync(claudeSettingsPath(claudeHome))).toBe(false);
  });

  it("dry-run writes nothing", () => {
    const res = applyInstall(claudeHome, alHome, opts(), true);
    expect(res.dryRun).toBe(true);
    expect(existsSync(claudeSettingsPath(claudeHome))).toBe(false);
    expect(existsSync(marketplaceRoot(alHome))).toBe(false);
  });

  it("install registers settings + known_marketplaces + materializes the marketplace + validates", () => {
    const res = applyInstall(claudeHome, alHome, opts());
    expect(res.registered).toBe(true);
    expect(res.validation.settingsParse).toBe(true);
    expect(res.validation.keysPresent).toBe(true);
    expect(res.validation.marketplaceValid).toBe(true);

    const settings = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(settings.extraKnownMarketplaces[MARKETPLACE_NAME].source.source).toBe("directory");
    expect(settings.enabledPlugins[ENABLED_PLUGIN_KEY]).toBe(true);

    const km = JSON.parse(readFileSync(knownMarketplacesPath(claudeHome), "utf8"));
    expect(km[MARKETPLACE_NAME].installLocation).toBe(marketplaceRoot(alHome));

    // Marketplace dir has a valid manifest + plugin.
    expect(existsSync(join(marketplaceRoot(alHome), ".claude-plugin", "marketplace.json"))).toBe(
      true,
    );
    expect(
      existsSync(
        join(
          marketplaceRoot(alHome),
          "plugins",
          "agentlens-claude",
          ".claude-plugin",
          "plugin.json",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(marketplaceRoot(alHome), "plugins", "agentlens-claude", "scripts", "hook.js"),
      ),
    ).toBe(true);
  });

  it("install backs up affected files to <home>/backups", () => {
    // Pre-existing settings with unrelated content must be backed up.
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify(
        { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] } },
        null,
        2,
      ),
    );
    const res = applyInstall(claudeHome, alHome, opts());
    expect(res.backedUp.length).toBeGreaterThan(0);
    const backups = readdirSync(join(alHome, "backups")).filter((f) => f.endsWith(".bak"));
    expect(backups.length).toBeGreaterThan(0);
  });

  it("install preserves unrelated hooks and other enabled plugins (§14.11)", () => {
    mkdirSync(claudeHome, { recursive: true });
    const original = {
      enabledPlugins: { "other@market": true },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] },
      someOtherSetting: true,
    };
    writeFileSync(claudeSettingsPath(claudeHome), JSON.stringify(original, null, 2));
    applyInstall(claudeHome, alHome, opts());
    const after = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(after.enabledPlugins["other@market"]).toBe(true);
    expect(after.enabledPlugins[ENABLED_PLUGIN_KEY]).toBe(true);
    expect(after.hooks).toEqual(original.hooks);
    expect(after.someOtherSetting).toBe(true);
  });

  it("install is idempotent (re-running does not duplicate keys)", () => {
    applyInstall(claudeHome, alHome, opts());
    applyInstall(claudeHome, alHome, opts());
    const settings = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(
      Object.keys(settings.extraKnownMarketplaces).filter((k) => k === MARKETPLACE_NAME),
    ).toHaveLength(1);
    expect(
      Object.keys(settings.enabledPlugins).filter((k) => k === ENABLED_PLUGIN_KEY),
    ).toHaveLength(1);
  });

  it("status reflects the registered state + hook event count", () => {
    applyInstall(claudeHome, alHome, opts());
    const status = buildStatus(claudeHome, alHome, opts());
    expect(status.registered).toBe(true);
    expect(status.marketplaceInstalled).toBe(true);
    expect(status.pluginManifestValid).toBe(true);
    expect(status.hookEventCount).toBeGreaterThanOrEqual(10);
    expect(status.otherEnabledPlugins).toEqual([]);
  });

  it("status lists other enabled plugins as context", () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify({ enabledPlugins: { "other@market": true } }, null, 2),
    );
    const status = buildStatus(claudeHome, alHome, opts());
    expect(status.otherEnabledPlugins).toEqual(["other@market"]);
  });

  it("removal removes ONLY AgentLens-owned keys and the marketplace dir, preserves the rest (§14.11)", () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify(
        {
          enabledPlugins: { "other@market": true },
          hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] },
          extraKnownMarketplaces: { "another-mp": { source: { source: "github", repo: "x/y" } } },
        },
        null,
        2,
      ),
    );
    applyInstall(claudeHome, alHome, opts());

    const removed = applyRemove(claudeHome, alHome, opts());
    expect(removed.removedMarketplace).toBe(true);
    expect(existsSync(marketplaceRoot(alHome))).toBe(false);
    expect(removed.removedSettingsKeys).toContain(`enabledPlugins.${ENABLED_PLUGIN_KEY}`);
    expect(removed.removedSettingsKeys).toContain(`extraKnownMarketplaces.${MARKETPLACE_NAME}`);

    const after = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(after.enabledPlugins["other@market"]).toBe(true); // preserved
    expect(after.enabledPlugins[ENABLED_PLUGIN_KEY]).toBeUndefined();
    expect(after.extraKnownMarketplaces["another-mp"]).toBeDefined(); // preserved
    expect(after.extraKnownMarketplaces[MARKETPLACE_NAME]).toBeUndefined();
    expect(after.hooks).toBeDefined(); // preserved
  });

  it("removal dry-run writes nothing", () => {
    applyInstall(claudeHome, alHome, opts());
    const before = readFileSync(claudeSettingsPath(claudeHome), "utf8");
    const removed = applyRemove(claudeHome, alHome, opts(), true);
    expect(removed.dryRun).toBe(true);
    expect(readFileSync(claudeSettingsPath(claudeHome), "utf8")).toBe(before);
    expect(existsSync(marketplaceRoot(alHome))).toBe(true);
  });

  it("removal backs up before deleting and explains rollback", () => {
    applyInstall(claudeHome, alHome, opts());
    const removed = applyRemove(claudeHome, alHome, opts());
    expect(removed.backedUp.length).toBeGreaterThan(0);
    expect(removed.rollbackHint).toContain("backups");
  });

  it("removal when not installed is a no-op that preserves everything", () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(
      claudeSettingsPath(claudeHome),
      JSON.stringify({ enabledPlugins: { "other@market": true } }, null, 2),
    );
    const removed = applyRemove(claudeHome, alHome, opts());
    expect(removed.removedSettingsKeys).toEqual([]);
    const after = JSON.parse(readFileSync(claudeSettingsPath(claudeHome), "utf8"));
    expect(after.enabledPlugins["other@market"]).toBe(true);
  });
});
