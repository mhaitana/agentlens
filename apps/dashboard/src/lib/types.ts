/**
 * API response view types (spec). The dashboard consumes *only* these
 * normalised shapes — never raw Claude transcript shapes. These mirror
 * the JSON the local API serialises, so dates are ISO strings (not `Date`),
 * matching the read-side privacy views in `apps/local-api/src/privacy.ts`.
 *
 * Snapshot/recommendation types are derived from `@agentlens/domain` so display
 * helpers stay in sync, with `Date` fields widened to `string` for JSON.
 */
import type {
  AnalyticsSnapshot as DomainSnapshot,
  Recommendation as DomainRecommendation,
} from "@agentlens/domain";

/** A paginated list envelope (spec"paginate large collections"). */
export interface PageEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** A recommendation as serialised over JSON (dates are ISO strings). */
export type JsonRecommendation = Omit<DomainRecommendation, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/** The analytics snapshot as serialised over JSON. */
export type AnalyticsSnapshot = Omit<DomainSnapshot, "recommendations"> & {
  recommendations: JsonRecommendation[];
};

/** GET /api/v1/status */
export interface StatusResponse {
  home: string;
  configPath: string;
  dbPath: string;
  privacyMode: PrivacyMode;
  sessions: number;
  projects: number;
  recommendations: number;
}

export type PrivacyMode = "metadata-only" | "redacted-content" | "full-local";

/** GET /api/v1/onboarding */
export interface OnboardingResponse {
  initialized: boolean;
  hasData: boolean;
  privacyMode: PrivacyMode;
  sources: Array<{
    id: string;
    adapter: string;
    displayName: string;
    enabled: boolean;
  }>;
  projectsCount: number;
  sessionsCount: number;
  exclusions: string[];
  whatAgentLensReads: string[];
  whereDataRemains: string;
}

/** GET /api/v1/sessions item (SessionListRow from queries.ts). */
export interface SessionListItem {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  completionStatus: string;
  privacyMode: string;
  promptCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;
  entryPoint: string;
}

/** GET /api/v1/sessions/:id */
export interface SessionDetailResponse {
  session: Record<string, unknown>;
  project: ProjectItem | null;
}

/** A merged timeline event for the session-detail screen. */
export interface TimelineEvent {
  timestamp: string;
  kind: string;
  sequence: number;
  data: Record<string, unknown>;
}

/** GET /api/v1/projects item (ProjectListRow from queries.ts). */
export interface ProjectItem {
  id: string;
  displayName: string;
  redactedPath: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sessionCount: number;
}

/** GET /api/v1/recommendations item — a stored recommendation row. */
export type RecommendationRow = {
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
  evidence: unknown;
  estimatedImpact: unknown | null;
  remediation: unknown | null;
  createdAt: string;
  updatedAt: string;
};

/** GET /api/v1/rules item. */
export interface RuleInfo {
  id: string;
  title: string;
  category: string;
  severity: string;
  description: string;
  enabled: boolean;
  version: number;
  defaultThresholds?: Record<string, unknown>;
}

/** GET /api/v1/privacy */
export interface PrivacyInfo {
  mode: PrivacyMode;
  retentionDays: number | null;
  redactEmails: boolean;
  redactHomePath: boolean;
  customPatterns: unknown[];
  excludedProjects: string[];
  dataLocation: string;
  storedDataCategories: string[];
}

/** GET /api/v1/settings */
export interface SettingsResponse {
  privacy: {
    mode: PrivacyMode;
    retentionDays: number | null;
    redactEmails: boolean;
    redactHomePath: boolean;
    customPatterns: unknown[];
    storeAssistantResponses?: boolean;
  };
  sources: {
    claudeCode: {
      excludedProjects?: string[];
      transcriptDir?: string;
      enabled?: boolean;
    };
  };
  analysis: {
    minimumRecommendationConfidence: number;
    ruleOverrides?: Record<string, unknown>;
  };
  dashboard: {
    host: string;
    port: number;
    openBrowser: boolean;
  };
}

/** GET /api/v1/live — live collector status snapshot (spec). */
export interface LiveStatus {
  status: string;
  streaming: boolean;
  collector: { running: boolean; port?: number };
  otel: { running: boolean; port?: number; events: number };
  hooks: { events: number };
  spool: { backlog: number };
  time: string;
}

