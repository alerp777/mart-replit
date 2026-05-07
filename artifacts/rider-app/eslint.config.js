import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
    },
    linterOptions: {
      // Pre-existing eslint-disable comments for rules that are currently off
      // (e.g. react-hooks/exhaustive-deps) must not be flagged as unused.
      // This config is intentionally scoped to no-console enforcement only.
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // Block console.log and console.debug — these can leak debug output in production.
      // console.error and console.warn are permitted for error reporting.
      // Build-time stripping (esbuild.drop) is the production safety net;
      // this rule is the developer-facing gate that makes violations visible in CI.
      "no-console": ["error", { allow: ["error", "warn"] }],

      // Registered so existing eslint-disable-next-line react-hooks/exhaustive-deps
      // comments in the codebase are accepted. Rule is intentionally off — a
      // dedicated lint clean-up task tracks enabling it fully.
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
