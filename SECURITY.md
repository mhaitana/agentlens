# Security policy

AgentLens is a **local-first** tool: it runs entirely on your machine, the API
binds to `127.0.0.1`, and nothing is transmitted externally by default. This
document covers supported versions, reporting a vulnerability, sensitive-data
handling, the threat model, safe debugging, and the rule against sharing real
transcripts.

## Supported versions

AgentLens is pre-1.0 and shipped as a source workspace. Security fixes apply to
the latest `main` only; there are no backport branches yet. Pin to a commit you
have reviewed, and update by pulling the latest.

| Version       | Supported   |
| ------------- | ----------- |
| latest `main` | ✅          |
| older commits | ❌ (update) |

## Reporting a vulnerability

Please report suspected vulnerabilities privately **before** opening a public
issue. Do not include real transcripts, API keys, or other private data in a
report. A good report includes:

- A description of the issue and its security impact.
- Steps to reproduce using **synthetic** fixtures only (see
  `packages/test-fixtures/`).
- The affected file(s) / command(s) / route(s).

If the issue involves a real transcript, redact it first or describe it without
attaching the file.

## Sensitive-data handling

AgentLens is designed so that sensitive data never leaves your machine and is
never persisted in the clear:

- **Redaction runs before persistence and before logging.** Secrets, auth
  headers, API keys, private keys, cookies, connection strings, and `.env`
  values are masked. Only a redacted representation plus a stable hash is stored;
  the original is never stored alongside the redacted version.
- **Privacy modes** cap what is stored at all. The default is `redacted-content`.
  Even in `full-local` (explicit opt-in), secret detection still runs and no
  secrets / auth headers / known API-key formats are ever persisted.
- **Telemetry logging fields default to off** — no prompt bodies, assistant
  responses, tool content, or raw API bodies are logged unless explicitly enabled.
- **External analysis is disabled by default** and, when enabled, requires
  redaction before transmission, a preview, a request timeout, and no retries
  carrying sensitive data.

Never put a real API key or secret into a bug report, a screenshot, or a
synthetic fixture.

## Threat model summary

AgentLens assumes a **single-user, local** trust boundary. The realistic threats
are:

1. **Local code execution / config tampering.** The Configuration Doctor can
   patch Claude Code settings. Mitigation: patches are never auto-applied
   (`automaticallyApplicable: false`); every remediation shows a diff, names the
   target file, backs up first, requires explicit approval, validates, and
   supports rollback. Patches are confined to approved Claude Code config paths.
2. **Secrets persisted in the clear.** Mitigation: redaction before persistence;
   secret detection even in full-local; telemetry logging defaults off.
3. **Browser-origin abuse of the loopback API.** Mitigation: the API binds to
   `127.0.0.1` only; mutating requests require a per-server random runtime token
   (CSRF); cross-origin requests (with an `Origin` header) are rejected; there is
   no permissive CORS.
4. **Path traversal / symlink escape.** Mitigation: paths are canonicalised,
   symlinks are not followed by default, reads are confined to approved source
   locations, and API params never grant arbitrary filesystem access.
5. **Untrusted hook payloads.** Mitigation: hook payloads are validated,
   redacted, size-limited, never executed, and never passed to a shell; hook
   processes are near-zero-latency and never run DB migrations or analysis.
6. **Injection via dashboard rendering.** Mitigation: all user-controlled text is
   escaped (React escapes by default; no `dangerouslySetInnerHTML` on transcript
   content); no transcript HTML is rendered; ANSI/terminal escape sequences are
   neutralised, not executed; there are no clickable command links that execute
   actions.
7. **Transcript leakage via logs/exports.** Mitigation: logs are rotated and
   redacted; `privacy export` produces a redacted bundle.

Out of scope by design: multi-user auth, remote transcript storage, cloud sync,
team dashboards, and any external network dependency by default.

## Safe debugging instructions

- Use `AGENTLENS_HOME` to point AgentLens at a throwaway data home so debugging
  never touches your real data.
- Use `AGENTLENS_CLAUDE_HOME` so `agentlens doctor` inspects a throwaway Claude
  config directory instead of your real `~/.claude`.
- Use `agentlens scan --dry-run` and `agentlens doctor --dry-run` to observe
  behaviour without writing.
- Use `agentlens privacy paths` to confirm where files will be written before
  running anything destructive.
- Avoid `console.log`-ing raw hook payloads, prompt bodies, or OTLP bodies; the
  codebase redacts before logging by default — keep it that way.
- Never `process.env`-dump in logs; environment variables may contain secrets.

## Warning against sharing real transcripts in bug reports

**Do not attach real Claude Code transcripts, hook payloads, or OTLP exports to
bug reports or issues.** They may contain your source code, secrets, file paths,
and command history. Instead:

- Reproduce with the synthetic fixtures under `packages/test-fixtures/`.
- Or use `agentlens privacy export` to produce a **redacted** bundle, and review
  it before sharing.
- If you must share a real transcript, redact it yourself first — do not rely on
  AgentLens redaction as a safe-to-share guarantee for untrusted audiences.
