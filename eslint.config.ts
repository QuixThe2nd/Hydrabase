import js from "@eslint/js";
import perfectionist from "eslint-plugin-perfectionist";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ─── Base ─────────────────────────────────────────────────────────────────
  {
    extends: [js.configs.all],
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      }
    },
    plugins: { js, react, unicorn },
  },
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  reactHooks.configs.flat.recommended,
  sonarjs.configs.recommended,

  // ─── Perfectionist ────────────────────────────────────────────────────────
  perfectionist.configs["recommended-natural"],

  // ─── Project-wide overrides ───────────────────────────────────────────────
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "camelcase": "off",
      "curly": "off",
      "dot-notation": "off",
      "id-length": "off",
      "max-params": "off",
      "no-await-in-loop": "off",
      "no-console": "error",
      "no-continue": "off",
      "no-inline-comments": "off",
      "no-magic-numbers": "off",
      "no-nested-ternary": "off",
      "no-plusplus": "off",
      "no-redeclare": "off",
      "no-shadow": "off",
      "no-ternary": "off",
      "no-undef": "off",
      "no-undefined": "off",
      "no-underscore-dangle": "off",
      "no-unused-vars": "off",
      "no-warning-comments": "off",
      "one-var": "off",
      "react/jsx-filename-extension": "off",
      "react/jsx-no-useless-fragment": "error",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "sonarjs/class-name": "off",
      "sonarjs/function-return-type": "off",
      "sonarjs/no-async-constructor": "off",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-nested-template-literals": "off",
      "sort-imports": "off",
      "sort-keys": "off",
      "sort-vars": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.min.js", "*.gen.ts"],
  },
)
