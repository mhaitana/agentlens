/**
 * Recommendation repository (spec §10.11, §15.1).
 *
 * Persists {@link RecommendationCandidate}s produced by the rule engine into
 * the `recommendations` table with deterministic ids derived from the finding
 * fingerprint, so a re-run is idempotent and supersession is detectable.
 *
 * Dedup / supersession / "reappear only on new evidence" logic lives in
 * {@link ./persist.js}; this repo is thin DB access only.
 */
import { and, eq, isNull, schema, type DrizzleDb } from "@agentlens/database";
import type {
  Confidence,
  Recommendation,
  RecommendationCandidate,
  RecommendationEvidence,
  Remediation,
  EstimatedImpact,
  RecommendationStatus,
  Severity,
  RecommendationCategory,
} from "@agentlens/domain";

type Db = DrizzleDb;

/** Row shape for the recommendations table (mirrors schema.ts). */
export interface RecommendationRow {
  id: string;
  ruleId: string;
  ruleVersion: number;
  sessionId: string | null;
  projectId: string | null;
  category: string;
  severity: string;
  confidence: number;
  status: string;
  title: string;
  summary: string;
  explanation: string;
  evidence: RecommendationEvidence[];
  estimatedImpact: EstimatedImpact | null;
  remediation: Remediation | null;
  createdAt: string;
  updatedAt: string;
}

/** Deterministic recommendation id from a candidate's fingerprint. */
export function recommendationId(fingerprint: string): string {
  return `rec:${fingerprint}`;
}

/** A scope key (ruleId + scope) used to find prior recommendations to supersede. */
export function scopeKey(
  ruleId: string,
  scope: { sessionId?: string; projectId?: string },
): string {
  return `${ruleId}|${scope.sessionId ?? ""}|${scope.projectId ?? ""}`;
}

export class RecommendationRepo {
  constructor(private readonly db: Db) {}

  /** Fetch a recommendation by its deterministic id, or undefined. */
  async getById(id: string): Promise<RecommendationRow | undefined> {
    const rows = await this.db
      .select()
      .from(schema.recommendations)
      .where(eq(schema.recommendations.id, id))
      .limit(1);
    const r = rows[0];
    return r ? toRow(r) : undefined;
  }

  /**
   * Find active recommendations for the same (ruleId, scope) — candidates for
   * supersession when a new fingerprint arrives. Null-safe scope matching.
   */
  async findActiveForScope(
    ruleId: string,
    scope: { sessionId?: string; projectId?: string },
  ): Promise<RecommendationRow[]> {
    const conditions = [
      eq(schema.recommendations.ruleId, ruleId),
      eq(schema.recommendations.status, "active"),
    ];
    if (scope.sessionId) conditions.push(eq(schema.recommendations.sessionId, scope.sessionId));
    else conditions.push(isNull(schema.recommendations.sessionId));
    if (scope.projectId) conditions.push(eq(schema.recommendations.projectId, scope.projectId));
    else conditions.push(isNull(schema.recommendations.projectId));
    const rows = await this.db
      .select()
      .from(schema.recommendations)
      .where(and(...conditions));
    return rows.map(toRow);
  }

  /** Insert a new active recommendation from a candidate. Idempotent on id. */
  async insertActive(candidate: RecommendationCandidate, now: string): Promise<RecommendationRow> {
    const id = recommendationId(candidate.fingerprint);
    const row: RecommendationRow = {
      id,
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
      sessionId: candidate.scope.sessionId ?? null,
      projectId: candidate.scope.projectId ?? null,
      category: candidate.category,
      severity: candidate.severity,
      confidence: candidate.confidence,
      status: "active",
      title: candidate.title,
      summary: candidate.summary,
      explanation: candidate.explanation,
      evidence: candidate.evidence,
      estimatedImpact: candidate.estimatedImpact ?? null,
      remediation: candidate.remediation ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db
      .insert(schema.recommendations)
      .values({
        id: row.id,
        ruleId: row.ruleId,
        ruleVersion: row.ruleVersion,
        sessionId: row.sessionId,
        projectId: row.projectId,
        category: row.category,
        severity: row.severity,
        confidence: row.confidence,
        status: row.status,
        title: row.title,
        summary: row.summary,
        explanation: row.explanation,
        evidence: row.evidence,
        estimatedImpact: row.estimatedImpact,
        remediation: row.remediation,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
      .onConflictDoNothing({ target: schema.recommendations.id });
    return row;
  }

  /** Mark a recommendation superseded (new evidence replaced it). */
  async markSuperseded(id: string, now: string): Promise<void> {
    await this.db
      .update(schema.recommendations)
      .set({ status: "superseded", updatedAt: now })
      .where(eq(schema.recommendations.id, id));
  }

  /** Touch updatedAt for an already-active recommendation (still relevant). */
  async touch(id: string, now: string): Promise<void> {
    await this.db
      .update(schema.recommendations)
      .set({ updatedAt: now })
      .where(eq(schema.recommendations.id, id));
  }

  /** List all recommendations (for history / dashboard). */
  async listAll(limit = 200): Promise<RecommendationRow[]> {
    const rows = await this.db.select().from(schema.recommendations).limit(limit);
    return rows.map(toRow);
  }
}

function toRow(r: typeof schema.recommendations.$inferSelect): RecommendationRow {
  return {
    id: r.id,
    ruleId: r.ruleId,
    ruleVersion: r.ruleVersion,
    sessionId: r.sessionId,
    projectId: r.projectId,
    category: r.category,
    severity: r.severity,
    confidence: r.confidence,
    status: r.status,
    title: r.title,
    summary: r.summary,
    explanation: r.explanation,
    evidence: r.evidence as RecommendationEvidence[],
    estimatedImpact: (r.estimatedImpact as EstimatedImpact | null) ?? null,
    remediation: (r.remediation as Remediation | null) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Convert a stored row to the neutral {@link Recommendation} domain type. */
export function rowToRecommendation(r: RecommendationRow): Recommendation {
  return {
    id: r.id,
    ruleId: r.ruleId,
    ruleVersion: r.ruleVersion,
    sessionId: r.sessionId ?? undefined,
    projectId: r.projectId ?? undefined,
    category: r.category as RecommendationCategory,
    severity: r.severity as Severity,
    confidence: r.confidence as Confidence,
    status: r.status as RecommendationStatus,
    title: r.title,
    summary: r.summary,
    explanation: r.explanation,
    evidence: r.evidence,
    estimatedImpact: r.estimatedImpact ?? undefined,
    remediation: r.remediation ?? undefined,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}
