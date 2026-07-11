/**
 * Default deterministic recommendation rule set (spec §13.10, §15.4).
 *
 * 34 rules across eight categories: TOOLS-001..008, VERIFY-001..006,
 * WORKFLOW-001..004, CONTEXT-001..004, PROMPT-001..005, MODEL-001..003,
 * SECURITY-001..002, CONFIG-001..002. Each carries a stable id + version,
 * configurable thresholds, deterministic confidence, an evidence builder, an
 * explanation, and a remediation. Tests live in `rules.test.ts`; documentation
 * in `docs/rules.md`.
 */
import type { RecommendationRule } from "@agentlens/domain";
import {
  tools001,
  tools002,
  tools003,
  tools004,
  tools005,
  tools006,
  tools007,
  tools008,
} from "./tools.js";
import { verify001, verify002, verify003, verify004, verify005, verify006 } from "./verify.js";
import { workflow001, workflow002, workflow003, workflow004 } from "./workflow.js";
import { context001, context002, context003, context004 } from "./context.js";
import { prompt001, prompt002, prompt003, prompt004, prompt005 } from "./prompt.js";
import { model001, model002, model003 } from "./model.js";
import { security001, security002 } from "./security.js";
import { config001, config002 } from "./configuration.js";

/**
 * All default deterministic rules in spec order. Phase 1 contributed the 16
 * TOOLS/VERIFY/WORKFLOW/CONTEXT/SECURITY rules; Phase 3 (§15.4) expands the
 * context, prompt and model categories. Each carries a stable id + version,
 * configurable thresholds, deterministic confidence, evidence, and a
 * remediation. Tests live in `rules.test.ts`; docs in `docs/rules.md`.
 */
export function defaultRules(): RecommendationRule[] {
  return [
    tools001(),
    tools002(),
    tools003(),
    tools004(),
    tools005(),
    tools006(),
    tools007(),
    tools008(),
    verify001(),
    verify002(),
    verify003(),
    verify004(),
    verify005(),
    verify006(),
    workflow001(),
    workflow002(),
    workflow003(),
    workflow004(),
    context001(),
    context002(),
    context003(),
    context004(),
    prompt001(),
    prompt002(),
    prompt003(),
    prompt004(),
    prompt005(),
    model001(),
    model002(),
    model003(),
    security001(),
    security002(),
    config001(),
    config002(),
  ];
}

/** Human-readable description of each rule (for `agentlens rules list/explain`). */
export interface RuleMetadata {
  id: string;
  version: number;
  category: string;
  severity: string;
  title: string;
  description: string;
  defaultThresholds: Record<string, number | string | boolean>;
}

