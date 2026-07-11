/**
 * @agentlens/prompt-coach — deterministic + optional semantic prompt analysis
 * (spec §15.5).
 *
 * Owns the structural prompt-feature extraction (§10.4 {@link PromptFeatures}),
 * the deterministic Prompt Coach (quality dimensions, suggested structure,
 * prompt comparison §15.6, repeated-template detection), and the optional
 * CoachingProvider interface with `none` / `deterministic` / openai-compatible
 * / local-model implementations plus the CoachingGateway that enforces the
 * §15.5 safeguards for external sends (disabled by default).
 *
 * No external model is required for the deterministic layer.
 */
export const PROMPT_COACH_VERSION = "0.3.0";

export { extractPromptFeatures, IMPERATIVE_VERBS } from "./features.js";
export { assessPrompt, DIMENSION_LABELS } from "./quality.js";
export { suggestImprovedStructure } from "./suggest.js";
export { comparePrompt } from "./compare.js";
export { detectRepeatedTemplates, normaliseTemplateKey } from "./templates.js";
export type { PromptTemplateInput } from "./templates.js";

// Optional semantic layer (§15.5).
export { noneProvider } from "./providers/none.js";
export { deterministicProvider } from "./providers/deterministic.js";
export { openAiCompatibleProvider, localModelProvider } from "./providers/external.js";
export type { ExternalProviderOptions } from "./providers/external.js";
export { chatCompletion, extractJson } from "./providers/chat.js";
export type { ChatMessage, ChatCompletionOptions } from "./providers/chat.js";
export { CoachingGateway, isExternalProviderId } from "./gateway.js";
export type { CoachingGatewayContext, CoachingGatewaySettings } from "./gateway.js";
export { resolveCoachingProvider } from "./resolve.js";
export type { CoachingProviderSettings, ResolveCoachingProviderDeps } from "./resolve.js";
