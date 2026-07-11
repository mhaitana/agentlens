/**
 * @agentlens/domain — provider-neutral domain types (spec §10).
 *
 * This package is deliberately dependency-free (no internal imports) and
 * contains no Claude-Code-specific shapes. It is the shared vocabulary every
 * adapter, analysis module and surface (CLI / API / dashboard) speaks.
 */

export type {
  MetricProvenance,
  ProvenancedValue,
  Confidence,
  ConfidenceBand,
} from "./provenance.js";
export {
  FULL_CONFIDENCE,
  ZERO_CONFIDENCE,
  confidenceBand,
  exact,
  reported,
  inferred,
  estimated,
  unknown,
} from "./provenance.js";

export type {
  DataSource,
  DiscoveredSource,
  SourceValidationResult,
  SourceCapabilities,
} from "./source.js";

export type { Project } from "./project.js";

export type {
  Session,
  SessionCompletionStatus,
  EntryPoint,
  DataCompletenessFlag,
} from "./session.js";

export type { Prompt, PromptFeatures } from "./prompt.js";

export type {
  PromptQualityDimensionKey,
  PromptMissingComponent,
  PromptQualityDimension,
  PromptQualityEvidence,
  SuggestedChange,
  SuggestedStructure,
  PromptQualityAssessment,
  PromptOutcomeEvidence,
  PromptComparison,
  RepeatedTemplate,
  CoachingGenerationSource,
  RedactedPromptPayload,
  CoachingCallOptions,
  RedactedPromptAnalysisInput,
  SemanticPromptAnalysis,
  RedactedTaskClassificationInput,
  TaskClassification,
  RedactedRemediationInput,
  GeneratedRemediation,
  CoachingProvider,
  CoachingDataCategory,
  CoachingRequestDisclosure,
  CoachingGatewayStatus,
  CoachingGatewayResult,
} from "./coaching.js";

export type { ModelRequest, QuerySource } from "./model-request.js";

export type {
  ToolCall,
  PermissionOutcome,
  FailureType,
  FileActivity,
  FileOperation,
  CommandRun,
  CommandClassification,
  CommandScope,
  VerificationRun,
  VerificationKind,
  Compaction,
} from "./tool.js";

export type {
  Recommendation,
  RecommendationCategory,
  Severity,
  RecommendationStatus,
  RecommendationEvidence,
  EstimatedImpact,
  Remediation,
  RemediationType,
} from "./recommendation.js";

export { defaultConfigurationSummary } from "./metrics.js";

export type {
  ReportPeriod,
  ReportFilters,
  ModelUsageRow,
  ToolUsageRow,
  RepeatedOperation,
  UsageMetrics,
  ToolBehaviourMetrics,
  WorkflowMetrics,
  PromptMetrics,
  CostSummary,
  CompletenessSummary,
  CompletionSummary,
  ScanProvenanceSummary,
  SensitivePathFinding,
  RedactedSecretFinding,
  SecurityMetrics,
  ConfigurationSummary,
  AnalyticsSnapshot,
} from "./metrics.js";

export type {
  BaselineDimension,
  SessionDataPoint,
  BaselineStat,
  BehaviouralBaseline,
  BaselineDeviation,
  SessionComparison,
} from "./baseline.js";

export type {
  ModelCatalogue,
  ModelCatalogueEntry,
  CapabilityTier,
  CostTier,
  ContextClass,
} from "./model-catalogue.js";

export type {
  DoctorScope,
  DoctorCheckFamily,
  DoctorSeverity,
  DoctorFixability,
  DoctorEvidence,
  DoctorFinding,
  PatchKind,
  PatchValidation,
  ProposedPatch,
  GeneratedSkillDraft,
  GeneratedHookDraft,
  DoctorReport,
  PatchApplicationResult,
  RollbackResult,
} from "./doctor.js";

export type {
  RecommendationRule,
  RecommendationCandidate,
  AnalysisContext,
  RuleThresholds,
  RuleScope,
  RuleEngineResult,
} from "./rule-engine.js";
