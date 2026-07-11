/**
 * Build a provider-neutral {@link ConfigurationSummary} (spec §15.4) from the
 * resolved AgentLens config, for the configuration-category recommendation
 * rules. The summary describes *config state* — never secrets — so rules can
 * flag overly broad retention/exclusions, network binding beyond loopback, and
 * external analysis enabled without safeguards.
 *
 * Lives in the config package (which owns the config shape and already depends
 * on `@agentlens/domain`) so both the CLI and the local API can build it
 * without the analysis-engine taking a config-package dependency.
 */
import type { ConfigurationSummary } from "@agentlens/domain";
import type { AgentLensConfig } from "./schema.js";

/** True when an exclusion pattern looks overly broad (wildcard or very short). */
function isBroadExclusion(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;
  // Wildcards or very short prefixes match a lot of projects unintentionally.
  if (trimmed.includes("*") || trimmed.includes("?")) return true;
  return trimmed.length <= 3;
}

/** True when the host binds beyond the loopback interface. */
function isBeyondLoopback(host: string): boolean {
  return (
    host !== "127.0.0.1" && host !== "::1" && host !== "localhost" && host !== "0.0.0.0" // 0.0.0.0 binds all interfaces — beyond loopback
  );
}

/** True for analysis providers that involve a model beyond the on-device
 *  deterministic layer (i.e. require the §15.5 redaction + opt-in safeguards).
 *  "openai-compatible" transmits off-machine; "local-model" runs an LLM
 *  on-machine but still warrants the safeguards. */
function isExternalProvider(provider: string): boolean {
  return provider === "openai-compatible" || provider === "local-model";
}

export function buildConfigurationSummary(config: AgentLensConfig): ConfigurationSummary {
  const excluded = config.sources.claudeCode.excludedProjects ?? [];
  const broadExclusions = excluded.some((p) => isBroadExclusion(p));
  const externalEnabled = config.externalAnalysis.enabled;
  const provider = config.externalAnalysis.provider;
  return {
    privacyMode: config.privacy.mode,
    retentionDays: config.privacy.retentionDays,
    excludedProjectCount: excluded.length,
    broadExclusions,
    dashboardHost: config.dashboard.host,
    bindsBeyondLoopback: isBeyondLoopback(config.dashboard.host),
    externalAnalysisEnabled: externalEnabled,
    externalAnalysisProvider: provider,
    // "External" here = a model beyond the on-device deterministic layer is
    // involved (local or remote), warranting the §15.5 safeguards.
    externalAnalysisExternal: externalEnabled && isExternalProvider(provider),
  };
}
