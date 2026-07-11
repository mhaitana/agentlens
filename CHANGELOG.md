# Changelog

AgentLens is versioned with [Changesets](https://github.com/changesets/changesets).
This file is generated and maintained by the release workflow — **do not edit
release entries by hand**.

## How it is kept up to date

1. A contributor runs `pnpm changeset` from the repo root and answers the
   prompts to record the change (which packages, semver bump, summary).
   A changeset markdown file is added under `.changeset/`.
2. At release time, `pnpm version-packages` consumes pending changesets,
   bumps package versions, and regenerates this file.
3. The generated entries are committed and tagged.

No releases have been published yet, so there are no version entries below.
When the first release runs, the changesets under `.changeset/` will produce
the initial version section here.
