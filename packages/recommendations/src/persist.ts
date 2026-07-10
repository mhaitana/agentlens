/**
 * Recommendation persistence with dedup + supersession (spec §15.1).
 *
 * Per candidate (already deduped by fingerprint within the run by the rule
 * engine), the persistence contract is:
 *
 * - **Same fingerprint already persisted** → no new row. If it is `active`, its
 *   `updatedAt` is touched (still relevant). If it is `dismissed`/`resolved`/
 *   `superseded`, it is left untouched — the user's disposition stands and a
 *   resolved recommendation does **not** reappear on the same evidence.
 * - **New fingerprint for the same (ruleId, scope)** → any existing `active`
 *   recommendation with a different fingerprint is marked `superseded` (new
 *   evidence replaced the old finding), and the new candidate is inserted as
 *   `active`. A previously dismissed/resolved recommendation reappears only
 *   here, because the evidence (fingerprint) changed.
 *
 * Determinism: recommendation ids are `rec:<fingerprint>`, so a re-run with the
 * same data produces the same rows — no duplicates, no churn.
 */
import { type DrizzleDb } from "@agentlens/database";
import type { Recommendation, RecommendationCandidate } from "@agentlens/domain";
import {
  RecommendationRepo,
  recommendationId,
  rowToRecommendation,
  type RecommendationRow,
} from "./repo.js";

export interface PersistOutcome {
  /** Per-candidate result. */
  results: PersistCandidateResult[];
  /** Count of brand-new active recommendations inserted. */
  inserted: number;
  /** Count of prior active recommendations superseded by new evidence. */
  superseded: number;
  /** Count of candidates matching an already-active recommendation (touched). */
  unchanged: number;
  /** Count of candidates matching a dismissed/resolved/superseded rec (left as-is). */
  retainedPriorStatus: number;
}

export interface PersistCandidateResult {
  candidate: RecommendationCandidate;
  /** The recommendation row as it stands after persistence (may be active/dismissed/…). */
  recommendation: RecommendationRow;
  /** Whether this candidate produced a brand-new active row this run. */
  isNew: boolean;
}

/**
 * Persist candidates with dedup + supersession. Returns per-candidate outcomes
 * so the caller can rank + return the active ones.
 */
export async function persistCandidates(
  db: DrizzleDb,
  candidates: RecommendationCandidate[],
  now: string,
): Promise<PersistOutcome> {
  const repo = new RecommendationRepo(db);
  const results: PersistCandidateResult[] = [];
  let inserted = 0;
  let superseded = 0;
  let unchanged = 0;
  let retainedPriorStatus = 0;

  for (const candidate of candidates) {
    const id = recommendationId(candidate.fingerprint);
    const existing = await repo.getById(id);

    if (existing) {
      // Same fingerprint already persisted — same evidence, no new finding.
      if (existing.status === "active") {
        await repo.touch(id, now);
        unchanged += 1;
      } else {
        // dismissed / resolved / superseded: keep the user's disposition. Do NOT
        // re-activate (reappear only on NEW evidence, i.e. a different fingerprint).
        retainedPriorStatus += 1;
      }
      results.push({ candidate, recommendation: existing, isNew: false });
      continue;
    }

    // New fingerprint → new evidence. Supersede prior active recs for this scope.
    const priorActive = await repo.findActiveForScope(candidate.ruleId, candidate.scope);
    for (const prior of priorActive) {
      if (prior.id === id) continue;
      await repo.markSuperseded(prior.id, now);
      superseded += 1;
    }

    const row = await repo.insertActive(candidate, now);
    inserted += 1;
    results.push({ candidate, recommendation: row, isNew: true });
  }

  return { results, inserted, superseded, unchanged, retainedPriorStatus };
}

/** Convenience: persist candidates and return the *active* recommendations as
 *  neutral domain objects (dismissed/resolved/superseded matches are excluded
 *  so the report never re-surfaces advice the user already disposed of). */
export async function persistAndCollectActive(
  db: DrizzleDb,
  candidates: RecommendationCandidate[],
  now: string,
): Promise<{ recommendations: Recommendation[]; outcome: PersistOutcome }> {
  const outcome = await persistCandidates(db, candidates, now);
  const recommendations = outcome.results
    .filter((r) => r.recommendation.status === "active")
    .map((r) => rowToRecommendation(r.recommendation));
  return { recommendations, outcome };
}
