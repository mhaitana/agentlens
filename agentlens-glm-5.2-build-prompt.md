# Build AgentLens — Phases 1, 2 and 3

You are the principal engineer responsible for designing and implementing **AgentLens**, a production-quality, local-first analytics and coaching tool for Claude Code.

Work autonomously through the entire implementation. Do not stop after producing architecture documents, mockups, scaffolding, or partial examples. Build the working application, run it, test it, inspect failures, fix them, and verify the completed system.

---

# 1. Product Definition

## 1.1 Product name

**AgentLens**

## 1.2 Tagline

> Local workflow intelligence for Claude Code.

## 1.3 Product mission

AgentLens privately analyses how a developer uses Claude Code and provides evidence-backed recommendations that help them:

- Reduce unnecessary token and context usage.
- Improve prompt quality.
- Select models more appropriately.
- Avoid repetitive tool calls.
- Reduce failed commands and rework.
- Improve testing and verification.
- Improve Claude Code configuration.
- Identify overly broad permissions.
- Detect sensitive-data exposure.
- Convert repeated workflows into reusable skills or hooks.
- Structure sessions more effectively.

AgentLens must explain not only **what happened**, but also:

1. Why the behaviour may be inefficient.
2. What evidence supports the finding.
3. How confident AgentLens is.
4. What the user can change.
5. What impact the change may have.
6. Whether the recommendation can be applied automatically.

## 1.4 Core positioning

AgentLens is not merely a usage dashboard.

Its defining value proposition is:

> Turn Claude Code usage data into practical behavioural coaching and safe workflow improvements.

---

# 2. Required Scope

Implement all functionality described under:

- **Phase 1 — Read-only analytics MVP**
- **Phase 2 — Live observation and Claude Code integration**
- **Phase 3 — Coaching and Configuration Doctor**

Do not implement the future team edition or broad support for unrelated coding agents beyond creating extensible interfaces for them.

---

# 3. Mandatory Product Principles

## 3.1 Local-first

AgentLens must run entirely on the user’s machine by default.

The default installation must require:

- No AgentLens account.
- No cloud database.
- No hosted backend.
- No authentication.
- No AgentLens telemetry.
- No external AI provider.
- No transmission of transcript content.

## 3.2 Privacy-first

Claude Code transcripts, prompts, tool calls and repository paths may be highly sensitive.

AgentLens must:

- Clearly explain what it reads.
- Require an explicit scan or integration action.
- Never silently upload data.
- Never silently enable an external model.
- Never store secrets intentionally.
- Redact sensitive values before persistence.
- Support project exclusions.
- Support metadata-only analysis.
- Support configurable retention.
- Support complete local deletion.
- Bind local services to loopback interfaces only by default.
- Never store full source-file contents.
- Never store full shell environments.
- Never log API keys or authentication headers.
- Never commit real transcripts or private usage data to the repository.

## 3.3 Evidence before advice

Every recommendation must contain structured evidence.

Do not generate generic advice such as:

- “Write better prompts.”
- “Use fewer tokens.”
- “Run tests.”
- “Consider using another model.”

Recommendations must reference concrete session evidence such as:

- A file was read six times without being edited.
- The same test command was run 14 times.
- Three equivalent commands failed consecutively.
- Files changed after the final successful test.
- A session experienced four compactions.
- A prompt required five corrective follow-ups.
- A sensitive file path was accessed.
- An expensive model tier handled a low-complexity mechanical task.

## 3.4 Honest metrics

Distinguish between:

- Exact values.
- Values reported by Claude Code.
- Values inferred from transcripts.
- Estimated values.
- Heuristic scores.
- Unknown values.

Never present an estimate as official billing data.

## 3.5 Safe remediation

AgentLens may generate patches and recommendations, but it must not modify Claude Code settings, hooks, skills, agents, permissions or project files without explicit user approval.

Every automated remediation must:

1. Show the proposed diff.
2. Explain the impact.
3. Identify the destination file.
4. Create a backup.
5. Require explicit approval.
6. Validate the resulting configuration.
7. Support rollback.

## 3.6 Extensible source architecture

Claude Code is the first supported source, but internal domain models must not be tightly coupled to Claude-specific event shapes.

Use a source-adapter architecture that allows future adapters for other coding agents.

---

# 4. Engineering Behaviour

Follow these execution requirements throughout the project.

## 4.1 Work autonomously

- Inspect the repository before changing it.
- If the repository is empty, initialise it.
- Resolve ordinary implementation details independently.
- Do not repeatedly ask the user to approve technical choices.
- Use the requirements in this prompt as the source of truth.
- Prefer a working, well-tested solution over speculative complexity.

## 4.2 Maintain a working build

At the end of every major implementation stage:

- Run formatting.
- Run linting.
- Run TypeScript checking.
- Run relevant unit tests.
- Run integration tests.
- Build all packages.
- Start the application.
- Exercise the relevant CLI commands.
- Fix errors before continuing.

## 4.3 No fake implementation

Do not leave:

- Placeholder functions.
- Hardcoded dashboard metrics.
- Fake recommendations.
- Empty handlers.
- Nonfunctional buttons.
- Mock API calls in production code.
- Comments that merely describe missing behaviour.
- Critical `TODO` items within Phases 1–3.

Synthetic fixtures are required for tests, but production behaviour must operate on actual local data.

## 4.4 Preserve maintainability

- Use strict TypeScript.
- Avoid `any`.
- Avoid oversized files.
- Separate domain logic from infrastructure.
- Keep UI components separate from feature logic.
- Use dependency injection or clear interfaces at external boundaries.
- Document non-obvious decisions.
- Prefer composition over deep inheritance.
- Keep packages independently testable.

---

# 5. Technology Stack

Use the following unless a concrete incompatibility requires a documented alternative.

## 5.1 Repository

- TypeScript monorepo.
- `pnpm` workspaces.
- Turborepo for task orchestration.
- Current active Node.js LTS.
- ESM by default.
- Strict TypeScript configuration.
- Shared ESLint configuration.
- Prettier.
- Changesets for package versioning.

## 5.2 CLI

- Commander.js.
- `picocolors` for terminal colour.
- `ora` for progress where appropriate.
- `cli-table3` or an equivalent accessible terminal table library.
- Support human-readable and `--json` output.
- Do not use colour when `NO_COLOR` is set.
- Respect non-interactive terminals.

## 5.3 Local API

- Fastify.
- Zod for validation.
- JSON Schema/OpenAPI generation where practical.
- Server-Sent Events for live dashboard updates.
- Bind to `127.0.0.1` by default.
- Select a safe available port when the default is occupied.

## 5.4 Database

- SQLite.
- Drizzle ORM.
- Versioned migrations.
- WAL mode where supported.
- Explicit foreign keys.
- Transactional imports.
- Indexed timestamps, session IDs, project IDs and event types.

## 5.5 Dashboard

- React.
- Vite.
- TanStack Router.
- TanStack Query.
- Tailwind CSS.
- Radix UI primitives.
- Lucide icons.
- Recharts or a similarly lightweight charting library.
- Feature-oriented architecture inspired by Bulletproof React.
- Accessible dark and light modes.
- Responsive desktop and tablet layouts.

Do not build a Tauri or Electron wrapper in these phases. The local browser dashboard is the primary interface.

