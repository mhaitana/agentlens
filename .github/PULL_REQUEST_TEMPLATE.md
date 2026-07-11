## What does this PR do?

Brief description of the change and the problem it solves.

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation / docs-only change
- [ ] Refactor / internal improvement
- [ ] Test improvement
- [ ] Build / tooling change

## Checklist

- [ ] `pnpm format:check` passes (run `pnpm format` first)
- [ ] `pnpm lint` and `pnpm typecheck` pass
- [ ] `pnpm test && pnpm test:integration && pnpm build` pass
- [ ] `pnpm test:e2e` passes if the change touches the dashboard, API, or CLI
- [ ] The §26 gate sequence is green (see [CONTRIBUTING.md](../CONTRIBUTING.md))
- [ ] No real transcripts or private usage data added — synthetic fixtures only
- [ ] No test depends on the real `~/.claude` directory; isolated `AGENTLENS_HOME` used
- [ ] New recommendation rules are registered in `defaultRules()`, tested in `rules.test.ts`, and documented in `docs/rules.md`
- [ ] Markdown links resolve; new public surfaces documented
- [ ] The change agrees with `agentlens-glm-5.2-build-prompt.md`, or the spec update is explained in the PR description

## Feature reference

If this PR implements or advances a tracked feature, include the tag in the
commit/PR body:

```
Refs: epcc-features.json#F00X
```

## Privacy / security notes

- Does this change persist, log, or transmit any user content? If so, how is it
  redacted and gated by the active privacy mode?
- Does this change expose a new API endpoint? If so, is it loopback-only and
  protected against browser-origin abuse?
- Does this change affect safe remediation (`automaticallyApplicable`)? It must
  remain `false` for any coding-agent adapter.

## Related issues

Closes #
