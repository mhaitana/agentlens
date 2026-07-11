# Architecture

AgentLens is a local-first TypeScript monorepo: a CLI, a loopback Fastify API,
and a Vite/React dashboard, backed by a SQLite database and a provider-neutral
domain model. This document describes the system context, package boundaries,
and the three data flows (transcript import, hook capture, telemetry).

## System context

```mermaid
flowchart LR
  subgraph Machine["Your machine (nothing leaves it)"]
    CC["Claude Code"] -- "transcripts (.jsonl), hooks, OTLP" --> AL
    AL["AgentLens"]
    AL -- "127.0.0.1 loopback only" --> API["Fastify local API"]
    API -- "SSE / REST" --> DASH["Browser dashboard"]
    CLI["agentlens CLI"] --> AL
  end
  AL -- "never (disabled by default)" --> EXT["External analysis provider"]
```

There is no account, cloud DB, hosted backend, auth, or AgentLens telemetry.
External analysis (an optional coaching provider) is **disabled by default** and
gated behind explicit opt-in, explicit provider+model, redaction before
transmission, preview, and a request timeout.

## Package boundaries

The key invariant: **`packages/domain` + `packages/source-adapter` define the
neutral contracts; `claude-adapter` is the only package that knows Claude’s
shapes.** The dashboard, analysis engine, and reporting depend only on
normalised domain events — never raw Claude transcript structures.

```mermaid
flowchart TD
  subgraph apps
    CLI["apps/cli — Commander CLI"]
    API["apps/local-api — Fastify + OTLP receiver + live collector"]
    DASH["apps/dashboard — Vite/React + TanStack Query"]
  end
  subgraph sources
    CA["packages/claude-adapter — Claude transcript parsing/normalisation"]
    SA["packages/source-adapter — SourceAdapter interface"]
  end
  subgraph core
    DOM["packages/domain — provider-neutral types"]
    AE["packages/analysis-engine — rule engine"]
    REC["packages/recommendations — ranking/persistence/supersession"]
    PC["packages/prompt-coach — deterministic prompt features"]
  end
  subgraph infra
    DB["packages/database — Drizzle/SQLite + repos + maintenance"]
    CFG["packages/config — versioned Zod config + migration"]
    RED["packages/redaction — redaction pipeline"]
    RPT["packages/reporting — terminal/markdown/JSON"]
    HC["packages/hook-collector — spool write/read"]
    OTEL["packages/otel-receiver — OTLP/HTTP metrics+logs"]
    SH["packages/shared — utils/types"]
    FX["packages/test-fixtures — synthetic fixtures only"]
  end
  CA --> SA --> DOM
  CA --> DOM
  AE --> DOM
  AE --> REC
  PC --> DOM
  CLI --> CA
  CLI --> AE
  CLI --> RPT
  CLI --> DB
  API --> AE
  API --> REC
  API --> PC
  API --> DB
  API --> HC
  API --> OTEL
  DASH --> API
```

Boundary rules enforced by package dependencies and review:

- `domain` and `source-adapter` import nothing Claude-specific.
- `claude-adapter` is the **only** package that parses Claude transcript shapes.
- `analysis-engine`, `recommendations`, `prompt-coach`, `reporting`, and the
  dashboard consume normalised domain events only.
- `test-fixtures` contains **synthetic** transcripts only — no real transcript is
  ever committed, and no test depends on the developer’s real `~/.claude`.

## Data flow — transcript import

```mermaid
sequenceDiagram
  participant CLI as agentlens scan
  participant CA as claude-adapter
  participant RED as redaction
  participant DB as database (SQLite/WAL)
  participant AE as analysis-engine
  participant REC as recommendations
  CLI->>CA: discover + stream-parse transcripts (tolerant JSONL)
  CA->>CA: normalise to domain events
  CA->>RED: redact before persist (secrets/paths/auth)
  RED->>DB: incremental import (size+mtime/hash dedup, transactional)
  CLI->>AE: computeAnalytics(snapshot filters)
  AE->>REC: persist recommendations (fingerprint dedup + supersession)
  REC-->>CLI: report rendered (terminal/markdown/json)
```

Highlights:

- **Incremental import** — a file is skipped when size + mtime match; re-imported
  (deleting the old rows first) when the parser version changes, the file is
  truncated, or the head hash differs; appended when the head is unchanged but
  the file grew. Re-runs are idempotent.