## 5.6 Testing

- Vitest.
- React Testing Library.
- Playwright.
- Temporary filesystem fixtures.
- Temporary SQLite databases.
- Snapshot tests only where they improve confidence.
- No tests that depend on the developer’s real `~/.claude` directory.

---

# 6. Repository Structure

Create a structure close to the following:

```text
agentlens/
├── apps/
│   ├── cli/
│   │   ├── src/
│   │   └── package.json
│   ├── local-api/
│   │   ├── src/
│   │   └── package.json
│   └── dashboard/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   ├── hooks/
│       │   ├── lib/
│       │   └── routes/
│       └── package.json
├── packages/
│   ├── analysis-engine/
│   ├── claude-adapter/
│   ├── config/
│   ├── database/
│   ├── domain/
│   ├── hook-collector/
│   ├── otel-receiver/
│   ├── prompt-coach/
│   ├── recommendations/
│   ├── redaction/
│   ├── reporting/
│   ├── source-adapter/
│   ├── test-fixtures/
│   └── shared/
├── plugins/
│   └── agentlens-claude/
│       ├── .claude-plugin/
│       ├── hooks/
│       ├── scripts/
│       └── README.md
├── docs/
│   ├── architecture/
│   ├── privacy/
│   ├── rules/
│   └── troubleshooting/
├── scripts/
├── .changeset/
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── LICENSE
```

Adjust this where necessary, but retain clear package boundaries.

---

# 7. Local Application Storage

Use an application data directory resolved per operating system.

Preferred locations:

```text
macOS:   ~/Library/Application Support/AgentLens/
Linux:   ~/.local/share/agentlens/
Windows: %LOCALAPPDATA%\AgentLens\
```

Allow an override through:

```text
AGENTLENS_HOME
```

Store:

```text
<agentlens-home>/
├── agentlens.sqlite
├── config.json
├── backups/
├── event-spool/
├── exports/
├── logs/
└── runtime/
```

Requirements:

- Create directories with restrictive permissions where supported.
- Store the database with restrictive permissions.
- Rotate logs.
- Redact logs.
- Do not log prompt bodies by default.
- Do not log raw hook payloads by default.
- Provide a command that prints the resolved data paths.

---

# 8. Privacy Modes

Implement three modes.

## 8.1 Metadata-only

Persist:

- Session identifiers.
- Timestamps.
- Tool names.
- Durations.
- Token metrics.
- Cost estimates.
- File-path hashes or optionally redacted relative paths.
- Command classifications.
- Success and failure status.
- Derived metrics.

Do not persist:

- Prompt text.
- Assistant text.
- Full tool input.
- Full tool output.
- Full shell commands containing arguments.

## 8.2 Redacted-content

Persist:

- Redacted user prompts.
- Redacted command text.
- Redacted relative file paths.
- Sanitised tool metadata.
- Derived prompt features.

Do not persist:

- Assistant response bodies by default.
- Source-file contents.
- Raw environment variables.
- Authentication data.
- Full command output.

This should be the recommended mode during interactive setup.

## 8.3 Full-local

Persist additional local content only after a strong warning and explicit opt-in.

Even in full-local mode:

- Apply secret detection.
- Never persist environment-variable values identified as secrets.
- Never persist authentication headers.
- Never persist known API key formats.
- Never transmit data externally.

## 8.4 Redaction system

Implement a redaction pipeline supporting:

- API keys.
- Bearer tokens.
- JWTs.
- Private keys.
- Password assignments.
- Connection strings.
- Cookies.
- Authorization headers.
- Common cloud credentials.
- `.env` values.
- User-defined regular expressions.
- User-defined replacement labels.
- Email redaction option.
- Absolute home-directory redaction.
- Repository-path anonymisation option.

Redaction must occur before database persistence and before logging.

Store both:

- A safe redacted representation.
- A stable hash where correlation is needed.

Never store the original secret alongside the redacted version.

---

# 9. Configuration

Create a versioned configuration schema.

Example:

```json
{
  "version": 1,
  "privacy": {
    "mode": "redacted-content",
    "retentionDays": 90,
    "redactEmails": false,
    "redactHomePath": true,
    "storeAssistantResponses": false,
    "customPatterns": []
  },
  "sources": {
    "claudeCode": {
      "enabled": true,
      "transcriptDirectories": [],
      "excludedProjects": [],
      "followSymlinks": false
    }
  },
  "analysis": {
    "minimumRecommendationConfidence": 0.65,
    "ruleOverrides": {}
  },
  "dashboard": {
    "host": "127.0.0.1",
    "port": 47821,
    "openBrowser": true
  },
  "externalAnalysis": {
    "enabled": false,
    "provider": "none",
    "model": null
  }
}
```

Requirements:

- Validate with Zod.
- Migrate old versions safely.
- Preserve unknown future-compatible keys where reasonable.
- Provide `agentlens config validate`.
- Provide `agentlens config path`.
- Never include API keys in this file unless a secure storage fallback is absolutely necessary.
- Prefer environment variables or OS credential storage for external provider keys.

---

# 10. Domain Model

Create provider-neutral domain types.

At minimum, model the following entities:

## 10.1 Source

```ts
interface DataSource {
  id: string;
  adapter: string;
  displayName: string;
  version?: string;
  enabled: boolean;
}
```

## 10.2 Project

```ts
interface Project {
  id: string;
  sourceId: string;
  displayName: string;
  pathHash: string;
  redactedPath?: string;
  repositoryRemoteHash?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
```

## 10.3 Session

Include:

- Source session ID.
- Project.
- Start and end time.
- Duration.
- Active duration where available.
- Entry point.
- Claude Code version where available.
- Completion status.
- Privacy mode used during import.
- Data-completeness indicators.
- Number of prompts.
- Number of model requests.
- Number of tool calls.
- Number of compactions.
- Number of subagents.
- Import provenance.

## 10.4 Prompt

Include:

- Sequence.
- Timestamp.
- Redacted content where permitted.
- Content hash.
- Character count.
- Approximate token count clearly labelled as approximate.
- Derived prompt features.
- Whether it appears corrective.
- Whether it begins a likely new task.
- Whether it references acceptance criteria.
- Whether it requests verification.
- Whether it contains multiple independent tasks.

## 10.5 Model request

Include:

- Model identifier.
- Model family or configured tier.
- Input tokens.
- Output tokens.
- Cache-read tokens.
- Cache-creation tokens.
- Estimated cost.
- Duration.
- Effort where available.
- Query source.
- Agent, skill or plugin attribution where available.
- Metric provenance.

## 10.6 Tool call

Include:

- Tool name.
- Tool-use ID.
- Start and end time.
- Duration.
- Success.
- Failure type.
- Permission outcome.
- Sanitised input.
- Input and output sizes.
- Associated prompt or model request.
- Subagent attribution.
- Source provenance.

## 10.7 File activity

Normalise tool calls into:

- Read.
- Write.
- Edit.
- Delete.
- Search.
- List.
- Unknown.

Track:

- Redacted relative path.
- Stable path hash.
- Timestamp.
- Operation.
- Success.
- Content size when available.
- Whether an intervening modification occurred.

## 10.8 Command run

Extract safe command metadata:

