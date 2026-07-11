/**
 * Configurable model-catalogue contracts (spec §15.4 model selection).
 *
 * A model catalogue describes models in *relative* terms — capability tier, cost
 * tier, context class, recommended task classes — so model-selection rules can
 * flag mismatches (e.g. a high-cost tier used for mechanical work) without ever
 * hardcoding a permanent claim that a named model is always best or cheapest
 * (§15.4: "Recommendations must be relative and configurable").
 *
 * These types are provider-neutral: the catalogue entry carries a provider label
 * and identifier patterns, but no provider-specific shapes. The bundled defaults
 * (which name Claude model families) and the resolution logic live in
 * `@agentlens/analysis-engine`; user overrides merge over the defaults.
 */

/** Relative capability tier (1 = lightest, 5 = most capable). */
export type CapabilityTier = 1 | 2 | 3 | 4 | 5;

/** Relative cost tier (1 = cheapest, 5 = most expensive). */
export type CostTier = 1 | 2 | 3 | 4 | 5;

/** Rough context-window class. */
export type ContextClass = "small" | "medium" | "large";

/** One catalogue entry describing a model family in relative terms. */
export interface ModelCatalogueEntry {
  /** Stable entry id (e.g. "claude-haiku-4-5"). */
  id: string;
  /**
   * Identifier patterns used to match a recorded model id to this entry. A
   * pattern matches if the model id equals it or starts with it (so dated
   * snapshots like `claude-sonnet-5-20251001` resolve to their family). The
   * resolver picks the longest matching pattern.
   */
  matchPatterns: string[];
  /** Provider label (e.g. "anthropic"). */
  provider: string;
  /** Relative capability tier (configurable — not an absolute claim). */
  capabilityTier: CapabilityTier;
  /** Relative cost tier (configurable — not an absolute claim). */
  costTier: CostTier;
  /** Context-window class. */
  contextClass: ContextClass;
  /** Task classes this tier is well-suited to (e.g. "mechanical", "complex"). */
  recommendedTaskClasses: string[];
  /** ISO date the entry became effective (optional). */
  effectiveFrom?: string;
  /** ISO date the entry stopped applying (optional). */
  effectiveUntil?: string;
  /** Free-form note (never used as a hard rule). */
  notes?: string;
}

/** A versioned catalogue: bundled defaults + user overrides (overrides win). */
export interface ModelCatalogue {
  /** Schema version; bump when bundled defaults change materially. */
  version: number;
  /** Bundled default entries. */
  defaults: ModelCatalogueEntry[];
  /** User-supplied override entries (matched by id; win over defaults). */
  overrides: ModelCatalogueEntry[];
}
