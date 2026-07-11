/**
 * A user prompt and the features derived from it. (§10.4)
 *
 * Prompt text is only stored when the active privacy mode permits; when not,
 * a content hash plus the derived features still allow analysis without the
 * original text.
 */
export interface Prompt {
  id: string;
  sessionId: string;
  /** 1-based sequence within the session. */
  sequence: number;
  timestamp: Date;

  /** Redacted prompt text, only when the privacy mode allows it. */
  redactedContent?: string;
  /** Stable hash of the original prompt content. */
  contentHash: string;
  characterCount: number;
  /** Approximate token count — always labelled approximate. */
  approximateTokenCount?: number;

  features: PromptFeatures;
}

/** Structural features extracted from a prompt. */
export interface PromptFeatures {
  /** Appears to correct, reverse or clarify prior work. */
  appearsCorrective: boolean;
  /** Appears to begin a new task. */
  beginsNewTask: boolean;
  /** References acceptance criteria. */
  referencesAcceptanceCriteria: boolean;
  /** Requests verification. */
  requestsVerification: boolean;
  /** Contains multiple independent tasks in one prompt. */
  multipleIndependentTasks: boolean;
  /** Detected imperative-verb count. */
  imperativeVerbCount: number;
  /** Detected file-reference count. */
  fileReferenceCount: number;
  /** Ambiguous-pronoun / vague-reference count. */
  ambiguousReferenceCount: number;
  /** Contains scope-bounding markers ("only", "just", "limit to", …). */
  hasScopeMarkers: boolean;
  /** Appears to reverse prior work (undo/revert/rollback), any sequence. */
  appearsReversal: boolean;
  /** Deterministic complexity proxy in [0,1] (heuristic structural density). */
  complexityScore: number;
  /** Character length (mirrors parent for quick scoring). */
  length: number;
}
