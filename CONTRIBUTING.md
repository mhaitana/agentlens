# Contributing to AgentLens

Thanks for considering a contribution to AgentLens — a local-first,
privacy-first analytics and coaching tool for AI coding agents. Claude Code is
the first supported source; the provider-neutral `SourceAdapter` interface makes
it possible to add other agents without touching the dashboard or analysis
engine.

The authoritative specification is
[`agentlens-glm-5.2-build-prompt.md`](./agentlens-glm-5.2-build-prompt.md).
**When the spec and anything in this repo disagree, the spec wins.** Re-read
the relevant spec section before any non-trivial change.

> **Privacy is non-negotiable.** A short list of hard rules sits near the bottom
> of this document — read them before you write any code or open a PR. The
> headline: **never commit real transcripts or private usage data**, and **no
> test may depend on your real `~/.claude` directory.**

---

## 1. Project layout & architecture boundary

AgentLens is a TypeScript ESM monorepo (pnpm workspaces + Turborepo): a CLI, a
loopback Fastify API, and a Vite/React dashboard, backed by SQLite (Drizzle).

The **one boundary you must not breach**: only adapter packages (currently
`packages/claude-adapter`) may know a provider's raw transcript / hook /
telemetry shapes. `packages/domain` + `packages/source-adapter` are
**provider-neutral**. The dashboard, `analysis-engine`, `recommendations`,
`prompt-coach`, and `reporting` consume **normalised domain events only** —
never raw Claude structures. If you find yourself importing a Claude-shaped
type outside `claude-adapter`, stop and rework against the domain model.

Full package map, data flows (transcript import / hook capture / telemetry),
and Mermaid diagrams: [`docs/architecture.md`](./docs/architecture.md).

```
apps/cli            agentlens CLI (Commander, tsup -> dist/index.js, bin "agentlens")
apps/local-api      Fastify loopback API + OTLP receiver + live collector
apps/dashboard      Vite/React + TanStack Router/Query + Tailwind v4
packages/
  domain            provider-neutral domain types (no Claude shapes)
  source-adapter    the SourceAdapter interface
  claude-adapter    the ONLY package that parses Claude transcript shapes
  database          Drizzle/SQLite (WAL) + repos + maintenance
  config            versioned Zod config schema + migration
  redaction         redaction pipeline (runs before persist + before logging)
  analysis-engine   versioned, threshold-overridable rule engine (34 rules)
  recommendations   ranking / persistence / supersession
  prompt-coach      deterministic prompt features + optional provider interface
  reporting         terminal / markdown / JSON rendering
  hook-collector    spool write/read for hook events
  otel-receiver     OTLP/HTTP metrics + logs ingestion
  shared            cross-package utils/types
  test-fixtures     synthetic Claude Code transcripts ONLY (no real data)
plugins/agentlens-claude   distributable observation-only Claude Code plugin
```

---

## 2. Development environment

Requirements:

- **Node.js ≥ 24**
- **pnpm 10.33.0** (the repo pins it via `packageManager`; `corepack enable`
  will pick it up automatically)

```bash
git clone github.com/mhaitana/agentlens.git
cd agentlens
pnpm install
pnpm build          # turbo builds all packages/apps in dependency order
```

Turbo tasks carry `^build` dependencies, so building a package first builds
its workspace dependencies. Build outputs land in each package's `dist/`.

---

## 3. Common commands

All commands run from the repo root.

```bash
pnpm build               # turbo run build
pnpm lint                # turbo run lint (eslint; dashboard is lint-ignored)
pnpm typecheck           # turbo run typecheck (tsc --noEmit)
pnpm test                # turbo run test (vitest unit; --passWithNoTests)
pnpm test:integration    # turbo run test:integration
pnpm test:e2e            # turbo run test:e2e (Playwright; dashboard)
pnpm format              # prettier --write
pnpm format:check        # prettier --check (used in the §26 gate)
```

### Work on a single package

```bash
pnpm --filter @agentlens/analysis-engine build
pnpm --filter @agentlens/analysis-engine test
pnpm --filter @agentlens/analysis-engine lint
```

### Run a single test

The turbo `test` task is `vitest run --passWithNoTests` and **swallows extra
arguments**. To run one file or one test name, bypass the wrapper with
`exec`:

```bash
pnpm --filter @agentlens/analysis-engine exec vitest run src/rules/rules.test.ts
pnpm --filter @agentlens/analysis-engine exec vitest run -t "TOOLS-001"
pnpm --filter @agentlens/analysis-engine exec vitest run --watch src/rules/rules.test.ts
```

### The CLI

The CLI builds to `apps/cli/dist/index.js` (tsup, ESM). The `bin` field
exposes `agentlens`:

