# Impl notes: `playwright-bootstrap` (v5, APPROVE)

Plan: `docs/plans/playwright-bootstrap.md`
Review: `docs/reviews/playwright-bootstrap-review.md` (5 rounds, verdict `APPROVE`)
Base commit: `a3aa8e7` (main, clean tree at start)

## Files changed

### New (all test/tooling, no application code)

- `playwright.config.ts` (new, root) — `testDir: "./e2e"`, `workers: 1`/`fullyParallel: false`,
  `forbidOnly: true`, `retries: 0`, pinned `viewport: {1280, 800}`, `serviceWorkers: "block"`
  default, artifacts (`trace`/`screenshot`/`video` on failure), the `webServer` block (probe →
  build → serve, `&&`-chained, `reuseExistingServer` gated on `E2E_REUSE`), and three projects
  (`chromium`, `chromium-dark` scoped to `calendar-keyboard.spec.ts` via `testMatch`, `webkit`
  gated on `E2E_WEBKIT`). No `globalSetup`.
- `e2e/preflight-port.mjs` (new) — the 8787 collision probe. First element of
  `webServer.command`, `&&`-chained before `npm run build`, so a non-zero exit aborts before
  `vite build`'s `emptyOutDir: true` can touch the shared `dist/`.
- `e2e/fixtures/dates.ts` (new) — pure current-month date helpers (`currentMonthYear`,
  `epochMsOnCurrentMonthDay`). No hardcoded month/year anywhere (grepped before finishing).
- `e2e/fixtures/api-mocks.ts` (new) — the whole mock contract: typed factories
  (`buildUser`/`buildList`/`buildItem`/`buildOccurrence`), the two fixture-geometry builders
  (`keyboardFixtureOccurrences`, `densityFixtureOccurrences`), and `installApiMocks`, which
  intercepts `**/api/**`, discriminates `getItems`/`getOccurrences` on the `from`/`to` query
  string, and **throws** on any unmatched `/api/*` request.
- `e2e/fixtures/assertions.ts` (new) — `expectContainedIn` (geometry containment with
  informative failures) and `expectFocusRing` (the ring-colour/offset-colour/layer-count
  assertion, via the hidden-probe technique for `--ring`, with a `testInfo.attach` screenshot on
  failure).
- `e2e/calendar-keyboard.spec.ts` (new) — E1. One test, nine `test.step` beats matching plan
  §3.2 exactly (reach Calendar → one tab stop → ArrowDown + `:focus-visible` → ring
  layers/colours → Button-primitive guard via Shift+Tab → real Enter/Space → focus restore).
  HARD INVARIANT comment at the top, citing `docs/qa/calendar-show-more-report.md:46-52`.
- `e2e/calendar-density.spec.ts` (new) — E2. Runs at 1280×800 and 390×844, collapsed and
  expanded, with the exact-cardinality beat (beat 0) before the geometry loop, plus the
  documented escape hatch for a 390px failure.
- `e2e/boot.spec.ts` (new) — E3. Two beats (nav visible; `/sw.js` served at root and contains
  `"notificationclick"`, polled SW registration). `serviceWorkers: "allow"` override for this
  file only.
- `tsconfig.e2e.json` (new) — extends the root `tsconfig.json`, overrides `types: ["node"]` and
  adds `"DOM"`/`"DOM.Iterable"` to `lib` (spec files reference `document`/`window` inside
  `page.evaluate` closures, which TS type-checks locally). Includes `e2e/**/*` and
  `playwright.config.ts`.

### Modified (non-application)

- `package.json` — `typecheck` gains `&& tsc --noEmit -p tsconfig.e2e.json`; `lint` gains
  `e2e playwright.config.ts`. `test:e2e` unchanged (`"playwright test"` was already correct).
- `eslint.config.js` — one block giving `e2e/**/*.ts`, `e2e/**/*.mjs`, and
  `playwright.config.ts` Node globals (otherwise `process` etc. trip `no-undef`), plus a second
  block scoped to `e2e/**/*.spec.ts` only, carrying the two `no-restricted-syntax` bans (`.focus(`
  and inline `JSON.stringify`).
- `CLAUDE.md` — replaced the bare E2E block with the full run/prerequisite/recovery/gate note
  (§4.2's required content: `playwright install chromium` prerequisite, dedicated port +
  `.wrangler/e2e-state`, "stop `npm run dev` first" rule, `pkill -f workerd` recovery,
  `E2E_WEBKIT=1`/`E2E_REUSE=1`, the gate-placement decision from plan §6).
