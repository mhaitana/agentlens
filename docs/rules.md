# Recommendation rules

AgentLens ships 34 deterministic recommendation rules (spec §13.10, §15.4).
Each rule is versioned, threshold-overridable, produces deterministic
confidence, and carries structured evidence plus a remediation that is **never
applied automatically** (§3.5 safe remediation — every remediation has
`automaticallyApplicable: false`). Recommendations are persisted with stable
ids derived from a finding fingerprint, so a re-run is idempotent: the same
evidence yields the same recommendations, and a recommendation is superseded only
when the evidence changes (§15.1, §15.2).

## Categories

| Category      | Rules             | Concern                                 |
| ------------- | ----------------- | --------------------------------------- |
| tools         | TOOLS-001..008    | Tool/command efficiency                 |
| verification  | VERIFY-001..006   | Verification discipline                 |
| workflow      | WORKFLOW-001..004 | Workflow friction                       |
| context       | CONTEXT-001..004  | Context efficiency                      |
| prompt        | PROMPT-001..005   | Prompt effectiveness                    |
| model         | MODEL-001..003    | Model selection (relative tiers)        |
| security      | SECURITY-001..002 | Sensitive access / secrets              |
| configuration | CONFIG-001..002   | AgentLens config / local-first boundary |

Model-selection rules compare usage against a **configurable model catalogue**
(§15.4) of relative capability/cost/context tiers — they never assert a
permanent "model X is best/cheapest" claim, and stay silent on unknown models
(§3.4 honest metrics). Configuration rules read a provider-neutral
`ConfigurationSummary` threaded from the resolved AgentLens config (never
secrets); Claude-Code-settings-derived signals (broad permissions, MCP) are
doctor-scope (§15.13).

## How confidence is computed

Confidence is a **deterministic function of the evidence** — never a guess.
Most rules scale confidence with the count of observations above a baseline and
cap it (`confidenceForCount(count, base, per, max)`). Rules the spec marks as
heuristic (narrow verification, broad tests, exploration ratio, long sessions)
use deliberately conservative caps. An estimate is never presented as a measured
value (§3.4 honest metrics) — every metric on a recommendation carries a
provenance tag (`exact`, `reported`, `inferred`, `estimated`, `heuristic`,
`unknown`).

## Configuring rules

Rules can be toggled and threshold-tuned via `analysis.ruleOverrides` in
`config.json` (keyed by rule id), or the `agentlens rules` CLI:

```bash
agentlens rules list                 # show all rules + on/off state
agentlens rules explain TOOLS-001    # full details + current thresholds
agentlens rules disable TOOLS-001    # skip the rule at run time
agentlens rules enable TOOLS-001     # restore it
agentlens rules list --json           # machine-readable
```

Threshold overrides are merged over each rule's defaults at run time. Example
config snippet:

```json
{
  "analysis": {
    "minimumRecommendationConfidence": 0.65,
    "ruleOverrides": {
      "TOOLS-001": { "thresholds": { "minOccurrences": 5 } },
      "VERIFY-004": { "enabled": false }
    }
  }
}
```

Recommendations below `analysis.minimumRecommendationConfidence` are dropped
before persistence.

## Dedup, supersession, re-appearance

