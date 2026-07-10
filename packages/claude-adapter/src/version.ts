/**
 * Versioning for the Claude Code adapter (spec §12, §13.3).
 *
 * - `ADAPTER_VERSION` identifies the adapter implementation.
 * - `PARSER_VERSION` is bumped whenever the parser/normaliser changes the
 *   meaning of a parsed record, so the incremental importer can reprocess
 *   transcripts that were last imported under an older parser.
 */
export const ADAPTER_ID = "claude-code";
export const ADAPTER_VERSION = "0.1.0";
export const PARSER_VERSION = 1;
