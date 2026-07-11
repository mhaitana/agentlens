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
    /**
     * User overrides for the §15.4 model catalogue. Each entry describes a
     * model family in relative tiers (capability/cost/context class) and wins
     * over the bundled default with the same id; entries with new ids add a
     * model. Optional — defaults to no overrides.
     */
    modelCatalogue: z
      .array(
        z
          .object({
            id: z.string().min(1),
            matchPatterns: z.array(z.string().min(1)),
            provider: z.string().min(1),
            capabilityTier: z.number().int().min(1).max(5),
            costTier: z.number().int().min(1).max(5),
            contextClass: z.enum(["small", "medium", "large"]),
            recommendedTaskClasses: z.array(z.string()),
            effectiveFrom: z.string().optional(),
            effectiveUntil: z.string().optional(),
            notes: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
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
    /**
     * Base URL of an external/local analysis endpoint (e.g.
     * `https://api.openai.com/v1` or `http://127.0.0.1:11434/v1`). Required for
     * the openai-compatible and local-model providers; ignored otherwise.
     */
    endpoint: z.string().url().nullable().default(null),
    /**
     * Name of the environment variable holding the API key for an
     * openai-compatible provider (e.g. `OPENAI_API_KEY`). The key itself is
     * NEVER stored in config — only the variable name, which the runtime reads
     * on demand (§3.2: never persist API keys/auth headers). Ignored for the
     * local-model provider (no key) and the none/deterministic providers.
     */
    apiKeyEnv: z.string().nullable().default(null),
  })
  .passthrough();

/**
 * Claude Code OpenTelemetry configuration (spec §14.7). AgentLens holds this
 * locally; `telemetry print-env` emits the corresponding `OTEL_*` /
 * `CLAUDE_CODE_*` env vars pointing at the local loopback OTLP receiver.
 *
 * Privacy defaults (§14.7, §14.11): every sensitive-content flag is OFF by
 * default — user prompts, assistant responses, tool details, tool content, and
 * raw API bodies are never logged unless explicitly enabled. Traces are a beta
 * feature and disabled unless explicitly enabled.
 */
export const TelemetryConfig = z
  .object({
    enabled: z.boolean().default(false),
    /** Loopback port the local OTLP/HTTP receiver binds (default 4318). */
    otlpPort: z.number().int().min(0).max(65535).default(4318),
    protocol: z.enum(["http/json", "http/protobuf", "grpc"]).default("http/json"),
    /** OTLP endpoint base URL (SDK appends /v1/{metrics,logs,traces}). */
    endpoint: z.string().default("http://127.0.0.1:4318"),
    logUserPrompts: z.boolean().default(false),
    logAssistantResponses: z.boolean().default(false),
    logToolDetails: z.boolean().default(false),
    logToolContent: z.boolean().default(false),
    logRawApiBodies: z.boolean().default(false),
    tracesEnabled: z.boolean().default(false),
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
    telemetry: TelemetryConfig,
  })
  .passthrough();

export type AgentLensConfig = z.infer<typeof AgentLensConfig>;
export type PrivacyConfig = z.infer<typeof PrivacyConfig>;
export type SourcesConfig = z.infer<typeof SourcesConfig>;
export type AnalysisConfig = z.infer<typeof AnalysisConfig>;
export type DashboardConfig = z.infer<typeof DashboardConfig>;
export type ExternalAnalysisConfig = z.infer<typeof ExternalAnalysisConfig>;
export type TelemetryConfig = z.infer<typeof TelemetryConfig>;
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
      modelCatalogue: [],
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
      endpoint: null,
      apiKeyEnv: null,
    },
    telemetry: {
      enabled: false,
      otlpPort: 4318,
      protocol: "http/json",
      endpoint: "http://127.0.0.1:4318",
      logUserPrompts: false,
      logAssistantResponses: false,
      logToolDetails: false,
      logToolContent: false,
      logRawApiBodies: false,
      tracesEnabled: false,
    },
  };
}
