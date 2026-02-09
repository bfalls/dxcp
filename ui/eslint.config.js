import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const ignores = [
  "dist/**",
  "coverage/**",
  "node_modules/**",
  "playwright-report/**",
  "test-results/**"
];

const sharedGlobals = {
  window: "readonly",
  document: "readonly",
  fetch: "readonly",
  localStorage: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  atob: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  console: "readonly",
  process: "readonly"
};

const baseLanguageOptions = {
  ecmaVersion: "latest",
  sourceType: "module",
  globals: sharedGlobals,
  parserOptions: {
    ecmaFeatures: { jsx: true }
  }
};

const tsConfigs = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: ["src/**/*.{ts,tsx}"],
  languageOptions: {
    ...config.languageOptions,
    ...baseLanguageOptions
  }
}));

export default [
  { ignores },
  {
    files: ["src/**/*.js"],
    languageOptions: baseLanguageOptions,
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" }
      ],
      ...reactHooks.configs.recommended.rules
    }
  },
  {
    files: ["src/**/*.jsx"],
    languageOptions: baseLanguageOptions,
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": "off",
      ...reactHooks.configs.recommended.rules
    }
  },
  ...tsConfigs,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  }
];