- Executable.
- Command family.
- Redacted command.
- Stable normalised-command hash.
- Test/build/lint/typecheck classification.
- Scope classification.
- Exit success.
- Duration.
- Output size.
- Failure signature.
- Git commit ID where safely available.

## 10.9 Verification run

Classify commands into:

- Unit test.
- Integration test.
- End-to-end test.
- Type check.
- Lint.
- Format check.
- Build.
- Security scan.
- Unknown verification.

Track whether code changed after the run.

## 10.10 Compaction

Include:

- Trigger.
- Success.
- Duration.
- Approximate pre-compaction tokens.
- Approximate post-compaction tokens.
- Source provenance.

## 10.11 Recommendation

Use a structure equivalent to:

```ts
interface Recommendation {
  id: string;
  ruleId: string;
  ruleVersion: number;
  sessionId?: string;
  projectId?: string;

  category:
    | "context"
    | "prompt"
    | "model"
    | "tools"
    | "workflow"
    | "verification"
    | "security"
    | "configuration";

  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: number;
  status: "active" | "dismissed" | "resolved" | "superseded";

  title: string;
  summary: string;
  explanation: string;

  evidence: RecommendationEvidence[];

  estimatedImpact?: {
    tokenRange?: {
      minimum: number;
      maximum: number;
    };
    costUsdRange?: {
      minimum: number;
      maximum: number;
    };
    durationMsRange?: {
      minimum: number;
      maximum: number;
    };
    confidence: number;
    methodology: string;
  };

  remediation?: {
    type:
      | "instruction"
      | "settings-patch"
      | "claude-md-patch"
      | "skill"
      | "hook"
      | "permission-rule"
      | "workflow";
    preview: string;
    targetPath?: string;
    automaticallyApplicable: boolean;
  };
}
```

Recommendation evidence must be structured, queryable and renderable.

---

# 11. Source Adapter Interface

Create a provider-neutral interface similar to:

```ts
interface SourceAdapter {
  readonly id: string;
  readonly displayName: string;

  discover(context: DiscoveryContext): Promise<DiscoveredSource[]>;
  scan(input: ScanInput): AsyncIterable<NormalisedSourceEvent>;
  validateSource(source: DiscoveredSource): Promise<SourceValidationResult>;
  getCapabilities(): SourceCapabilities;
}
```

The Claude Code adapter must be the first implementation.

Do not let dashboard or analysis code consume raw Claude transcript shapes directly.

---

# 12. Claude Code Compatibility Requirements

Before implementing Claude Code-specific behaviour:

1. Consult the latest official Claude Code documentation.
2. Review the current documentation for:
   - Data usage and local application data.
   - Hooks.
   - Hooks reference.
   - Monitoring and OpenTelemetry.
   - Settings.
   - Permissions.
   - Security.
   - Plugins.
   - Plugin reference.
3. Treat undocumented transcript fields as unstable.
4. Use tolerant parsers.
5. Do not assume every transcript uses the same schema.
6. Do not fail an entire scan because one line is unknown or malformed.
7. Record parser diagnostics and continue safely.

Current known integration points include:

- Local Claude Code transcript files.
- Claude Code lifecycle hooks.
- Claude Code plugins.
- Claude Code OpenTelemetry metrics and events.
- User, project and local settings scopes.

Validate all current field names and event schemas before relying on them.

---

# 13. Phase 1 — Read-Only Analytics MVP

Phase 1 must work before hooks or OpenTelemetry are configured.

## 13.1 Transcript discovery

Implement:

```bash
agentlens scan
```

The command must:

- Discover standard Claude Code transcript locations.
- Support additional configured directories.
- Allow `--path`.
- Allow `--project`.
- Allow `--since`.
- Allow `--until`.
- Allow `--dry-run`.
- Allow `--force`.
- Allow `--json`.
- Respect project exclusions.
- Display what will be scanned.
- Never mutate Claude Code transcript files.

## 13.2 Streaming parser

Transcript files may be large.

Implement a line-streaming JSONL parser that:

- Does not load full files into memory.
- Handles an incomplete final line.
- Handles malformed JSON.
- Handles unknown record types.
- Uses tolerant Zod schemas.
- Preserves useful unknown metadata only after sanitisation.
- Produces parser diagnostics.
- Continues after recoverable errors.
- Supports cancellation.
- Supports incremental imports.

## 13.3 Incremental indexing

Do not fully re-import every transcript on each scan.

Track:

- Source file.
- Safe file identity.
- Size.
- Modified time.
- Last processed byte offset.
- Last processed line.
- Safe rolling hash.
- Import version.

Requirements:

- Detect truncation.
- Detect replacement.
- Reprocess when parser versions require it.
- Avoid duplicate sessions and events.
- Use transactions.
- Make interrupted scans resumable.

## 13.4 Session reconstruction

Reconstruct session timelines from transcript records.

Where information is incomplete:

- Preserve partial sessions.
- Mark data completeness.
- Avoid inventing timestamps or metrics.
- Label inferred values.

## 13.5 Initial analytics

Calculate:

### Usage

- Sessions per day, week and month.
- Active days.
- Session duration.
- Median session duration.
- Prompts per session.
- Tool calls per session.
- Tool success rate.
- Model usage where available.
- Tokens where available.
- Cache usage where available.
- Estimated cost where available.
- Compactions where available.
- Subagent usage where available.

### Tool behaviour

- Most-used tools.
- Tool failure rates.
- Average tool duration.
- Repeated reads.
- Repeated searches.
- Repeated commands.
- Repeated failed commands.
- Largest tool inputs and outputs.
- Test-command frequency.
- Build-command frequency.

### Workflow behaviour

- Files changed per session.
- Read-to-write ratio.
- Verification runs.
- Sessions ending after successful verification.
- Sessions ending with known failures.
- Changes after final verification.
- Corrective prompt count.
- Time spent before first edit.
- Time between final edit and verification.

Every metric must expose provenance and confidence.

## 13.6 Estimated cost handling

Use the following priority:

1. Claude Code-reported estimated cost.
2. Provider telemetry estimate.
3. Versioned configurable model-price registry.
4. Unknown.

Do not calculate cost when model identity or pricing is ambiguous.

Display:

> Estimated cost — not an official billing value.

## 13.7 CLI reports

Implement:

```bash
agentlens report
agentlens report --period week
agentlens report --period month
agentlens report --project <project>
agentlens report --session <session>
agentlens report --format markdown
agentlens report --format json
agentlens report --output <path>
```

The terminal report should show:

- Summary.
- Usage.
- Most important findings.
- Verification quality.
- Tool efficiency.
- Data completeness.
- Top recommendations.
- Privacy mode.
- Scan provenance.

## 13.8 Dashboard command

Implement:

```bash
agentlens dashboard
```

This command must:

- Start the local API.
- Start or serve the built dashboard.
- Bind to loopback.
- Open the browser unless disabled.
- Reuse a healthy existing local instance.
- Handle occupied ports safely.
- Print the local URL.
- Shut down cleanly.

## 13.9 Phase 1 dashboard screens

### Onboarding

Show:

- What AgentLens reads.
- Where data remains.
- Privacy-mode selection.
- Discovered Claude Code data.
- Project exclusions.
- First-scan preview.

### Overview

Show:

