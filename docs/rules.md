# Recommendation rules

AgentLens ships 34 deterministic recommendation rules (spec §13.10, §15.4).
Each rule is versioned, threshold-overridable, produces deterministic
confidence, and carries structured evidence plus a remediation that is **never
applied automatically** (§3.5 safe remediation — every remediation has
`automaticallyApplicable: false`). Recommendations are persisted with stable
ids derived from a finding fingerprint, so a re-run is idempotent: the same
evidence yields the same recommendations, and a recommendation is superseded only
when the evidence changes (§15.1, §15.2).

## Documented fields (§22.4)

Each rule is documented with the spec §22.4 fields: **ID**, **Version**,
**Category**, **Trigger** ("Fires when"), **Threshold**, **Confidence method**,
**Evidence**, **False-positive considerations**, and **Remediation**. All rules
ship at **version 1**; rule versions are persisted alongside recommendation
fingerprints so a version bump re-runs affected rules (§15.1). Thresholds are
overridable via `analysis.ruleOverrides` in `config.json` or the `agentlens rules`
CLI (`agentlens rules explain <ID>` prints the live thresholds + state).

Confidence is a deterministic function of the evidence, never a guess. Two
shapes are used: `confidenceForCount(count; base, +per, cap)` scales linearly from
`base` by `per` per additional observation and caps at `cap`; and `min(cap, base +
factor×k)` where `k` is a normalised evidence ratio in [0,1]. An estimate is never
presented as a measured value (§3.4) — every metric carries a provenance tag.

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

- **Version:** 1
- **Threshold:** minOccurrences: 3
- **Confidence method:** confidenceForCount(occurrences; base 0.5, +0.08 each, cap 0.9)
- **False-positive considerations:** Legitimate re-reads after edits are excluded by the intervening-modification check; watch/poll loops are not distinguished here.

- **Severity:** medium · **Category:** tools
- **Fires when:** a file is read ≥ `minOccurrences` (default 3) times with no
  recorded intervening edit.
- **Evidence:** path label, occurrences, sessions, intervening-modifications.
- **Remediation:** read once and retain, or use a targeted search/Edit.

## TOOLS-002 Repeated equivalent command

- **Version:** 1
- **Threshold:** minOccurrences: 3
- **Confidence method:** confidenceForCount(occurrences; base 0.45, +0.06 each, cap 0.75)
- **False-positive considerations:** Watch/polling is not distinguished at this evidence level (conservative cap).

- **Severity:** low · **Category:** tools
- **Fires when:** a normalised command recurs ≥ `minOccurrences` (default 3).
- **Note:** watch/polling is not distinguished at this evidence level
  (conservative confidence).
- **Remediation:** combine into one step or script the loop.

## TOOLS-003 Repeated unchanged failure

- **Version:** 1
- **Threshold:** minOccurrences: 2
- **Confidence method:** confidenceForCount(occurrences; base 0.6, +0.1 each, cap 0.9)
- **False-positive considerations:** Flaky external systems can repeat failures with strategy changes; inspect the error before assuming retry-without-change.

- **Severity:** high · **Category:** tools
- **Fires when:** materially identical commands fail ≥ `minOccurrences` (default 2) times without a strategy change.
- **Remediation:** read the error / inspect the file before retrying.

## TOOLS-004 Excessive broad test runs

- **Version:** 1
- **Threshold:** minBroadRuns: 3, maxFilesChanged: 2
- **Confidence method:** min(0.55, 0.35 + overThreshold×0.05) — deliberately conservative
- **False-positive considerations:** Broad runs may be justified (e.g. pre-commit suites); only surfaces when few files changed.

- **Severity:** low · **Category:** tools (conservative)
- **Fires when:** broad-scope test runs ≥ `minBroadRuns` (default 3) while
  `filesChangedPerSession` ≤ `maxFilesChanged` (default 2).
- **Remediation:** run the affected test path rather than the full suite.

## TOOLS-005 Oversized tool result

- **Version:** 1
- **Threshold:** minOutputBytes: 200000
- **Confidence method:** min(0.85, 0.5 + min(1, over−1)×0.3)
- **False-positive considerations:** Large outputs from codegen/build are sometimes necessary; size alone doesn't imply waste.

- **Severity:** medium · **Category:** tools
- **Fires when:** the largest tool output ≥ `minOutputBytes` (default 200 000).
- **Remediation:** pipe through head/grep/jq or write to a file.

## TOOLS-006 High exploration-to-change ratio

