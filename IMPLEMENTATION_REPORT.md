# AgentLens — Final Implementation Report (§27)

Built per `agentlens-glm-5.2-build-prompt.md`. This report is honest about
pass/fail (§27): nothing is claimed that was not implemented or tested.

## Implementation summary

AgentLens is a **local-first, privacy-first analytics and coaching tool for
Claude Code**, implemented across the three phases mandated by the spec.

- **Phase 1 — Read-only analytics MVP.** Transcript discovery under the Claude
  projects directory, a streaming tolerant JSONL parser, incremental
  import (size+mtime/hash dedup, transactional, idempotent re-runs), session
  reconstruction, analytics with honest metric provenance
  (`exact`/`reported`/`inferred`/`estimated`/`heuristic`/`unknown`), and a
  rule engine of **34 deterministic recommendation rules** with structured,
  queryable evidence. CLI reports (terminal/markdown/JSON) and a
  Vite/React dashboard. Works with zero hooks/telemetry configured.
- **Phase 2 — Live observation.** A distributable, observation-only Claude
  Code plugin (`plugins/agentlens-claude`) + hooks, an atomic spool
  fallback with short-timeout loopback delivery, a local OTLP/HTTP receiver,
  `integrate claude-code` / `telemetry configure|status|print-env|remove`
  commands, and an SSE-driven live dashboard. Hooks are near-zero-latency and
  never run migrations/analysis.
- **Phase 3 — Coaching & Configuration Doctor.** Personal/project baselines,
  an expanded rule set, a **deterministic** Prompt Coach (no external model by
  default), an optional external CoachingProvider interface (disabled by
  default), and a `doctor` command that detects risky Claude Code config and
  generates patches with diff → explain → name target → back up → approve →
  validate → rollback. `automaticallyApplicable` is always `false`.

Everything runs locally. There is no account, cloud DB, hosted backend, auth,
AgentLens telemetry, or external AI provider by default. The local API binds
to `127.0.0.1` only.

## Architecture summary

TypeScript pnpm/Turborepo monorepo, ESM, strict TS.

- `apps/cli` — Commander CLI (`agentlens`).
- `apps/local-api` — Fastify loopback API + OTLP receiver + live collector.
- `apps/dashboard` — Vite/React + TanStack Router/Query + Tailwind + Radix.
- `packages/domain` — provider-neutral domain types (no Claude shapes).
- `packages/source-adapter` — the `SourceAdapter` interface.
- `packages/claude-adapter` — the only package that knows Claude's shapes.
- `packages/database` — Drizzle/SQLite (WAL) + repos + maintenance.
- `packages/config` — versioned Zod config + migration.
- `packages/redaction` — redaction pipeline (runs before persist + logging).
- `packages/analysis-engine` — versioned, threshold-overridable rule engine.
- `packages/recommendations` — ranking/persistence/supersession.
- `packages/prompt-coach` — deterministic prompt features + optional provider.
- `packages/reporting` — terminal/markdown/JSON rendering.
- `packages/hook-collector` — spool write/read.
- `packages/otel-receiver` — OTLP/HTTP metrics+logs.
- `packages/shared`, `packages/test-fixtures` — utils + synthetic fixtures only.
- `plugins/agentlens-claude` — observation-only Claude Code plugin.

Key invariant: `domain` + `source-adapter` are neutral; `claude-adapter` is the
only package that parses Claude transcript structures. Dashboard, analysis,
and reporting consume normalised domain events only.

## Key decisions

- **Local-first & privacy-first.** No cloud/auth/AgentLens-telemetry by default;
  redaction runs before persistence **and** before logging; never store full
  source-file contents, raw env vars, API keys, or auth headers. Three privacy
  modes: `metadata-only`, `redacted-content` (default), `full-local` (opt-in).
  Even in `full-local`, secret detection runs.
- **Evidence before advice.** Every recommendation carries structured
  evidence. Confidence is a deterministic function of the evidence, never a
  guess. All 34 rules are version 1, threshold-overridable via config.
- **Honest metrics.** Cost is always labelled "Estimated — not an official
  billing value." Provenance tags distinguish exact/reported/inferred/
  estimated/heuristic/unknown.