/** Metadata for the default rule set (used by the `rules` CLI command + docs). */
export const RULE_METADATA: RuleMetadata[] = [
  {
    id: "TOOLS-001",
    version: 1,
    category: "tools",
    severity: "medium",
    title: "Repeated unchanged file reads",
    description: "The same file read repeatedly without an intervening write or edit.",
    defaultThresholds: { minOccurrences: 3 },
  },
  {
    id: "TOOLS-002",
    version: 1,
    category: "tools",
    severity: "low",
    title: "Repeated equivalent command",
    description:
      "A normalised command executed repeatedly within a short period (watch/polling distinguished where possible).",
    defaultThresholds: { minOccurrences: 3 },
  },
  {
    id: "TOOLS-003",
    version: 1,
    category: "tools",
    severity: "high",
    title: "Repeated unchanged failure",
    description:
      "Materially identical commands fail repeatedly without a meaningful change in arguments or strategy.",
    defaultThresholds: { minOccurrences: 2 },
  },
  {
    id: "TOOLS-004",
    version: 1,
    category: "tools",
    severity: "low",
    title: "Excessive broad test runs",
    description:
      "A broad/full test suite is repeatedly run after changes limited to a narrow project area. Conservative confidence.",
    defaultThresholds: { minBroadRuns: 3, maxFilesChanged: 2 },
  },
  {
    id: "TOOLS-005",
    version: 1,
    category: "tools",
    severity: "medium",
    title: "Oversized tool result",
    description:
      "Command or tool output is unusually large and likely contributes unnecessary context.",
    defaultThresholds: { minOutputBytes: 200_000 },
  },
  {
    id: "TOOLS-006",
    version: 1,
    category: "tools",
    severity: "low",
    title: "High exploration-to-change ratio",
    description:
      "A session reads/searches many files but changes very few. Moderate confidence — exploration is not always wasteful.",
    defaultThresholds: { minReads: 8, maxFilesChanged: 2 },
  },
  {
    id: "TOOLS-007",
    version: 1,
    category: "tools",
    severity: "low",
    title: "Repeated unchanged searches",
    description:
      "The same search (tool + input) recurs without a change in query (§15.4 duplicate searches).",
    defaultThresholds: { minOccurrences: 3 },
  },
  {
    id: "TOOLS-008",
    version: 1,
    category: "tools",
    severity: "medium",
    title: "Repeatedly failing tool",
    description:
      "A tool (often an MCP server) fails a large share of its calls (§15.4 unused or failing MCP tools).",
    defaultThresholds: { minFailureRate: 0.5, minFailures: 2 },
  },
  {
    id: "VERIFY-001",
    version: 1,
    category: "verification",
    severity: "high",
    title: "No verification after code changes",
    description: "Code changes occurred but no recognised verification command followed.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-002",
    version: 1,
    category: "verification",
    severity: "medium",
    title: "Changes after final successful verification",
    description: "Files changed after the last successful test, build, lint or typecheck.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-003",
    version: 1,
    category: "verification",
    severity: "high",
    title: "Session ended with failed verification",
    description: "The latest relevant verification command failed and no later success occurred.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-004",
    version: 1,
    category: "verification",
    severity: "low",
    title: "Narrow verification only",
    description:
      "A substantial cross-cutting change received only an obviously narrow verification step. Conservative confidence.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-005",
    version: 1,
    category: "verification",
    severity: "high",
    title: "No test runs despite code changes",
    description: "No recognised test command ran while code was being changed (§15.4 'no tests').",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-006",
    version: 1,
    category: "verification",
    severity: "medium",
    title: "No build verification despite changes",
    description:
      "No recognised build command ran while substantial changes were made (§15.4 'no build'). Conservative.",
    defaultThresholds: { minFilesPerSession: 3 },
  },
  {
    id: "WORKFLOW-001",
    version: 1,
    category: "workflow",
    severity: "medium",
    title: "Excessive corrective turns",
    description:
      "Multiple user prompts appear to correct, reverse or clarify prior work (deterministic phrases + structural indicators).",
    defaultThresholds: { minCorrective: 3 },
  },
  {
    id: "WORKFLOW-002",
    version: 1,
    category: "workflow",
    severity: "low",
    title: "Very long session with task switching",
    description:
      "Conservative deterministic indicators only in Phase 1; semantic detection in Phase 3.",
    defaultThresholds: { minDurationMs: 3_600_000, minPromptsPerSession: 6 },
  },
  {
    id: "WORKFLOW-003",
    version: 1,
    category: "workflow",
    severity: "medium",
    title: "Large changes without verification",
    description:
      "Large per-session change sets with sessions that changed code without verification (§15.4).",
    defaultThresholds: { minFilesPerSession: 5, minSessions: 2 },
  },
  {
    id: "WORKFLOW-004",
    version: 1,
    category: "workflow",
    severity: "low",
    title: "Repeated manual validation suitable for a hook",
    description:
      "Deterministic verification commands run very frequently by hand — candidates for a Claude Code hook (§15.4).",
    defaultThresholds: { minRuns: 8, minSessions: 3 },
  },
  {
    id: "CONTEXT-001",
    version: 1,
    category: "context",
    severity: "medium",
    title: "Frequent compaction",
    description:
      "A session experiences repeated compactions or unusually high pre-compaction context.",
    defaultThresholds: { minCompactions: 2, minPreCompactionTokens: 100_000 },
  },
  {
    id: "CONTEXT-002",
    version: 1,
    category: "context",
    severity: "medium",
    title: "Large repeated outputs",
    description: "Large command outputs repeatedly enter the session.",
    defaultThresholds: { minOutputBytes: 100_000, minRepeatedCommands: 1 },
  },
  {
    id: "CONTEXT-003",
    version: 1,
    category: "context",
    severity: "low",
    title: "Excessive stale context",
    description:
      "A large share of input tokens are cache reads alongside compaction — stale context is carried and re-summarised.",
    defaultThresholds: { minCacheReadShare: 0.6, minCompactions: 1 },
  },
  {
    id: "CONTEXT-004",
    version: 1,
    category: "context",
    severity: "low",
    title: "Verbose exploration",
    description:
      "High read/search volume with very few files changed — exploration that could be delegated to a subagent.",
    defaultThresholds: { minReads: 12, minSearches: 6, maxFilesChanged: 2 },
  },
  {
    id: "PROMPT-001",
    version: 1,
    category: "prompt",
    severity: "medium",
    title: "Prompts rarely state acceptance criteria",
    description:
      "Most prompts do not reference what 'done' looks like. Heuristic, from per-prompt structural features.",
    defaultThresholds: { minPrompts: 4, maxCriteriaShare: 0.2 },
  },
  {
    id: "PROMPT-002",
    version: 1,
    category: "prompt",
    severity: "low",
    title: "Prompts rarely request verification",
    description:
      "Few prompts ask the agent to verify its work. Heuristic, from per-prompt structural features.",
    defaultThresholds: { minPrompts: 4, maxVerifyShare: 0.2 },
  },
  {
    id: "PROMPT-003",
    version: 1,
    category: "prompt",
    severity: "medium",
    title: "Multiple independent tasks per prompt",
    description:
      "Prompts bundle several independent objectives, making verification harder. Heuristic.",
    defaultThresholds: { minMultiTask: 3, minShare: 0.3 },
  },
  {
    id: "PROMPT-004",
    version: 1,
    category: "prompt",
    severity: "low",
    title: "Vague references in prompts",
    description:
      'Prompts use open references like "this" or "the issue" without naming the target. Heuristic.',
    defaultThresholds: { minVague: 4, minPerPrompt: 0.5 },
  },
  {
    id: "PROMPT-005",
    version: 1,
    category: "prompt",
    severity: "medium",
    title: "Repeated user corrections",
    description:
      "A meaningful share of prompts correct or reverse prior work. Heuristic + corrective-turn count.",
    defaultThresholds: { minCorrective: 3, minShare: 0.2 },
  },
  {
    id: "MODEL-001",
    version: 1,
    category: "model",
    severity: "low",
    title: "High-cost model used for light work",
    description:
      "A high relative cost-tier model is dominant on low-activity work. Tiers are relative + configurable (§15.4).",
    defaultThresholds: { minCostTier: 4, maxToolCallsPerSession: 6, minRequests: 3 },
  },
  {
    id: "MODEL-002",
    version: 1,
    category: "model",
    severity: "medium",
    title: "Lower-capability model struggling",
    description:
      "A low relative capability-tier model is dominant with a high failure rate. Tiers are relative + configurable (§15.4).",
    defaultThresholds: { maxCapabilityTier: 2, minFailureRate: 0.3, minFailedCommands: 2 },
  },
  {
    id: "MODEL-003",
    version: 1,
    category: "model",
    severity: "low",
    title: "Stale context sent to a premium model",
    description:
      "A high capability-tier model receives mostly cached (stale) input. Tiers are relative + configurable (§15.4).",
    defaultThresholds: { minCapabilityTier: 4, minCacheReadShare: 0.6, minRequests: 3 },
  },
  {
    id: "SECURITY-001",
    version: 1,
    category: "security",
    severity: "high",
    title: "Sensitive path access",
    description:
      "Access to likely-sensitive files (.env, credentials, private keys, secret directories, cloud credentials). Never exposes the value.",
    defaultThresholds: { minAccesses: 1 },
  },
  {
    id: "SECURITY-002",
    version: 1,
    category: "security",
    severity: "critical",
    title: "Potential secret in persisted content",
    description:
      "The redaction pipeline detected a likely secret. Only the finding category is stored, not the secret.",
    defaultThresholds: { minFindings: 1 },
  },
  {
    id: "CONFIG-001",
    version: 1,
    category: "configuration",
    severity: "medium",
    title: "Overly broad retention or exclusions",
    description:
      "AgentLens config broadens what is kept (full-local/long retention) or narrows what is analysed (broad exclusions) (§15.4).",
    defaultThresholds: { maxRetentionDays: 365, minExclusions: 5 },
  },
  {
    id: "CONFIG-002",
    version: 1,
    category: "configuration",
    severity: "high",
    title: "Local-first boundary weakened",
    description:
      "Dashboard binds beyond loopback or external analysis is enabled with a non-local provider (§15.4).",
    defaultThresholds: {},
  },
];

export {
  tools001,
  tools002,
  tools003,
  tools004,
  tools005,
  tools006,
  tools007,
  tools008,
} from "./tools.js";
export { verify001, verify002, verify003, verify004, verify005, verify006 } from "./verify.js";
export { workflow001, workflow002, workflow003, workflow004 } from "./workflow.js";
export { context001, context002, context003, context004 } from "./context.js";
export { prompt001, prompt002, prompt003, prompt004, prompt005 } from "./prompt.js";
export { model001, model002, model003 } from "./model.js";
export { security001, security002 } from "./security.js";
export { config001, config002 } from "./configuration.js";