- Sessions.
- Active time.
- Prompts.
- Tool calls.
- Token usage.
- Estimated cost.
- Tool success rate.
- Verified completion rate.
- Recommendation count.
- Trends over time.
- Data-completeness notices.

### Sessions

Provide:

- Search.
- Project filter.
- Date filter.
- Model filter.
- Status filter.
- Sort.
- Pagination or virtualisation.

### Session detail

Display a timeline containing:

- Prompts.
- Model requests.
- Tool calls.
- File operations.
- Command runs.
- Verification runs.
- Failures.
- Compactions.
- Recommendations.

Never display content unavailable under the selected privacy mode.

### Projects

Show per-project:

- Usage.
- Tool patterns.
- Verification quality.
- Recommendation trends.
- Scan status.

### Recommendations

Show:

- Severity.
- Category.
- Confidence.
- Evidence.
- Estimated impact.
- Remediation.
- Dismiss and restore actions.

### Privacy and settings

Show:

- Active privacy mode.
- Stored-data categories.
- Retention.
- Excluded projects.
- Redaction patterns.
- Data location.
- Delete controls.
- Export controls.

## 13.10 Phase 1 deterministic recommendation rules

Implement at least these rules.

### `TOOLS-001` Repeated unchanged file reads

Trigger when the same file is read repeatedly without an intervening write or edit.

Evidence:

- File.
- Read count.
- Time range.
- Intervening modifications.

### `TOOLS-002` Repeated equivalent command

Trigger when a normalised command is executed repeatedly within a short period.

Distinguish legitimate watch commands and polling where possible.

### `TOOLS-003` Repeated unchanged failure

Trigger when materially identical commands fail repeatedly without a meaningful change in arguments or surrounding strategy.

### `TOOLS-004` Excessive broad test runs

Trigger when a broad/full test suite is repeatedly run after changes limited to a narrow project area and narrower test commands appear available.

Keep confidence conservative.

### `TOOLS-005` Oversized tool result

Trigger when command or tool output is unusually large and is likely to contribute unnecessary context.

### `TOOLS-006` High exploration-to-change ratio

Trigger when a session reads or searches a large number of files but changes very few files.

Do not assume exploration is always wasteful. Require sufficient evidence and use moderate confidence.

### `VERIFY-001` No verification after code changes

Trigger when code changes occurred but no recognised verification command followed.

### `VERIFY-002` Changes after final successful verification

Trigger when files changed after the last successful test, build, lint or typecheck.

### `VERIFY-003` Session ended with failed verification

Trigger when the latest relevant verification command failed and no later success occurred.

### `VERIFY-004` Narrow verification only

Trigger when a substantial cross-cutting change received only an obviously narrow verification step.

Use conservative confidence.

### `WORKFLOW-001` Excessive corrective turns

Trigger when multiple user prompts appear to correct, reverse or clarify prior work.

Initially use deterministic phrases and structural indicators.

### `WORKFLOW-002` Very long session with task switching

Use only conservative deterministic indicators in Phase 1.

Improve this semantically in Phase 3.

### `CONTEXT-001` Frequent compaction

Trigger when a session experiences repeated compactions or unusually high pre-compaction context.

### `CONTEXT-002` Large repeated outputs

Trigger when large command outputs repeatedly enter the session.

### `SECURITY-001` Sensitive path access

Trigger on likely sensitive files such as:

- `.env`
- Credential files.
- Private keys.
- Secret directories.
- Cloud credential locations.

Do not expose the sensitive value.

### `SECURITY-002` Potential secret in persisted content

Trigger when the redaction pipeline detects a likely secret.

Store only the finding category, not the secret.

Each rule must include:

- Version.
- Configurable threshold.
- Severity.
- Confidence calculation.
- Evidence builder.
- Explanation.
- Remediation.
- Tests.
- Documentation.

## 13.11 Phase 1 acceptance criteria

Phase 1 is complete only when:

- A fresh installation can scan synthetic Claude Code fixtures.
- A scan can be run repeatedly without duplicates.
- Malformed transcript lines do not crash the scan.
- The database contains reconstructed sessions and events.
- At least 16 deterministic rules execute.
- Reports are available in terminal, JSON and Markdown.
- The dashboard displays real database data.
- Session timelines work.
- Privacy-mode restrictions are enforced.
- Redaction occurs before persistence.
- Retention and deletion work.
- Unit, integration and Playwright tests pass.
- The production build succeeds.

---

# 14. Phase 2 — Live Observation

Phase 2 adds opt-in hooks and OpenTelemetry ingestion.

## 14.1 Claude Code plugin

Build a distributable Claude Code plugin under:

```text
plugins/agentlens-claude/
```

The plugin must contain:

- A valid plugin manifest.
- Hook configuration.
- Cross-platform collection scripts or a stable AgentLens hook executable.
- Documentation.
- Version metadata.
- A health-check mechanism.

The plugin must be observation-only.

It must never:

- Approve tool calls.
- Deny tool calls.
- Change Claude’s prompt.
- Add context to Claude.
- Block a session.
- Alter tool inputs.
- Modify user files.
- Execute analysis inside the hook process.

## 14.2 Hook events