```bash
pnpm --filter @mhaitana/agentlens build
node apps/cli/dist/index.js --help          # run directly
npm link apps/cli                            # or put `agentlens` on your PATH
```

### The §26 gate (run before declaring done)

A change is not finished until the full gate is green:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && \
  pnpm test:integration && pnpm build && pnpm test:e2e
```

Then a CLI smoke test in an **isolated temp home** — never point this at your
real `~/.claude`:

```bash
HOME_TMP="$(mktemp -d)"
AGENTLENS_HOME="$HOME_TMP/al" node apps/cli/dist/index.js init
agentlens scan --path ./packages/test-fixtures/claude-code
agentlens report --period month
agentlens doctor --dry-run
```

Plus the smoke from spec §26: `agentlens --help`, `init/scan/report/dashboard/doctor --help`,
`integrate claude-code --status`, `telemetry status`, `privacy status`. Report
exact pass/fail honestly (spec §27) — never claim functionality that wasn't
implemented or tested.

---

## 4. Code style

TypeScript, ESLint, and Prettier are preconfigured; let the tools enforce
style. Notable conventions (from `tsconfig.base.json`, `eslint.config.js`,
`.prettierrc.json`):

- **Strict TypeScript.** `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`. No `any`.
- **`verbatimModuleSyntax` is on** → use `import type` for type-only imports.
- **ESM throughout** → relative imports use `.js` extensions
  (e.g. `import { tools001 } from "./tools.js"`), even for `.ts` source files.
- **Prettier**: `semi: true`, `singleQuote: false`, `trailingComma: "all"`,
  `printWidth: 100`, `tabWidth: 2`, `endOfLine: "lf"`.
- **ESLint**: `typescript-eslint` strict. Unused vars/params prefixed with `_`
  are ignored. The dashboard (`apps/dashboard/**`) is lint-ignored (Vite/React
  tooling owns it). The distributable plugin scripts
  (`plugins/agentlens-claude/scripts/**/*.js`) are intentionally CommonJS —
  they run directly on a bare `node` with no build step.
- **No placeholder / fake / mock code in production.** Tests use mocks; product
  code does not.

Run `pnpm format` before committing so `pnpm format:check` passes in CI.

---

## 5. Adding a recommendation rule

Recommendation rules live in `packages/analysis-engine/src/rules/`, split by
category file (`tools.ts`, `verify.ts`, `workflow.ts`, `context.ts`,
`prompt.ts`, `model.ts`, `security.ts`, `configuration.ts`) and aggregated by
`defaultRules()` in `rules/index.ts`. IDs follow `<CATEGORY>-NNN`
(`TOOLS-001`..`008`, `VERIFY-001`..`006`, …). To add one:

1. **Add the rule factory** to the right category file, e.g. `tools009()` in
   `tools.ts`. Use the shared builders in `helpers.ts` (`candidate`,
   `threshold`, `confidenceForCount`, `evidence`, `metric`, `num`). A rule is a
   `RecommendationRule` with a stable `id` + `version`, `defaultThresholds`, a
   deterministic `evaluate(ctx)` that emits **at most one candidate** (the most
   significant finding), an evidence builder, an explanation, and a
   remediation. Read metrics from `ctx.snapshot` — **never** from raw Claude
   shapes.
2. **Register it** by exporting the factory from `rules/index.ts` and adding it
   to the `defaultRules()` array.
3. **Add a co-located test** in `rules.test.ts`: fires above threshold, silent
   below, threshold override respected, ≤1 candidate, deterministic confidence.
4. **Document it** in [`docs/rules.md`](./docs/rules.md) with the spec §22.4
   fields: ID, Version, Category, Trigger, Threshold, Confidence method,
   Evidence, False-positive considerations, Remediation.
5. **Thresholds are config-overridable**, never hardcoded by callers. Override
   via `analysis.ruleOverrides` in `config.json` or the `agentlens rules` CLI,
   not by editing the rule.

`automaticallyApplicable` is **always `false`** (spec §3.5 — safe remediation).
Recommendations are persisted with ids derived from a finding fingerprint, so
a re-run is idempotent and a recommendation is superseded only when the
evidence changes.

---

## 6. Adding a source adapter (other coding agents)

The architecture is provider-neutral: every adapter implements the `SourceAdapter`
interface from `packages/source-adapter` and emits normalised domain events
(see `packages/domain`). A new adapter lives in its own package
(e.g. `packages/<provider>-adapter`) and **only that package** may know the
provider's raw shapes. Dashboard, analysis, and reporting consume the
normalised events unchanged, so Claude Code is the first supported source but
not the only one that can exist.

---

## 7. Commit & release conventions

**Conventional Commits**, scoped with the feature tag from
`epcc-features.json`:

```
feat(F010): add contributing guide and LICENSE
fix(F003): TOOLS-001 threshold edge case
docs(F010): document the rule engine
chore(F009): record verified commit SHA
```

- Allowed types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`.
- Reference the feature: include `Refs: epcc-features.json#F00X` in the body
  for implementation commits.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`
  when Claude Code paired on the work.

**Changesets** drive versioning (`.changeset/config.json`):

```bash
pnpm changeset            # answer prompts -> writes a changeset under .changeset/
pnpm version-packages     # release time: consumes changesets, bumps versions,
                          # regenerates CHANGELOG.md
