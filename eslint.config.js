import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// Minimal Node.js global set for the distributable Claude Code plugin scripts
// (CommonJS, executed directly by the hook runner — intentionally not ESM).
const NODE_SCRIPT_GLOBALS = Object.fromEntries(
  [
    "process",
    "Buffer",
    "console",
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "setImmediate",
    "clearImmediate",
    "queueMicrotask",
    "AbortController",
    "AbortSignal",
    "fetch",
    "URL",
    "URLSearchParams",
    "TextEncoder",
    "TextDecoder",
    "performance",
    "crypto",
    "Event",
    "EventTarget",
    "MessageEvent",
    "structuredClone",
    "global",
    "navigator",
    "Blob",
    "FormData",
    "Headers",
    "Request",
    "Response",
    "BroadcastChannel",
  ].map((name) => [name, "readonly"]),
);

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/*.config.{js,ts,cjs,mjs}",
      "apps/dashboard/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    // The distributable Claude Code plugin ships CommonJS scripts that the
    // Claude Code hook runner executes directly (no build step, must run on a
    // bare `node scripts/hook.js`). Allow Node globals + require for those
    // files only; everything else stays strict ESM.
    files: ["plugins/agentlens-claude/scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: NODE_SCRIPT_GLOBALS,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
