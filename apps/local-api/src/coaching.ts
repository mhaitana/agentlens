/**
 * Coaching aggregator (spec §15.12 coaching-dashboard views).
 *
 * Orchestrates the already-deterministic building blocks — the analysis engine,
 * the persisted recommendations, the prompt-coach structural layer, and the
 * configurable model catalogue — into the shapes the coaching dashboard
 * consumes. Everything here is derived from normalised, already-redacted
 * persisted rows (§3.6): no raw Claude transcript shapes, no external model
 * (§15.5 "Prompt Coach works without an external model"; external semantic
 * analysis stays disabled by default and is never invoked here).
 *
 * Provenance is labelled honestly (§3.4): prompt-quality scores are
 * `heuristic`, token/cost avoidable-usage figures are `estimated`, and cost is
 * never presented as official billing data (§3.4 "label cost Estimated").
 */
import { desc, asc, eq, sql, and } from "@agentlens/database";
import type { DrizzleDb } from "@agentlens/database";
import { schema } from "@agentlens/database";
import type { AgentLensConfig } from "@agentlens/config";
import {
  computeAnalytics,
  defaultRules,
  computeBaselines,
  buildModelCatalogue,
  type RuleOverrides,
} from "@agentlens/analysis-engine";
import {
  assessPrompt,
  suggestImprovedStructure,
  comparePrompt,
  detectRepeatedTemplates,
  type PromptTemplateInput,
} from "@agentlens/prompt-coach";
import type {
  ModelCatalogueEntry,
  PromptFeatures,
  PromptOutcomeEvidence,
  RepeatedTemplate,
} from "@agentlens/domain";
import { buildConfigurationSummary } from "@agentlens/config";
import { contentPermitted } from "./privacy.js";
import type { ServerDeps } from "./deps.js";

const COST_ESTIMATE_LABEL = "Estimated — not an official billing value";

/* -------------------------------------------------------------------------- */
/* Overview (§15.12 coaching overview)                                        */
/* -------------------------------------------------------------------------- */

export interface CoachingTopOpportunity {
  id: string;
  ruleId: string;
  title: string;
  summary: string;
  category: string;
  severity: string;
  confidence: number;
  evidenceCount: number;
  sessionId: string | null;
  projectId: string | null;
}

export interface CoachingTrendPoint {
  date: string;
  count: number;
}

export interface CoachingTrends {
  /** Verification rate over the window (sessions ending after a green check). */
  verificationRate: number | null;
  verificationProvenance: string;
  /** Mean deterministic prompt-quality score across recent prompts [0,1]. */
  promptQualityScore: number | null;
  promptQualityProvenance: string;
  /** Count of model-allocation recommendations (model-* rules) currently active. */
  modelAllocationFindings: number;
  /** Active recommendation counts per category. */
  recommendationsByCategory: Array<{ category: string; count: number }>;
}

export interface CoachingAvoidableUsage {
  /** Sum of recommendation estimated-impact token minima (estimated). */
  estimatedTokens: number | null;
  /** Sum of recommendation estimated-impact cost minima, USD (estimated). */
  estimatedCostUsd: number | null;
  methodology: string;
  costLabel: string;
}

export interface CoachingOverview {
  generatedAt: string;
  topOpportunities: CoachingTopOpportunity[];
  improvementsOverTime: CoachingTrendPoint[];
  repeatedBehaviours: RepeatedTemplate[];
  estimatedAvoidableUsage: CoachingAvoidableUsage;
  trends: CoachingTrends;
  /** The resolved, configurable model catalogue (defaults + user overrides). */
  modelCatalogue: { version: number; entries: ModelCatalogueEntry[] };
}

/** Sum the minimum side of every recommendation's estimated-impact ranges. */
function sumAvoidableUsage(recs: Array<{ estimatedImpact: unknown }>): {
  tokens: number | null;
  cost: number | null;
} {
  let tokens = 0;
  let cost = 0;
  let any = false;
  for (const r of recs) {
    const impact = r.estimatedImpact as {
      tokenRange?: { minimum: number; maximum: number };
      costUsdRange?: { minimum: number; maximum: number };
    } | null;
    if (!impact) continue;
    if (impact.tokenRange) {
      tokens += impact.tokenRange.minimum;
      any = true;
    }
    if (impact.costUsdRange) {
      cost += impact.costUsdRange.minimum;
      any = true;
    }
  }
  return { tokens: any ? tokens : null, cost: any ? cost : null };
}

