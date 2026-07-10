/**
 * Recommendation generation pipeline (spec §15.1, §15.2).
 *
 * Takes rule-engine candidates, persists them (dedup + supersession), and
 * returns the active recommendations ranked by §15.2 factors. Reproducible:
 * deterministic ids + fingerprints mean a re-run with identical evidence yields
 * identical rows and ordering.
 */
import { type DrizzleDb } from "@agentlens/database";
import type { Confidence, Recommendation, RecommendationCandidate } from "@agentlens/domain";
import { persistAndCollectActive, type PersistOutcome } from "./persist.js";
import { rankRecommendations, type RankOptions } from "./ranking.js";

export interface GenerateOptions extends RankOptions {
  /** Confidence floor; candidates below this are dropped before persistence. */
  minimumConfidence?: Confidence;
  /** ISO timestamp for createdAt/updatedAt (deterministic per run when passed). */
  now?: string;
}

export interface GenerateResult {
  recommendations: Recommendation[];
  outcome: PersistOutcome;
}

/**
 * Persist candidates and return ranked active recommendations. Candidates below
 * `minimumConfidence` are dropped (mirrors the rule engine's own floor).
 */
export async function generateRecommendations(
  db: DrizzleDb,
  candidates: RecommendationCandidate[],
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const now = opts.now ?? new Date().toISOString();
  const floor = opts.minimumConfidence ?? 0;
  const eligible = candidates.filter((c) => (c.confidence as number) >= floor);
  const { recommendations, outcome } = await persistAndCollectActive(db, eligible, now);
  const ranked = rankRecommendations(recommendations, { ...opts, now });
  return { recommendations: ranked, outcome };
}
