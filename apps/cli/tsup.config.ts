import { defineConfig } from "tsup";

/**
 * CLI build config (spec §11, §16).
 *
 * The published `@mhaitana/agentlens` package inlines every `@agentlens/*`
 * workspace package (they are never published on their own) and keeps all
 * third-party deps external so they resolve from the installer's registry.
 *
 *  - `skipNodeModulesBundle: true` makes every node_modules import external by
 *    default (including `@libsql/client`, whose platform-specific native
 *    optionalDependencies MUST stay external so npm installs the right binary).
 *  - `noExternal` re-includes the `@agentlens` scope so those workspace packages
 *    are bundled into the single `dist/index.js`.
 *
 * The build emits a single ESM file with the existing `#!/usr/bin/env node`
 * shebang and executable bit.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  skipNodeModulesBundle: true,
  noExternal: [/@agentlens\/.*/],
  sourcemap: true,
});
