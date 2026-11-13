import { defineWorkspace } from "vitest/config";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Dual Vitest project setup (fix-item-save §8.1):
//  1. "worker" — the existing workers-runtime pool (miniflare/workerd, local D1). Runs
//     server-side *.test.ts under tests/ and src/worker/. No DOM.
//  2. "web" — a jsdom-environment project for React component tests (*.test.tsx under web/).
// Kept as two SEPARATE projects (not merged) so the workers pool config is never applied to
// the DOM project and vice versa. `vitest.config.ts` is intentionally NOT also loaded as an
// implicit root project here — it is referenced exactly once, inline below, to avoid
// double-loading defineWorkersConfig under the workspace.
export default defineWorkspace([
  defineWorkersConfig({
    test: {
      name: "worker",
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            d1Databases: { DB: "local-test-db" },
            r2Buckets: ["ATTACHMENTS"],
          },
        },
      },
      include: ["tests/**/*.test.ts", "src/worker/**/*.test.ts"],
    },
  }),
  {
    plugins: [react()],
    // This inline "web" project does NOT load vite.config.ts, so it needs its own
    // resolve.alias for "@" -> web/src (M2 — three-places requirement, plan Decision 1).
    resolve: {
      alias: {
        "@": resolve(__dirname, "web/src"),
      },
    },
    test: {
      name: "web",
      environment: "jsdom",
      // Widened from "web/**/*.test.tsx" (item-view-mode plan §7.1) so new pure-lib specs
      // under web/src/lib/*.test.ts are collected too. micromatch *.test.ts does NOT match
      // *.test.tsx, so BOTH globs are required — do not collapse to one. The worker project's
      // include (above) is scoped to tests/** and src/worker/**, so there is no overlap.
      include: ["web/**/*.test.ts", "web/**/*.test.tsx"],
      setupFiles: ["tests/setup/jsdom.setup.ts"],
      // Pinned for T29 (feat/item-archive, plan §7 step 12 / N4.2): T29 compares local midnight
      // against UTC midnight, which are the SAME instant at UTC offset zero — without a pinned
      // zone the guard clause would fail rather than skip on such a runner/CI machine. Applies
      // to every web spec, not just T29 — repo-wide, deliberately (see the plan's blast-radius
      // note); no existing web spec asserts an absolute timestamp, so this is safe today.
      env: { TZ: "America/Los_Angeles" },
    },
  },
]);