Where supported by the current Claude Code version, capture useful metadata from:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PermissionDenied`
- `PostToolUse`
- `PostToolUseFailure`
- `PostToolBatch`
- `SubagentStart`
- `SubagentStop`
- `Stop`
- `StopFailure`
- `InstructionsLoaded`
- `ConfigChange`
- `PreCompact`
- `PostCompact`
- `SessionEnd`

Verify current event schemas against official documentation.

The collector must tolerate:

- Missing fields.
- New fields.
- Removed fields.
- Unknown tools.
- Unknown hook events.
- Different Claude Code versions.

## 14.3 Low-latency hook capture

Hook processing must be extremely lightweight.

Target:

- Read JSON from stdin.
- Validate minimal required fields.
- Redact immediately.
- Write an atomic event to a local spool or send it to the local collector.
- Exit successfully.
- Never delay Claude Code unnecessarily.

Preferred behaviour:

1. Attempt delivery to the loopback collector with a short timeout.
2. If unavailable, write an atomic spool file.
3. Exit without blocking the Claude Code session.
4. Let the AgentLens collector process the spool later.

Do not perform database migrations, recommendations or expensive analysis inside a Claude Code hook.

## 14.4 Correlation

Use available identifiers to correlate:

- Session.
- Tool use.
- Prompt.
- Subagent.
- Hook event.
- OpenTelemetry event.
- Transcript event.

Where exact correlation is impossible, store the relationship as inferred with a confidence level.

## 14.5 Integration commands

Implement:

```bash
agentlens integrate claude-code
agentlens integrate claude-code --status
agentlens integrate claude-code --remove
agentlens integrate claude-code --dry-run
```

The install flow must:

1. Detect Claude Code.
2. Detect its version where possible.
3. Inspect existing settings safely.
4. Show planned files and changes.
5. Back up affected files.
6. Install or register the plugin.
7. Avoid overwriting unrelated hooks.
8. Preserve formatting where practical.
9. Validate the resulting configuration.
10. Run a health check.
11. Explain rollback.

Removal must remove only AgentLens-owned configuration.

## 14.6 OpenTelemetry receiver

Implement a lightweight local receiver for Claude Code telemetry.

Support OTLP over HTTP using a protocol currently supported by Claude Code.

At minimum ingest:

- Metrics.
- Events/logs.

Tracing may be added behind an experimental setting but must not be required.

Implement endpoints equivalent to:

```text
POST /v1/metrics
POST /v1/logs
POST /v1/traces
```

Requirements:

- Bind to loopback.
- Enforce request-size limits.
- Reject unsupported content types safely.
- Parse valid payloads.
- Persist normalised events.
- Preserve source provenance.
- Deduplicate retransmissions.
- Support graceful shutdown.
- Provide health and readiness endpoints.
- Never expose the receiver externally by default.

## 14.7 Telemetry configuration

Provide commands:

```bash
agentlens telemetry configure
agentlens telemetry status
agentlens telemetry print-env
agentlens telemetry remove
```

Generate a minimal configuration that enables only required telemetry.

Privacy defaults:

- User-prompt telemetry logging disabled.
- Assistant-response logging disabled.
- Tool-content logging disabled.
- Raw API body logging disabled.
- Tool details optional and separately explained.
- Tracing disabled unless explicitly enabled.

Do not overwrite existing telemetry configuration without showing a merge plan.

## 14.8 Telemetry events

Normalise currently available Claude Code data such as:

- Session count.
- Active time.
- Lines changed.
- Token usage.
- Estimated cost.
- Model attribution.
- API request duration.
- Cache tokens.
- Query source.
- Tool result.
- Tool duration.
- Tool success.
- Tool failure.
- Tool input and output size.
- Tool permission decisions.
- API errors.
- Compaction.
- Agent, skill, plugin and MCP attribution where available.

Do not assume all versions emit all fields.

## 14.9 Live collector

Implement:

```bash
agentlens observe
```

The command must:

- Start the local API.
- Start hook-event ingestion.
- Start OTLP ingestion.
- Process existing spool events.
- Watch for new spool events.
- Run incremental analysis.
- Stream updates to the dashboard.
- Show status in the terminal.
- Shut down cleanly.

`agentlens dashboard` may also start observation unless disabled.

## 14.10 Live dashboard

Add:

- Live session indicator.
- Current session duration.
- Current prompt count.
- Current tool calls.
- Current failures.
- Current token and cost metrics where available.
- Recent events.
- Collector health.
- Hook health.
- Telemetry health.
- Last event time.
- Spool backlog.
- Data-source status.

Use Server-Sent Events rather than aggressive polling.

## 14.11 Phase 2 acceptance criteria

Phase 2 is complete only when:

- The Claude Code plugin validates.
- Hook events are captured without changing Claude behaviour.
- Hook capture works when the collector is online.
- Hook capture falls back to the spool when offline.
- Spool events are imported later.
- OpenTelemetry metrics and logs are ingested.
- Hook and telemetry events correlate with sessions.
- Live dashboard updates appear without refresh.
- Integration removal leaves unrelated settings intact.
- No sensitive telemetry content is enabled by default.
- Receiver endpoints reject malformed or oversized requests safely.
- Cross-platform path and process behaviour is tested.
- All tests and builds pass.

---

# 15. Phase 3 — Coaching and Configuration Doctor

Phase 3 turns the collected data into personalised coaching and safe remediations.

## 15.1 Recommendation engine architecture

Implement a versioned rule engine.

Each rule must expose an interface similar to:

```ts
interface RecommendationRule {
  readonly id: string;
  readonly version: number;
  readonly category: RecommendationCategory;

  evaluate(context: AnalysisContext): Promise<RecommendationCandidate[]>;

  explain(candidate: RecommendationCandidate): RecommendationExplanation;
}
```

Requirements:

- Rules are independently testable.
- Rules can be enabled or disabled.
- Thresholds can be overridden.
- Rule versions are persisted.
- Old recommendations can be superseded.
- Duplicate recommendations are consolidated.
- Resolved recommendations can reappear only when new evidence warrants it.
- Confidence must be deterministic for deterministic rules.
- Recommendation generation must be reproducible.

## 15.2 Recommendation ranking

Rank using:

- Severity.
- Confidence.
- Estimated impact.
- Recency.
- Frequency.
- Whether the behaviour appears across sessions.
- Whether remediation is actionable.
- Whether the user dismissed similar advice.

Avoid flooding the user.

Default views should show a manageable number of high-value recommendations.

## 15.3 Behavioural baselines

Build personal and project baselines.

Examples:

- Typical session duration.
- Typical tool-call count.
- Typical test frequency.
- Normal read-to-write ratio.
- Normal output sizes.
- Typical compaction count.
- Normal model distribution.
- Normal corrective-turn count.

Compare a session with:

- The user’s overall baseline.
- The project baseline.
- Recent historical behaviour.

Do not compare users against invented industry averages.

## 15.4 Expanded recommendation categories

### Context efficiency

Detect:

- Sessions with repeated compaction.
- Unrelated task switching.
- Excessive stale context.
- Large repeated tool output.
- Instructions loaded in every session but rarely relevant.
- Excessive always-on plugin or skill context where measurable.
- Verbose exploration that could be delegated.
- Repeatedly reloading architectural information.

### Prompt effectiveness

Detect:

- Unclear objective.
- Missing scope boundary.
- Missing acceptance criteria.
- Missing verification request.
- Multiple independent tasks in one prompt.
- Vague references such as “fix this” without a clear target.
- Repeated user corrections.
- Reversal of prior implementation.
- Prompt and outcome mismatch.
- Recurring prompt patterns suitable for a skill.

Do not equate prompt length with prompt quality.

### Model selection

Create a configurable model catalogue containing:

- Model identifier patterns.
- Provider.
- Relative capability tier.
- Relative cost tier.
- Context characteristics.
- Recommended task classes.
- Effective dates.
- User overrides.

Recommendations must be relative and configurable.

Do not hardcode a permanent statement that a particular named model is always best or cheapest.

Detect:

- High-cost tier used for mechanical work.
- Lower-capability tier struggling repeatedly with a complex task.
- Large stale context repeatedly sent to a premium model.
- Excessive high-effort settings for simple work.
- Agent teams or subagents used where overhead appears greater than benefit.
- Complex work kept in one main context where isolated subagents might reduce noise.

### Tool efficiency

Detect:

- Duplicate reads.
- Duplicate searches.
- Repeated equivalent commands.
- Repeated failures.
- Broad test overuse.
- Huge unfiltered output.
- File-by-file exploration.
- Tool calls immediately reversed.
- Repeated edits to the same region.
- Unused or failing MCP tools.
- Repeated permission friction.
- Missing code-intelligence support inferred from inefficient symbol exploration.

### Workflow quality

Detect:

- Large changes without planning indicators.
- Plans created but repeatedly abandoned.
- Research and implementation mixed inefficiently.
- Long sessions containing multiple unrelated objectives.
- Lack of logical checkpoints.
- No final review.
- Repeated manual workflow that should be a skill.
- Deterministic validation that should be a hook.
- Repeated architectural explanation that should be project instructions.

### Verification quality

Detect:

- No tests.
- No typecheck.
- No lint.
- No build.
- Failed verification ignored.
- Code changed after verification.
- Tests weakened after implementation failure.
- Verification limited to unrelated areas.
- Completion claim before successful verification.
- Repeated user requests to “actually run” or “verify” the result.

### Security and configuration

Detect:

- Sensitive file access.
- Broad read permissions.
- Broad shell allow rules.
- Potentially dangerous auto-approval.
- Untrusted MCP configuration.
- Secrets in prompts or commands.
- External analysis enabled without appropriate safeguards.
- Project instructions containing secrets.
- Overly broad AgentLens exclusions or retention.
- Network binding beyond loopback.

## 15.5 Prompt Coach

Create a Prompt Coach feature with two layers.

### Deterministic layer

Analyse prompts without an LLM using:

- Structural parsing.
- Imperative-verb detection.
- Scope markers.
- File references.
- Acceptance-criteria markers.
- Verification markers.
- Multiple-task indicators.
- Correction phrases.
- Reversal phrases.
- Ambiguous pronouns and references.
- Length and complexity features.
- Repeated prompt-template detection.

Produce:

- Prompt-quality dimensions.
- Evidence.
- Suggested missing components.
- A deterministic improved structure.

### Optional semantic layer

Create a provider interface:

```ts
interface CoachingProvider {
  readonly id: string;
  analysePrompt(input: RedactedPromptAnalysisInput): Promise<SemanticPromptAnalysis>;