- **Safe remediation.** Doctor patches are never auto-applied. The Doctor
  confines writes to approved Claude Code config paths (`~/.claude/**`,
  `<project>/CLAUDE.md`, `<project>/.mcp.json`, `<project>/.claude/**`),
  canonicalises inputs, and stores an authoritative `{target, claudeHome,
projectPath}` sidecar at apply time so rollback is self-contained and ignores
  client-supplied `targetFile` (forged-target protection).
- **Loopback-only API.** `127.0.0.1` binding, random runtime token for
  mutations (CSRF), no permissive CORS, JSON-in-script escaping for the
  bootstrap token, request-body limits, no arbitrary FS access via params.
- **Provider-neutral core.** The `SourceAdapter` interface keeps the domain
  model reusable for other coding agents; only `claude-adapter` knows Claude.

## Commands run

All §26 gate commands run **separately** (as required), all exit 0:

| Command                 | Result                                         |
| ----------------------- | ---------------------------------------------- |
| `pnpm format:check`     | ✅ All matched files use Prettier code style   |
| `pnpm lint`             | ✅ 33/33 tasks                                 |
| `pnpm typecheck`        | ✅ 32/32 tasks                                 |
| `pnpm test`             | ✅ CLI 127/127 (9 files) + package unit suites |
| `pnpm test:integration` | ✅ CLI 24/24 + local-api suites                |
| `pnpm build`            | ✅ 17/17 tasks                                 |
| `pnpm test:e2e`         | ✅ 9/9 Playwright (chromium)                   |

CLI smoke tests in an isolated temp home (`AGENTLENS_HOME` + `AGENTLENS_CLAUDE_HOME`
pointed at throwaway `mktemp -d` dirs):

| Command                                    | Result                                             |
| ------------------------------------------ | -------------------------------------------------- |
| `agentlens --help`                         | ✅ exit 0                                          |
| `agentlens init --help`                    | ✅ exit 0                                          |
| `agentlens scan --help`                    | ✅ exit 0                                          |
| `agentlens report --help`                  | ✅ exit 0                                          |
| `agentlens dashboard --help`               | ✅ exit 0                                          |
| `agentlens doctor --help`                  | ✅ exit 0                                          |
| `agentlens integrate claude-code --status` | ✅ exit 0 (claude binary detected, not registered) |
| `agentlens telemetry status`               | ✅ exit 0 (receiver off, port 4318)                |
| `agentlens privacy status`                 | ✅ exit 0 (mode `redacted-content`, retention 90)  |

Fixture-driven end-to-end (same isolated env):

| Command                                                      | Result                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `agentlens init`                                             | ✅ created config + SQLite, mode `redacted-content`                                            |
| `agentlens scan --path ./packages/test-fixtures/claude-code` | ✅ 1 discovered, 1 imported, 0 skipped                                                         |
| `agentlens report --period month`                            | ✅ rendered, cost labelled "Estimated — not an official billing value"                         |
| `agentlens doctor --dry-run`                                 | ✅ exit 0, "Configuration looks healthy" (empty isolated claude home)                          |
| `agentlens doctor --dry-run --json`                          | ✅ exit 0, keys: scope/generatedAt/findings/patches/skillDrafts/hookDrafts/summary/diagnostics |

Real-home integrity: the developer's real
`~/Library/Application Support/AgentLens/agentlens.sqlite` was **not** modified
during smoke/fixture runs (mtime predates the run window); all writes landed
in the throwaway temp homes, which were cleaned up after.

## Verification results

- **§26 gate:** all 7 commands green (table above).
- **Privacy modes:** `metadata-only`, `redacted-content`, and `full-local` are
  each covered by tests (`import.test.ts`, `api.test.ts`, `coaching.test.ts`).
  Purge is verified in `cli.smoke.test.ts`, `api.test.ts`, and
  `maintenance.test.ts`.
- **Security review (§19):** a dedicated security review found 33 verified
  controls and 4 findings (2 MEDIUM, 1 LOW, 1 INFO), all of which were fixed:
  - Doctor apply/rollback now confined to approved Claude Code config paths
    (§19.2) with an authoritative target sidecar that ignores a forged
    client-supplied `targetFile` on rollback.
  - GET doctor route canonicalises project/claude-home path inputs.
  - Dashboard bootstrap token is HTML-escaped (`<`, `>`, `&`) in the script.
  - Added 9 unit tests (`targets.test.ts`) + a forged-targetFile rollback test
    (`doctor-routes.test.ts`). All 127 CLI tests pass.