- `docs/backlog.md` — the `Playwright bootstrap` entry (`:161`) marked `✅ RESOLVED` with the
  scope/gate summary and the verbatim dated keep-or-kill entry from plan §6. **New entry added**
  (see "Defect found" below) for the mobile "+N more" wrap.
- `docs/dev-fixtures.md` — one new section recording that the automated e2e suite and manual QA
  now take different paths (mocked API vs. real backend + shim).

**Not touched, as the plan requires:** anything under `src/` or `web/src/`, `wrangler.toml`,
`vite.config.ts`, `.gitignore` (needs no change — `test-results/`/`playwright-report/`/
`.wrangler/` already ignored), any migration. The one exception, per the plan's own explicit
carve-out: `web/src/components/ui/button.tsx:8` was edited (removed `ring-offset-background`),
verified red in both `chromium`/`chromium-dark`, and reverted byte-for-byte — confirmed via
`git status --short -- src web/src` returning empty after the revert.

## Commands to run the feature locally

```
npx playwright install chromium     # one-time prerequisite
npm run test:e2e                    # builds dist, boots wrangler dev on :8788, runs 3 specs
E2E_WEBKIT=1 npm run test:e2e       # also runs the webkit project
E2E_REUSE=1 npm run test:e2e        # debug-only: skips the build, reuses a running server
```

## Verification output

### `npm run typecheck` — clean (three projects: worker, web, e2e)

```
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.e2e.json
```
No output, exit 0.

### `npm run lint` — 0 errors, 2 warnings (unchanged baseline, no new warnings)

```
src/worker/channels/push.ts
  150:3  warning  Unused eslint-disable directive (...)
web/src/components/ItemListView.tsx
  74:6  warning  React Hook useEffect has a missing dependency: 'onItemsChange' (...)

✖ 2 problems (0 errors, 2 warnings)
```
Same two pre-existing warnings named in `docs/backlog.md`'s "Lint follow-ups" entry; nothing new.

### `npm test` — 300/300 across 34 files, unchanged

```
 Test Files  34 passed (34)
      Tests  300 passed (300)
```
`npx playwright test --list` confirms only the 3 e2e specs are collected by Playwright (none of
the 34 vitest files); the vitest run above confirms no `.spec.ts` file was swept into vitest.

### `npm run build` — succeeds

```
../dist/assets/manifest-CiWbszge.webmanifest    0.60 kB
../dist/index.html                              0.92 kB │ gzip:   0.43 kB
../dist/assets/main-DKOuuaMu.css               28.43 kB │ gzip:   6.31 kB
../dist/sw.js                                   0.91 kB │ gzip:   0.51 kB
../dist/assets/main-DS5h0_P1.js               321.53 kB │ gzip: 101.88 kB
✓ built in ~1s
```

### `npm run test:e2e` (default mode, chromium + chromium-dark)

```
Running 6 tests using 1 worker
  ✓ boot.spec.ts › beat 1: the built bundle boots to the primary nav
  ✓ boot.spec.ts › beat 2: sw.js is served at the root, and is actually the service worker
  ✓ calendar-density.spec.ts › desktop (1280x800) › ...
  ✘ calendar-density.spec.ts › mobile (390x844) › ...   <- see "Defect found" below
  ✓ calendar-keyboard.spec.ts (chromium)
  ✓ calendar-keyboard.spec.ts (chromium-dark)

1 failed, 5 passed (6.8s)
```

This is the **expected** outcome per the plan's own §3.2 E2 escape hatch and risk R8 — see
"Defect found by the suite" below. It is not a bug in the harness.

### Both ESLint bans verified to fire (§8 step 11b)

Temporarily added `chip.focus()` to `calendar-keyboard.spec.ts` → `npm run lint` reported exactly
one new error at that line, citing `docs/qa/calendar-show-more-report.md:46-52`. Reverted;
confirmed byte-identical to the pre-edit file via `diff`.

Temporarily added an inline `JSON.stringify({...})` to `calendar-density.spec.ts` → `npm run lint`
reported exactly one new error at that line, citing `docs/plans/playwright-bootstrap.md §3.3a,
§4.2b`. Removed; re-ran lint to confirm the 0-errors/2-warnings baseline was restored.

### The preflight probe: verified pre-build, not post-build

Started a dummy listener on `127.0.0.1:8787`, recorded `dist/`'s mtime, ran
`node e2e/preflight-port.mjs && npm run build && ...` directly: the probe printed the exact
message from §3.4.1a, exited 1, the `&&` chain never reached `npm run build`, and `dist/`'s mtime
was unchanged (confirmed via `stat`). Also ran the full `npm run test:e2e` with the dummy listener
up: Playwright reported `Error: Process from config.webServer was not able to start. Exit code: 1`
within a few seconds (not the 180s `webServer.timeout`), with the probe's message visible in the
`[WebServer]`-prefixed output — matching goal 6 ("fails informatively") and done condition 3.

