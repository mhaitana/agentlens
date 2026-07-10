/**
 * Import pipeline (spec §13): discovery → streaming parse → normalisation →
 * incremental decision → redaction-at-boundary → transactional persistence →
 * session reconstruction. Lives in the CLI app (M1 consumer); the local API
 * (Phase 2) can re-use these modules.
 */

export { buildPrivacy, type ImportPrivacy, type BuildPrivacyInput } from "./privacy.js";
export { decideImport, type IncrementalDecision, type DecideInput } from "./incremental.js";
export { reconstructSession, type ReconstructedSession } from "./reconstruct.js";
export {
  persistSession,
  type PersistInput,
  type PersistResult,
  type PersistCounts,
} from "./persist.js";
export {
  runPipeline,
  type PipelineOptions,
  type PipelineResult,
  type PipelineFileResult,
  type PipelineProgress,
  type PipelinePhase,
} from "./pipeline.js";
