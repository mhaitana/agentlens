/** A configured data source (e.g. Claude Code) that AgentLens can scan. (§10.1) */
export interface DataSource {
  id: string;
  /** Adapter identifier, e.g. "claude-code". */
  adapter: string;
  displayName: string;
  /** Source/adapter version, when known. */
  version?: string;
  enabled: boolean;
}

/** A source location discovered during scanning. */
export interface DiscoveredSource {
  /** Adapter that discovered this location. */
  adapter: string;
  /** Human-readable label. */
  displayName: string;
  /** Filesystem path or URL of the source location. */
  uri: string;
  /** Optional source version. */
  version?: string;
}

/** Result of validating a discovered source. */
export interface SourceValidationResult {
  valid: boolean;
  /** Diagnostic messages describing why validation failed or what was checked. */
  diagnostics: string[];
}

/** Capabilities a source adapter declares. */
export interface SourceCapabilities {
  /** Whether the adapter can discover sources on its own. */
  discovery: boolean;
  /** Whether it streams events rather than batch-importing. */
  streaming: boolean;
  /** Whether it can provide live observations. */
  live: boolean;
  /** Whether token/cost metrics are available from this source. */
  costMetrics: boolean;
}