### The deliberate-break check (§8 step 12) — green → red → green, in order

1. **GREEN FIRST**, unmodified `main`: `npx playwright test calendar-keyboard --project=chromium
   --project=chromium-dark` → 2/2 passed.
2. **BREAK**: removed `ring-offset-background` from `button.tsx:8`.
3. **RED**: both projects failed at beat 7, with the message:
   ```
   expectFocusRing(month-next-button) failed: offset layer colour "rgb(255, 255, 255)" !==
   document.body background "rgb(252, 252, 253)" [chromium]
   expectFocusRing(month-next-button) failed: offset layer colour "rgb(255, 255, 255)" !==
   document.body background "rgb(17, 22, 24)" [chromium-dark]
   ```
   Confirms the offset-colour reference (`document.body`, not the day cell) is correctly
   implemented — the failure fires in **both** projects, as the plan requires (a dark-only
   failure would have indicated the reference was implemented against the wrong element).
4. **GREEN AGAIN**: reverted `button.tsx` (`git status --short -- web/src` returned empty,
   confirming byte-identical restoration), re-ran the same two projects → 2/2 passed.

### WebKit run (`E2E_WEBKIT=1`) — run once, recorded, not a blocker

`E2E_WEBKIT=1 npx playwright test` → **8 passed, 3 failed** (11 total: 5 on `chromium`, 1 on
`chromium-dark`, 5 on `webkit`):

- `webkit` fails `calendar-density.spec.ts`'s mobile test the same way `chromium` does — the same
  real "+N more" wrap (see below), not a WebKit artifact.
- `webkit` fails `calendar-keyboard.spec.ts` at beat 2: `did not reach the month "›" control
  within 40 Tab presses. Last focused element: <INPUT> ""`. This is a documented WebKit/Safari
  keyboard-navigation difference, not an app defect or a harness bug: WebKit's default Tab
  sequence (matching real Safari without "Full Keyboard Access" enabled) does not include
  `<button>` elements, only form fields — so the bounded Tab-walk never reaches the `›` button.
  Per plan §3.5, "a WebKit failure may be a Playwright artifact" and must not be treated as a
  blocker on this branch; recorded here rather than investigated further or worked around.

## Defect found by the suite (not fixed here, per the plan's explicit instruction)

`e2e/calendar-density.spec.ts`'s mobile (390×844) test fails on unmodified `main`:

```
assertNoUnintendedWrap: toggle box.height=30.0px >= 1.6x line-height (24.0px, line-height="15px")
— the toggle wrapped to more than one line
```

A screenshot (`test-results/.../test-failed-1.png`, viewed during this run) confirms the "+2
more" toggle in day 12's cell renders on two lines at 390px width. This is **exactly** what
review round 1's R8 and the plan's §3.2 E2 escape hatch predicted, down to the arithmetic (~34px
of content box for an 8-character string at `text-[10px]`). Per the plan: *"If E2 beat 2 fails at
390px on unmodified `main`: file it as a defect and STOP. Do not weaken the assertion, and do not
fix `CalendarView.tsx`."*

Filed as a new `docs/backlog.md` entry (dated 2026-08-22, immediately after the Playwright
bootstrap entry). **`CalendarView.tsx` was not touched.** The failing test is left exactly as
written — it will go green the moment the real defect is fixed on a future branch, with no test
change required.

## Deviations from the plan / points requiring interpretation

None changed test coverage or design. Points I had to decide because the plan left them
unspecified at the literal-code level:

