---
name: Privacy report
about: Report a possible privacy, data-handling, or redaction concern
labels: privacy
---

⚠️ **Do not paste real transcripts, prompts, commands, file paths, API keys,
auth headers, or other private usage data in this issue.** Describe behaviour
in the abstract, using synthetic examples only.

## Concern

What data handling, redaction, retention, or disclosure behaviour is incorrect
or surprising?

## Expected behaviour

What did you expect AgentLens to do instead, according to the privacy model in
`docs/privacy.md` or spec §8?

## Actual behaviour

What happened? If you have synthetic fixture data that reproduces the issue,
you may attach it or describe it abstractly.

## Privacy mode

Which mode was active?

- metadata-only
- redacted-content
- full-local

## Does this affect security?

If you believe this is a vulnerability rather than a general privacy concern,
please follow [`SECURITY.md`](../SECURITY.md) and report privately instead.

## Feature reference

If tracked, note `Refs: epcc-features.json#F00X`.