/** A single event delivered over the /api/v1/live/stream SSE channel. */
export interface LiveEvent {
  type: "hook" | "otel" | "status" | "heartbeat";
  time: string;
  data: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Coaching (Phase 3,)                                                 */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/coaching/overview — top opportunities, trends, avoidable usage. */
export interface CoachingOverview {
  generatedAt: string;
  topOpportunities: Array<{
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
  }>;
  improvementsOverTime: Array<{ date: string; count: number }>;
  repeatedBehaviours: Array<{
    templateKey: string;
    occurrences: number;
    sessions: number;
    examplePrefix: string;
  }>;
  estimatedAvoidableUsage: {
    estimatedTokens: number | null;
    estimatedCostUsd: number | null;
    methodology: string;
    costLabel: string;
  };
  trends: {
    verificationRate: number | null;
    verificationProvenance: string;
    promptQualityScore: number | null;
    promptQualityProvenance: string;
    modelAllocationFindings: number;
    recommendationsByCategory: Array<{ category: string; count: number }>;
  };
  modelCatalogue: {
    version: number;
    entries: Array<{
      id: string;
      matchPatterns: string[];
      provider: string;
      capabilityTier: number;
      costTier: number;
      contextClass: string;
      recommendedTaskClasses: string[];
    }>;
  };
}

/** GET /api/v1/coaching/prompts item. */
export interface CoachingPromptListItem {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  redactedContent: string | null;
  approximateTokenCount: number | null;
  overallScore: number;
  dimensions: Array<{ key: string; label: string; score: number }>;
  qualityProvenance: "heuristic";
}

/** GET /api/v1/coaching/prompts/:id — Prompt Coach detail. */
export interface CoachingPromptDetail {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  redactedContent: string | null;
  assessment: {
    overallScore: number;
    strengths: string[];
    ambiguities: string[];
    missingComponents: string[];
    dimensions: Array<{ key: string; label: string; score: number; rationale: string }>;
    provenance: "heuristic";
  } | null;
  suggestion: {
    suggestedPrompt: string;
    changes: Array<{ kind: string; description: string; component?: string }>;
    missingComponents: string[];
    provenance: "heuristic";
  } | null;
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
  recurringTemplates: Array<{
    templateKey: string;
    occurrences: number;
    sessions: number;
    examplePrefix: string;
  }>;
  baselineComparison: {
    sessionDurationMs: number | null;
    personalMedianDurationMs: number | null;
    relativeDuration: string | null;
    provenance: string;
  } | null;
}

/* -------------------------------------------------------------------------- */
/* Configuration Doctor (Phase 3,)                                     */
/* -------------------------------------------------------------------------- */

/** A proposed doctor patch (subset the dashboard renders). */
export interface DoctorPatch {
  id: string;
  kind: string;
  targetFile?: string;
  summary: string;
  impact: string;
  diff: string;
  automaticallyApplicable: false;
  validation: {
    parses: boolean;
    noBypassPermissions: boolean;
    noExternalTransmission: boolean;
    unrelatedPreserved: boolean;
    notes: string[];
  };
  refused: boolean;
  refusalReason?: string;
  addresses: string[];
}

/** GET /api/v1/doctor response. */
export interface DoctorResponse {
  report: {
    scope: { kind: string; projectPath?: string };
    generatedAt: string;
    findings: Array<{
      id: string;
      family: string;
      scope: string;
      severity: string;
      title: string;
      detail: string;
      fixability: string;
      patchId?: string;
    }>;
    patches: DoctorPatch[];
    skillDrafts: Array<{ id: string; name: string }>;
    hookDrafts: Array<{ id: string }>;
    summary: {
      total: number;
      critical: number;
      warning: number;
      info: number;
      patches: number;
      refusedPatches: number;
    };
    diagnostics: Array<{ path: string; message: string }>;
  };
  appliedPatchIds: string[];
}

/** POST /api/v1/doctor/apply response. */
export interface DoctorApplyResponse {
  applied: Array<{
    patchId: string;
    applied: boolean;
    backupPath?: string;
    targetFile?: string;
    validation: DoctorPatch["validation"];
    rollbackHint: string;
  }>;
  draftsWritten: { skills: string[]; hooks: string[] };
  appliedPatchIds: string[];
}

/** POST /api/v1/doctor/rollback response. */
export interface DoctorRollbackResponse {
  result: {
    patchId: string;
    restored: boolean;
    backupPath: string;
    targetFile?: string;
    validation: DoctorPatch["validation"];
  };
  appliedPatchIds: string[];
}
