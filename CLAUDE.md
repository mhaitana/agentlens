# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: spec-driven, greenfield

This project is defined by **`agentlens-glm-5.2-build-prompt.md`** at the repo root. That document is the authoritative source of truth — every architectural decision, package boundary, CLI command, privacy rule, and acceptance criterion below derives from it. When the spec and anything else disagree, the spec wins. Re-read the relevant section of the build prompt before making non-trivial decisions.

The directory currently contains only that spec; implementation is to be built from scratch following the phase order in §23. Treat the build prompt's engineering-behaviour section (§4) as standing instructions: work autonomously, maintain a working build at every stage, leave no placeholder/fake/mock code in production, and run format → lint → typecheck → tests → build → CLI smoke at the end of each major stage.

Note: this project does **not** use the Next.js/Expo stack described in the parent workspace `CLAUDE.md`. AgentLens is a local-first TypeScript monorepo with a CLI, a Fastify local API, and a Vite/React dashboard.

## What AgentLens is

A **local-first, privacy-first analytics and coaching tool for Claude Code**. It reads Claude Code transcripts/hooks/telemetry from the user's machine, reconstructs sessions, computes metrics, and produces **evidence-backed recommendations** (not generic advice) plus a Configuration Doctor that can propose — but never silently apply — patches. Claude Code is the first supported source; the domain model must stay provider-neutral so other coding agents can be added later.

Three phases, which must be implemented in order:

- **Phase 1** — Read-only analytics MVP: transcript discovery, streaming JSONL parser, incremental indexing, session reconstruction, analytics, ≥16 deterministic recommendation rules, CLI reports, dashboard. Must work with zero hooks/telemetry configured.
- **Phase 2** — Live observation: a Claude Code plugin + observation-only hooks, spool fallback, a local OTLP receiver, `integrate`/`telemetry` commands, SSE-driven live dashboard.
- **Phase 3** — Coaching & Configuration Doctor: baselines, expanded rules, deterministic Prompt Coach, optional external coaching-provider interface (disabled by default), `doctor` command with safe patch generation/backups/rollback, generated skill & hook drafts.

Phase 3 acceptance is gated by explicit checklists in §13.11, §14.11, §15.13. Definition of Done is §25: a fresh `pnpm install && pnpm build && agentlens init && agentlens scan && agentlens report --period week && agentlens dashboard` workflow works end-to-end.

## Non-negotiable principles (§3)

- **Local-first.** No account, cloud DB, hosted backend, auth, AgentLens telemetry, external AI provider, or transcript transmission by default.
- **Privacy-first.** Require an explicit scan/integration action; never silently upload; redact before persistence and before logging; support project exclusions, metadata-only analysis, configurable retention, and complete local deletion. Never store full source-file contents, full shell environments, API keys, or auth headers. Never commit real transcripts or private usage data to this repo.
- **Evidence before advice.** Every recommendation must carry structured, queryable evidence (e.g. "file read six times without an edit"). No "write better prompts" hand-waving.
- **Honest metrics.** Distinguish exact vs. reported vs. inferred vs. estimated vs. heuristic vs. unknown. Never present an estimate as official billing data; label cost "Estimated — not an official billing value."
- **Safe remediation.** No changes to Claude Code settings/hooks/skills/agents/permissions/project files without explicit approval. Every remediation must: show diff → explain impact → name target file → back up → require approval → validate → support rollback.
- **Extensible source architecture.** Dashboard/analysis code must never consume raw Claude transcript shapes directly — only normalised domain events via the `SourceAdapter` interface (§11).

## Technology stack (§5)

TypeScript monorepo, ESM by default, strict TS (avoid `any`). `pnpm` workspaces + Turborepo. Shared ESLint config, Prettier, Changesets.

- **CLI**: Commander.js, `picocolors`, `ora`, `cli-table3`; human + `--json` output; respect `NO_COLOR` and non-interactive terminals.
- **Local API**: Fastify, Zod validation, SSE for live updates, bind `127.0.0.1` by default, pick a safe free port if occupied.
- **DB**: SQLite via Drizzle ORM, versioned migrations, WAL mode, explicit FKs, transactional imports, indexed timestamps/session/project/event-type.
- **Dashboard**: React + Vite + TanStack Router + TanStack Query + Tailwind + Radix UI + Lucide + Recharts. Feature-oriented (Bulletproof React–inspired). Dark/light, accessible, responsive. No Tauri/Electron in these phases — the browser dashboard is the UI.

Testing (§5.6, §21): Vitest + React Testing Library + Playwright, with temp-fs and temp-SQLite fixtures. **No test may depend on the developer's real `~/.claude` directory**, and **no real transcript is ever committed** — only synthetic fixtures under `packages/test-fixtures/`.

## Monorepo structure (§6)