  classifyTask(input: RedactedTaskClassificationInput): Promise<TaskClassification>;

  generateRemediation(input: RedactedRemediationInput): Promise<GeneratedRemediation>;
}
```

Implement:

- `none` provider.
- Deterministic provider.
- Generic OpenAI-compatible provider.
- Local-model configuration suitable for tools such as Ollama or LM Studio.

External providers must be disabled by default.

Before sending content externally:

1. Show exactly what categories of data will be sent.
2. Redact it.
3. Show a preview.
4. Require explicit enablement.
5. Allow per-request cancellation.
6. Clearly mark externally generated advice.

Do not silently send entire transcripts.

## 15.6 Prompt comparison

For a selected prompt, show:

- Original redacted prompt.
- Detected strengths.
- Detected ambiguities.
- Missing constraints.
- Relevant outcome evidence.
- Suggested improved prompt.
- Explanation of each change.

Example style:

```text
Original:
Review this and fix any issues.

Observed outcome:
- 38 files inspected.
- Three corrective prompts.
- Two implementations reversed.
- Tests were not run until requested separately.

Suggested:
Review the authentication refresh-token flow for correctness,
security vulnerabilities and race conditions. Implement only confirmed
issues, add regression tests, run the authentication test suite and
typecheck, then summarise changed behaviour and remaining risks.
```

Never claim the revised prompt guarantees better results.

## 15.7 Configuration Doctor

Implement:

```bash
agentlens doctor
agentlens doctor --project <path>
agentlens doctor --json
agentlens doctor --fix
agentlens doctor --dry-run
```

Without `--fix`, it must be read-only.

Inspect relevant Claude Code configuration such as:

- User settings.
- Project settings.
- Local settings.
- `CLAUDE.md`.
- Local Claude instruction files.
- `.claude/rules/`.
- Agents.
- Skills.
- Commands.
- Hooks.
- MCP configuration.
- Plugin configuration.
- Permission rules.

Verify current locations and formats against official documentation.

## 15.8 Doctor checks

Implement checks for:

### Instructions

- Missing project instructions.
- Extremely large instruction files.
- Duplicate instructions.
- Conflicting instructions.
- Highly specialised instructions loaded globally.
- Instructions rarely relevant to observed sessions.
- Missing build, test or verification commands.
- Missing architecture overview.
- Missing repository boundaries.
- Sensitive content.
- Stale file references.
- Instructions better represented as a skill.

Token-cost estimates for instruction files must be labelled approximate unless sourced from exact telemetry.

### Skills and commands

- Repeated workflows suitable for a skill.
- Duplicate skills.
- Poorly scoped descriptions.
- Always-on text that should be on-demand.
- Skills never used.
- Skills repeatedly failing.
- Missing validation around generated actions.

### Hooks

- Repeated deterministic tasks suitable for hooks.
- Duplicate hooks.
- Blocking or slow hooks.
- Hooks with unsafe broad matchers.
- Hooks that modify behaviour unexpectedly.
- AgentLens hook health.
- Hook scripts that no longer exist.

### Agents and subagents

- Repeated tasks suitable for a specialised agent.
- Overly broad tool access.
- Missing limits.
- Agent descriptions that cause accidental invocation.
- Agents never used.
- Excessive subagent overhead.
- Tasks where isolated context would likely help.

### MCP

- Configured but unused servers.
- Repeatedly failing servers.
- Broad permissions.
- Unknown or untrusted command paths.
- Environment values likely containing secrets.
- Servers contributing overhead without observed value.

### Permissions

- Broad wildcard allow rules.
- Dangerous shell patterns.
- Sensitive paths not denied.
- Network commands broadly allowed.
- Bypass-permission modes.
- Conflicts across scopes.
- Rules that never match.
- Rules causing repeated friction.

## 15.9 Safe patch generation

Doctor findings may produce:

- JSON settings patch.
- Unified diff.
- Suggested permission rule.
- Suggested `CLAUDE.md` change.
- New skill.
- New hook.
- New agent configuration.
- MCP removal suggestion.

Requirements:

- Use minimal diffs.
- Preserve unrelated configuration.
- Preserve comments and formatting where possible.
- Validate after applying.
- Back up before applying.
- Support rollback.
- Refuse unsafe or ambiguous modifications.
- Never auto-enable bypass permissions.
- Never auto-enable external data transmission.

## 15.10 Generated skills

When AgentLens detects a repeated workflow, generate a draft skill containing:

- Clear name.
- Description.
- Invocation guidance.
- Required inputs.
- Bounded responsibilities.
- Step-by-step workflow.
- Verification requirements.
- Failure handling.
- Safety constraints.
- Supporting scripts only when necessary.

The skill must be presented as a reviewable draft.

## 15.11 Generated hooks

When AgentLens detects a deterministic repeated action, generate a draft hook containing:

- Narrow event selection.
- Narrow matcher.
- Safe script.
- Timeout.
- Cross-platform considerations.
- Expected input.
- Expected output.
- Failure behaviour.
- Rollback instructions.
- Tests.

Do not use an LLM hook for work that can be deterministic.

## 15.12 Coaching dashboard

Add screens or sections for:

### Coaching overview

- Top opportunities.
- Improvements over time.
- Repeated behaviours.
- Estimated avoidable usage.
- Verification trend.
- Prompt-quality trend.
- Model-allocation trend.

### Prompt Coach

- Prompt list.
- Prompt score dimensions.
- Outcome correlation.
- Improved prompt.
- Recurring templates.
- Candidate skills.

### Configuration Doctor

- Overall health.
- Findings by scope.
- Proposed patches.
- Diff preview.
- Apply.
- Rollback.
- Validation status.

### Recommendation detail

Show:

- Finding.
- Why it matters.
- Evidence.
- Confidence.
- Baseline comparison.
- Estimated impact.
- Remediation.
- Proposed patch.
- Related sessions.
- Dismiss, resolve and reopen controls.

## 15.13 Phase 3 acceptance criteria

Phase 3 is complete only when:

- Recommendations use structured evidence.
- Personal and project baselines work.
- Prompt Coach works without an external model.
- External semantic analysis remains disabled by default.
- External analysis requires explicit configuration and preview.
- Doctor performs useful read-only checks.
- Doctor generates valid minimal patches.
- `--dry-run` never changes files.
- `--fix` requires explicit confirmation.
- Backups and rollback work.
- Skills and hooks can be generated as drafts.
- Model recommendations use a configurable catalogue.
- The dashboard shows coaching and Doctor results.
- Recommendation dismissal and resolution persist.
- All tests, builds and end-to-end workflows pass.

---

# 16. Required CLI Surface

Implement a coherent CLI including:

```bash
agentlens init

