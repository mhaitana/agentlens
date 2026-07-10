import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Dashboard eslint config (spec §18.5). The root config ignores
 * `apps/dashboard/**`, so the dashboard ships its own lightweight flat config:
 * `@eslint/js` recommended + typescript-eslint recommended (JSX-aware, not
 * type-checked, to keep lint fast). React hooks/refresh plugins are omitted to
 * avoid extra install churn; `tsc --noEmit` already type-checks, and the test
 * suite exercises render behaviour.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".turbo/**", "*.config.{js,ts,cjs,mjs}"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
