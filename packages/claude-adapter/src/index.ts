/**
 * @agentlens/claude-adapter — the ONLY package that knows Claude Code's data
 * shapes. Translates Claude transcript / hook / OTLP events into the
 * provider-neutral {@link NormalisedSourceEvent} union (spec §4, §13.1).
 *
 * Per the architecture constraint, this package depends ONLY on
 * @agentlens/source-adapter and @agentlens/domain — no redaction, no
 * database, no config. Redaction is applied by the consuming import layer.
 *
 * Skeleton — implementation lands in feature F001.
 */
export const CLAUDE_ADAPTER_VERSION = "0.0.0";