- **Placeholders/dead code:** a grep for `TODO`/`FIXME`/`XXX`/`HACK`/
  `placeholder`/`stub`/`fake`/`unimplemented`/`hardcoded` in production source
  found only legitimate uses (UI `placeholder` attributes, redaction labels,
  doc comments, intentional "no hardcoded models" design). No fake/stub/mock
  production code; no `UnimplementedError` throws.

## Remaining limitations

These are genuine and stated plainly (§24 scope + §12 compatibility):

- Only **Claude Code** is supported as a source in these phases. The domain
  model and `SourceAdapter` are provider-neutral, but no other coding-agent
  adapter ships yet.
- Transcript/hook/telemetry fields are **partially undocumented and
  version-dependent**. Parsers are tolerant (a malformed line is recorded as a
  diagnostic and skipped, never failing the whole scan), and undocumented
  fields are treated as unstable.
- Token and cost figures are **estimates** derived from transcript-reported
  fields, never official billing data, and never a guarantee of savings.
- No cloud sync, accounts, team dashboards, or mobile apps (intentionally out
  of scope). The dashboard is the browser UI (no Tauri/Electron packaging).
- The optional external coaching provider is disabled by default and, when
  enabled, requires explicit opt-in + redaction-before-transmission; the
  deterministic Prompt Coach is the default path.
- Doctor patches are read/propose-only; nothing is applied without explicit
  approval, and writes are confined to approved Claude Code config paths.

## How to run

Requirements: **Node.js ≥ 24** and **pnpm** (the repo pins `pnpm@10.33.0`).

```bash
pnpm install
pnpm build
```

Link or call the CLI directly:

```bash
npm link apps/cli                         # makes `agentlens` available on PATH
# or:
node apps/cli/dist/index.js --help
```

Typical flow (use `AGENTLENS_HOME` / `AGENTLENS_CLAUDE_HOME` to point at
throwaway dirs for tests/dry-runs that must not touch real data):

```bash
agentlens init                             # choose privacy mode, create config + DB
agentlens scan                             # import Claude Code sessions locally
agentlens report --period week             # terminal analytics report
agentlens doctor --dry-run                 # preview Claude Code config findings
agentlens dashboard                        # open the local dashboard in a browser
```

## Important files

Documentation (all created/updated in F009 H3):

- `README.md` — product overview, privacy summary, install, quick start.
- `docs/architecture.md` — Mermaid diagrams: context, packages, data flows.
- `docs/privacy.md` — data read/stored/not-stored, modes, redaction, deletion.
- `docs/rules.md` — all 34 rules with §22.4 fields (version, threshold,
  confidence method, false-positive considerations).
- `docs/troubleshooting.md` — 11 common-issue sections.
- `SECURITY.md` — supported versions, reporting, threat model, safe debugging.
- `CLAUDE.md` — repo guidance for Claude Code.
- `agentlens-glm-5.2-build-prompt.md` — authoritative spec.
- `IMPLEMENTATION_REPORT.md` — this §27 report.

Security hardening (F009 H2):

- `apps/cli/src/doctor/targets.ts` — §19.2 approved-path allowlist + canonicalisation.
- `apps/cli/src/doctor/apply.ts` — allowlist check on apply + authoritative
  rollback sidecar (`{target, claudeHome, projectPath}`).
- `apps/cli/src/doctor/doctor-routes.ts` — input canonicalisation + ctx threading.
- `apps/local-api/src/server.ts` — HTML-escaped bootstrap token.

Core implementation (Phases 1–3): `apps/cli/src/commands/*`, `apps/cli/src/doctor/*`,
`apps/local-api/src/*`, `apps/dashboard/src/features/*`,
`packages/claude-adapter/src/*`, `packages/analysis-engine/src/rules/*`,
`packages/recommendations/src/*`, `packages/prompt-coach/src/*`,
`packages/redaction/src/*`, `packages/database/src/*`, `packages/config/src/*`.