- **Version:** 1
- **Threshold:** minReads: 8, maxFilesChanged: 2
- **Confidence method:** min(0.6, 0.4 + min(1,(ratio−minReads)/minReads)×0.2) — conservative
- **False-positive considerations:** Read-heavy sessions (research, review) are legitimate; only flags low change counts.

- **Severity:** low · **Category:** tools (moderate)
- **Fires when:** read/write ratio ≥ `minReads` (default 8) and
  `filesChangedPerSession` ≤ `maxFilesChanged` (default 2).
- **Remediation:** narrow exploration or delegate broad sweeps to a subagent.

## TOOLS-007 Repeated unchanged searches

- **Version:** 1
- **Threshold:** minOccurrences: 3
- **Confidence method:** confidenceForCount(occurrences; base 0.45, +0.07 each, cap 0.8)
- **False-positive considerations:** Equivalent search phrasing is normal during exploration; conservative cap.

- **Severity:** low · **Category:** tools
- **Fires when:** the same search (tool + input) recurs ≥ `minOccurrences`
  (default 3) without a query change (§15.4 duplicate searches).
- **Remediation:** run a search once and retain the result, or refine the query.

## TOOLS-008 Repeatedly failing tool

- **Version:** 1
- **Threshold:** minFailureRate: 0.5, minFailures: 2
- **Confidence method:** min(0.75, 0.4 + min(1, failures/(minFailures×2))×0.35)
- **False-positive considerations:** A single failing tool used across distinct failing contexts isn't always a tool bug.

- **Severity:** medium · **Category:** tools
- **Fires when:** a tool (often an MCP server) has failure rate ≥
  `minFailureRate` (default 0.5) and ≥ `minFailures` (default 2) failures
  (§15.4 unused or failing MCP tools).
- **Remediation:** check the failing tool/MCP config, or stop invoking it for
  unsupported tasks.

## VERIFY-001 No verification after code changes

- **Version:** 1
- **Threshold:** minSessions: 1
- **Confidence method:** min(0.9, 0.55 + ratio×0.3)
- **False-positive considerations:** Sessions without code changes are excluded; some change sets need no verification (docs-only).

- **Severity:** high · **Category:** verification
- **Fires when:** ≥ `minSessions` (default 1) sessions changed code but ran no
  recognised verification command.
- **Remediation:** run a verification command after code changes.

## VERIFY-002 Changes after final successful verification

- **Version:** 1
- **Threshold:** minSessions: 1
- **Confidence method:** confidenceForCount(count; base 0.55, +0.1 each, cap 0.9)
- **False-positive considerations:** Intentional follow-up edits after a green check aren't always regressions.

- **Severity:** medium · **Category:** verification
- **Fires when:** ≥ `minSessions` had file changes after the last verification.
- **Remediation:** re-run verification after the last edit.

## VERIFY-003 Session ended with failed verification

- **Version:** 1
- **Threshold:** minSessions: 1
- **Confidence method:** confidenceForCount(count; base 0.6, +0.1 each, cap 0.9)
- **False-positive considerations:** A failed final command isn't always a failed session (the user may have stopped intentionally).

- **Severity:** high · **Category:** verification
- **Fires when:** ≥ `minSessions` ended with a known-failed verification and no
  later success.
- **Remediation:** resolve the failure or acknowledge it before ending.

## VERIFY-004 Narrow verification only (conservative)

- **Version:** 1
- **Threshold:** minSessions: 1
- **Confidence method:** min(0.55, 0.35 + count×0.05) — conservative
- **False-positive considerations:** Narrow verification is sometimes correct (targeted fixes); deliberately conservative.

- **Severity:** low · **Category:** verification
- **Fires when:** ≥ `minSessions` made cross-cutting changes (≥ 3 distinct
  paths) but used only one verification kind.
- **Remediation:** add a complementary verification step (e.g. typecheck/lint).

## VERIFY-005 No test runs despite code changes

- **Version:** 1
- **Threshold:** minSessions: 1
- **Confidence method:** min(0.85, 0.5 + share×0.3)
- **False-positive considerations:** Projects without a test suite are expected to have no test runs.

- **Severity:** high · **Category:** verification
- **Fires when:** no recognised test command ran in the window while ≥
  `minSessions` (default 1) changed code without verification (§15.4 "no tests").
- **Remediation:** run the project's test command after changes; add a test if
  none cover the changed area.

## VERIFY-006 No build verification despite changes

