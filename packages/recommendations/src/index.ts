/**
 * @agentlens/recommendations — recommendation persistence, dedup, supersession
 * and ranking (spec §10.11, §15.1, §15.2).
 *
 * The rule engine (in @agentlens/analysis-engine) emits deterministic
 * {@link RecommendationCandidate}s; this package persists them into the
 * `recommendations` table (deduped by fingerprint, with cross-run supersession
 * and "reappear only on new evidence"), and ranks the active set by the §15.2
 * factors.
 */
export const RECOMMENDATIONS_VERSION = "0.1.0";

export {
  RecommendationRepo,
  recommendationId,
  scopeKey,
  rowToRecommendation,
  type RecommendationRow,
} from "./repo.js";

export {
  persistCandidates,
  persistAndCollectActive,
  type PersistOutcome,
  type PersistCandidateResult,
} from "./persist.js";

export { rankRecommendations, scoreRecommendation, type RankOptions } from "./ranking.js";

export { generateRecommendations, type GenerateOptions, type GenerateResult } from "./generate.js";