```

- Add a changeset on your feature PR (select `@mhaitana/agentlens`).
- When the PR merges to `main`, the `Release` workflow
  (`.github/workflows/release.yml`) uses `changesets/action` to open a
  "Version Packages" PR that bumps versions and regenerates `CHANGELOG.md`.
- Merging that Version PR publishes `@mhaitana/agentlens` to GitHub Packages
  (`npm.pkg.github.com`) and tags the release. The `GITHUB_TOKEN` authenticates
  (the `@mhaitana` scope matches the repo owner, so no PAT is needed to publish).

Config: `access: public`; `baseBranch: main`; `updateInternalDependencies: patch`.
`@agentlens/dashboard` and all internal `@agentlens/*` packages are
`private: true` and therefore excluded from publishing by that flag (not by
`ignore`). The changelog targets `mhaitana/agentlens`. See
[`CHANGELOG.md`](./CHANGELOG.md).

---

## 8. Hard privacy & safety rules (read before coding)

These are non-negotiable (spec §3, §4, §8) and apply to every contribution:

- **Never commit real transcripts or private usage data.** Synthetic fixtures
  only, under `packages/test-fixtures/`. No real `~/.claude` content, ever.
- **No test may depend on the developer's real `~/.claude`.** Use an isolated
  `AGENTLENS_HOME` (and `AGENTLENS_CLAUDE_HOME` for Doctor tests) in a temp
  dir.
- **Redact before persistence _and_ before logging.** Never store secrets, auth
  headers, or known API-key formats — secret detection runs even in full-local
  mode. Home-directory paths are anonymised by default.
- **Never store** full source-file contents, full shell environments, API keys,
  or auth headers.
- **Safe remediation.** `automaticallyApplicable` is always `false`. The Doctor
  never writes without explicit approval + backup + rollback (spec §3.5, §15.7).
- **Honest metrics.** Label provenance (`exact` / `reported` / `inferred` /
  `estimated` / `heuristic` / `unknown`). Cost is always labelled
  "Estimated — not an official billing value."
- **Hooks are near-zero-latency and untrusted.** A hook process reads stdin →
  validates minimal fields → redacts → atomic-spools or short-timeout
  loopback-delivers → exits. Never run DB migrations, recommendations, or
  analysis inside a hook; never block Claude because AgentLens is unavailable;
  never execute or shell-pass hook payload content.

---

## 9. Opening a pull request

PR checklist (a template is at
[`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)):

- [ ] `pnpm format:check` passes (run `pnpm format` first)
- [ ] `pnpm lint && pnpm typecheck` pass
- [ ] `pnpm test && pnpm test:integration && pnpm build` pass
- [ ] `pnpm test:e2e` passes (if the change touches the dashboard or API)
- [ ] No real transcripts or private usage data added (synthetic fixtures only)
- [ ] No test depends on a real `~/.claude`
- [ ] New rules are registered in `defaultRules()`, tested, and documented in
      `docs/rules.md` (§22.4 fields)
- [ ] New public surfaces are documented; markdown links resolve
- [ ] The change agrees with the spec — or the spec is updated and the reason
      is explained in the PR description

Keep PRs focused. Reference the feature (`Refs: epcc-features.json#F00X`) in
the PR description when relevant.

---

## 10. Reporting a vulnerability or privacy issue

Do **not** open a public issue for security or privacy vulnerabilities. See
[`SECURITY.md`](./SECURITY.md) for supported versions, the private reporting
process, the threat model, and safe debugging guidance.

For a **privacy report** (e.g. something that may have persisted data it
shouldn't have), use the privacy issue template and **do not paste real
transcripts, prompts, commands, or file paths** — describe the behaviour in
the abstract with synthetic examples.

---

## 11. Need help?

- Architecture & data flow: [`docs/architecture.md`](./docs/architecture.md)
- Privacy model: [`docs/privacy.md`](./docs/privacy.md)
- Rule catalogue: [`docs/rules.md`](./docs/rules.md)
- Common problems: [`docs/troubleshooting.md`](./docs/troubleshooting.md)
- Spec (source of truth): [`agentlens-glm-5.2-build-prompt.md`](./agentlens-glm-5.2-build-prompt.md)

By contributing, you agree that your contributions are licensed under the
project's [MIT license](./LICENSE).
