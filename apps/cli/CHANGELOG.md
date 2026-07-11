# @mhaitana/agentlens

## 0.1.1

### Patch Changes

- [`bc01ab7`](https://github.com/mhaitana/agentlens/commit/bc01ab737237be8bb225609e74880c30a84bdb7f) Thanks [@mhaitana](https://github.com/mhaitana)! - Serve the dashboard SPA shell with `Cache-Control: no-store` so a stale cached `index.html` can't reference old asset hashes and 404 across reinstalls/redeploys. Hashed `/assets/*` files are now served `immutable`.

## 0.1.0

### Minor Changes

- [`6524495`](https://github.com/mhaitana/agentlens/commit/652449541818110937bd3a767c435a426ba0b251) Thanks [@mhaitana](https://github.com/mhaitana)! - Initial release — local-first, privacy-first analytics & coaching for AI coding agents (Claude Code first): CLI reports, a local dashboard, 34 recommendation rules, a Claude Code observation plugin, and a Configuration Doctor. Distributed as `@mhaitana/agentlens` via GitHub Packages.
