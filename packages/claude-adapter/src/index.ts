/**
 * @agentlens/claude-adapter — the ONLY package that knows Claude Code's data
 * shapes. Translates Claude transcript JSONL into the provider-neutral
 * {@link NormalisedSourceEvent} union (spec §4, §13.1–13.2).
 *
 * Per the architecture constraint, this package depends ONLY on
 * @agentlens/source-adapter and @agentlens/domain — no redaction, no database,
 * no config. Redaction-before-persistence is the importer's responsibility.
 */

export { ClaudeCodeAdapter } from "./adapter.js";
export {
  discoverTranscripts,
  type DiscoveredTranscript,
  type DiscoverOptions,
} from "./locations.js";
export {
  claudeHome,
  projectsDir,
  encodeProjectPath,
  decodeProjectFolder,
  hashPath,
  sha256,
  normaliseUri,
} from "./paths.js";
export { TranscriptNormaliser, type NormaliserOptions } from "./normalise.js";
export {
  fileOperationFor,
  isFileTool,
  isBashTool,
  classifyCommand,
  verificationKindFor,
  gitCommitIdFromCommand,
} from "./tools.js";
export { parseTranscriptStream, collectStream, type StreamOptions } from "./parser/stream.js";
export {
  parseLine,
  TranscriptLineSchema,
  MessageSchema,
  UsageSchema,
  ContentBlockSchema,
  type ParsedRecord,
  type ParsedLine,
  type ParserDiagnostic,
  type RecordKind,
  type TranscriptLine,
  type ParsedMessage,
  type Usage,
  type ContentBlock,
} from "./parser/schema.js";
export { ADAPTER_ID, ADAPTER_VERSION, PARSER_VERSION } from "./version.js";