- **Redaction before persistence and before logging** (§3.2). Both a redacted
  representation and a stable hash are stored; the original is never stored
  alongside the redacted version.
- **Recommendations are persisted by `computeAnalytics`**, not by `scan`. A fresh
  database shows zero recommendations until an analytics pass runs (the dashboard
  runs one on load).

## Data flow — hook capture (Phase 2)

```mermaid
sequenceDiagram
  participant CC as Claude Code hook
  participant HC as hook-collector (spool)
  participant API as local API (loopback)
  participant DB as database
  CC->>HC: stdin JSON → validate minimal fields → redact → size-limit
  HC->>HC: atomic spool write (near-zero-latency exit)
  HC-->>API: short-timeout loopback delivery (best-effort)
  API->>RED: re-redact (treat payloads as untrusted)
  API->>DB: persist normalised event
  API-->>DASH: SSE live update
```

Hook processes must be **near-zero-latency**: read stdin → validate minimal
fields → redact → atomic spool or short-timeout loopback delivery → exit. The
DB, recommendations, and analysis are never run inside a hook process; Claude
Code is never blocked because AgentLens is unavailable. Hook payloads are
untrusted: validated, redacted, size-limited, never executed, and never passed
to a shell.

## Data flow — telemetry (Phase 2)

```mermaid
flowchart LR
  CC["Claude Code / OTLP exporter"] -- "OTLP/HTTP (metrics+logs)" --> OTEL["otel-receiver (loopback :4318)"]
  OTEL -- "normalise + redact" --> DB["database"]
  DB -- "correlate by session/trace" --> AE["analysis-engine"]
  AE --> DASH["live dashboard (SSE)"]
```

The OTLP receiver is local-only, disabled by default, and configurable via
`agentlens telemetry configure`. Telemetry log fields default to off (no prompt
bodies, no assistant responses, no raw API bodies).

## Recommendation engine

```mermaid
flowchart TD
  EV["Normalised domain events (already redacted, persisted)"] --> CTX["RuleContext: filters + configuration summary"]
  CTX --> RULES["34 deterministic rules (versioned, threshold-overridable)"]
  RULES --> CAND["candidates (evidence + remediation)"]
  CAND --> DEDUP["fingerprint dedup + supersession"]
  DEDUP --> RANK["rank by severity/confidence/impact"]
  RANK --> PERS["persist active recommendations"]
  PERS --> DASH["dashboard / report / coaching"]
```

Every recommendation carries structured, queryable evidence (e.g. “file read 6
times with no intervening edit”). Confidence is a **deterministic function of
the evidence**, never a guess. Every metric carries a provenance tag (`exact`,
`reported`, `inferred`, `estimated`, `heuristic`, `unknown`). Remediations are
proposed only; `automaticallyApplicable` is always `false` (§3.5). Analysis is
incremental — rule versions + fingerprints are persisted so only affected rules
re-run.

## Privacy boundaries

```mermaid
flowchart TD
  RAW["Raw transcript / hook / OTLP input"] --> RED["Redaction pipeline"]
  RED --> PM{"Active privacy mode"}
  PM -- "metadata-only" --> M["ids, timestamps, tool names, durations, token/cost est., path hashes, command classes"]
  PM -- "redacted-content (default)" --> R["redacted prompts+commands, redacted relative paths, sanitised tool metadata, derived features"]
  PM -- "full-local (opt-in)" --> F["additional local content; secrets still always stripped"]
  M --> DB[("SQLite (local only)")]
  R --> DB
  F --> DB
  RED --> LOG["Logs (rotated + redacted; no prompt bodies/raw payloads by default)"]
```

The redaction pipeline covers API keys, bearer tokens, JWTs, private keys,
password assignments, connection strings, cookies, auth headers, cloud creds,
`.env` values, user-defined regex/labels, optional email redaction, home-dir
redaction, and repo-path anonymisation. Secret detection runs even in full-local
mode; no secrets, auth headers, or known API-key formats are ever persisted.

## External-analysis boundary

External analysis (§19.5) is an opt-in coaching-provider interface, **disabled
by default**. When enabled it requires: explicit opt-in, explicit provider+model,
redaction before transmission, a preview, clear disclosure, a request timeout,
no automatic retries containing sensitive data, and no remote provider keys in
logs. The deterministic Prompt Coach works **without** any external model and is
what the dashboard uses by default.
