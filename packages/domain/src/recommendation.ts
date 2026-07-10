import type { Confidence } from "./provenance.js";

/** Recommendation categories (spec §10.11). */
export type RecommendationCategory =
  | "context"
  | "prompt"
  | "model"
  | "tools"
  | "workflow"
  | "verification"
  | "security"
  | "configuration";

/** Severity band. */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

/** Lifecycle status of a recommendation. */
export type RecommendationStatus = "active" | "dismissed" | "resolved" | "superseded";

/** Structured evidence backing a recommendation. */
export interface RecommendationEvidence {
  /** Human-readable description of the observed behaviour. */
  description: string;
  /** Machine-queryable evidence kind (e.g. "repeated-read", "failed-command"). */
  kind: string;
  /** Stable pointer to the source session(s)/event(s), when available. */
  references?: string[];
  /** Concrete metric values supporting the finding. */
  metrics?: Array<{ label: string; value: string | number; provenance: string }>;
}

/** Estimated impact of acting on the recommendation. */
export interface EstimatedImpact {
  tokenRange?: { minimum: number; maximum: number };
  costUsdRange?: { minimum: number; maximum: number };
  durationMsRange?: { minimum: number; maximum: number };
  confidence: Confidence;
  /** How the estimate was produced. */
  methodology: string;
}

/** Remediation type. */
export type RemediationType =
  | "instruction"
  | "settings-patch"
  | "claude-md-patch"
  | "skill"
  | "hook"
  | "permission-rule"
  | "workflow";

/** A proposed remediation, never applied without explicit approval. */
export interface Remediation {
  type: RemediationType;
  /** Human-readable preview of the change. */
  preview: string;
  /** Destination file, when applicable. */
  targetPath?: string;
  /** Whether this could be applied automatically (still requires approval). */
  automaticallyApplicable: boolean;
}

/** A structured, evidence-backed recommendation. (§10.11) */
export interface Recommendation {
  id: string;
  ruleId: string;
  ruleVersion: number;
  sessionId?: string;
  projectId?: string;

  category: RecommendationCategory;
  severity: Severity;
  confidence: Confidence;
  status: RecommendationStatus;

  title: string;
  summary: string;
  explanation: string;

  evidence: RecommendationEvidence[];
  estimatedImpact?: EstimatedImpact;
  remediation?: Remediation;

  createdAt: Date;
  updatedAt: Date;
}