- **Version:** 1
- **Threshold:** minFilesPerSession: 3
- **Confidence method:** min(0.6, 0.35 + min(1, filesPerSession/8)×0.2) — conservative
- **False-positive considerations:** Not every project has a build step; conservative for projects without one.

- **Severity:** medium · **Category:** verification (conservative)
- **Fires when:** no recognised build command ran while `filesChangedPerSession`
  ≥ `minFilesPerSession` (default 3) and unverified sessions exist (§15.4 "no
  build").
- **Remediation:** run the build/compile step after substantial changes (or add
  a typecheck as a lighter alternative).

## WORKFLOW-001 Excessive corrective turns

- **Version:** 1
- **Threshold:** minCorrective: 3
- **Confidence method:** confidenceForCount(count; base 0.5, +0.08 each, cap 0.8)
- **False-positive considerations:** Corrective prompts are sometimes clarifications, not errors.

- **Severity:** medium · **Category:** workflow
- **Fires when:** corrective prompts (a prompt following a failed verification)
  ≥ `minCorrective` (default 3).
- **Note:** Phase 1 uses deterministic phrases + the failed-verification
  structural indicator; semantic detection lands in Phase 3.
- **Remediation:** state objective, scope and acceptance criteria up front.

## WORKFLOW-002 Very long session with task switching

- **Version:** 1
- **Threshold:** minDurationMs: 3600000, minPromptsPerSession: 6
- **Confidence method:** fixed 0.45 (conservative structural indicator)
- **False-positive considerations:** Long sessions legitimately mix related sub-tasks; semantic task-switching detection is Phase 3.

- **Severity:** low · **Category:** workflow (conservative, fixed confidence 0.45)
- **Fires when:** median session duration ≥ `minDurationMs` (default
  3 600 000 ms = 1 h) and prompts/session ≥ `minPromptsPerSession` (default 6).
- **Remediation:** split long multi-task sessions into focused sessions.

## WORKFLOW-003 Large changes without verification

- **Version:** 1
- **Threshold:** minFilesPerSession: 5, minSessions: 2
- **Confidence method:** min(0.8, 0.35 + min(1,share)×0.3 + min(1,filesPerSession/10)×0.1)
- **False-positive considerations:** Large legitimate refactors change many files; only flags when verification is also absent.

- **Severity:** medium · **Category:** workflow
- **Fires when:** `filesChangedPerSession` ≥ `minFilesPerSession` (default 5)
  and ≥ `minSessions` (default 2) changed code without verification (§15.4 large
  changes without planning indicators).
- **Remediation:** pair large changesets with a stated plan and a verification
  step.

## WORKFLOW-004 Repeated manual validation suitable for a hook

- **Version:** 1
- **Threshold:** minRuns: 8, minSessions: 3
- **Confidence method:** min(0.65, 0.35 + min(1, total/(minRuns×2))×0.3)
- **False-positive considerations:** Manual validation is sometimes preferable to a hook (judgement calls); suggests, doesn't force.

- **Severity:** low · **Category:** workflow
- **Fires when:** test + build command runs ≥ `minRuns` (default 8) across ≥
  `minSessions` (default 3) — deterministic validation run frequently by hand
  (§15.4).
- **Remediation:** consider a Claude Code PostToolUse hook that runs the
  dominant verification automatically (AgentLens `doctor` can draft this).

## CONTEXT-001 Frequent compaction

- **Version:** 1
- **Threshold:** minCompactions: 2, minPreCompactionTokens: 100000
- **Confidence method:** min(0.8, 0.45 + min(1, compactionsPerSession)×0.3)
- **False-positive considerations:** Compaction is normal in long sessions; only flags repeated compaction.

- **Severity:** medium · **Category:** context
- **Fires when:** total compactions ≥ `minCompactions` (default 2).
- **Remediation:** trim always-on context and avoid re-reading large outputs.

## CONTEXT-002 Large repeated outputs

- **Version:** 1
- **Threshold:** minOutputBytes: 100000, minRepeatedCommands: 1
- **Confidence method:** min(0.75, 0.45 + min(1, largest/(minBytes×4))×0.25)
- **False-positive considerations:** Large outputs from one command aren't always avoidable.

- **Severity:** medium · **Category:** context
- **Fires when:** largest output ≥ `minOutputBytes` (default 100 000) and
  repeated command groups ≥ `minRepeatedCommands` (default 1).
- **Remediation:** summarise/page large outputs before they enter context.

## CONTEXT-003 Excessive stale context

- **Version:** 1
- **Threshold:** minCacheReadShare: 0.6, minCompactions: 1
- **Confidence method:** min(0.7, 0.4 + min(1, cacheReadShare)×0.3)
- **False-positive considerations:** High cache-read share can reflect healthy prompt caching, not just stale context.

- **Severity:** low · **Category:** context
- **Fires when:** cache-read share of input ≥ `minCacheReadShare` (default 0.6)
  and total compactions ≥ `minCompactions` (default 1) — stale context carried
  and re-summarised (§15.4).
- **Remediation:** start a fresh focused session; trim always-on context.

## CONTEXT-004 Verbose exploration

- **Version:** 1
- **Threshold:** minReads: 12, minSearches: 6, maxFilesChanged: 2
- **Confidence method:** min(0.65, 0.35 + min(1, total/(minReads+minSearches))×0.3)
- **False-positive considerations:** Research/review sessions read a lot legitimately; only flags low change counts.

- **Severity:** low · **Category:** context
- **Fires when:** repeated reads ≥ `minReads` (default 12), repeated searches ≥
  `minSearches` (default 6), and `filesChangedPerSession` ≤ `maxFilesChanged`
  (default 2) — exploration that could be delegated (§15.4).
- **Remediation:** delegate broad exploration to a subagent to keep the main
  context focused.

## PROMPT-001 Prompts rarely state acceptance criteria

- **Version:** 1
- **Threshold:** minPrompts: 4, maxCriteriaShare: 0.2
- **Confidence method:** min(0.7, 0.35 + min(1, missing/minPrompts)×0.35)
- **False-positive considerations:** Short prompts sometimes omit criteria implicitly; not every prompt needs acceptance criteria.

- **Severity:** medium · **Category:** prompt
- **Fires when:** ≥ `minPrompts` (default 4) prompts and the share referencing
  acceptance criteria ≤ `maxCriteriaShare` (default 0.2). Heuristic, from
  per-prompt structural features (§15.5).
- **Remediation:** add a one-line acceptance criterion to task prompts.

## PROMPT-002 Prompts rarely request verification

- **Version:** 1
- **Threshold:** minPrompts: 4, maxVerifyShare: 0.2
- **Confidence method:** min(0.65, 0.3 + min(1, missing/minPrompts)×0.35)
- **False-positive considerations:** Not every task warrants a verify step; conservative for trivial tasks.

- **Severity:** low · **Category:** prompt
- **Fires when:** ≥ `minPrompts` (default 4) prompts and the share requesting
  verification ≤ `maxVerifyShare` (default 0.2). Heuristic.
- **Remediation:** append an explicit verification request to implementation
  prompts.

## PROMPT-003 Multiple independent tasks per prompt

- **Version:** 1
- **Threshold:** minMultiTask: 3, minShare: 0.3
- **Confidence method:** min(0.65, 0.35 + min(1, multi/minMulti)×0.3)
- **False-positive considerations:** Multi-step prompts are sometimes one coherent task; structural detection only.

- **Severity:** medium · **Category:** prompt
- **Fires when:** ≥ `minMultiTask` (default 3) prompts bundle several
  independent tasks at ≥ `minShare` (default 0.3). Heuristic.
- **Remediation:** split bundled objectives into one task per prompt.

## PROMPT-004 Vague references in prompts

- **Version:** 1
- **Threshold:** minVague: 4, minPerPrompt: 0.5
- **Confidence method:** min(0.6, 0.3 + min(1, vague/minVague)×0.3)
- **False-positive considerations:** Vague references are sometimes intentional (continuing a thread); heuristic, not semantic.

- **Severity:** low · **Category:** prompt
- **Fires when:** ≥ `minVague` (default 4) vague references ("this", "the
  issue") at ≥ `minPerPrompt` (default 0.5) per prompt. Heuristic.
- **Remediation:** replace open references with the concrete target (path,
  symbol, behaviour).

## PROMPT-005 Repeated user corrections

- **Version:** 1
- **Threshold:** minCorrective: 3, minShare: 0.2
- **Confidence method:** min(0.7, 0.4 + min(1, corrective/minCorrective)×0.3)
- **False-positive considerations:** Corrections can be clarifications, not prompt defects.

- **Severity:** medium · **Category:** prompt
- **Fires when:** corrective prompts ≥ `minCorrective` (default 3) at ≥
  `minShare` (default 0.2) of total prompts. Heuristic + corrective-turn count.
- **Remediation:** state objective, scope and acceptance criteria up front.

## MODEL-001 High-cost model used for light work

- **Version:** 1
- **Threshold:** minCostTier: 4, maxToolCallsPerSession: 6, minRequests: 3
- **Confidence method:** min(0.6, 0.3 + min(1, modelRequests/minRequests)×0.3)
- **False-positive considerations:** Silent on unknown models (no catalogue entry); cost tiers are relative, not absolute.

- **Severity:** low · **Category:** model
- **Fires when:** the dominant model is in a high relative cost tier (≥
  `minCostTier`, default 4) with `toolCallsPerSession` ≤ `maxToolCallsPerSession`
  (default 6) and ≥ `minRequests` (default 3) requests. Tiers are relative +
  configurable (§15.4); silent on unknown models.
- **Remediation:** use a lower-cost-tier model for mechanical/light work.

## MODEL-002 Lower-capability model struggling

- **Version:** 1
- **Threshold:** maxCapabilityTier: 2, minFailureRate: 0.3, minFailedCommands: 2
- **Confidence method:** min(0.6, 0.3 + min(1, failureRate)×0.3)
- **False-positive considerations:** Failures may stem from the task, not the model; silent on unknown models.

- **Severity:** medium · **Category:** model
- **Fires when:** the dominant model is in a low relative capability tier (≤
  `maxCapabilityTier`, default 2) with tool failure rate ≥ `minFailureRate`
  (default 0.3) or repeated failed commands ≥ `minFailedCommands` (default 2).
  Tiers are relative + configurable.
- **Remediation:** for complex tasks failing repeatedly, consider a
  higher-capability-tier model, then step back down.

## MODEL-003 Stale context sent to a premium model

- **Version:** 1
- **Threshold:** minCapabilityTier: 4, minCacheReadShare: 0.6, minRequests: 3
- **Confidence method:** min(0.6, 0.3 + min(1, cacheReadShare)×0.3)
- **False-positive considerations:** Stale context is sometimes intended (long-running review); silent on unknown models.

- **Severity:** low · **Category:** model
- **Fires when:** the dominant model is in a high capability tier (≥
  `minCapabilityTier`, default 4) with cache-read share ≥ `minCacheReadShare`
  (default 0.6) and ≥ `minRequests` (default 3) requests. Tiers are relative +
  configurable.
- **Remediation:** start a fresh focused session for premium-tier work, or carry
  stale context on a lower-cost tier.

## SECURITY-001 Sensitive path access

- **Version:** 1
- **Threshold:** minAccesses: 1
- **Confidence method:** confidenceForCount(operations; base 0.6, +0.08 each, cap 0.85)
- **False-positive considerations:** Access to sensitive paths is sometimes legitimate (security review, secret rotation).

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

- **Version:** 1
- **Threshold:** minFindings: 1
- **Confidence method:** confidenceForCount(total; base 0.65, +0.07 each, cap 0.9)
- **False-positive considerations:** Redaction runs before persistence; a finding here means redaction flagged suspected secret-shaped text, which can include non-secrets (test fixtures).

- **Severity:** critical · **Category:** security
- **Fires when:** the redaction pipeline scrubbed ≥ `minFindings` (default 1)
  likely secret, detected via `[REDACTED:<label>]` markers in stored content.
- **Privacy:** only the finding **category/label** and counts are stored — the
  secret itself was never persisted (§8.4). In metadata-only mode no content is
  stored, so no finding is produced.
- **Remediation:** do not paste API keys/tokens/credentials into prompts; use
  environment variables or an approved secrets mechanism.

## CONFIG-001 Overly broad retention or exclusions

- **Version:** 1
- **Threshold:** maxRetentionDays: 365, minExclusions: 5
- **Confidence method:** min(0.8, 0.45 + reasons×0.15)
- **False-positive considerations:** Long retention or few exclusions can be deliberate for power users.

- **Severity:** medium (high when `privacyMode` is `full-local`) · **Category:** configuration
- **Fires when:** the AgentLens config uses `full-local` mode, retention >
  `maxRetentionDays` (default 365), or broad/many exclusions (≥ `minExclusions`
  default 5, or a wildcard/very-short pattern) (§15.4).
- **Privacy:** the summary describes config state only — never secrets.
- **Remediation:** lower retention, prefer `redacted-content` mode, narrow
  exclusions to specific project paths.

## CONFIG-002 Local-first boundary weakened

- **Version:** 1
- **Threshold:** (none — fired by configuration signals)
- **Confidence method:** min(0.85, 0.5 + reasons×0.2)
- **False-positive considerations:** Some local-first relaxations are operator-chosen; the finding surfaces them, doesn't forbid them.

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