```
apps/cli              agentlens CLI (Commander)
apps/local-api        Fastify local API + OTLP receiver + live collector
apps/dashboard        Vite/React dashboard (app/, components/, features/, hooks/, lib/, routes/)
packages/
  domain              provider-neutral domain types (§10) — nothing Claude-specific here
  source-adapter      the SourceAdapter interface (§11)
  claude-adapter      first SourceAdapter implementation; owns Claude transcript parsing/normalisation
  database            Drizzle schema + migrations + repos
  config              versioned Zod config schema + migration (§9)
  redaction           secret/path redaction pipeline (§8.4) — runs before DB persist and before logging
  analysis-engine     rule engine; rules independently testable, versioned, threshold-overridable, deterministic confidence
  recommendations     recommendation domain + ranking/persistence/supersession
  prompt-coach        deterministic prompt-feature extraction + optional CoachingProvider interface (§15.5)
  reporting           terminal/markdown/JSON report rendering
  hook-collector      spool write/read for hook events (§14.3)
  otel-receiver       OTLP/HTTP metrics+logs ingestion (§14.6)
  shared              cross-package utils/types
  test-fixtures       synthetic Claude Code transcripts + hook/OTLP fixtures
plugins/agentlens-claude   distributable Claude Code plugin: manifest, hooks/, scripts/, README — observation-only
docs/                architecture/, privacy/, rules/, troubleshooting/
```

Key boundary: **`packages/domain` + `packages/source-adapter` define the neutral contracts; `claude-adapter` is the only package that knows Claude's shapes.** Dashboard, analysis, and reporting depend only on normalised domain events.

## Local data & privacy (§7, §8)

App data dir per-OS (`~/Library/Application Support/AgentLens` / `~/.local/share/agentlens` / `%LOCALAPPDATA%\AgentLens`), overridable via `AGENTLENS_HOME`. Contents: `agentlens.sqlite`, `config.json`, `backups/`, `event-spool/`, `exports/`, `logs/`, `runtime/`. Create dirs and the DB with restrictive permissions; rotate + redact logs; don't log prompt bodies or raw hook payloads by default; provide a command that prints resolved paths.

Three privacy modes (§8.1–8.3): **metadata-only**, **redacted-content** (recommended default in interactive setup), **full-local** (strong warning + explicit opt-in). Even in full-local, secret detection runs and no secrets/auth headers/known API-key formats are ever persisted. Redaction (§8.4) covers API keys, bearer tokens, JWTs, private keys, password assignments, connection strings, cookies, auth headers, cloud creds, `.env` values, user-defined regex/labels, optional email redaction, home-dir redaction, and repo-path anonymisation. Store both a redacted representation and a stable hash (for correlation); never store the original alongside the redacted version.

## CLI surface (§16)

The full `agentlens` command tree is in §16. Headline commands: `init`, `scan` (`--dry-run/--force/--path/--project/--since/--until/--json`), `report` (`--period/--project/--session/--format terminal|markdown|json/--output`), `dashboard`, `observe`, `integrate claude-code` (`--status/--dry-run/--remove`), `telemetry configure|status|print-env|remove`, `doctor` (`--project/--dry-run/--fix/--json`), `config path|validate|get|set`, `privacy status|purge|export|paths`, `rules list|explain|enable|disable`, `status`, `version`. All commands support `--help`, useful exit codes, clear errors, non-interactive behaviour, and `--json` where automation is reasonable.

## API (§17)

Versioned routes under `/api/v1/*` (health, status, onboarding, scans, projects, sessions, events, metrics, recommendations, rules, prompts, doctor, remediations, privacy, settings, live). Validate req/res with Zod, return stable error shapes, paginate large collections, never return fields disallowed by the active privacy mode, protect mutation endpoints against browser-origin abuse with a local runtime token / CSRF, restrict allowed origins, no permissive CORS, no arbitrary filesystem access via API params.

## Security & performance invariants (§19, §20)

Loopback-only binding; random runtime credentials for mutating requests; request-body limits; canonicalise + symlink-check paths (don't follow symlinks by default); treat hook payloads as untrusted (validate, redact, size-limit, never execute or shell-pass payload content); escape all user-controlled text in the dashboard (no transcript HTML, no ANSI/terminal escape execution, no command links that execute). Hooks must be near-zero-latency: read stdin JSON → validate minimal fields → redact → atomic spool or short-timeout loopback delivery → exit. Never run DB migrations, recommendations, or analysis inside a hook process; never block Claude because AgentLens is unavailable. Analysis must be incremental — don't recompute all history per event; persist rule versions + fingerprints and re-run only affected rules.

## Claude Code compatibility (§12)

Transcript/hook/telemetry fields are partially undocumented and version-dependent. Use tolerant Zod parsers, never fail an entire scan for one malformed line, record parser diagnostics and continue, and treat undocumented fields as unstable. Before relying on any field name or event schema, verify it against current official Claude Code docs (transcripts, hooks reference, monitoring/OpenTelemetry, settings, permissions, security, plugins/plugin reference).

## Final verification to run before declaring done (§26)

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Plus CLI smoke tests in an isolated temp home (`agentlens --help`, `init/scan/report/dashboard/doctor --help`, `integrate claude-code --status`, `telemetry status`, `privacy status`) and a fixture-driven run: `agentlens scan --path ./packages/test-fixtures/claude-code && agentlens report --period month && agentlens doctor --dry-run`. Report exact pass/fail results honestly (§27); never claim functionality that wasn't implemented or tested.
