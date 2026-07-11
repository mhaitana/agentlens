/**
 * Configurable model catalogue — bundled defaults + resolution (spec §15.4).
 *
 * The catalogue describes models in *relative* tiers (capability, cost, context
 * class) so model-selection rules can flag mismatches without ever asserting a
 * permanent "model X is always best/cheapest" claim (§15.4). Tiers are
 * configurable: callers merge user overrides over the bundled defaults, and the
 * resolver picks the longest matching identifier pattern so dated snapshots
 * resolve to their family. Models not in the catalogue resolve to `null` —
 * rules then stay silent rather than guess a tier (honest-metrics §3.4).
 *
 * The types live in `@agentlens/domain` (provider-neutral); the bundled defaults
 * (which name Claude families) and the matching behaviour live here.
 */
import type {
  CapabilityTier,
  ContextClass,
  CostTier,
  ModelCatalogue,
  ModelCatalogueEntry,
} from "@agentlens/domain";

/** Current bundled catalogue version. Bump when BUNDLED_DEFAULTS changes. */
export const MODEL_CATALOGUE_VERSION = 1;

/**
 * Bundled default entries. Tiers are RELATIVE and configurable — they encode
 * "haiku is lighter/cheaper than sonnet is lighter/cheaper than opus" within the
 * Claude family, not an absolute quality or price claim. Effective dates are
 * omitted because the family prefixes are intentionally version-agnostic (a
 * dated snapshot resolves via prefix matching).
 */
const BUNDLED_DEFAULTS: ModelCatalogueEntry[] = [
  {
    id: "claude-haiku-4-5",
    matchPatterns: ["claude-haiku-4-5", "claude-3-5-haiku", "claude-haiku"],
    provider: "anthropic",
    capabilityTier: 2,
    costTier: 1,
    contextClass: "medium",
    recommendedTaskClasses: ["mechanical", "light-edit", "quick-lookup", "formatting"],
    notes: "Lightest tier in the bundled catalogue; configurable, not an absolute claim.",
  },
  {
    id: "claude-sonnet-5",
    matchPatterns: ["claude-sonnet-5", "claude-3-5-sonnet", "claude-sonnet"],
    provider: "anthropic",
    capabilityTier: 4,
    costTier: 2,
    contextClass: "large",
    recommendedTaskClasses: ["general", "implementation", "refactor", "verification"],
    notes: "Balanced tier in the bundled catalogue; configurable, not an absolute claim.",
  },
  {
    id: "claude-opus-4-8",
    matchPatterns: ["claude-opus-4-8", "claude-opus-4", "claude-opus"],
    provider: "anthropic",
    capabilityTier: 5,
    costTier: 4,
    contextClass: "large",
    recommendedTaskClasses: ["complex", "architecture", "deep-reasoning", "planning"],
    notes: "Highest bundled capability tier; configurable, not an absolute claim.",
  },
];

/** Bundled catalogue with no user overrides. */
export const DEFAULT_MODEL_CATALOGUE: ModelCatalogue = {
  version: MODEL_CATALOGUE_VERSION,
  defaults: BUNDLED_DEFAULTS,
  overrides: [],
};

/**
 * Build a catalogue by merging user overrides onto the bundled defaults.
 * An override with an `id` that matches a default replaces that entry; an
 * override with a new `id` is appended (a user can describe a non-Claude model).
 */
export function buildModelCatalogue(overrides: ModelCatalogueEntry[] = []): ModelCatalogue {
  return {
    version: MODEL_CATALOGUE_VERSION,
    defaults: BUNDLED_DEFAULTS,
    overrides,
  };
}

/**
 * Resolve a recorded model id to a catalogue entry, or `null` when unknown.
 *
 * Resolution order: exact override id → exact default id → longest pattern match
 * across overrides then defaults (so `claude-sonnet-5-20251001` → the sonnet
 * entry). An unknown model yields `null` — callers must treat the tier as
 * "unknown" and never guess (§3.4).
 */
export function resolveCatalogueEntry(
  modelId: string | null | undefined,
  catalogue: ModelCatalogue = DEFAULT_MODEL_CATALOGUE,
): ModelCatalogueEntry | null {
  if (!modelId) return null;
  const exactOverride = catalogue.overrides.find((e) => e.id === modelId);
  if (exactOverride) return exactOverride;
  const exactDefault = catalogue.defaults.find((e) => e.id === modelId);
  if (exactDefault) return exactDefault;

  let best: ModelCatalogueEntry | null = null;
  let bestLen = 0;
  for (const entry of [...catalogue.overrides, ...catalogue.defaults]) {
    for (const pattern of entry.matchPatterns) {
      if (modelId.startsWith(pattern) && pattern.length > bestLen) {
        best = entry;
        bestLen = pattern.length;
      }
    }
  }
  return best;
}

/** Relative capability tier for a model id (null when unknown). */
export function capabilityTierOf(
  modelId: string | null | undefined,
  catalogue: ModelCatalogue = DEFAULT_MODEL_CATALOGUE,
): CapabilityTier | null {
  return resolveCatalogueEntry(modelId, catalogue)?.capabilityTier ?? null;
}

/** Relative cost tier for a model id (null when unknown). */
export function costTierOf(
  modelId: string | null | undefined,
  catalogue: ModelCatalogue = DEFAULT_MODEL_CATALOGUE,
): CostTier | null {
  return resolveCatalogueEntry(modelId, catalogue)?.costTier ?? null;
}

/** Context class for a model id (null when unknown). */
export function contextClassOf(
  modelId: string | null | undefined,
  catalogue: ModelCatalogue = DEFAULT_MODEL_CATALOGUE,
): ContextClass | null {
  return resolveCatalogueEntry(modelId, catalogue)?.contextClass ?? null;
}
