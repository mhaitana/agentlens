/**
 * CoachingGateway (spec §15.5) — the only sanctioned path to an external
 * CoachingProvider. Enforces the six §15.5 safeguards before any external send:
 *
 *   1. Show exactly what categories of data will be sent  (buildDisclosure)
 *   2. Redact it                                         (ctx.redact)
 *   3. Show a preview                                    (disclosure.preview)
 *   4. Require explicit enablement + opt-in              (ctx.enabled && ctx.approved)
 *   5. Allow per-request cancellation                    (ctx.signal)
 *   6. Clearly mark externally generated advice          (provider sets externalDisclaimer)
 *
 * External providers are DISABLED BY DEFAULT: if `ctx.enabled` is false, an
 * external provider is never called (status "disabled"). The `none` and
 * `deterministic` providers are on-device and bypass the gate. The gateway
 * never sends a transcript — only the single redacted prompt + features.
 */
import type {
  CoachingCallOptions,
  CoachingDataCategory,
  CoachingGatewayResult,
  CoachingGatewayStatus,
  CoachingProvider,
  CoachingRequestDisclosure,
  GeneratedRemediation,
  RedactedPromptAnalysisInput,
  RedactedPromptPayload,
  RedactedRemediationInput,
  RedactedTaskClassificationInput,
  SemanticPromptAnalysis,
  TaskClassification,
} from "@agentlens/domain";

/** Per-call gateway context (the §15.5 safeguards, resolved by the caller). */
export interface CoachingGatewayContext {
  /** config.externalAnalysis.enabled — external sends require this true. */
  enabled: boolean;
  /** Resolved explicit opt-in for this external request (§15.5 step 4). */
  approved: boolean;
  /** Per-request cancellation (§15.5 step 5). */
  signal?: AbortSignal;
  /** Injected redaction applied to content before any external send (step 2). */
  redact?: (text: string) => string;
}

/** Optional provider settings surfaced in the disclosure (endpoint/model). */
export interface CoachingGatewaySettings {
  endpoint?: string;
  model?: string;
}

const DATA_CATEGORIES: CoachingDataCategory[] = [
  "redacted-prompt-text",
  "structural-features",
  "session-sequence",
];

/** Apply redaction if provided, else passthrough (content should already be redacted). */
function redactText(text: string, redact?: (t: string) => string): string {
  return redact ? redact(text) : text;
}

/** Build a redacted payload copy for an external send. */
function redactedPayload(
  prompt: RedactedPromptPayload,
  redact?: (t: string) => string,
): RedactedPromptPayload {
  return { ...prompt, redactedContent: redactText(prompt.redactedContent, redact) };
}

/** Decide whether an external send may proceed. */
function gateExternal(
  provider: CoachingProvider,
  ctx: CoachingGatewayContext,
): { ok: true } | { ok: false; status: CoachingGatewayStatus; error: string } {
  if (!provider.external) return { ok: true };
  if (!ctx.enabled) {
    return { ok: false, status: "disabled", error: "External analysis is disabled by default." };
  }
  if (!ctx.approved) {
    return {
      ok: false,
      status: "not-approved",
      error: "External send was not explicitly approved.",
    };
  }
  if (ctx.signal?.aborted) {
    return { ok: false, status: "cancelled", error: "Cancelled before send." };
  }
  return { ok: true };
}

/** A blocked semantic-analysis result. */
function blockedAnalysis(providerId: string): SemanticPromptAnalysis {
  return {
    generatedBy: "none",
    providerId,
    available: false,
    qualityNotes: [],
    suggestedMissing: [],
  };
}
function blockedClassification(providerId: string, rationale: string): TaskClassification {
  return {
    generatedBy: "none",
    providerId,
    available: false,
    taskType: "unknown",
    confidence: 0,
    rationale,
  };
}
function blockedRemediation(providerId: string): GeneratedRemediation {
  return { generatedBy: "none", providerId, available: false, remediation: "", steps: [] };
}

/** True when an error looks like a cancellation. */
function isCancelError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return /cancel|abort/i.test((err as Error).message ?? "");
}

/**
 * The CoachingGateway. Construct with a resolved provider (and optional
 * endpoint/model for disclosure). Call `buildDisclosure` to show the user what
 * an external send would transmit; resolve opt-in; then call `analysePrompt` /
 * `classifyTask` / `generateRemediation` with the context.
 */
export class CoachingGateway {
  constructor(
    private readonly provider: CoachingProvider,
    private readonly settings: CoachingGatewaySettings = {},
  ) {}

