# Troubleshooting

Common issues and how to resolve them. When in doubt, run
`agentlens status` and `agentlens privacy paths` to see what AgentLens sees and
where it is writing.

## Claude transcripts not found

`agentlens scan` reports zero discovered sessions.

- Confirm the Claude projects directory exists. By default AgentLens looks under
  your Claude Code projects location; override with `agentlens scan --path <dir>`.
- Check `agentlens config path` and inspect `sources.claudeCode.transcriptDirectories`
  in `config.json`; an empty list means “use defaults”, a non-empty list **replaces**
  the defaults.
- Ensure the directory contains `.jsonl` transcript files (not just `.jsonll` or
  backups). The discovery step skips files that do not match the transcript glob.
- Symlinks are **not** followed by default (`sources.claudeCode.followSymlinks`
  is `false`). Enable it only if you understand the traversal risk.
- Run `agentlens scan --dry-run --json` to see what would be discovered without
  writing anything.

## Unsupported transcript records

A scan completes but reports parser diagnostics / skipped lines.

- This is expected: transcript fields are partially undocumented and
  version-dependent. Parsers are tolerant — a malformed line is recorded as a
  diagnostic and skipped; it never fails the whole scan.
- Inspect diagnostics via `agentlens scan --json` (the `diagnostics` field).
- Undocumented fields are treated as unstable; do not build logic against them.
  If a field you relied on changed, verify against current Claude Code docs.

## Hook not firing

You installed the plugin but no hook events appear.

- Run `agentlens integrate claude-code --status` to confirm the install and the
  hook matcher.
- Check the hook command in your Claude Code settings points at the AgentLens
  hook script (see `plugins/agentlens-claude/`).
- Hooks run the collector, which writes to the spool then attempts a short-timeout
  loopback delivery. If the local API is down, events are retained in the spool
  and drained on the next `agentlens scan` / collector wake — they are not lost.
- Ensure the hook process can write to the AgentLens event-spool directory
  (`agentlens privacy paths`).

## Plugin installation issues

- `agentlens integrate claude-code --status` returns “not installed”: run
  `agentlens integrate claude-code` to install the observation-only plugin.
- To preview without changing anything: `agentlens integrate claude-code --dry-run`.
- To remove: `agentlens integrate claude-code --remove`.
- The plugin is **observation-only**. It never executes commands, never passes
  payload strings to a shell, and never auto-enables bypass permissions or
  external data transmission.

## Collector offline

The live dashboard shows no new events.

- Confirm the local API is running: `agentlens dashboard` starts it (or reuses a
  healthy instance). Check the printed loopback URL.
- The collector drains the spool to the API on a short timeout; if the API was
  unreachable, spooled events persist on disk and are drained later.
- Run `agentlens status` — it reports the runtime port if a server is healthy.

## OTLP errors

`agentlens telemetry status` reports the receiver off, or exporters cannot connect.

- Enable with `agentlens telemetry configure` (disabled by default). The receiver
  listens on loopback only (default OTLP/HTTP port 4318).
- Confirm the exporter targets `http://127.0.0.1:4318` (or your configured port).
  Telemetry must stay local; pointing an exporter at a remote endpoint transmits
  data externally and is outside AgentLens’s local-first model.
- Inspect the resolved environment with `agentlens telemetry print-env`.

## Port conflicts

`agentlens dashboard` picks a different port than expected.

- The default port is `4318` for OTLP and `47821` for the dashboard. If a
  preferred port is occupied on loopback, AgentLens picks a free one and prints
  the chosen URL.
- To pin a port, set `dashboard.port` in `config.json`.
- The API binds to `127.0.0.1` only; it is not reachable from other machines.

## Database recovery

The dashboard or CLI reports a database error.

- The DB is SQLite in WAL mode under your data home. Stop any running server,
  then run `agentlens scan` again — migrations run on open.
- If the DB is corrupt, move it aside (`agentlens privacy paths` shows the
  location) and run `agentlens init` + `agentlens scan` to rebuild from the
  original transcripts (which are untouched).
- Never edit the SQLite file by hand while a server is running.

## Privacy purge

`agentlens privacy purge` is **irreversible**.

- `agentlens privacy purge` deletes **all** imported data (every table) but keeps
  the schema. The original Claude transcripts on disk are untouched.
- `agentlens privacy purge --project X` deletes one project and its sessions/events.
- `agentlens privacy retain --days N` prunes sessions older than N days.
- `agentlens privacy export` writes a redacted bundle to `exports/` first if you
  want a copy before purging.
- Via the API, purge/retain require the random runtime token.

## Windows path issues

- Use forward slashes or escaped backslashes in `--path` and config.
- The data home is `%LOCALAPPDATA%\AgentLens`; override with `AGENTLENS_HOME`.
- Long paths may need Windows long-path support enabled.

## Permission errors

- The data home and DB are created with restrictive permissions. If a hook or
  scan cannot write, check the OS data home directory’s ownership/permissions.
- Doctor patches to Claude Code config require write access to your
  `~/.claude` (override with `AGENTLENS_CLAUDE_HOME` for tests/dry-runs).
- Doctor **never** applies a patch without explicit approval; every remediation
  shows a diff, names the target file, backs up first, validates, and supports
  rollback. See the dashboard Doctor screen or `agentlens doctor --dry-run`.
