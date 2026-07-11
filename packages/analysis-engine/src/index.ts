/**
 * @agentlens/analysis-engine — computes derived metrics from persisted domain
 * entities and runs the versioned rule engine (spec §13.5, §13.6, §15.1).
 *
 * This package depends on `@agentlens/domain` (neutral contracts) and
 * `@agentlens/database` (schema queries). It never depends on a source
 * adapter — it consumes only normalised, persisted rows. Dashboard, CLI and
 * reporting consume the {@link AnalyticsSnapshot} it produces.
 */

export const ANALYSIS_ENGINE_VERSION = "0.1.0";

export { computeAnalytics, type ComputeAnalyticsOptions } from "./analytics.js";
export {
  computeCostSummary,
  COST_ESTIMATE_LABEL,
  type CostRequestRow,
  type CostComputationResult,
  type RequestCost,
  type CostMethodology,
} from "./cost.js";
export {
  resolvePrice,
  estimateRequestCost,
  buildPriceRegistry,
  DEFAULT_PRICE_REGISTRY,
  PRICE_REGISTRY_VERSION,
  type ModelPrice,
  type PriceRegistry,
} from "./price-registry.js";
export {
  RuleEngine,
  createRuleEngine,
  mergeThresholds,
  fingerprintCandidate,
  type RuleOverride,
  type RuleOverrides,
} from "./rule-engine.js";
export { defaultRules, RULE_METADATA, type RuleMetadata } from "./rules/index.js";
export {
  tools001,
  tools002,
  tools003,
  tools004,
  tools005,
  tools006,
  tools007,
  tools008,
  verify001,
  verify002,
  verify003,
  verify004,
  verify005,
  verify006,
  workflow001,
  workflow002,
  workflow003,
  workflow004,
  context001,
  context002,
  context003,
  context004,
  prompt001,
  prompt002,
  prompt003,
  prompt004,
  prompt005,
  model001,
  model002,
  model003,
  security001,
  security002,
  config001,
  config002,
} from "./rules/index.js";
export {
  computeBaselines,
  computeSessionDataPoints,
  aggregateBaseline,
  compareSession,
  type ComputeBaselinesOptions,
  type BaselinesResult,
} from "./baselines.js";
export {
  DEFAULT_MODEL_CATALOGUE,
  MODEL_CATALOGUE_VERSION,
  buildModelCatalogue,
  resolveCatalogueEntry,
  capabilityTierOf,
  costTierOf,
  contextClassOf,
} from "./model-catalogue.js";
