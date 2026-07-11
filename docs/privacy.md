# Privacy

AgentLens is local-first and privacy-first. This document describes exactly
what is read, what is stored, what is never stored, the privacy modes, the
redaction pipeline, retention, deletion, and the behaviour of the local server
and the optional external provider.

The non-negotiable principles (spec §3) are: local-first (no account, cloud, auth,
or AgentLens telemetry by default), privacy-first (explicit action required; redact
before persistence **and** before logging; never store full source-file contents,
full shell environments, API keys, or auth headers), evidence before advice, honest
metrics, safe remediation, and an extensible source architecture.

## Data read

AgentLens reads, **only when you run a scan or have installed the optional
plugin/hooks**:

- Claude Code transcript `.jsonl` files under your Claude projects directory (or a
  `--path` you choose).
- Claude Code hook payloads (stdin JSON) when the optional plugin is installed.
- OTLP/HTTP metrics+logs from a local exporter, only when the optional telemetry
  receiver is enabled.
- Claude Code settings/permissions/MCP config, **only** when you run
  `agentlens doctor` (read-only inspection; patches require explicit approval).

It does not read arbitrary files outside approved source locations, does not
follow symlinks by default, and canonicalises + symlink-checks every path.

## Data stored

Everything is stored in a local SQLite database (`agentlens.sqlite`, WAL mode)
under your OS data home (`AGENTLENS_HOME` overrides). What is stored depends on
the active privacy mode (see below). Across all modes:

- **Persisted:** session identifiers, timestamps, tool names, durations, token
  metrics, cost **estimates**, file-path hashes (and optionally redacted relative
  paths), command classifications, success/failure status, derived metrics, and —
  depending on mode — redacted prompt/command text and derived prompt features.
- **Never persisted:** full source-file contents, raw environment variables,
  authentication headers, API keys, known API-key formats, private keys, cookies,
  connection strings, or `.env` values. Secret detection always runs, even in
  full-local mode.

## Data not stored

- Assistant response bodies are not stored by default (configurable, off by
  default).
- Raw hook payloads and raw OTLP API bodies are not stored (telemetry logging of
  these fields defaults to off).
- The original unredacted representation is never stored alongside the redacted
  version — only a redacted representation plus a stable hash for correlation.
- Your real home directory path is never stored verbatim; it is anonymised by
  default (`redactHomePath: true`).

## Privacy modes

### metadata-only

Persists: session identifiers, timestamps, tool names, durations, token metrics,
cost estimates, file-path hashes (or optionally redacted relative paths), command
classifications, success/failure status, derived metrics.

Does **not** persist: prompt text, assistant text, full tool input, full tool
output, full shell commands containing arguments.

### redacted-content _(recommended default)_

Persists: redacted user prompts, redacted command text, redacted relative file
paths, sanitised tool metadata, derived prompt features.

Does **not** persist: assistant response bodies by default, source-file contents,
raw environment variables, authentication data, full command output.

### full-local

Persists additional local content **only** after a strong warning and explicit
opt-in. Even in full-local mode: secret detection runs; environment-variable
values identified as secrets are never persisted; auth headers are never
persisted; known API-key formats are never persisted; data is never transmitted
externally.

## Redaction

The redaction pipeline (§8.4) runs **before** persistence and **before** logging.
It detects and masks:

- API keys (common formats)
- Bearer tokens
- JWTs
- Private keys
- Password assignments
- Connection strings
- Cookies
- Authorization headers
- Common cloud credentials
- `.env` values
- User-defined regular expressions / labels (`privacy.customPatterns`)
- Optional email redaction (`privacy.redactEmails`)
- Home-directory redaction (`privacy.redactHomePath`, default true)
- Repo-path anonymisation

For each redacted value, AgentLens stores a redacted representation plus a stable
hash (for correlation); it never stores the original alongside the redacted
version. Redaction is applied to hook payloads and telemetry too — all untrusted
inputs are re-redacted on ingestion.

## Retention

`privacy.retentionDays` (default 90) controls automatic pruning. Prune manually:

```bash
agentlens privacy retain --days 30   # delete sessions older than 30 days
```

Retention pruning deletes sessions and their events; the schema is preserved.

## Deletion

Complete local deletion is always available and irreversible:

```bash
agentlens privacy purge              # delete ALL imported data (every table)
agentlens privacy purge --project X  # delete one project + its sessions/events
```

The local API exposes the same controls (requiring the random runtime token for
mutating requests):

```
POST /api/v1/privacy/purge              # all data
POST /api/v1/privacy/purge?projectId=X  # one project
POST /api/v1/privacy/retain             # prune by retention window
```

`agentlens privacy export` writes a redacted bundle to `exports/` for support or
inspection without exposing raw transcripts. You can inspect resolved paths with
`agentlens privacy paths` / `agentlens config path`.

## External provider behaviour

External analysis (an optional coaching provider, §19.5) is **disabled by
default**. When enabled it requires explicit opt-in, an explicit provider and
model, redaction before transmission, a preview, clear disclosure, a request
timeout, no automatic retries containing sensitive data, and no remote provider
keys in logs. The deterministic Prompt Coach works **without** any external
model and is what the dashboard uses by default.

## Local server behaviour

- Binds to `127.0.0.1` only; non-loopback binding is rejected unless explicitly
  configured with a warning.
- Mutating requests require a random **runtime token** generated per server
  start (CSRF / browser-origin abuse protection); the token is injected into the
  served dashboard HTML so the same-origin UI can call mutations.
- Cross-origin browser requests (with an `Origin` header) are rejected; there is
  no permissive CORS.
- Request bodies are size-limited; safe timeouts are applied.
- The API never returns fields disallowed by the active privacy mode, never
  offers arbitrary filesystem access via parameters, and paginates large
  collections.

See [`SECURITY.md`](../SECURITY.md) for the threat model.
