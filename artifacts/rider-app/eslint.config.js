import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "public/**"],
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      // Block console.log and console.debug — these can leak debug info in production.
      // console.error/warn are allowed for error reporting.
      // group/groupCollapsed/groupEnd/info are allowed for dev-only env diagnostic banners
      // (main.tsx) which are already gated by import.meta.env.DEV
      // and stripped at build time via esbuild.drop.
      "no-console": ["error", { allow: ["error", "warn", "info", "group", "groupCollapsed", "groupEnd"] }],
    },
  },
);
