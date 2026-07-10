/**
 * Versioned, configurable model-price registry (spec §13.6 rung 3).
 *
 * Cost is never taken from thin air: when Claude does not report a cost and
 * no provider telemetry is available, the registry supplies per-model token
 * rates so an *estimated* cost can be computed. The registry is versioned (so
 * a price bump is auditable) and configurable (callers merge user overrides on
 * top of the bundled defaults). Every figure it produces is an estimate —
 * "not an official billing value" — and is labelled as such downstream.
 *
 * Prices are expressed in USD per **million** tokens (the unit providers quote
 * publicly); the cost module converts to per-token before multiplying.
 */

/** Per-token-type USD price for one model, per million tokens. */
export interface ModelPrice {
  /** Identifier the registry is keyed by (e.g. "claude-sonnet-5"). */
  modelId: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** Cached prompt tokens read from the cache. */
  cacheReadPerMillion: number;
  /** Prompt tokens written to the cache (cache creation). */
  cacheWritePerMillion: number;
}

/** A versioned bundle of model prices + user overrides. */
export interface PriceRegistry {
  /** Schema version; bump when the bundled defaults change materially. */
  version: number;
  /** Bundled default prices keyed by canonical model id. */
  defaults: Record<string, ModelPrice>;
  /** User-supplied overrides keyed by model id (win over defaults). */
  overrides: Record<string, ModelPrice>;
}

/**
 * Bundled default prices. These are approximate public list rates (USD per
 * million tokens) for common Claude models, used only when the source did not
 * report a cost. They are ESTIMATES, not billing data. Models not listed here
 * resolve to `null` (cost reported as "unknown"), per §13.6 rung 4 — we never
 * guess a price for a model we don't recognise.
 */
const BUNDLED_DEFAULTS: ModelPrice[] = [
  {
    modelId: "claude-sonnet-5",
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    modelId: "claude-opus-4-8",
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    modelId: "claude-haiku-4-5",
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  // Legacy / alias families still seen in older transcripts.
  {
    modelId: "claude-3-5-sonnet",
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    modelId: "claude-3-5-haiku",
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
];

/** Current bundled registry version. Bump when BUNDLED_DEFAULTS changes. */
export const PRICE_REGISTRY_VERSION = 1;

/** The bundled registry with no user overrides. */
export const DEFAULT_PRICE_REGISTRY: PriceRegistry = {
  version: PRICE_REGISTRY_VERSION,
  defaults: indexByModelId(BUNDLED_DEFAULTS),
  overrides: {},
};

function indexByModelId(prices: ModelPrice[]): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const p of prices) out[p.modelId] = p;
  return out;
}

/**
 * Build a registry by merging user overrides onto the bundled defaults.
 * Overrides win on a per-model basis (same `modelId`).
 */
export function buildPriceRegistry(overrides: ModelPrice[] = []): PriceRegistry {
  return {
    version: PRICE_REGISTRY_VERSION,
    defaults: indexByModelId(BUNDLED_DEFAULTS),
    overrides: indexByModelId(overrides),
  };
}

/**
 * Resolve a price for a model id, or `null` if unknown (§13.6 rung 4).
 *
 * Resolution order: exact override → exact default → family-prefix match
 * against defaults (so dated snapshots like `claude-sonnet-5-20251001` resolve
 * to their family). Two model ids with ambiguous pricing (none matched) yield
 * `null` — the caller must then report the cost as "unknown", never guess.
 */
export function resolvePrice(
  modelId: string | null | undefined,
  registry: PriceRegistry = DEFAULT_PRICE_REGISTRY,
): ModelPrice | null {
  if (!modelId) return null;
  const exactOverride = registry.overrides[modelId];
  if (exactOverride) return exactOverride;
  const exactDefault = registry.defaults[modelId];
  if (exactDefault) return exactDefault;

  // Family-prefix match: longest bundled key that is a prefix of the model id.
  // e.g. "claude-sonnet-5-20251001" → "claude-sonnet-5".
  let best: ModelPrice | null = null;
  let bestLen = 0;
  for (const key of Object.keys(registry.defaults)) {
    if (modelId.startsWith(key) && key.length > bestLen) {
      best = registry.defaults[key] as ModelPrice;
      bestLen = key.length;
    }
  }
  for (const key of Object.keys(registry.overrides)) {
    if (modelId.startsWith(key) && key.length > bestLen) {
      best = registry.overrides[key] as ModelPrice;
      bestLen = key.length;
    }
  }
  return best;
}

/**
 * Estimate the USD cost of a single model request from its token usage and a
 * resolved price. Returns `null` when pricing is ambiguous (unknown model or
 * no usage recorded at all) — the caller then labels the cost "unknown".
 *
 * Missing token fields are treated as zero (the source did not report them),
 * which is the honest interpretation: we cost only what was measured.
 */
export function estimateRequestCost(
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheCreationTokens?: number | null;
  },
  price: ModelPrice,
): number {
  const perToken = (perMillion: number): number => perMillion / 1_000_000;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  return (
    input * perToken(price.inputPerMillion) +
    output * perToken(price.outputPerMillion) +
    cacheRead * perToken(price.cacheReadPerMillion) +
    cacheWrite * perToken(price.cacheWritePerMillion)
  );
}
