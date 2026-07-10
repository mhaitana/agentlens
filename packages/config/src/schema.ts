import { z } from "zod";

/** The three privacy modes (spec §8). */
export const PrivacyMode = z.enum(["metadata-only", "redacted-content", "full-local"]);
export type PrivacyMode = z.infer<typeof PrivacyMode>;

/** A user-defined redaction pattern (§8.4). */
export const CustomPattern = z
  .object({
    name: z.string().min(1),
    /** Regex source string. */
    pattern: z.string().min(1),
    /** Label the matched text is replaced with, e.g. "[REDACTED:api-key]". */
    replacement: z.string(),
  })
  .strict();

export const PrivacyConfig = z
  .object({
    mode: PrivacyMode,
    retentionDays: z.number().int().positive().max(3650),
    redactEmails: z.boolean(),
    redactHomePath: z.boolean(),
    storeAssistantResponses: z.boolean(),
    customPatterns: z.array(CustomPattern),
  })
  .passthrough();

export const ClaudeCodeSourceConfig = z
  .object({
    enabled: z.boolean(),
    transcriptDirectories: z.array(z.string()),
    excludedProjects: z.array(z.string()),
    followSymlinks: z.boolean(),
  })
  .passthrough();

export const SourcesConfig = z
  .object({
    claudeCode: ClaudeCodeSourceConfig,
  })
  .passthrough();

export const AnalysisConfig = z
  .object({
    minimumRecommendationConfidence: z.number().min(0).max(1),
    ruleOverrides: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export const DashboardConfig = z
  .object({
    host: z.string().ip({ version: "v4" }).or(z.literal("127.0.0.1")).default("127.0.0.1"),
    port: z.number().int().min(0).max(65535).default(47821),
    openBrowser: z.boolean().default(true),
  })
  .passthrough();

export const ExternalAnalysisConfig = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(["none", "deterministic", "openai-compatible", "local-model"]).default("none"),
    model: z.string().nullable().default(null),
  })
  .passthrough();

/** Current config schema version (spec §9 example uses version 1). */
export const CURRENT_CONFIG_VERSION = 1;

export const AgentLensConfig = z
  .object({
    version: z.literal(CURRENT_CONFIG_VERSION).default(CURRENT_CONFIG_VERSION),
    privacy: PrivacyConfig,
    sources: SourcesConfig,
    analysis: AnalysisConfig,
    dashboard: DashboardConfig,
    externalAnalysis: ExternalAnalysisConfig,
  })
  .passthrough();

export type AgentLensConfig = z.infer<typeof AgentLensConfig>;
export type PrivacyConfig = z.infer<typeof PrivacyConfig>;
export type SourcesConfig = z.infer<typeof SourcesConfig>;
export type AnalysisConfig = z.infer<typeof AnalysisConfig>;
export type DashboardConfig = z.infer<typeof DashboardConfig>;
export type ExternalAnalysisConfig = z.infer<typeof ExternalAnalysisConfig>;
export type CustomPattern = z.infer<typeof CustomPattern>;
export type ClaudeCodeSourceConfig = z.infer<typeof ClaudeCodeSourceConfig>;

/** Default configuration used for a fresh install (spec §9 example). */
export function defaultConfig(): AgentLensConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    privacy: {
      mode: "redacted-content",
      retentionDays: 90,
      redactEmails: false,
      redactHomePath: true,
      storeAssistantResponses: false,
      customPatterns: [],
    },
    sources: {
      claudeCode: {
        enabled: true,
        transcriptDirectories: [],
        excludedProjects: [],
        followSymlinks: false,
      },
    },
    analysis: {
      minimumRecommendationConfidence: 0.65,
      ruleOverrides: {},
    },
    dashboard: {
      host: "127.0.0.1",
      port: 47821,
      openBrowser: true,
    },
    externalAnalysis: {
      enabled: false,
      provider: "none",
      model: null,
    },
  };
}
