/**
 * @agentlens/config — versioned configuration + local data paths (spec §9, §7).
 */

export {
  CURRENT_CONFIG_VERSION,
  defaultConfig,
  PrivacyMode,
  AgentLensConfig,
  PrivacyConfig,
  SourcesConfig,
  ClaudeCodeSourceConfig,
  AnalysisConfig,
  DashboardConfig,
  ExternalAnalysisConfig,
  TelemetryConfig,
  CustomPattern,
} from "./schema.js";

export {
  migrate,
  validate,
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  type ValidationResult,
} from "./config.js";

export {
  resolveAgentLensHome,
  configPath,
  databasePath,
  ensureDataDirs,
  restrictFile,
  pathExists,
  DATA_SUBDIRS,
  type DataSubdir,
} from "./paths.js";
