// e2e/boot.spec.ts — E3, build-output integrity. Two beats only.
//
// v1 of this plan carried a third beat (a console-error allowlist) that was cut: it would have
// shipped with 3 allowlist entries against its own documented kill threshold of ~5, and two of
// those three are not console *errors* at all (calendar-roving-tabindex-report.md:147-152: the
// `[dev-auth]` line is a `warn`, the favicon 404 is a network failure). See
// docs/plans/playwright-bootstrap.md §3.2 E3.
//
// Beat 1 is a smoke check with narrow residual value, not a diagnosability guarantee — there is
// no authentication in this harness at all (GET /api/me is fulfilled by a mock), so beat 1
// degrades to "does React render given a canned payload," which the 300 jsdom tests already
// establish far more cheaply. What it still proves, and the only reason it is kept: the BUILT
// bundle parses, mounts, and reaches an interactive state when served by `wrangler dev` — no
// jsdom test loads build output. It is NOT coverage on its own.
//
// Beat 2 is the only genuine claim in this file: vite.config.ts's custom entryFileNames emits
// the service worker at the site ROOT as sw.js, while every other chunk gets a hashed
// assets/[name]-[hash].js path. Nothing else in the repo verifies that a future Vite/rollup
// config edit couldn't quietly relocate it (push would then break silently on the family's
// phones).
//
// `wrangler dev` is retained for EVERY spec in this suite, not because of beat 2 alone:
// src/worker/index.ts's `app.all("*") -> c.env.ASSETS.fetch(...)` fallback routes every
// non-API request (including every plain page.goto("/") in E1 and E2) through the same
// Static Assets path production uses. Beat 2 is the most explicit assertion against that path,
// not the only consumer of it (plan §3.4.0) — if beat 2 is ever dropped, do not swap in a
// static server on that basis.
//
// This is the one spec where service workers are NOT blocked (plan §3.4.3(e)) — it needs the
// real registration to assert against. E1/E2 block them (`serviceWorkers: "block"`, the config
// default) because page.route() is reliable only while a service worker is not controlling the
// page; that is safe today only because web/sw.ts has no `fetch` handler (R2d).
import { test, expect } from "@playwright/test";
import { buildList, buildUser, installApiMocks } from "./fixtures/api-mocks";

test.use({ serviceWorkers: "allow" });

test.describe("boot (E3)", () => {
  test("beat 1: the built bundle boots to the primary nav (a smoke check, not coverage)", async ({ page }) => {
    const list = buildList();
    // Still needs the /api/* mocks installed — otherwise the app hits the real Worker and
    // renders the "Signing in…"/error state instead of the primary nav.
    await installApiMocks(page, { list, user: buildUser() });

    await page.goto("/");

    // Assert the POSITIVE and let it carry the claim. App.tsx has FOUR non-app states:
    // "Loading Family Scheduler…", "Account deactivated", "Error: …", and "Signing in…". A
    // naive "not Signing in / not Deactivated" check would pass on an app booted into the
    // error banner. nav[aria-label="Primary"] is inside the md:flex desktop aside and is
    // display:none below 768px — this assertion is only valid at the pinned 1280x800 default
    // viewport.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  test("beat 2: sw.js is served at the root, and is actually the service worker", async ({ page, request }) => {
    const list = buildList();
    await installApiMocks(page, { list, user: buildUser() });

    // Fetched via APIRequestContext — deterministic, no service-worker lifecycle flake, and
    // outside the page, so no route mocking is involved either way.
    const swResponse = await request.get("/sw.js");
    expect(swResponse.status()).toBe(200);
    const contentType = swResponse.headers()["content-type"] ?? "";
    expect(contentType).toContain("javascript");

    // Status + content-type alone are not enough — a future `not_found_handling` change on
    // [assets] could satisfy a 200 with something that is not the service worker at all.
    // "notificationclick" is a string literal passed to addEventListener (web/sw.ts), so it
    // survives minification.
    const body = await swResponse.text();
    expect(body).toContain("notificationclick");

    // main.tsx registers on `window load`, so a single synchronous read races the
    // registration — poll instead.
    await page.goto("/");
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration("/");
            return reg !== undefined;
          }),
        { timeout: 10_000 }
      )
      .toBe(true);
  });
});