  /**
   * Build the §15.5 disclosure for a prompt — what categories of data would be
   * sent, to which endpoint/model, plus a redacted preview. No send occurs.
   */
  buildDisclosure(
    prompt: RedactedPromptPayload,
    redact?: (t: string) => string,
  ): CoachingRequestDisclosure {
    const preview = redactText(prompt.redactedContent, redact).slice(0, 200);
    const where = this.settings.endpoint ? ` at ${this.settings.endpoint}` : "";
    const withModel = this.settings.model ? ` (model: ${this.settings.model})` : "";
    return {
      providerId: this.provider.id,
      external: this.provider.external,
      endpoint: this.settings.endpoint,
      model: this.settings.model,
      dataCategories: this.provider.external ? [...DATA_CATEGORIES] : [],
      summary: this.provider.external
        ? `Send ${DATA_CATEGORIES.join(", ")} to ${this.provider.id}${where}${withModel}.`
        : `On-device ${this.provider.id} provider — nothing is sent off-machine.`,
      preview,
    };
  }

  async analysePrompt(
    input: RedactedPromptAnalysisInput,
    ctx: CoachingGatewayContext,
  ): Promise<CoachingGatewayResult<SemanticPromptAnalysis>> {
    const disclosure = this.buildDisclosure(input.prompt, ctx.redact);
    const g = gateExternal(this.provider, ctx);
    if (!g.ok) {
      return {
        status: g.status,
        result: blockedAnalysis(this.provider.id),
        disclosure,
        error: g.error,
      };
    }
    const payload = redactedPayload(input.prompt, ctx.redact);
    const options: CoachingCallOptions | undefined = ctx.signal
      ? { signal: ctx.signal }
      : undefined;
    try {
      const result = await this.provider.analysePrompt({ prompt: payload }, options);
      if (ctx.signal?.aborted) {
        return {
          status: "cancelled",
          result: blockedAnalysis(this.provider.id),
          disclosure,
          error: "Cancelled.",
        };
      }
      return { status: "ok", result, disclosure };
    } catch (err) {
      const cancelled = isCancelError(err, ctx.signal);
      return {
        status: cancelled ? "cancelled" : "error",
        result: blockedAnalysis(this.provider.id),
        disclosure,
        error: (err as Error).message,
      };
    }
  }

  async classifyTask(
    input: RedactedTaskClassificationInput,
    ctx: CoachingGatewayContext,
  ): Promise<CoachingGatewayResult<TaskClassification>> {
    const disclosure = this.buildDisclosure(input.prompt, ctx.redact);
    const g = gateExternal(this.provider, ctx);
    if (!g.ok) {
      return {
        status: g.status,
        result: blockedClassification(this.provider.id, g.error),
        disclosure,
        error: g.error,
      };
    }
    const payload = redactedPayload(input.prompt, ctx.redact);
    const options: CoachingCallOptions | undefined = ctx.signal
      ? { signal: ctx.signal }
      : undefined;
    try {
      const result = await this.provider.classifyTask({ prompt: payload }, options);
      if (ctx.signal?.aborted) {
        return {
          status: "cancelled",
          result: blockedClassification(this.provider.id, "Cancelled."),
          disclosure,
          error: "Cancelled.",
        };
      }
      return { status: "ok", result, disclosure };
    } catch (err) {
      const cancelled = isCancelError(err, ctx.signal);
      return {
        status: cancelled ? "cancelled" : "error",
        result: blockedClassification(this.provider.id, (err as Error).message),
        disclosure,
        error: (err as Error).message,
      };
    }
  }

  async generateRemediation(
    input: RedactedRemediationInput,
    ctx: CoachingGatewayContext,
  ): Promise<CoachingGatewayResult<GeneratedRemediation>> {
    const disclosure = this.buildDisclosure(input.prompt, ctx.redact);
    const g = gateExternal(this.provider, ctx);
    if (!g.ok) {
      return {
        status: g.status,
        result: blockedRemediation(this.provider.id),
        disclosure,
        error: g.error,
      };
    }
    const payload = redactedPayload(input.prompt, ctx.redact);
    const options: CoachingCallOptions | undefined = ctx.signal
      ? { signal: ctx.signal }
      : undefined;
    try {
      const result = await this.provider.generateRemediation({ prompt: payload }, options);
      if (ctx.signal?.aborted) {
        return {
          status: "cancelled",
          result: blockedRemediation(this.provider.id),
          disclosure,
          error: "Cancelled.",
        };
      }
      return { status: "ok", result, disclosure };
    } catch (err) {
      const cancelled = isCancelError(err, ctx.signal);
      return {
        status: cancelled ? "cancelled" : "error",
        result: blockedRemediation(this.provider.id),
        disclosure,
        error: (err as Error).message,
      };
    }
  }
}

/** True for providers that send content off-device (§15.5 external). */
export function isExternalProviderId(id: string): boolean {
  return id === "openai-compatible" || id === "local-model";
}
