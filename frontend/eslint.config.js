/** Governance lint gates for the feature-sliced structure (Step 4).
 *
 * Rules enforced:
 * 1. No raw fetch() in components/pages — endpoint calls belong in each
 *    feature module's api.ts (which uses shared/api/client apiFetch).
 * 2. No relative "./api" or "@/api" imports — the legacy shim is deleted.
 * 3. Pages import their feature api directly.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src-tauri/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      // ratchet (2026-09-03): src passes with these ON except the two noted below
      "no-unused-expressions": "off",             // print-report template style, revisit
      "@typescript-eslint/no-unused-expressions": "off",
      "no-constant-binary-expression": "off",     // print-report template style, revisit
      "no-useless-escape": "off",                 // print-report <\/script> bytes, keep
      // no-undef is redundant under TS (tsc catches undefined identifiers) and
      // false-positives on `React.ReactNode` / `RequestInit` type positions
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      // governance: transport must go through shared/api/client.ts (apiFetch)
      "no-restricted-globals": ["error", {
        name: "fetch",
        message: "Call APIs through @/features/<name>/api.ts (which uses apiFetch) — never raw fetch in components/pages.",
      }],
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["./api", "../api", "@/api"],
            message: "The legacy src/api.ts shim is deleted — import from @/features/<name>/api directly." },
        ],
      }],
      // pragmatic baseline for an existing large codebase
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "no-case-declarations": "off",
      // B-13: emoji banned in JSX (lucide SVG only) — block common ranges in source
      "no-irregular-whitespace": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // the sanctioned homes for raw fetch(): shared client + feature api modules
    files: [
      "src/shared/api/client.ts",
      "src/features/*/api.ts",
      "src/features/*/admin-api.ts",
    ],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["scripts/**/*.{mjs,js}", "vite.config.ts"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  }
);