agentlens scan
agentlens scan --dry-run
agentlens scan --force
agentlens scan --path <path>
agentlens scan --project <project>
agentlens scan --since <date>
agentlens scan --until <date>
agentlens scan --json

agentlens report
agentlens report --period day
agentlens report --period week
agentlens report --period month
agentlens report --project <project>
agentlens report --session <session>
agentlens report --format terminal
agentlens report --format markdown
agentlens report --format json
agentlens report --output <path>

agentlens dashboard
agentlens observe

agentlens integrate claude-code
agentlens integrate claude-code --status
agentlens integrate claude-code --dry-run
agentlens integrate claude-code --remove

agentlens telemetry configure
agentlens telemetry status
agentlens telemetry print-env
agentlens telemetry remove

agentlens doctor
agentlens doctor --project <path>
agentlens doctor --dry-run
agentlens doctor --fix
agentlens doctor --json

agentlens config path
agentlens config validate
agentlens config get <key>
agentlens config set <key> <value>

agentlens privacy status
agentlens privacy purge
agentlens privacy purge --project <project>
agentlens privacy export
agentlens privacy paths

agentlens rules list
agentlens rules explain <rule-id>
agentlens rules enable <rule-id>
agentlens rules disable <rule-id>

agentlens status
agentlens version
```

All applicable commands must support:

- `--help`
- Useful exit codes.
- Clear errors.
- Non-interactive behaviour.
- `--json` where automation is reasonable.

---

# 17. API Requirements

Create a versioned local API.

Suggested route groups:

```text
/api/v1/health
/api/v1/status
/api/v1/onboarding
/api/v1/scans
/api/v1/projects
/api/v1/sessions
/api/v1/events
/api/v1/metrics
/api/v1/recommendations
/api/v1/rules
/api/v1/prompts
/api/v1/doctor
/api/v1/remediations
/api/v1/privacy
/api/v1/settings
/api/v1/live
```

Requirements:

- Validate request and response data.
- Return stable error shapes.
- Paginate large collections.
- Avoid returning sensitive fields unavailable in the active privacy mode.
- Protect mutation endpoints against browser-origin abuse.
- Use a local runtime token or equivalent CSRF protection.
- Restrict allowed origins.
- Do not enable permissive CORS.
- Do not expose arbitrary filesystem access through API parameters.

---

# 18. UI and UX Requirements

The interface should feel like a polished developer tool rather than an enterprise telemetry console.

## 18.1 Visual direction

- Clean.
- Modern.
- Minimal.
- Calm.
- Information-dense without clutter.
- Strong hierarchy.
- Good empty states.
- Helpful explanations.
- Dark and light themes.
- Accessible contrast.
- No unnecessary gradients.
- No novelty animations.
- No excessive cards nested inside cards.

## 18.2 Recommendation language

Use constructive language.

Prefer:

> This file was read six times without an intervening edit. Capturing its architecture in project instructions may reduce repeated exploration.

Avoid:

> You used Claude badly.

## 18.3 Confidence display

Display confidence as:

- High confidence.
- Moderate confidence.
- Low confidence.

Allow users to inspect the underlying numeric score and methodology.

## 18.4 Empty states

Provide useful empty states for:

- No transcripts found.
- No scan performed.
- No telemetry configured.
- No active session.
- No recommendations.
- Metadata-only mode.
- Project excluded.
- Collector offline.

## 18.5 Accessibility

- Keyboard navigation.
- Visible focus indicators.
- Semantic headings.
- Accessible chart summaries.
- Reduced-motion support.
- Screen-reader labels.
- Do not communicate severity using colour alone.

---

# 19. Security Requirements

## 19.1 Local server

- Bind to loopback only by default.
- Reject non-loopback binding unless explicitly configured with a warning.
- Use random runtime credentials for mutating API requests.
- Limit request bodies.
- Apply safe timeouts.
- Avoid directory traversal.
- Avoid shell interpolation.
- Avoid evaluating configuration as code.

## 19.2 Filesystem

- Canonicalise paths.
- Detect symlink traversal.
- Do not follow symlinks by default.
- Prevent reads outside approved source locations.
- Prevent Doctor patches outside approved Claude Code configuration paths.
- Validate backup and restore paths.

## 19.3 Hook ingestion

Treat hook payloads as untrusted input.

- Validate.
- Redact.
- Limit size.
- Never execute payload content.
- Never pass payload strings to a shell.
- Never trust file paths without canonicalisation.

## 19.4 Dashboard rendering

- Escape all user-controlled text.
- Do not render transcript HTML.
- Do not execute ANSI control sequences.
- Neutralise terminal escape sequences.
- Do not create clickable command links that execute actions.

## 19.5 External analysis

- Disabled by default.
- Explicit opt-in.
- Explicit provider and model.
- Redaction before transmission.
- Preview.
- Clear disclosure.
- Request timeout.
- No automatic retries containing sensitive data without user awareness.
- No remote provider keys in logs.

---

# 20. Performance Requirements

Set and test reasonable targets.

## 20.1 Scanning

- Stream large JSONL files.
- Use bounded memory.
- Batch database writes.
- Use transactions.
- Avoid repeated parsing.
- Support cancellation.
- Report progress.
- Remain responsive while scanning.

## 20.2 Dashboard

- Paginate or virtualise long session timelines.
- Aggregate metrics in SQL where appropriate.
- Avoid loading all events into the browser.
- Cache stable queries.
- Invalidate only affected data after live events.

## 20.3 Hooks

- Minimal synchronous work.
- Short network timeout.
- Fast spool fallback.
- No recommendation analysis.
- No expensive secret scanning beyond necessary bounded redaction.
- Never block Claude because AgentLens is unavailable.

## 20.4 Analysis

- Incrementally analyse affected sessions.
- Avoid recalculating all history after every event.
- Persist rule versions and fingerprints.
- Re-run only affected rules when possible.

---

# 21. Testing Strategy

## 21.1 Synthetic fixtures

Create synthetic fixtures representing:

- Simple successful session.
- Session with malformed JSONL.
- Partial final JSONL line.
- Repeated file reads.
- Repeated command failures.
- Broad tests run repeatedly.
- Code changes with no verification.
- Changes after final verification.
- Multiple compactions.
- Sensitive path access.
- Prompt corrections.
- Multiple projects.
- Subagent activity.
- Hook events.
- OpenTelemetry metrics.
- OpenTelemetry logs.
- Duplicate telemetry delivery.
- Unknown future fields.
- Unknown event type.

Never use a real transcript in the repository.

## 21.2 Unit tests

Test:

- Redaction.
- Path handling.
- Normalisation.
- Command classification.
- Verification classification.
- Prompt-feature extraction.
- Rule confidence.
- Recommendation fingerprints.
- Config migration.
- Parser recovery.
- Cost provenance.
- Privacy-mode filtering.
- Patch generation.

## 21.3 Integration tests

Test:

- Transcript import to SQLite.
- Incremental scan.
- Interrupted scan recovery.
- Hook spool processing.
- OTLP ingestion.
- Session correlation.
- Recommendation generation.
- Doctor inspection.
- Backup/apply/rollback.
- Retention and purge.

## 21.4 End-to-end tests

Use Playwright to test:

- Onboarding.
- First scan.
- Overview.
- Session list.
- Session detail.
- Recommendation detail.
- Prompt Coach.
- Doctor.
- Diff preview.
- Privacy settings.
- Data deletion.
- Live update simulation.

## 21.5 CLI tests

Run packaged CLI commands against isolated temporary homes.

Test:

- Human output.
- JSON output.
- Exit codes.
- Missing data.
- Invalid config.
- Read-only dry runs.
- Integration install and remove.
- Non-interactive mode.

---

# 22. Documentation Requirements

Create complete documentation.

## 22.1 README

Include:

- Product explanation.
- Screenshots or generated local screenshots.
- Installation.
- Quick start.
- Privacy summary.
- CLI examples.
- Supported platforms.
- Known limitations.
- Development setup.

## 22.2 Architecture

Document:

- System context.
- Package boundaries.
- Data flow.
- Transcript import.
- Hook flow.
- Telemetry flow.
- Recommendation engine.
- Privacy boundaries.
- External-analysis boundary.

Include Mermaid diagrams where useful.

## 22.3 Privacy

Document:

- Data read.
- Data stored.
- Data not stored.
- Privacy modes.
- Redaction.
- Retention.
- Deletion.
- External provider behaviour.
- Local server behaviour.

## 22.4 Rules catalogue

For every rule document:

- ID.
- Version.
- Category.
- Trigger.
- Threshold.
- Confidence method.
- Evidence.
- False-positive considerations.
- Remediation.

## 22.5 Troubleshooting

Cover:

- Claude transcripts not found.
- Unsupported transcript records.
- Hook not firing.
- Plugin installation issues.
- Collector offline.
- OTLP errors.
- Port conflicts.
- Database recovery.
- Privacy purge.
- Windows path issues.
- Permission errors.

## 22.6 Security

Create `SECURITY.md` with:

- Supported versions.
- Vulnerability reporting.
- Sensitive-data handling.
- Threat model summary.
- Safe debugging instructions.
- Warning against sharing real transcripts in bug reports.

---

# 23. Phase Execution Order

Implement in this order.

## Foundation

1. Initialise monorepo.
2. Configure TypeScript, linting, formatting, tests and builds.
3. Create domain types.
4. Create configuration package.
5. Create local-data path handling.
6. Create database and migrations.
7. Create redaction package.
8. Create source-adapter interface.

## Phase 1

9. Implement Claude transcript discovery.
10. Implement streaming parser.
11. Implement normalisation.
12. Implement incremental import.
13. Implement session reconstruction.
14. Implement analytics.
15. Implement deterministic rule engine.
16. Implement initial rules.
17. Implement reporting.
18. Implement local API.
19. Implement dashboard.
20. Implement onboarding and privacy controls.
21. Verify Phase 1 acceptance criteria.

## Phase 2

22. Implement Claude Code plugin.
23. Implement hook capture.
24. Implement spool fallback.
25. Implement integration commands.
26. Implement local OTLP receiver.
27. Implement telemetry configuration.
28. Implement event correlation.
29. Implement live observation.
30. Implement SSE dashboard updates.
31. Verify Phase 2 acceptance criteria.

## Phase 3

32. Implement personal and project baselines.
33. Expand recommendation rules.
34. Implement deterministic Prompt Coach.
35. Implement optional coaching-provider interface.
36. Implement Configuration Doctor.
37. Implement patch generation.
38. Implement backups and rollback.
39. Implement skill and hook draft generation.
40. Implement coaching dashboard.
41. Verify Phase 3 acceptance criteria.

## Final hardening

42. Run all tests.
43. Build all packages.
44. Run CLI smoke tests.
45. Run Playwright.
46. Run security review.
47. Test metadata-only mode.
48. Test redacted-content mode.
49. Test purge.
50. Review documentation.
51. Remove placeholders and dead code.
52. Produce final implementation report.

---

# 24. Out of Scope

Do not implement these in Phases 1–3:

- Hosted AgentLens accounts.
- Cloud synchronisation.
- Team dashboards.
- Organisation management.
- Billing.
- Subscription plans.
- Multi-user authentication.
- Remote transcript storage.
- Mobile applications.
- Electron or Tauri desktop packaging.
- Automatic Claude Code command execution.
- Automatic settings changes without approval.
- Full support for Codex, Gemini CLI or other agents.
- Official billing reconciliation.
- Claims that AgentLens can guarantee token or cost savings.
- Training a custom machine-learning model.

Create extension interfaces where useful, but do not let out-of-scope work delay the required product.

---

# 25. Definition of Done

The project is done only when a user can perform this workflow:

```bash
pnpm install
pnpm build