1. **`serviceWorkers: "block"`/`"allow"` mechanism.** The plan says "set `serviceWorkers` per
   project — `block` for E1/E2, allowed for E3" (§3.4.3(e), §3.7). Rather than defining
   additional Playwright *projects* split by spec file (which would have meant either duplicating
   the chromium/chromium-dark/webkit matrix three ways, or losing the "same project runs all
   three specs" simplicity), I set the global default (`use.serviceWorkers: "block"`) and added
   `test.use({ serviceWorkers: "allow" })` at the top of `boot.spec.ts` only. This produces the
   identical per-spec behavior the plan requires (E1/E2 blocked, E3 allowed) regardless of which
   browser project runs the file, with less configuration surface. Flagging this as an
   interpretation rather than a literal reading of "per project."
2. **Reset-to-page-start technique for beat 2's Tab walk (E1).** The plan says "press Tab
   repeatedly from the page start" but the spec must first *click* the Calendar nav button
   (mouse click) to reach the view — which itself moves focus onto that button. To get back to a
   genuine "page start" (`document.activeElement === document.body`) without ever calling
   `.focus()` from the test (the HARD INVARIANT), I added a real mouse click on the calendar's
   `<h2>` month heading (non-interactive) immediately after navigating, which blurs the
   previously-clicked button back to `<body>`. This is a real click, not a `.focus()` call, and
   does not trip the ESLint ban. Not spelled out in the plan; needed to make beat 2 deterministic.
3. **Deterministic chip ids, not just "not equal to before."** The plan's beats describe the
   *shape* of each assertion (e.g., beat 3: "ArrowDown moves focus... assert
   `matches(':focus-visible')`") without pinning exact `data-cal-id` values. Given this spec's own
   fixture (days 5/6/12/19), the roving-tabindex geometry (`calendarFocus.ts`) is fully
   deterministic, so I asserted exact ids (`c-5-0` → `c-12-0` → etc.) throughout rather than only
   "moved" — a stronger, still-plan-conformant reading that also made the Enter/Space/Escape
   sequence in beats 8-9 traceable without extra bookkeeping.
4. **`tsconfig.e2e.json`'s `lib` override.** The plan names only `"types": ["node"]` as the
   required addition (§4.2, required change 16). I also added `"DOM"`/`"DOM.Iterable"` to `lib`
   (the base `tsconfig.json` only has `["ES2022"]`) because spec/fixture files reference
   `document`, `window`, and `getComputedStyle` inside `page.evaluate`/`locator.evaluate`
   closures, which TypeScript type-checks against the *local* `lib`, not a browser-side one. This
   was necessary for `npm run typecheck` to pass at all, so it is a correction to an underspecified
   detail rather than a deviation from intent.
5. **`box-shadow` layer-colour parsing implementation.** The plan specifies the *rule*
   ("index 0 = offset / index 1 = ring, `length >= 2` never `=== 2`," §3.2 beat 4/beat 5) but not
   a parsing algorithm. `splitBoxShadowLayerColors` in `assertions.ts` splits on top-level commas
   only (tracking paren depth so a `rgb(a, b, c)` inside a layer is never split), then extracts
   each layer's `rgba?(...)` substring. Verified empirically against Chromium's actual computed
   `boxShadow` serialization during the deliberate-break check (three layers on unmodified `main`,
   confirmed via the raw `boxShadow` string included in every failure message).

## Out-of-scope observations

- **`.dev.vars` has `DEV_AUTH_IDENTITY` set locally** (confirmed: `wrangler dev`'s binding list
  shows `env.DEV_AUTH_IDENTITY ("(hidden)")`, and a direct `curl /api/me` against the e2e server
  logged `[dev-auth] shim active as juniwar.dev@gmail.com`). This has **zero effect** on the e2e
  suite (no `/api/*` request from the browser ever reaches the Worker), which is itself a
  confirmation of done condition 2/5 rather than a problem. Noting only so nobody is surprised
  that the `[dev-auth]` line never appears in a `npm run test:e2e` run's output — per plan §9 DC5,
  its absence there is expected and proves nothing either way.
- **The real `wrangler dev` server 500s on `GET /api/me`** when hit directly (not through the
  mocked browser path) against `.wrangler/e2e-state`, because no migrations have ever been run
  against that persist directory (`no such table: users`). This is expected and intentional under
  Alternative B (no migration step; nothing ever queries D1 in this harness) — recorded here only
  because I observed it while manually verifying the composed server command in isolation
  (§8 step 2), not because it needs fixing.

## What I did NOT do (left for QA / the owner, per the plan)

- Fix the mobile "+N more" wrap defect the suite found — explicitly forbidden on this branch
  (plan §2, §3.2 E2 escape hatch). Filed to `docs/backlog.md` instead.
- Investigate the WebKit Tab-sequence difference further — plan §3.5 explicitly does not require
  this ("a WebKit failure may be a Playwright artifact... record it").
- Anything under §9's manual/QA-side checks this plan doesn't claim to replace (ring *contrast*,
  as opposed to ring *colour*; VoiceOver; iOS Full Keyboard Access) — all explicitly named as
  accepted residuals in the plan itself, paired with existing manual QA reports.

## State of the working tree

Left dirty, as instructed. `git status --short`:

```
 M CLAUDE.md
 M docs/backlog.md
 M docs/dev-fixtures.md
 M eslint.config.js
 M package.json
?? e2e/
?? playwright.config.ts
?? tsconfig.e2e.json
```

`git status --short -- src web/src` is empty — the application-code diff is empty, as required.
No commit was made.
