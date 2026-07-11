# agentlens-claude

An **observation-only** [Claude Code](https://code.claude.com) plugin that feeds
Claude Code hook events to your **local** [AgentLens](https://github.com/mhaitana/agentlens)
instance for analytics — with no account, no cloud, and no transmission of data
off your machine.

## What it does

For every supported hook event (SessionStart, UserPromptSubmit, PreToolUse,
PostToolUse, Stop, SubagentStart/Stop, Pre/PostCompact, SessionEnd, …), the
plugin's hook script:

1. Reads the hook payload from stdin.
2. **Secret-redacts** it immediately (API keys, tokens, private keys, connection
   strings, cookies, … are replaced with opaque `[REDACTED:…]]` placeholders).
3. POSTs the redacted payload to your local AgentLens collector on loopback
   (`127.0.0.1`) with a short timeout.
4. If the collector is offline, **atomically spools** the redacted event to
   `<AGENTLENS_HOME>/event-spool/` for later import.
5. **Always exits 0** — it never blocks, approves, denies, or modifies
   anything Claude Code does.

## What it does NOT do

Per the AgentLens non-negotiable principles, this plugin is strictly
observation-only. It never:

- Approves or denies tool calls.
- Changes Claude's prompt or adds context.
- Blocks a session.
- Alters tool inputs.
- Modifies user files.
- Writes anything to stdout (stdout on some events is added to Claude's context;
  the hook is silent).

## Install

```bash
agentlens integrate claude-code
```

This detects Claude Code, shows the planned changes, backs up your settings,
registers the plugin, validates the result, and runs a health check. Run with
`--dry-run` to preview, `--status` to inspect, or `--remove` to uninstall (only
AgentLens-owned configuration is removed — unrelated hooks are preserved).

## Health check

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/health.js"
```

## Privacy

The hook script redacts secrets **before** they leave the hook process (before
spool or POST). The AgentLens collector then re-applies the full redaction
pipeline before persisting to the local database (defense in depth, spec §8.4).
In `metadata-only` mode, prompt text and tool I/O are dropped entirely. No data
ever leaves your machine.

## Manual setup (without `integrate`)

Load the plugin directly for testing:

```bash
claude --plugin-dir ./plugins/agentlens-claude
```

## Version

See `.claude-plugin/plugin.json`. The hook event set follows Claude Code's
documented hook reference; the collector tolerates missing, new, removed, and
unknown fields (spec §14.2, §12).
