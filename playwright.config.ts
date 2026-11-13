import { defineConfig } from "@playwright/test";

// Root Playwright config — kept here (not under e2e/) so `playwright test` finds it with no
// flags. Implements docs/plans/playwright-bootstrap.md §3.4 (harness) and §3.7 (config
// summary). Alternative B (route-mocked API, §3.3a): every /api/* request is intercepted in
// the browser (e2e/fixtures/api-mocks.ts) — nothing reaches the Worker, so there is no
// migration step, no seeding, no teardown, and no auth plumbing here. `wrangler dev` is
// retained because every spec's page.goto("/") is routed through
// src/worker/index.ts's `app.all("*") -> ASSETS.fetch(...)` fallback — the real, deployed
// Static Assets serving path (§3.4.0).
//
// No globalSetup: the 8787 dev-server collision probe MUST run BEFORE `npm run build` (it
// aborts the chain before `vite build`'s `emptyOutDir: true` can wipe the shared ./dist a live
// `npm run dev` session may be serving), so it lives as the first element of
// webServer.command instead (e2e/preflight-port.mjs, §3.4.1a). That placement also means the
// guard does not depend on Playwright's globalSetup/webServer ordering, which has changed
// across Playwright versions.

const E2E_PORT = 8788;
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// E2E_REUSE=1 — debug-only, mirrors the E2E_WEBKIT=1 pattern below. Skips the leading
// `npm run build` and reuses whatever server is already listening. Serves WHATEVER dist/ is
// already built, and REQUIRES that one exist — on a fresh clone with no dist/ every spec fails
// confusingly. Only valid when iterating on spec code, never when validating an app change
// (see the CLAUDE.md note this plan adds).
const reuseExistingServer = process.env.E2E_REUSE === "1";

// E2E_WEBKIT=1 — WebKit is defined but excluded from the default run (§3.5). The product's
// primary surface is iOS Safari, but Playwright's WebKit is not Safari, so a WebKit pass does
// not license "works on iPhone" and a WebKit failure may be a Playwright artifact. Run it
// deliberately when a branch touches focus or layout.
const withWebkit = process.env.E2E_WEBKIT === "1";

const buildStep = reuseExistingServer ? "" : "npm run build && ";
const serverCommand =
  `node e2e/preflight-port.mjs && ${buildStep}npx wrangler dev --port ${E2E_PORT} --persist-to .wrangler/e2e-state`;

export default defineConfig({
  testDir: "./e2e",

  // Determinism, not shared state (there is none under Alternative B): E1 is a focus- and
  // geometry-sensitive suite running headless, in a browser with DOCUMENTED focus artifacts
  // (calendar-roving-tabindex-report.md — headless Chromium's Tab-exit destination is
  // inconsistent at the page boundary). Competing browser processes perturb layout timing and
  // focus; three spec files on one machine gain almost nothing from parallelism.
  fullyParallel: false,
  workers: 1,

  // Unconditional, not `!!process.env.CI` — there is no CI in this repo. A stray `test.only`
  // is the specific way this suite silently shrinks back toward a no-op.
  forbidOnly: true,
  retries: 0,

  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },

  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // Pinned explicitly: E3 beat 1's nav[aria-label="Primary"] and E1's Calendar-nav selector
    // both depend on being at/above the ~768px breakpoint. E2 overrides per-test to add
    // 390x844.
    viewport: { width: 1280, height: 800 },
    // page.route() is reliable only while a service worker is not controlling the page. Safe
    // as the default here only because web/sw.ts has no `fetch` handler (R2d) — boot.spec.ts
    // (E3) overrides this to "allow" because it needs the real registration to assert against.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  webServer: {
    // Chained with `&&`, never `;`, so a failed port probe or build surfaces immediately as a
    // command failure rather than an opaque 180s wait-for-URL timeout.
    command: serverCommand,
    url: `${BASE_URL}/`,
    reuseExistingServer,
    timeout: 180_000,
    // So the "[dev-auth] shim active as <email>" line and any Worker error appear in the run
    // output — not a leak (test-results/ and playwright-report/ are gitignored, and the
    // address is already committed in wrangler.toml), but do not paste raw run output into a
    // docs/qa/ report without noticing it.
    stdout: "pipe",
    stderr: "pipe",
  },

  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // colorScheme claims only — E1 is the only spec asserting anything about colour. E2's
    // geometry and E3's boot claims are scheme-independent, so running them twice buys
    // nothing.
    {
      name: "chromium-dark",
      use: { browserName: "chromium", colorScheme: "dark" },
      testMatch: /calendar-keyboard\.spec\.ts/,
    },
    ...(withWebkit
      ? [
          {
            name: "webkit",
            use: { browserName: "webkit" as const },
          },
        ]
      : []),
  ],
});