/** Bucket active recommendations by createdAt day for the last `days` days. */
function improvementsOverTime(
  recs: Array<{ createdAt: string; status: string }>,
  days: number,
  nowIso: string,
): CoachingTrendPoint[] {
  const end = new Date(nowIso).getTime();
  const start = end - days * 86_400_000;
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start + i * 86_400_000);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of recs) {
    const day = r.createdAt.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

/** Compute the coaching overview from persisted data + the analytics snapshot. */
export async function computeCoachingOverview(
  db: DrizzleDb,
  config: AgentLensConfig,
  deps: ServerDeps,
): Promise<CoachingOverview> {
  const nowIso = (deps.now ?? new Date()).toISOString();

  // Trends from the analytics snapshot (window = last week). computeAnalytics
  // also persists recommendations (dedup + supersession) as a side effect, so run
  // it BEFORE reading the active set — otherwise a fresh DB (no prior /metrics)
  // would show zero top opportunities on the first coaching view.
  const snap = await computeAnalytics(
    db,
    { period: "week" },
    {
      minimumRecommendationConfidence: config.analysis.minimumRecommendationConfidence,
      privacyMode: config.privacy.mode,
      rules: defaultRules(),
      ruleOverrides: config.analysis.ruleOverrides as RuleOverrides,
      configurationSummary: buildConfigurationSummary(config),
      now: deps.now,
    },
  );

  // Active recommendations, newest first (now reflecting anything the analytics
  // pass just persisted).
  const recs = await db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.status, "active"))
    .orderBy(desc(schema.recommendations.createdAt));

  const topOpportunities: CoachingTopOpportunity[] = recs
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      title: r.title,
      summary: r.summary,
      category: r.category,
      severity: r.severity,
      confidence: r.confidence,
      evidenceCount: Array.isArray(r.evidence) ? (r.evidence as unknown[]).length : 0,
      sessionId: r.sessionId,
      projectId: r.projectId,
    }));

  const improvements = improvementsOverTime(
    recs.map((r) => ({ createdAt: r.createdAt, status: r.status })),
    14,
    nowIso,
  );

  // Repeated prompt templates across recent prompts (§15.5). Deterministic.
  const recentPrompts = await db
    .select({
      id: schema.prompts.id,
      sessionId: schema.prompts.sessionId,
      sequence: schema.prompts.sequence,
      content: schema.prompts.redactedContent,
    })
    .from(schema.prompts)
    .orderBy(desc(schema.prompts.timestamp))
    .limit(500);
  const repeatedBehaviours = detectRepeatedTemplates(
    recentPrompts.map((p) => ({
      content: contentPermitted(config.privacy.mode) ? (p.content ?? undefined) : undefined,
      sessionId: p.sessionId,
    })) as PromptTemplateInput[],
  ).slice(0, 8);

  const avoidable = sumAvoidableUsage(recs);
  const estimatedAvoidableUsage: CoachingAvoidableUsage = {
    estimatedTokens: avoidable.tokens,
    estimatedCostUsd: avoidable.cost,
    methodology: "Sum of the minimum side of each active recommendation's estimated-impact range.",
    costLabel: COST_ESTIMATE_LABEL,
  };

  const totalSessions = snap.usage.totalSessions.value;
  const verificationRate =
    typeof totalSessions === "number" && totalSessions > 0
      ? snap.workflow.sessionsEndingAfterSuccessfulVerification.value / totalSessions
      : null;

  // Mean prompt-quality score across the recent prompts (heuristic).
  let qualitySum = 0;
  let qualityN = 0;
  for (const p of recentPrompts.slice(0, 100)) {
    if (!p.content) continue;
    qualitySum += assessPrompt(p.content, p.sequence).overallScore;
    qualityN += 1;
  }
  const promptQualityScore = qualityN > 0 ? qualitySum / qualityN : null;

  const byCategory = new Map<string, number>();
  for (const r of recs) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  const modelAllocationFindings = recs.filter((r) => r.ruleId.startsWith("model-")).length;

  const trends: CoachingTrends = {
    verificationRate,
    verificationProvenance: snap.workflow.sessionsEndingAfterSuccessfulVerification.provenance,
    promptQualityScore,
    promptQualityProvenance: "heuristic",
    modelAllocationFindings,
    recommendationsByCategory: Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };

  // Resolved configurable catalogue (defaults + user overrides). No hardcoded
  // permanent model claims — only relative tiers (§15.4).
  const catalogue = buildModelCatalogue(
    (config.analysis.modelCatalogue ?? []) as ModelCatalogueEntry[],
  );

  return {
    generatedAt: nowIso,
    topOpportunities,
    improvementsOverTime: improvements,
    repeatedBehaviours,
    estimatedAvoidableUsage,
    trends,
    modelCatalogue: {
      version: catalogue.version,
      entries: [...catalogue.defaults, ...catalogue.overrides],
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Prompt Coach — list + detail (§15.12 Prompt Coach)                         */
/* -------------------------------------------------------------------------- */

export interface CoachingPromptListItem {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  /** Null when the active privacy mode strips content. */
  redactedContent: string | null;
  approximateTokenCount: number | null;
  overallScore: number;
  /** The five deterministic dimension scores, keyed by dimension. */
  dimensions: Array<{ key: string; label: string; score: number }>;
  qualityProvenance: "heuristic";
}

/** Recent prompts across sessions with deterministic quality scores. */
export async function listCoachingPrompts(
  db: DrizzleDb,
  mode: string,
  page: number,
  limit: number,
): Promise<{ items: CoachingPromptListItem[]; total: number }> {
  const totalRows = await db.select({ c: sql<number>`count(*)` }).from(schema.prompts);
  const total = Number(totalRows[0]?.c ?? 0);

  const offset = (page - 1) * limit;
  const rows = await db
    .select()
    .from(schema.prompts)
    .orderBy(desc(schema.prompts.timestamp))
    .limit(limit)
    .offset(offset);

  const showContent = contentPermitted(mode);
  const items: CoachingPromptListItem[] = rows.map((r) => {
    const content = showContent ? r.redactedContent : null;
    const assessment = content ? assessPrompt(content, r.sequence) : null;
    return {
      id: r.id,
      sessionId: r.sessionId,
      sequence: r.sequence,
      timestamp: r.timestamp,
      redactedContent: content,
      approximateTokenCount: r.approximateTokenCount,
      overallScore: assessment ? assessment.overallScore : 0,
      dimensions: assessment
        ? assessment.dimensions.map((d) => ({ key: d.key, label: d.label, score: d.score }))
        : [],
      qualityProvenance: "heuristic",
    };
  });
  return { items, total };
}

export interface CoachingPromptDetail {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  redactedContent: string | null;
  /** Deterministic quality assessment (§15.5). */
  assessment: {
    overallScore: number;
    strengths: string[];
    ambiguities: string[];
    missingComponents: string[];
    dimensions: Array<{ key: string; label: string; score: number; rationale: string }>;
    provenance: "heuristic";
  } | null;
  /** Suggested improved structure (§15.5) — not a guarantee of better results. */
  suggestion: {
    suggestedPrompt: string;
    changes: Array<{ kind: string; description: string; component?: string }>;
    missingComponents: string[];
    provenance: "heuristic";
  } | null;
  /** §15.6 prompt comparison: outcome correlation + improved prompt. */
  comparison: {
    strengths: string[];
    ambiguities: string[];
    missingConstraints: string[];
    observedOutcome: string[];
    suggestedImprovedPrompt: string;
    changeExplanations: Array<{ kind: string; description: string; component?: string }>;
    disclaimer: string;
    provenance: "heuristic";
  } | null;
  /** Recurring templates that include this prompt (§15.5). */
  recurringTemplates: RepeatedTemplate[];
  /** Personal baseline comparison for the owning session (§15.12). */
  baselineComparison: {
    sessionDurationMs: number | null;
    personalMedianDurationMs: number | null;
    relativeDuration: string | null;
    provenance: string;
  } | null;
}

/** Build the §15.6 outcome evidence for a prompt from later session events. */
async function buildOutcomeEvidence(
  db: DrizzleDb,
  sessionId: string,
  sequence: number,
): Promise<PromptOutcomeEvidence> {
  const laterPrompts = await db
    .select()
    .from(schema.prompts)
    .where(and(eq(schema.prompts.sessionId, sessionId)))
    .orderBy(asc(schema.prompts.sequence));
  let correctivePromptsAfter = 0;
  let reversalsAfter = 0;
  for (const p of laterPrompts) {
    if (p.sequence <= sequence) continue;
    const f = p.features as PromptFeatures;
    if (f?.appearsCorrective) correctivePromptsAfter += 1;
    if (f?.appearsReversal) reversalsAfter += 1;
  }
  const fileRows = await db
    .select({ id: schema.fileActivity.id })
    .from(schema.fileActivity)
    .where(eq(schema.fileActivity.sessionId, sessionId));
  const verRows = await db
    .select({ id: schema.verificationRuns.id })
    .from(schema.verificationRuns)
    .where(eq(schema.verificationRuns.sessionId, sessionId));
  const observedOutcome: string[] = [];
  if (correctivePromptsAfter > 0)
    observedOutcome.push(`${correctivePromptsAfter} corrective prompt(s) followed.`);
  if (reversalsAfter > 0) observedOutcome.push(`${reversalsAfter} reversal(s) followed.`);
  if (verRows.length > 0) observedOutcome.push("A verification run occurred in the session.");
  if (observedOutcome.length === 0) observedOutcome.push("No notable downstream signals observed.");
  return {
    correctivePromptsAfter,
    reversalsAfter,
    filesInspected: fileRows.length,
    verificationRan: verRows.length > 0,
    observedOutcome,
  };
}

/** Compute the Prompt Coach detail view for a single prompt. */
export async function getCoachingPromptDetail(
  db: DrizzleDb,
  mode: string,
  id: string,
): Promise<CoachingPromptDetail | null> {
  const rows = await db.select().from(schema.prompts).where(eq(schema.prompts.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const showContent = contentPermitted(mode);
  const content = showContent ? row.redactedContent : null;

  let assessment: CoachingPromptDetail["assessment"] = null;
  let suggestion: CoachingPromptDetail["suggestion"] = null;
  let comparison: CoachingPromptDetail["comparison"] = null;
  if (content) {
    const a = assessPrompt(content, row.sequence);
    assessment = {
      overallScore: a.overallScore,
      strengths: a.strengths,
      ambiguities: a.ambiguities,
      missingComponents: a.missingComponents,
      dimensions: a.dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        score: d.score,
        rationale: d.rationale,
      })),
      provenance: "heuristic",
    };
    const s = suggestImprovedStructure(content, row.sequence);
    suggestion = {
      suggestedPrompt: s.suggestedPrompt,
      changes: s.changes.map((c) => ({
        kind: c.kind,
        description: c.description,
        component: c.component,
      })),
      missingComponents: s.missingComponents,
      provenance: "heuristic",
    };
    const outcome = await buildOutcomeEvidence(db, row.sessionId, row.sequence);
    const cmp = comparePrompt(content, row.sequence, outcome);
    comparison = {
      strengths: cmp.strengths,
      ambiguities: cmp.ambiguities,
      missingConstraints: cmp.missingConstraints,
      observedOutcome: cmp.observedOutcome,
      suggestedImprovedPrompt: cmp.suggestedImprovedPrompt,
      changeExplanations: cmp.changeExplanations.map((c) => ({
        kind: c.kind,
        description: c.description,
        component: c.component,
      })),
      disclaimer: cmp.disclaimer,
      provenance: "heuristic",
    };
  }

  // Recurring templates that include this prompt.
  const sessionPrompts = await db
    .select({ content: schema.prompts.redactedContent, sessionId: schema.prompts.sessionId })
    .from(schema.prompts)
    .where(eq(schema.prompts.sessionId, row.sessionId))
    .orderBy(asc(schema.prompts.sequence));
  const templates = detectRepeatedTemplates(
    sessionPrompts.map((p) => ({
      content: showContent ? (p.content ?? undefined) : undefined,
      sessionId: p.sessionId,
    })) as PromptTemplateInput[],
  );
  const prefix = content ? content.slice(0, 60) : "";
  const recurringTemplates = prefix
    ? templates.filter((t) => t.examplePrefix.slice(0, 20) === prefix.slice(0, 20)).slice(0, 5)
    : [];

  // Baseline comparison: this session's duration vs the personal median.
  const sessionRows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, row.sessionId))
    .limit(1);
  const session = sessionRows[0];
  let baselineComparison: CoachingPromptDetail["baselineComparison"] = null;
  if (session) {
    const baselines = await computeBaselines(db, {});
    const durations = baselines.dataPoints
      .map((p) => p.sessionDurationMs)
      .filter((d): d is number => typeof d === "number" && d > 0)
      .sort((a, b) => a - b);
    const personalMedian =
      durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null;
    const rel =
      personalMedian && personalMedian > 0 && session.durationMs
        ? session.durationMs / personalMedian
        : null;
    baselineComparison = {
      sessionDurationMs: session.durationMs,
      personalMedianDurationMs: personalMedian ?? null,
      relativeDuration: rel !== null ? `${rel.toFixed(2)}× personal median` : null,
      provenance: "heuristic",
    };
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    timestamp: row.timestamp,
    redactedContent: content,
    assessment,
    suggestion,
    comparison,
    recurringTemplates,
    baselineComparison,
  };
}
