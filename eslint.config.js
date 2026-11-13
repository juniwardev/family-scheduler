// ESLint 9 flat config. Restores `npm run lint` (previously broken: ESLint 9 was installed
// but no config file existed and the old script used the removed `--ext` flag).
//
// Two file groups: the Cloudflare Worker code under `src/` (service-worker + Node globals) and
// the React PWA under `web/src/` (browser globals + React-hooks rules). typescript-eslint's
// `recommended` (non-type-checked) is used as the baseline — it disables core rules that TS
// already covers (e.g. no-undef) and adds TS-aware lint without requiring the slower
// type-checked program wiring.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts", "coverage/**", ".wrangler/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Allow underscore-prefixed identifiers to be intentionally unused (e.g. `_ctx` handler args).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Cloudflare Worker code
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.node },
    },
  },

  // React PWA
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Rules-of-hooks is load-bearing here (see the NotificationSetup on-mount effect fix).
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // E2E (Playwright) tooling (docs/plans/playwright-bootstrap.md §4.2). Otherwise `process`
  // etc. trip no-undef, and neither of the suite's two most important invariants is enforced.
  {
    files: ["e2e/**/*.ts", "e2e/**/*.mjs", "playwright.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // The two highest-leverage rules in the Playwright bootstrap plan (§4.2a, §4.2b) — both ride
  // on `npm run lint`, which is in the Coder's per-change loop AND the pre-PR gate, unlike
  // `npm run test:e2e` (neither). Scoped to *.spec.ts only: e2e/fixtures/api-mocks.ts is where
  // JSON.stringify is SUPPOSED to live, behind typed factory signatures.
  {
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='focus']",
          message:
            "Do not call .focus() in an e2e spec. Focus must be established ONLY by real key " +
            "presses (page.keyboard.press) — a JS-triggered focus does not reliably set " +
            ":focus-visible in Chromium, and Chromium's heuristic keys on the last USER " +
            "interaction, so a preceding real Tab elsewhere in the same test can let a " +
            ".focus() substitution pass silently. See " +
            "docs/qa/calendar-show-more-report.md:46-52 and the HARD INVARIANT comment at the " +
            "top of calendar-keyboard.spec.ts.",
        },
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message:
            "E2E mock payloads must come from typed factories in e2e/fixtures/api-mocks.ts — " +
            "an inline JSON.stringify typechecks against nothing and silently defeats the " +
            "OccurrenceEntry drift check (docs/plans/playwright-bootstrap.md §3.3a, §4.2b).",
        },
      ],
    },
  },
);