agentlens init
agentlens scan
agentlens report --period week
agentlens dashboard
```

They must be able to:

1. Discover local Claude Code sessions.
2. Select a privacy mode.
3. Scan sessions safely.
4. View real analytics.
5. Inspect a reconstructed session timeline.
6. Receive evidence-backed recommendations.
7. Export a report.
8. Install the optional Claude Code integration.
9. Observe a live session.
10. Receive telemetry locally.
11. Use Prompt Coach.
12. Run Configuration Doctor.
13. Preview a proposed patch.
14. Apply it explicitly.
15. Roll it back.
16. Purge AgentLens data.

The workflow must be documented and covered by automated tests.

---

# 26. Final Verification

Before declaring completion, execute and report the results of:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Also run CLI smoke tests in an isolated temporary environment:

```bash
agentlens --help
agentlens init --help
agentlens scan --help
agentlens report --help
agentlens dashboard --help
agentlens doctor --help
agentlens integrate claude-code --status
agentlens telemetry status
agentlens privacy status
```

Then test with synthetic fixtures:

```bash
agentlens scan --path ./packages/test-fixtures/claude-code
agentlens report --period month
agentlens doctor --dry-run
```

Inspect the dashboard manually or through Playwright and ensure there are no console errors.

---

# 27. Final Response Format

When implementation is complete, provide:

## Implementation summary

Explain what was built across Phases 1, 2 and 3.

## Architecture summary

List the major applications and packages.

## Key decisions

Explain important technical and privacy decisions.

## Commands run

List formatting, linting, tests, builds and smoke tests.

## Verification results

Report exact pass/fail results honestly.

## Remaining limitations

List genuine limitations without hiding them.

## How to run

Provide exact installation and startup commands.

## Important files

List the most important implementation and documentation files.

Do not claim functionality that was not implemented or tested.

Begin by inspecting the repository, creating an implementation plan in the repository documentation, and then immediately start building the working system.