- **Dedup:** a candidate's fingerprint is `sha256(ruleId + version + scope +
evidence)`. Two candidates with the same fingerprint consolidate; re-running
  with identical evidence does not insert duplicate rows.
- **Supersession:** when a rule emits a new fingerprint for the same
  (ruleId, scope), prior active recommendations for that rule+scope are marked
  `superseded` and the new one is inserted. Each rule emits at most one
  candidate per scope (the most significant finding), so a single rule keeps at
  most one active recommendation per scope (§15.2 "avoid flooding").
- **Re-appearance:** a dismissed/resolved/superseded recommendation is **not**
  re-activated by identical evidence. It reappears only when new evidence
  produces a new fingerprint.
- **Scope:** when a report is project-filtered, recommendations are scoped to
  that project; otherwise they are global.

## TOOLS-001 Repeated unchanged file reads

- **Severity:** medium · **Category:** tools
- **Fires when:** a file is read ≥ `minOccurrences` (default 3) times with no
  recorded intervening edit.
- **Evidence:** path label, occurrences, sessions, intervening-modifications.
- **Remediation:** read once and retain, or use a targeted search/Edit.

## TOOLS-002 Repeated equivalent command

- **Severity:** low · **Category:** tools
- **Fires when:** a normalised command recurs ≥ `minOccurrences` (default 3).
- **Note:** watch/polling is not distinguished at this evidence level
  (conservative confidence).
- **Remediation:** combine into one step or script the loop.

## TOOLS-003 Repeated unchanged failure

- **Severity:** high · **Category:** tools
- **Fires when:** materially identical commands fail ≥ `minOccurrences` (default 2) times without a strategy change.
- **Remediation:** read the error / inspect the file before retrying.

## TOOLS-004 Excessive broad test runs

- **Severity:** low · **Category:** tools (conservative)
- **Fires when:** broad-scope test runs ≥ `minBroadRuns` (default 3) while
  `filesChangedPerSession` ≤ `maxFilesChanged` (default 2).
- **Remediation:** run the affected test path rather than the full suite.

## TOOLS-005 Oversized tool result

- **Severity:** medium · **Category:** tools
- **Fires when:** the largest tool output ≥ `minOutputBytes` (default 200 000).
- **Remediation:** pipe through head/grep/jq or write to a file.

## TOOLS-006 High exploration-to-change ratio

- **Severity:** low · **Category:** tools (moderate)
- **Fires when:** read/write ratio ≥ `minReads` (default 8) and
  `filesChangedPerSession` ≤ `maxFilesChanged` (default 2).
- **Remediation:** narrow exploration or delegate broad sweeps to a subagent.

## TOOLS-007 Repeated unchanged searches

- **Severity:** low · **Category:** tools
- **Fires when:** the same search (tool + input) recurs ≥ `minOccurrences`
  (default 3) without a query change (§15.4 duplicate searches).
- **Remediation:** run a search once and retain the result, or refine the query.

## TOOLS-008 Repeatedly failing tool

- **Severity:** medium · **Category:** tools
- **Fires when:** a tool (often an MCP server) has failure rate ≥
  `minFailureRate` (default 0.5) and ≥ `minFailures` (default 2) failures
  (§15.4 unused or failing MCP tools).
- **Remediation:** check the failing tool/MCP config, or stop invoking it for
  unsupported tasks.

## VERIFY-001 No verification after code changes

- **Severity:** high · **Category:** verification
- **Fires when:** ≥ `minSessions` (default 1) sessions changed code but ran no
  recognised verification command.
- **Remediation:** run a verification command after code changes.

## VERIFY-002 Changes after final successful verification

- **Severity:** medium · **Category:** verification
- **Fires when:** ≥ `minSessions` had file changes after the last verification.
- **Remediation:** re-run verification after the last edit.

## VERIFY-003 Session ended with failed verification

- **Severity:** high · **Category:** verification
- **Fires when:** ≥ `minSessions` ended with a known-failed verification and no
  later success.
- **Remediation:** resolve the failure or acknowledge it before ending.

## VERIFY-004 Narrow verification only (conservative)

- **Severity:** low · **Category:** verification
- **Fires when:** ≥ `minSessions` made cross-cutting changes (≥ 3 distinct
  paths) but used only one verification kind.
- **Remediation:** add a complementary verification step (e.g. typecheck/lint).

## VERIFY-005 No test runs despite code changes

- **Severity:** high · **Category:** verification
- **Fires when:** no recognised test command ran in the window while ≥
  `minSessions` (default 1) changed code without verification (§15.4 "no tests").
- **Remediation:** run the project's test command after changes; add a test if
  none cover the changed area.

## VERIFY-006 No build verification despite changes

- **Severity:** medium · **Category:** verification (conservative)
- **Fires when:** no recognised build command ran while `filesChangedPerSession`
  ≥ `minFilesPerSession` (default 3) and unverified sessions exist (§15.4 "no
  build").
- **Remediation:** run the build/compile step after substantial changes (or add
  a typecheck as a lighter alternative).

## WORKFLOW-001 Excessive corrective turns

- **Severity:** medium · **Category:** workflow
- **Fires when:** corrective prompts (a prompt following a failed verification)
  ≥ `minCorrective` (default 3).
- **Note:** Phase 1 uses deterministic phrases + the failed-verification
  structural indicator; semantic detection lands in Phase 3.
- **Remediation:** state objective, scope and acceptance criteria up front.

## WORKFLOW-002 Very long session with task switching

- **Severity:** low · **Category:** workflow (conservative, fixed confidence 0.45)
- **Fires when:** median session duration ≥ `minDurationMs` (default
  3 600 000 ms = 1 h) and prompts/session ≥ `minPromptsPerSession` (default 6).
- **Remediation:** split long multi-task sessions into focused sessions.

## WORKFLOW-003 Large changes without verification

- **Severity:** medium · **Category:** workflow
- **Fires when:** `filesChangedPerSession` ≥ `minFilesPerSession` (default 5)
  and ≥ `minSessions` (default 2) changed code without verification (§15.4 large
  changes without planning indicators).
- **Remediation:** pair large changesets with a stated plan and a verification
  step.

## WORKFLOW-004 Repeated manual validation suitable for a hook

- **Severity:** low · **Category:** workflow
- **Fires when:** test + build command runs ≥ `minRuns` (default 8) across ≥
  `minSessions` (default 3) — deterministic validation run frequently by hand
  (§15.4).
- **Remediation:** consider a Claude Code PostToolUse hook that runs the
  dominant verification automatically (AgentLens `doctor` can draft this).

## CONTEXT-001 Frequent compaction

- **Severity:** medium · **Category:** context
- **Fires when:** total compactions ≥ `minCompactions` (default 2).
- **Remediation:** trim always-on context and avoid re-reading large outputs.

## CONTEXT-002 Large repeated outputs

- **Severity:** medium · **Category:** context
- **Fires when:** largest output ≥ `minOutputBytes` (default 100 000) and
  repeated command groups ≥ `minRepeatedCommands` (default 1).
- **Remediation:** summarise/page large outputs before they enter context.

## CONTEXT-003 Excessive stale context

- **Severity:** low · **Category:** context
- **Fires when:** cache-read share of input ≥ `minCacheReadShare` (default 0.6)
  and total compactions ≥ `minCompactions` (default 1) — stale context carried
  and re-summarised (§15.4).
- **Remediation:** start a fresh focused session; trim always-on context.

## CONTEXT-004 Verbose exploration

- **Severity:** low · **Category:** context
- **Fires when:** repeated reads ≥ `minReads` (default 12), repeated searches ≥
  `minSearches` (default 6), and `filesChangedPerSession` ≤ `maxFilesChanged`
  (default 2) — exploration that could be delegated (§15.4).
- **Remediation:** delegate broad exploration to a subagent to keep the main
  context focused.

## PROMPT-001 Prompts rarely state acceptance criteria

- **Severity:** medium · **Category:** prompt
- **Fires when:** ≥ `minPrompts` (default 4) prompts and the share referencing
  acceptance criteria ≤ `maxCriteriaShare` (default 0.2). Heuristic, from
  per-prompt structural features (§15.5).
- **Remediation:** add a one-line acceptance criterion to task prompts.

## PROMPT-002 Prompts rarely request verification

- **Severity:** low · **Category:** prompt
- **Fires when:** ≥ `minPrompts` (default 4) prompts and the share requesting
  verification ≤ `maxVerifyShare` (default 0.2). Heuristic.
- **Remediation:** append an explicit verification request to implementation
  prompts.

## PROMPT-003 Multiple independent tasks per prompt

- **Severity:** medium · **Category:** prompt
- **Fires when:** ≥ `minMultiTask` (default 3) prompts bundle several
  independent tasks at ≥ `minShare` (default 0.3). Heuristic.
- **Remediation:** split bundled objectives into one task per prompt.

## PROMPT-004 Vague references in prompts

- **Severity:** low · **Category:** prompt
- **Fires when:** ≥ `minVague` (default 4) vague references ("this", "the
  issue") at ≥ `minPerPrompt` (default 0.5) per prompt. Heuristic.
- **Remediation:** replace open references with the concrete target (path,
  symbol, behaviour).

## PROMPT-005 Repeated user corrections

- **Severity:** medium · **Category:** prompt
- **Fires when:** corrective prompts ≥ `minCorrective` (default 3) at ≥
  `minShare` (default 0.2) of total prompts. Heuristic + corrective-turn count.
- **Remediation:** state objective, scope and acceptance criteria up front.

## MODEL-001 High-cost model used for light work

- **Severity:** low · **Category:** model
- **Fires when:** the dominant model is in a high relative cost tier (≥
  `minCostTier`, default 4) with `toolCallsPerSession` ≤ `maxToolCallsPerSession`
  (default 6) and ≥ `minRequests` (default 3) requests. Tiers are relative +
  configurable (§15.4); silent on unknown models.
- **Remediation:** use a lower-cost-tier model for mechanical/light work.

## MODEL-002 Lower-capability model struggling

- **Severity:** medium · **Category:** model
- **Fires when:** the dominant model is in a low relative capability tier (≤
  `maxCapabilityTier`, default 2) with tool failure rate ≥ `minFailureRate`
  (default 0.3) or repeated failed commands ≥ `minFailedCommands` (default 2).
  Tiers are relative + configurable.
- **Remediation:** for complex tasks failing repeatedly, consider a
  higher-capability-tier model, then step back down.

## MODEL-003 Stale context sent to a premium model

- **Severity:** low · **Category:** model
- **Fires when:** the dominant model is in a high capability tier (≥
  `minCapabilityTier`, default 4) with cache-read share ≥ `minCacheReadShare`
  (default 0.6) and ≥ `minRequests` (default 3) requests. Tiers are relative +
  configurable.
- **Remediation:** start a fresh focused session for premium-tier work, or carry
  stale context on a lower-cost tier.

## SECURITY-001 Sensitive path access

- **Severity:** high · **Category:** security
- **Fires when:** a likely-sensitive path (`.env`, private keys, `.ssh/`,
  cloud credentials, secret directories, credential files) is accessed ≥
  `minAccesses` (default 1).
- **Privacy:** derived from the **redacted** path basename only — the raw path
  is never present, and the secret value is never stored or exposed. In
  metadata-only mode no path is retained, so no finding is produced
  (evidence-before-advice, §3.3).
- **Remediation:** avoid reading credential/secret files into context; use
  environment variables or a secrets manager.

## SECURITY-002 Potential secret in persisted content

- **Severity:** critical · **Category:** security
- **Fires when:** the redaction pipeline scrubbed ≥ `minFindings` (default 1)
  likely secret, detected via `[REDACTED:<label>]` markers in stored content.
- **Privacy:** only the finding **category/label** and counts are stored — the
  secret itself was never persisted (§8.4). In metadata-only mode no content is
  stored, so no finding is produced.
- **Remediation:** do not paste API keys/tokens/credentials into prompts; use
  environment variables or an approved secrets mechanism.

## CONFIG-001 Overly broad retention or exclusions

- **Severity:** medium (high when `privacyMode` is `full-local`) · **Category:** configuration
- **Fires when:** the AgentLens config uses `full-local` mode, retention >
  `maxRetentionDays` (default 365), or broad/many exclusions (≥ `minExclusions`
  default 5, or a wildcard/very-short pattern) (§15.4).
- **Privacy:** the summary describes config state only — never secrets.
- **Remediation:** lower retention, prefer `redacted-content` mode, narrow
  exclusions to specific project paths.

## CONFIG-002 Local-first boundary weakened

- **Severity:** high · **Category:** configuration
- **Fires when:** the dashboard binds beyond loopback, or external analysis is
  enabled with a non-deterministic provider (local or remote model) (§15.4).
- **Remediation:** prefer `127.0.0.1` for the dashboard host and keep external
  analysis disabled unless the §15.5 redaction + opt-in safeguards are reviewed.

## Testing

- **Unit:** `packages/analysis-engine/src/rules/rules.test.ts` exercises every
  rule above and below its threshold, asserts ≤1 candidate per rule, and
  verifies deterministic confidence + safe (non-auto) remediations.
- **Persistence/dedup/supersession:**
  `packages/recommendations/src/recommendations.test.ts`.
- **End-to-end:** `packages/analysis-engine/src/analytics.test.ts` runs the rule
  engine through `computeAnalytics` and verifies idempotent re-runs; the CLI
  smoke (`apps/cli/src/cli.smoke.test.ts`, "F003 rules smoke") runs scan →
  report → rules list/disable/enable against an isolated temp home.
- **Fixtures:** `packages/test-fixtures/src/index.ts` provides synthetic
  transcripts for every §21.1 case (repeated reads, repeated failures, broad
  tests, no-verification, changes-after-verify, multiple compactions, sensitive
  paths, prompt corrections, multiple projects). No real transcript is ever
  committed.
