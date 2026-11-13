# Review: `docs/plans/playwright-bootstrap.md`

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-08-22
Plan revision reviewed: v1
Round: 1

**Scope note.** The owner chose to pursue this backlog item. §7 of this review answers the
"should this be built at all" question directly anyway, because the plan itself (§1.3, §7 OQ3)
asks plan-review to rule on it and designates deletion as the fallback.

---

## 0. What I verified, and what checked out

I read every file the plan cites a line number in. Citation hygiene is very good — the only
wrong line references I found are cosmetic (§0.1 below). Confirmed as claimed:

- `package.json:14` `"test:e2e": "playwright test"`, `@playwright/test ^1.49.0` at `:39`; no
  `playwright.config.*` and no spec file exists anywhere (`Glob` over the repo). §1.1 is correct.
- `.gitignore:3` `.wrangler/`, `:4` `.dev.vars`, `:17-18` `test-results/` + `playwright-report/`.
  §3.6 and §4.2's "`.gitignore` needs no change" are right — a pleasant surprise given Playwright
  has never run here.
- `wrangler.toml:5-7` `[assets] directory = "./dist"`; `:25` `OWNER_EMAIL`. §3.4.1 and §3.4.3's
  "assert `role === "admin"`, not a hardcoded email" are correct.
- `src/worker/auth.ts:164-187` — `isLocalDevContext` allows exactly `localhost` / `127.0.0.1` /
  `[::1]`, and `resolveDevIdentity` at `:185` does `sel.includes("@") ? sel : env.OWNER_EMAIL`.
  So the plan's chosen value `DEV_AUTH_IDENTITY=owner` really does resolve to the owner and yield
  `role=admin`. The `[dev-auth] shim active as …` line is at `:215` as cited.
- `vite.config.ts:22-27` — the custom `entryFileNames` emitting `sw.js` at the root really is
  unverified by anything else in the repo. E3 beat 2 is a genuine, otherwise-uncovered claim.
- `vitest.workspace.ts:27` (`tests/**`, `src/worker/**`, `.test.ts`) and `:46`
  (`web/**/*.test.ts{,x}`). `e2e/*.spec.ts` matches neither, and Playwright's default `testMatch`
  under `testDir: "./e2e"` cannot reach the 34 vitest files. §3.7's first row is correct in both
  directions.
- `tsconfig.web.json:17` (`web/src/**/*`), `tsconfig.worker.json:6` (`src/**/*`,
  `tests/unit/**/*`), `lint` scoped to `src web/src` (`package.json:11`). §4.2's "otherwise the
  specs are untypechecked and unlinted" is correct and is the right instinct.
- `docs/qa/calendar-show-more-report.md:46-52` says exactly what the plan says it says: an early
  `element.focus()` attempt "showed no ring at all and had to be redone with genuine `Tab` key
  presses to be a valid test."
- `docs/qa/calendar-roving-tabindex-report.md:104-131` — the headless Tab-exit artifact, and at
  `:130-131` that report explicitly recommends noting it in any future e2e bootstrap. R3 is
  well-founded and correctly scoped ("never assert *where* focus goes when it leaves the grid").
- `docs/backlog.md:167` confirms the `button.tsx:8` halo defect was real and shipped.
- `tailwind.config.ts` has no `ringWidth`/`ringOffsetWidth`/`ringColor` overrides — stock v3.4
  ring utilities. This matters for §0.2 below.
- `web/sw.ts` has no `fetch` handler and does no asset caching, so the service worker registered
  during E3 cannot serve stale assets back into E1/E2. A risk I went looking for and did not find.

### 0.1 Minor citation slips (non-blocking, listed for completeness)

- §3.2 E3 beat 1 cites `App.tsx:102-125` for "the 'Signing in…' or 'Account deactivated' state."
  Deactivated is `:102-111`, "Signing in…" is `:119-125`, and the range silently swallows the
  `error` branch at `:112-118`, which is a *third* boot-failure state E3 should also exclude by
  name (an app booting into "Error: …" would pass a naive "not Signing in / not Deactivated"
  check). There is a fourth, `:93-99` "Loading Family Scheduler…". Assert the positive
  (`nav[aria-label="Primary"]` visible) and let that carry it — but say so, because all four
  negatives are enumerated in the plan as if two were the whole set.
- §3.4.4 cites `CalendarView.tsx:27` for "renders the current month from `new Date()`" — correct.
  §1.2 cites `CalendarView.tsx:116-121` for the wrapping defect — correct (`:118-121` is the
  comment). §3.4.4 cites `:226-229` for `isToday`; it is `:226-230`. Immaterial.

### 0.2 Two factual errors about CSS that will make E1 fail on a correct app

These are the sharpest findings in this review, because the failure mode is not "E1 misses a bug"
— it is "E1 fails on unmodified `main`, and the cheapest way for a Coder to make it green is to
weaken the exact assertion that carries the suite's value." That is how this suite gets hollowed
out on day one rather than in six months.

**(a) §3.2 E1 beat 4: "Tailwind's `ring-2` + `ring-offset-1` compile to a two-layer
`box-shadow`" — this is wrong; it is three layers.**

Tailwind v3 (confirmed stock, `tailwind.config.ts` has no ring overrides; `package.json:57`
pins `tailwindcss ^3.4.19`) emits:

```
box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);
```

and preflight sets `--tw-shadow: 0 0 #0000` on `*`. Chromium therefore serialises a **third**,
fully transparent layer: `…, rgba(0, 0, 0, 0) 0px 0px 0px 0px`. Asserting "exactly two layers"
fails on today's chips (`CalendarView.tsx:250`, `:270`).

It is worse for beat 6's target. The month `›` control is `variant="outline"`
(`CalendarView.tsx:186`), which has no `shadow-*` class, so it is also three layers — but if the
Coder retargets to any `variant="default"` Button (e.g. the active nav Button, `App.tsx:168`),
`shadow-soft` is itself a **two**-layer token (`tailwind.config.ts:57`), giving four. Any
hardcoded layer count is fragile. Assert on the *parsed offset layer* and the *parsed ring layer*
by position (index 0 and 1), and assert `layers.length >= 2`, not `=== 2`.

**(b) §3.2 E1 beat 5: "assert the offset layer's colour … equals the computed
`background-color` of the day cell" — this is wrong, and it fails on a correct app.**

`ring-offset-background` resolves to `hsl(var(--background))`. The day cell is `bg-card`
(`CalendarView.tsx:224`). Those are different tokens in both schemes (`web/src/index.css`):

| | `--background` | `--card` |
|---|---|---|
| light | `240 33% 99%` | `0 0% 100%` |
| dark | `200 17% 8%` | `200 14% 12%` |

They are never equal, so the assertion fails on unmodified `main` in both projects. Note also that
in **light** mode the day cell genuinely *is* `rgb(255, 255, 255)`, so the "offset is not white"
half of beat 5 would be a false alarm if it were ever run in light — the plan correctly scopes it
to `chromium-dark`, but nothing in the spec text says so at the assertion level, and beat 5 says
"the same beats run again under `chromium-dark`", implying beats 3-5 also run in light.

The correct reference value is the *page* background, which `index.css:63-65` applies to `<body>`
via `@apply bg-background`. So: `getComputedStyle(document.body).backgroundColor`. That is a
complete-value assertion (§5.2's strongest rung) rather than a "not white" proxy, and it catches
the real defect exactly — with `ring-offset-background` removed from `button.tsx:8`, the offset
colour becomes Tailwind's default `#fff` and diverges from `document.body`'s in both schemes,
which additionally means the deliberate-break check in §8 step 12 would then also fail in the
*light* project, not just dark. Strictly better.

**(c) Consequence for §8 step 12's deliberate-break check.** As specified, that check cannot
distinguish "E1 caught the reintroduced halo" from "E1 was already red." The step must require
E1 green on unmodified `main` **first**, then red after the break, then green after the revert.
The plan says "confirm E1 beat 6 fails … and revert immediately"; it never says "confirm it
passed before you broke it." Given (a) and (b), that omission is load-bearing.

---

## 1. Do the three specs earn their cost? (Q1)

### E1 `calendar-keyboard` — yes, but its best assertions are one rung weaker than the plan's own cited standard

Verified: `CalendarView.tsx:173` is a genuine programmatic `next.focus()` driven by a real
keydown, and `web/src/lib/calendarFocus.ts` is pure with no DOM, so nothing in the 300 tests can
observe whether Chromium keeps `:focus-visible` across that hop. Beat 3 (`el.matches(":focus-visible")`)
is the single most valuable line in the plan and I endorse it.

Beat 7 (real `Enter` and real `Space`) is likewise strong, and the plan's justification is
precisely correct: `calendar-show-more.md`'s v7 amendment records a `<div role="button">` passing
ten tests via computed role, and `locator.click()` would fire its `onClick` happily. Only real key
presses are dead against it.

**What a wrong implementation still passes:**

- **A near-invisible ring.** Change `focus-visible:ring-ring` to `focus-visible:ring-border` on
  the chips (`--border: 220 14% 91%` on a white `--card` cell) and E1 passes every beat: box-shadow
  is not `none`, the layers are there, and the ring colour is not the element's own
  `background-color`. The plan flags this as an "accepted residual" and defers to a manual eyeball
  — but the fix is nearly free and is exactly the rung `calendar-show-more.md` §5.2 was rewritten
  around in v6 ("Test 9 now asserts Decision 4's whole string"). Assert the ring layer's colour
  **equals** the resolved value of `--ring`, read at runtime from
  `getComputedStyle(document.documentElement).getPropertyValue("--ring")` (converted to the same
  colour space). That is a complete-value assertion, it is scheme-agnostic (the token flips
  automatically under `colorScheme: "dark"`), and it makes the "accepted residual" mostly
  disappear. The plan cites §5.2 as its governing rule and then settles for the weaker rung in the
  one place the stronger rung is cheap.
- **A calendar rendering the wrong items or the wrong month.** Plan admits this; correct scoping.
- **Beat 2 in isolation** — the plan admits this too, and it is worse than admitted: "exactly one
  `[data-cal-id][tabindex="0"]`" is guaranteed by construction in `calendarFocus.ts:115-120` and is
  already asserted by the C-series in `CalendarView.test.tsx`. Beat 2 adds real-browser realism
  and nothing else. Keep it (it is two lines and it is the entry route for beat 3), but do not let
  the impl notes count it as coverage.
- **Beat 8's `activeElement` half** — plan admits duplication. Agreed, and the two-line marginal
  cost argument is fair.

**Under-specified, blocking:** beat 6 says "Shift+Tabs back to the month `›` control … and repeats
beats 3-5 against it." Beats 3-5 cannot be repeated verbatim there:

- Beat 3 is "press `ArrowDown`". `›` is outside the `Card`, so `handleGridKeyDown`
  (`CalendarView.tsx:162-174`) never runs and ArrowDown does nothing. Focus on `›` is established
  by the Shift+Tab itself — which is fine and is still a real key press, but the plan must say so.
- Beat 5 is "equals the computed `background-color` of the day cell." There is no day cell. Under
  §0.2(b)'s fix (`document.body`) this resolves cleanly for both targets, which is a further
  argument for that fix.
- `button.tsx:8` uses `ring-offset-2`; the chips use `ring-offset-1`. Any width expectation must
  be read, not hardcoded.

**Not addressed at all: how the spec reaches the Calendar view.** There is no route for it —
`activeView` is React state (`App.tsx:25`, `:231-232`) with no URL. The spec must click a nav
button. At 1280 that is the desktop nav's `Button` (`App.tsx:164-176`, accessible name
"Calendar"); at 390 the desktop `aside` is `hidden` (`App.tsx:154`) and the visible control is
the bottom tab with `aria-label="Calendar (bottom tab)"` (`App.tsx:263`). **Two different
selectors for the two viewports.** E2 runs at both. The plan never mentions this and it will bite
the Coder in E2 immediately.

Also unaddressed: beat 2's "press `Tab` from the page start until `document.activeElement` is
[the `›` button]" walks through the whole `ListSidebar` (`App.tsx:179-186`) — an unbounded loop
in a spec whose stated risk R3 is focus-boundary flake. Specify a bounded loop (e.g. 40 presses)
that throws with the current `activeElement`'s tag/text, not a silent `while(true)`.

### E2 `calendar-density` — yes, and it is the cleanest-scoped spec, but it has a scope collision

Verified: the wrapping defect is real and documented in-source (`CalendarView.tsx:116-121`), the
chips really are `overflow-hidden text-ellipsis whitespace-nowrap` (`:250`) so beat 3's "do not
assert `scrollWidth > clientWidth`" is correct and non-obvious, and the `+N more` toggle really
has no ellipsis classes (`:270`) so it really is the element that wraps.

**What a wrong implementation still passes:** with beat 1 written as "for every `[data-cal-id]`
element inside the seeded day cell," the geometry loop is **vacuous if zero chips rendered**. If
the seed silently lands on the wrong day (a `start_at` timezone slip is the realistic way), the
cell has no chips, the loop body never executes, and beat 1 passes. The `toBeVisible()` +
`box.height > 0` guard the plan adds protects against a zero-size element but not against an
empty set. **Required: assert the exact cardinality first** — collapsed, exactly 3 `[data-cal-id]`
chips plus one toggle whose visible text is exactly `+2 more`; expanded, exactly 5 chips plus
`Show less`. That also makes the seeding correctness load-bearing instead of incidental.

**Scope collision, blocking.** §2 is a hard "no application-code changes." But beat 2 at **390px**
may well fail on today's app. Rough arithmetic: 390 viewport − `main` `p-4` (32) = 358, minus
6 × 1px grid gaps = 352, ÷ 7 ≈ 50px per cell, minus day-cell `p-1` (8) = 42px, minus the toggle's
`px-1` (8) = ~34px of content box for the eight-character string "+2 more" at `text-[10px]`. That
is marginal at best. Neither QA report covers it: `calendar-show-more-report.md:56-58` measured
"+2 more" on one line at desktop width, and `calendar-roving-tabindex-report.md:84-90`'s 390px
sweep checked tap targets and chrome, not the toggle's line count. So E2 beat 2 at 390px is
asserting something genuinely unverified, and if it fails the plan's own non-goal forbids the fix.
The plan needs an explicit escape hatch: **if E2 fails on unmodified `main`, file it as a defect
and stop — do not weaken the assertion and do not fix `CalendarView.tsx` on this branch.**

The `chip.locator("xpath=..")` day-cell hop (§4.3) is a reasonable call. I agree with rejecting
`data-cal-day` — the tradeoff analysis at `:581-585` ("it breaks as a loud failure, never as a
false pass") is the right shape of argument.

### E3 `boot` — my direct opinion: keep beat 2, drop beats 1 and 3

The plan asks for a direct answer, so: **beat 2 is worth having and beats 1 and 3 are not worth
what they cost.**

- **Beat 2 (`sw.js` at root) is the only genuine claim in the spec** and I verified there is
  nothing else guarding it. Keep it. Two refinements: (i) do it as an `APIRequestContext` fetch of
  `/sw.js`, which is deterministic and has no service-worker lifecycle flake, and (ii) assert the
  *body* contains a known SW string (`web/sw.ts:33` registers `"notificationclick"`), not just a
  200 and a JS content type — otherwise a future `not_found_handling` change on `[assets]` could
  satisfy the status check with something that is not the service worker. The
  `navigator.serviceWorker.getRegistration("/")` half must poll, because `main.tsx:8` registers on
  `window load`; a single synchronous read will race.
- **Beat 1 is a self-check.** The plan is honest that it "passes on an app that is completely
  broken below the nav." I would keep it only because it is one line and it does buy the
  diagnosability argument in §3.2 point 1, which is real. But do not let it be called coverage,
  and pin the viewport explicitly — `nav[aria-label="Primary"]` is `md:flex` (`App.tsx:154`) and is
  `display: none` below 768px, so the assertion is silently viewport-coupled.
- **Beat 3 (console-error allowlist) should not ship.** The plan's own R6 says "if it grows past
  ~5 entries, drop beat 3 rather than maintain it." It starts at **3** entries
  (`calendar-roving-tabindex-report.md:147-152`), two of which the plan itself notes are not
  console *errors* at all (the shim line is a `warn`, the favicon 404 is a network failure) and so
  need no allowlist entry. That leaves a rule whose entire allowlist exists to suppress one
  deprecation warning that the rule already ignores. A guard that is two entries from its own
  documented kill threshold on the day it ships is not worth writing. Removing beat 3 also removes
  R6 entirely.

---

## 2. E1's `Button`-primitive argument (Q2) — verified, and it is correct

This is the plan's sharpest claim and it holds up under direct inspection.

- Calendar chips are raw `<button>` elements with hand-written classes
  (`CalendarView.tsx:236-254`), not the `Button` primitive. The `+N more` toggle likewise
  (`:263-273`).
- Both chip and toggle class strings **already include** `focus-visible:ring-offset-background`
  (`:250`, `:270`). They were never affected by the halo defect and can never regress it.
- `web/src/components/ui/button.tsx:8` is the shared `cva` base and carries the (now-fixed)
  `ring-offset-2 … ring-offset-background`. `docs/backlog.md:167` confirms the defect was
  `ring-offset-2` with no `ring-offset-background`, shipped, and retrofitted during the
  `item-view-mode` re-QA.

So the plan's assertion is exactly right: beats 3-5 against chips would **not** have caught the
`button.tsx:8` regression, and beat 6 is the only part of E1 that is a real regression guard for a
defect this repo actually shipped. Good, load-bearing reasoning. My only objections to beat 6 are
the mechanical ones in §0.2 and §1 above.

One thing the plan does not say and should: beat 6 guards `button.tsx` through **one** call site,
the month `›` control. The other primitives that were retrofitted alongside it (`ui/sheet.tsx`,
`ui/dialog.tsx`, `ui/select.tsx`, `ui/tabs.tsx`, per `docs/backlog.md:167`) remain unguarded. That
is fine as scoping, but it should be stated so nobody later reads E1 as "the focus-ring suite."

---

## 3. The `.focus()` HARD INVARIANT (Q3) — a comment is not sufficient, and R2's self-defence claim is unreliable

**No, a file-header comment does not stop this, and the plan's fallback argument is weaker than it
appears.**

§7 R2 claims the invariant is self-enforcing because `matches(":focus-visible")` "*fails* under
`.focus()`, so the 'simplification' breaks the test rather than quietly hollowing it." That is not
reliable. Chromium's focus-visible heuristic is not "was this focus call programmatic" — it is
approximately "was the most recent user interaction a keyboard interaction." E1 is a sequence: it
Tabs into the grid (beat 2) *before* it arrows around (beat 3). A maintainer who replaces beat 3's
`page.keyboard.press("ArrowDown")` with `chip.focus()` still has a preceding real `Tab` in the same
test, so Chromium can legitimately keep the focus-visible state and beat 3 passes — silently, with
the browser-heuristic claim no longer being tested at all. The QA anecdote the plan leans on
(`calendar-show-more-report.md:48-50`) is a `.focus()` with *no* preceding keyboard interaction,
which is a different case from the one R2 needs to be safe against.

The plan is therefore relying on a comment plus an assertion that may not fire. That is exactly
the situation §1.2 says this repo has already learned about three times.

**What would actually work, and it is cheap.** §4.2 already adds an `eslint.config.js` block for
`e2e/**/*.ts`. Put the invariant in it:

- a `no-restricted-syntax` (or `no-restricted-properties`) rule banning `.focus(` inside
  `e2e/**/*.spec.ts`, with the message carrying the `docs/qa/calendar-show-more-report.md:46-52`
  citation verbatim.

This is mechanical, it fails at authoring time rather than at some future run, and — decisively —
it runs inside `npm run lint`, which per the global CLAUDE.md is in **the Coder's per-change loop
and the pre-PR gate**. `test:e2e` is in neither (§6). So the lint rule is enforced by a gate that
actually executes on every branch, while the comment is enforced by a suite the plan itself admits
may go un-run. For a plan whose §6 is a candid essay about the absence of enforcement, this is the
single highest-leverage six lines available, and it is not in the plan.

Keep the comment as well — it explains *why*, which the lint message can only gesture at.

---

## 4. `workers: 1` (Q4) — verified, required, and the plan slightly understates the reason

Correct. `CalendarView.tsx:64-69` fans out `lists.map((l) => getOccurrences(l.id, from, to))` and
`flatMap`s the results into one month grid, and `lists` comes from `GET /api/me` at mount
(`App.tsx:49-50`), i.e. every list the identity can see. All e2e workers authenticate as the same
owner identity, so a parallel worker's `e2e-<uuid>` list is fully visible in the other worker's
grid. Chip ids are `c-${day}-${i}` assigned by visual index (`CalendarView.tsx:234`) over a merged,
time-sorted array (`:67`), so a foreign item on day 12 does shift them exactly as the plan says.
E2's `+2 more` count breaks the same way.

The plan understates it in one respect: it frames the cause as parallelism, but the deeper cause
is that the harness runs **one** `wrangler dev` with **one** D1 behind `--persist-to
.wrangler/e2e-state`. Parallel workers would share that state no matter what the calendar did.
`workers: 1` is therefore required for the seeded-fixture model in general, not only for
`CalendarView`. Worth stating, because it forecloses the obvious "just seed into per-worker lists"
counter-proposal — that would not help, since `CalendarView` merges *all* visible lists.

`fullyParallel: false` alongside `workers: 1` is belt-and-braces and harmless.

---

## 5. The harness (Q5)

### 5.1 The stale-dist trap: mostly avoided, with one hole the plan explicitly claims is safe

`npm run build` first + `reuseExistingServer: false` is the right pair, and the reasoning at
§3.4.1 is correct — I verified `fix-dev-stale-dist.md:9-17` says what the plan says it says, and
`wrangler.toml:5-7` confirms the mechanism.

**But §7's edge case "A developer's `npm run dev` is already running. Fine: different port … and
different persist dir, so no `SQLITE_BUSY`" is wrong, and it is wrong about the plan's own core
concern.** Port and persist directory are isolated. **`dist/` is not.** Both servers serve
`./dist` (`wrangler.toml:6`), and:

- `npm run build` is `vite build` with `emptyOutDir: true` (`vite.config.ts:15`), so the e2e run
  **deletes and rebuilds the shared `dist/`** out from under a live dev session. The developer's
  browser 404s on its hashed asset names (`assets/[name]-[hash].js`, `:25`).
- Worse in the other direction: `npm run dev`'s watcher is `vite build --watch --emptyOutDir false`
  (`package.json:7`). If the developer saves a file mid-run, the watcher rebuilds `dist/`
  **during** the e2e suite. E1 and E2 would then be running against assets the harness did not
  build — the precise failure `fix-dev-stale-dist.md` exists to prevent, arriving through a door
  the plan declared closed.

This is not hypothetical: §3.4.2's whole justification for `--persist-to` is "coexist with a
running `npm run dev`," so the plan is actively inviting the concurrent configuration it is unsafe
in. Options, in my order of preference: (i) give the e2e build its own output directory and point
the e2e `wrangler dev` at it via a separate config or `--assets` — heavier, but actually isolated;
(ii) drop the coexistence claim and have `globalSetup` detect a listener on 8787 and fail with
"stop `npm run dev` before running e2e"; (iii) at minimum, document the collision honestly and
delete the "Fine" from §7. Option (ii) is cheap and honest, and it costs the plan only a claim it
should not have made.

### 5.2 The D1 lock: `--persist-to` is the right fix, with one unverified step

The analysis is correct — the lock is on the state directory, and a separate persist dir genuinely
solves contention, pollution, and disposability at once. `.wrangler/` at `.gitignore:3` covers
`.wrangler/e2e-state`, confirmed.

**Unverified and worth flagging:** `wrangler d1 migrations apply` prompts for confirmation. Step 0b
tells the Coder to run it in a terminal — i.e. with a TTY. Inside `webServer.command` it runs with
piped stdio and no TTY, which is a different code path in Wrangler. If it blocks on a prompt, the
symptom is `Timed out waiting 180000ms from config.webServer` — an unhelpful message for a
three-minute wait, and directly contrary to goal 1 ("fails informatively"). **Step 0b must be run
through the actual composed `webServer.command` with piped stdio, not interactively**, and if a
non-interactive flag is needed it must be recorded.

Second, smaller: the plan chains build → migrate → serve in a single `webServer.command`. Make the
chaining `&&` (not `;`) so a failed build or migration surfaces as a command failure rather than as
a wait-for-URL timeout.

### 5.3 What a failed run leaves behind

§3.4.4's three-case table is honest and correct, and the `e2e-` reserved-prefix sweep plus the
strict empty-set assertion (§3.4.5) is a good design — I particularly like that the prefix guard
means a mis-set `--persist-to` cannot eat the developer's real data. `.gitignore` genuinely needs
no change.

One gap: the sweep runs in `globalSetup`, which runs **once per `playwright test` invocation**. A
crash mid-suite leaves rows that the *next* run's sweep will clear — fine — but if the crash
happens between specs within the same run, nothing re-sweeps and later specs inherit the debris.
Given `workers: 1` and per-test fixture teardown that runs on failure, this is a narrow window.
Non-blocking; note it.

### 5.4 An adoption cost the plan does not weigh

`reuseExistingServer: false` plus an unconditional `vite build` means **every** invocation —
including "re-run the one spec I am debugging" — pays a full build, migration, and cold Worker
boot. For a suite whose designated failure mode (§6, §1.3) is "nobody runs it," a fixed
tens-of-seconds tax on every iteration is a real adoption risk that the plan treats purely as a
correctness question. I am not asking for the default to change — the stale-asset argument wins —
but the plan should at least acknowledge the tradeoff, and an opt-in, documented-as-debug-only
`E2E_REUSE=1` escape hatch (mirroring the `E2E_WEBKIT=1` pattern it already uses) is worth
considering.

---

## 6. Gates (Q6) — aspiration, and the plan knows it; the concrete tripwire is missing

The plan's §6 is the most intellectually honest section in it, and I want to say so before
criticising it. "With no CI, none of the above is *enforcement*. It is convention backed by the
multi-agent document trail" is correct and unusually rare.

**Is the QA gate enforceable? No.** There is no CI (verified: no `.github/workflows`; project
memory `deploys-are-manual`). "Mandatory for QA on `web/src/**` branches" is a rule enforced by a
QA agent reading `CLAUDE.md` and choosing to comply, and by plan-review noticing the absence of a
pass count in the report. That is weaker than the plan's table format implies — a table with
"Yes — mandatory" in a cell reads like a gate. Of the four anti-rot mechanisms listed, exactly two
have teeth, and both are the ones that ride on `npm run lint` / `npm run typecheck` (mechanisms 1
and 4), i.e. gates that genuinely run. Mechanisms 2 and 3 depend on someone choosing to invoke the
suite. The plan should say which two are real and which two are norms, rather than listing four
peers.

This is also why §3's ESLint recommendation matters so much: it converts the suite's most
important invariant from a norm into a mechanism.

**Is the deletion trigger concrete enough to actually happen? No.** "If this suite is found un-run
for several consecutive frontend branches, the correct response is §1.3 — delete it" has no owner,
no count, no date, and no artefact that would surface the condition. Nobody will ever "find" it.
Make it a dated, tickable backlog entry in the same style the repo already uses for
`docs/qa/prod-verification-checklist.md`: e.g. "**2026-11-22 — e2e keep-or-kill review.** If fewer
than 2 QA reports since 2026-08-22 quote an `npm run test:e2e` pass count, delete
`playwright.config.ts`, `e2e/`, `tsconfig.e2e.json`, and `@playwright/test`." That is checkable by
`grep` over `docs/qa/`, it names the exact files, and it appears in a document that gets read. The
plan's §4.2 already edits `docs/backlog.md:161`; this belongs there.

---

## 7. The premise (Q7) — build it, but the harness is the wrong half to spend on, and one cheaper alternative is unexamined

**I do not think this should be deleted.** §1.2's three defect classes are demonstrated in this
repo's own history, not hypothetical — I verified all three (`docs/backlog.md:167` for the halo,
`CalendarView.tsx:116-121` for the wrapping, `calendar-show-more-report.md:46-52` for the
focus-visible near-false-bug). Class 3 in particular is a browser-heuristic question with no static
answer and no jsdom analogue, and it invalidates a shipped feature if the answer flips. Encoding
it once is worth doing. §1.3's deletion option is real but I decline to take it.

**But the shape is wrong in one important way, and the plan's §3.3 rejection table does not
mention the alternative that would fix it.**

All three defect classes are **pure rendering claims**: real Tailwind CSS, real layout, real
Chromium focus heuristics. *None of them needs the Worker, D1, seeded API data, the dev-auth shim,
`--persist-to`, `workers: 1`, or a built `dist`.* The plan nonetheless spends §3.4 — five
subsections, the entire operational risk surface, and every one of R1/R3/R5/R7 plus most of the
edge-case list — constructing an integration harness in service of roughly a dozen computed-style
and geometry assertions.

**The unexamined alternative is Vitest browser mode** (`@vitest/browser` with the Playwright
provider, driving the existing `web` project's component tests in real Chromium instead of jsdom).
Against this plan it would:

- cover defect classes 1, 2, and 3 identically — real CSS, real layout, real `:focus-visible`,
  real `Enter`/`Space`, `colorScheme` emulation via the same Playwright primitives;
- reuse the 30 existing `CalendarView.test.tsx` mocks, so **no seeding, no teardown, no reserved
  prefix, no sweep, no `--persist-to`, no D1, no auth preflight, no `--var`, no `dist`, no
  `workers: 1`** — §3.4 in its entirety, plus R1, R5, R7 and most of §7's edge cases, simply do
  not exist;
- and decisively, it would run inside **`npm test`**, which is in the pre-PR gate and does execute
  on every branch — directly answering §6's honest admission that nothing forces this suite to
  run. The plan's own designated weakest point is designed away rather than documented.

What it would **not** cover is E3's build-output claim (`sw.js` at root) — but that does not need a
browser at all. It is `existsSync("dist/sw.js")` after a build, or a two-line assertion in a
vitest test, or a `test -f dist/sw.js` appended to the `build` script.

Costs I can see and will not pretend away: it adds a devDependency; Vitest 2.x browser mode is
less settled than `@playwright/test`; it needs `web/src/index.css` imported into the test setup so
Tailwind is actually resolved (doable — vitest processes CSS); and it tests components in
isolation rather than the real integration path, so it would never catch a Worker/asset/serving
regression. That last point is a genuine argument for this plan's approach and the Architect may
well land there again.

**But it is not in §3.3's rejection table, which is presented as the record of what was
considered so it is "not re-litigated."** An alternative that eliminates half the plan and lands
the result in a gate that actually runs deserves an entry there with a reasoned verdict, even if
the verdict is "reject." I am not requiring the plan to switch — I am requiring it to show the
comparison, because a future reader of §3.3 will otherwise reasonably conclude it was never
weighed.

---

## 8. The `--var` question — the ladder should collapse, and several other hedges with it

I confirmed the fact independently against this repo's own history: project memory
`no-local-dev-auth-shim.md` and the `list-isolation-http` work record `wrangler dev --var
DEV_AUTH_IDENTITY:second@test.dev` being used successfully here, and `--var` is a documented
`wrangler dev` flag (`A key-value pair to be injected into the script as a variable [array]`).
`--persist-to` likewise. `src/worker/auth.ts:185` confirms the bare value `owner` resolves to
`env.OWNER_EMAIL`, so `--var DEV_AUTH_IDENTITY:owner` is a fully specified, working invocation
today.

**So §3.4.3's three-step ladder should collapse to "use `--var`", and A2
(`CLOUDFLARE_INCLUDE_PROCESS_ENV`) and A3 (documented `.dev.vars` prerequisite) should be deleted
outright.** With them go:

- **§7 R1** ("`--var` may not exist … Not confirmable from the Cloudflare docs") — delete the
  risk entirely.
- **§7 Open question 1** — the support half is resolved. See below for the half that survives.
- **§8 step 1**, which currently instructs the Coder to spend a probe cycle on a settled question.
- **§8 step 11c**'s conditional "the auth prerequisite **if Step 0 landed on A3**" — unconditional
  now: there is no auth prerequisite, which is a *better* CLAUDE.md note than the one the plan
  describes.
- **§8 step 13**'s "report the Step 0 branch taken."
- **§9 done condition 2**, which currently reads "either with no `.dev.vars` at all (Step 0 branch
  A1/A2), **or** failing with the §3.4.3 message (branch A3)." A done condition that admits two
  mutually exclusive outcomes is not a done condition — it cannot be checked. It becomes the
  single deterministic claim: *works on a fresh clone with no `.dev.vars`.* That is a materially
  stronger guarantee than the plan currently commits to, and it is available for free.

**What survives, and must not be deleted with the rest: precedence.** Nothing I can verify tells
me whether `--var DEV_AUTH_IDENTITY:owner` beats an existing `.dev.vars DEV_AUTH_IDENTITY=...`.
This is not academic — `docs/dev-fixtures.md:9` and `:19` explicitly instruct QA to set
`DEV_AUTH_IDENTITY="someone@example.com"` (a *member*) for sharing and 403 testing, so a developer
having a member identity in `.dev.vars` at the moment they run e2e is a normal, documented state,
not an exotic one. If `.dev.vars` wins, the suite runs as a member.

The `globalSetup` preflight already catches this with the right message, and I strongly endorse
the plan's insistence (§3.4.3) that the preflight ships regardless of branch — it is the
difference between one clear sentence and a wall of 403s. Two notes on it:

- The `role !== "admin"` message says "Set `DEV_AUTH_IDENTITY="owner"` in `.dev.vars`, or remove a
  conflicting override." That guidance is only correct if `.dev.vars` wins. Once precedence is
  measured, the message must match the measured direction.
- Keep a one-line Step 0 that measures precedence and records it, and keep the finding in the
  §8 step 13 report. Everything else in Step 0 goes.

Rejecting `.env` and rejecting harness writes to `.dev.vars` are both correct calls, well argued,
and should stay in §3.4.3 as recorded rejections even after the ladder collapses —
`.dev.vars` holds `RESEND_API_KEY` and `VAPID_PRIVATE_KEY`, and a harness that writes to it is
unacceptable. Agreed without reservation.

The `127.0.0.1` host note is correct and the `--ip 127.0.0.1` fallback with the explicit "do not
silently switch to a non-loopback host" warning is exactly right — that switch would deactivate
the shim (`src/worker/auth.ts:171`) and produce 401s that look like an auth bug.

---

## 9. Other findings

**Browsers (§3.5).** The Chromium-default / WebKit-behind-`E2E_WEBKIT=1` decision is well
reasoned, and the "a WebKit pass does not license 'works on iPhone'" caveat is the honest framing.
No objection. Small gap: the config is described as defining a `webkit` project, but nothing says
whether it has ever been *run*. A project definition that has never executed is a second no-op
inside a plan about no-ops. Either run it once during §8 step 12 and record the result, or state
plainly that it is untried.

**Open question 2 (`chromium-dark` scope).** Agreed with the plan's own recommendation: run E1
only, via `testMatch` on the dark project. Under §0.2(b)'s `document.body` fix, the ring
assertions become scheme-agnostic and E1's dark run costs nothing extra to reason about. E2's
geometry and E3's boot claims are scheme-independent; running them twice buys nothing.

**Viewport is never pinned.** `use.viewport` is absent from §3.7's table. E3 beat 1 depends on it
(`nav[aria-label="Primary"]` is `md:flex`), and E1's nav-button selector depends on it too (§1
above). Pin it explicitly at 1280×800 in `use`, and let E2 override per-test.

**`expect.timeout: 5_000` vs the calendar's fetch.** `CalendarView.tsx:51-72` issues one
`getOccurrences` request per list on mount and only clears `loading` when all settle. The first
chip assertion after navigating to Calendar on a cold Worker is the one that will brush 5s.
Consider waiting on the `Loading…` indicator (`CalendarView.tsx:190`) clearing rather than relying
on the raw expect timeout — which is, incidentally, exactly the technique
`calendar-show-more.md` §5.2 landed on for jsdom after three revisions.

**`forbidOnly: true` unconditionally.** Correct, and the reasoning ("with no CI, the standard
CI-gated form is dead code") is right. No objection.

**Hidden coupling, worth stating in §4.2.** Adding `tsc -p tsconfig.e2e.json` to `typecheck` means
a type error in `e2e/` now fails the Coder loop and the pre-PR gate on **every** branch, including
worker-only ones. That is the intent and I support it, but it should be named as a deliberate
coupling rather than discovered by a Worker developer wondering why a Playwright file is failing
their build. `tsconfig.e2e.json` will need `"types": ["node"]` for `process` (`@types/node ^22` is
present, `package.json:44`).

**Security.** No new binding, no schema change, no route change; the shim's loopback gate
(`src/worker/auth.ts:164-171`) is untouched and the harness is unreachable from the deployed
Worker. §5's analysis is correct. One cosmetic note: `webServer.stdout: "pipe"` will print
`[dev-auth] shim active as juniwar.dev@gmail.com` into `playwright-report/`. That directory is
gitignored (`.gitignore:18`) and the address is already committed at `wrangler.toml:25`, so this
is not a leak — mentioning it only so nobody pastes raw run output into a `docs/qa/` report and
then wonders.

**Observability.** `expectContainedIn` / `expectFocusRing` with `testInfo.attach` screenshots
(§3.6) is genuinely good design and is the part of this plan I would most want kept intact. The
"bare numbers are unactionable" observation is correct and is the sort of thing most e2e suites
never do.

---

## Required changes

1. **Collapse §3.4.3's probe ladder to `--var`.** `wrangler dev --var` is confirmed (documented
   flag; used successfully in this repo). Delete branches A2 and A3, delete §7 R1, delete §8
   step 1's three-option probe and §8 step 13's "branch taken" report, and make §8 step 11c's
   CLAUDE.md auth note unconditional (there is no auth prerequisite). Make §9 done condition 2
   the single deterministic claim: *works on a fresh clone with no `.dev.vars`.* Keep the
   `globalSetup` preflight verbatim, keep the `.env` and `.dev.vars`-write rejections, and keep a
   one-line Step 0 that measures **only** `--var` vs `.dev.vars` precedence and records it —
   `docs/dev-fixtures.md:9,19` makes a member identity in `.dev.vars` a normal state. Adjust the
   preflight's remediation message to match the measured precedence direction.
2. **Fix E1 beat 4's layer count.** Tailwind v3 emits three comma-separated layers
   (`--tw-ring-offset-shadow`, `--tw-ring-shadow`, `--tw-shadow: 0 0 #0000` from preflight); a
   `shadow-soft` Button would give four. Assert the offset and ring layers **by index** and
   `layers.length >= 2`, never `=== 2`.
3. **Fix E1 beat 5's reference colour.** `ring-offset-background` resolves to `--background`;
   the day cell is `bg-card`, and the two tokens differ in both schemes
   (`web/src/index.css:13,16,37,39`), so the assertion fails on unmodified `main`. Compare against
   `getComputedStyle(document.body).backgroundColor` (`index.css:63-65` applies `bg-background` to
   `<body>`). This also makes the assertion valid for beat 6's `<Button>`, where there is no day
   cell, and makes the deliberate-break check fail in **both** projects rather than only dark.
4. **Strengthen the ring-colour assertion to a complete value.** Assert the ring layer equals the
   resolved `--ring` token read at runtime from `document.documentElement`, not merely "not the
   element's own `background-color`." As written, swapping `ring-ring` for `ring-border` —
   near-invisible — passes every beat. This is the rung `calendar-show-more.md` §5.2 was rewritten
   around in v6, and the plan cites §5.2 as its governing rule.
5. **Specify beat 6 concretely.** State that focus on the `›` control is established by the
   Shift+Tab itself (ArrowDown does nothing there — `handleGridKeyDown` is bound to the `Card`,
   `CalendarView.tsx:201-203`), that `button.tsx:8` uses `ring-offset-2` vs the chips'
   `ring-offset-1` so no width may be hardcoded, and that beat 6 guards `button.tsx` through one
   call site only — `ui/sheet.tsx`, `ui/dialog.tsx`, `ui/select.tsx`, `ui/tabs.tsx` remain
   unguarded.
6. **Enforce the `.focus()` invariant mechanically, not only by comment.** Add a
   `no-restricted-syntax` rule banning `.focus(` in `e2e/**/*.spec.ts` to §4.2's new
   `eslint.config.js` block, carrying the `docs/qa/calendar-show-more-report.md:46-52` citation in
   its message. §7 R2's claim that `matches(":focus-visible")` self-defends is unreliable —
   Chromium's heuristic keys on "was the last user interaction a keypress," and beat 2's real
   `Tab` precedes beat 3, so a `.focus()` substitution can still match. `npm run lint` is in the
   Coder loop and the pre-PR gate; `test:e2e` is in neither. Keep the header comment as well.
7. **Specify how the specs reach the Calendar view, per viewport.** There is no route
   (`App.tsx:25`, `:231-232`). At 1280 the target is the desktop nav `Button` (`App.tsx:164-176`,
   name "Calendar"); at 390 the `aside` is `hidden` (`:154`) and the visible control is the bottom
   tab with `aria-label="Calendar (bottom tab)"` (`:263`). E2 runs at both. Also bound beat 2's
   "Tab until `activeElement` is `›`" loop (e.g. 40 presses) and make it throw with the current
   `activeElement`'s tag and text.
8. **Add cardinality assertions to E2 before the geometry loop.** Collapsed: exactly 3
   `[data-cal-id]` chips plus a toggle reading exactly `+2 more`. Expanded: exactly 5 chips plus
   `Show less`. As written, beat 1's "for every chip in the cell" loop passes **vacuously** if the
   seed lands on the wrong day.
9. **Add an escape hatch for E2 failing on unmodified `main`.** The `+N more` toggle at 390px has
   ~34px of content box for an eight-character `text-[10px]` string, and neither QA report covers
   the toggle's line count at mobile width. If beat 2 fails on today's app, the Coder must file it
   as a defect and stop — not weaken the assertion, and not fix `CalendarView.tsx` (§2 forbids it).
10. **Order the deliberate-break check correctly (§8 step 12).** Require E1 green on unmodified
    `main` *first*, then red after removing `ring-offset-background`, then green after the revert.
    As written the check cannot distinguish "caught the regression" from "was already red" —
    which, given findings 2 and 3, is the state it would actually be in.
11. **Correct §7's `npm run dev` coexistence claim.** Port and persist dir are isolated; **`dist/`
    is not.** The e2e `vite build` has `emptyOutDir: true` (`vite.config.ts:15`) and wipes the
    shared `dist/` a dev session is serving, and the dev watcher (`package.json:7`) can rebuild
    `dist/` mid-suite — reintroducing the exact stale-asset failure §3.4.1 exists to prevent.
    Either isolate the e2e build output, or have `globalSetup` detect a listener on 8787 and fail
    with "stop `npm run dev` first." Do not leave "Fine" in §7.
12. **Verify the migration step non-interactively.** `wrangler d1 migrations apply` prompts for
    confirmation; §8 step 0b runs it in a TTY, but `webServer.command` runs it with piped stdio.
    Verify through the composed command, record any non-interactive flag needed, and chain the
    three commands with `&&` so a failure surfaces as a command error rather than a 180s
    wait-for-URL timeout.
13. **Cut E3 beat 3 (the console-error allowlist).** It ships with 3 entries against its own
    documented kill threshold of ~5 (§7 R6), and two of the three are not console *errors* at all
    (`calendar-roving-tabindex-report.md:147-152`: the shim line is a `warn`, the favicon is a
    network failure). Removing it also removes R6. Strengthen beat 2 instead: fetch `/sw.js` via
    `APIRequestContext` and assert the body contains a known SW string (`web/sw.ts:33`
    `"notificationclick"`), and poll for `getRegistration` rather than reading once (`main.tsx:8`
    registers on `load`). Fix beat 1's citation to enumerate all four non-app states
    (`App.tsx:93-99`, `:102-111`, `:112-118`, `:119-125`).
14. **Add Vitest browser mode to §3.3's rejection table with a reasoned verdict.** All three
    defect classes are pure rendering claims needing no Worker, D1, seeding, auth, or `dist`;
    driving the existing `web` project in real Chromium would cover them, delete §3.4 wholesale
    along with R1/R5/R7, and — decisively — run inside `npm test`, which executes on every branch,
    answering §6's own admission that nothing forces this suite to run. E3's build-output claim
    does not need a browser (`existsSync("dist/sw.js")`). The verdict may be "reject" — the
    integration-path argument is real — but §3.3 is presented as the record of what was weighed,
    and this was not.
15. **Make the deletion trigger concrete (§6).** Replace "if this suite is found un-run for
    several consecutive frontend branches" with a dated, `grep`-checkable backlog entry naming the
    exact files to delete, in the style of `docs/qa/prod-verification-checklist.md`. Also mark
    which of §6's four anti-rot mechanisms are actual mechanisms (1 and 4 — they ride on `lint` and
    `typecheck`) and which are norms (2 and 3).
16. **Pin `use.viewport` explicitly** (§3.7 omits it). E3 beat 1 and E1's nav selector both depend
    on it (`App.tsx:154`, `md:flex`). Note the `typecheck` coupling in §4.2 (a type error in
    `e2e/` now fails worker-only branches) and that `tsconfig.e2e.json` needs `"types": ["node"]`.

APPROVE WITH CHANGES

---

# Round 2

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-08-22
Plan revision reviewed: v2
Round: 2

## 2.0 Delta verification — all 16 landed

I checked each required change against the revised text rather than the changelog. All 16 are
present, and several are folded in more thoroughly than I asked for:

| # | Landed at | Note |
|---|---|---|
| 1 | §3.4.3:602-629, R1 deleted :1005, DC2 :1196-1199, step 1 :1088-1092 | Ladder gone; precedence retained as the sole Step 0 measurement, correctly |
| 2 | §3.2 E1 beat 4 :179-188 | Index-based, `length >= 2`, no hardcoded widths. Correct |
| 3 | §3.2 E1 beat 6 :202-211 | `document.body`; explicitly forbids both the day-cell and the "not white" forms |
| 4 | §3.2 E1 beat 5 :189-201 | See §2.1 — the correction is right |
| 5 | §3.2 E1 beat 7 :212-224 | Shift+Tab, no ArrowDown, one-call-site scope stated |
| 6 | §4.2a :880-905, R2 :1007-1013, step 11b :1142-1147 | Goes further than asked: step 11b requires *verifying the rule fires* by temporarily writing `chip.focus()`. Good |
| 7 | §3.2 table :151-157, beat 2 :169-174 | Both viewports; 40-press bound throwing with tag+text |
| 8 | §3.2 E2 beat 0 :271-277 | |
| 9 | §3.2 E2 blockquote :291-302, R8 :1039-1042, step 9 :1132-1134 | |
| 10 | §8 step 12 :1167-1179 | Adds a refinement I did not ask for and that is correct: under the `document.body` reference the red stage must fail in **both** projects, and failing in dark only diagnoses a wrong reference |
| 11 | §3.4.1a :528-557, edge case :1046-1048 | See §2.3 — the analysis is right but the probe is in the wrong place |
| 12 | §3.4.2 :589-595, `&&` :523-526, step 0b :1093-1101 | |
| 13 | §3.2 E3 :336-365, R6 deleted :1034 | Two beats; `"notificationclick"` body check; polled registration; four non-app states enumerated |
| 14 | §3.3 row :380, §3.3a :382-475, OQ1 :1062-1067 | See §2.4-2.7 |
| 15 | §6 :967-997 | Mechanism/norm split and the dated `grep`-checkable entry, both as specified |
| 16 | §3.7 :837, §4.2 :871-878 | |

Advisory items also landed: `Loading…` settle signal (:164-168, :834), WebKit run-once-or-declare
(:797-802), the `[dev-auth]` line in `playwright-report/` (:812-815), `chromium-dark` scoped to E1
(:838), the mid-run sweep gap (:749-754), and the `E2E_REUSE=1` debug hatch (§3.4.6).

## 2.1 The correction to required change 4 is right — confirmed

The Architect is correct and I was wrong. `getComputedStyle(document.documentElement)
.getPropertyValue("--ring")` returns `"172 36% 44%"` — the shadcn HSL *channel triplet*
(`web/src/index.css:31`, consumed as `hsl(var(--ring))` per `tailwind.config.ts:18`) — not a
serialised colour. Comparing that string against the `rgb(...)` in the computed `boxShadow` fails
on a correct app, which is precisely the failure class I flagged in round 1. I should have caught
that this repo's tokens are triplets, not colours; `tailwind.config.ts:16-48` wraps every one of
them in `hsl()`, so no token is ever directly comparable to a computed value.

The hidden-probe mechanism (`style.color = "hsl(var(--ring))"`, read back via
`getComputedStyle(probe).color`) is the right fix: it resolves through the same engine and the
same colour-space serialisation the shadow layer uses, it inherits `prefers-color-scheme`
automatically so there is no second expected value under `chromium-dark`, and it degrades to a
loud failure rather than a silent mismatch. Two implementation notes worth carrying into
`e2e/fixtures/assertions.ts`:

- The probe must be attached to `document.body` (not `documentElement`) and be laid out — a probe
  inside a `display: none` subtree still resolves `color`, but keeping it in the normal flow with
  `position: absolute; visibility: hidden` avoids any doubt.
- Remove it in a `finally`, so a throwing assertion cannot leave a stray node that a later
  `[data-cal-id]` count or geometry query trips over.

Recorded plainly: **this is a reviewer error corrected by the Architect, not a plan defect.**

## 2.2 New in v2 and worth a line each (non-blocking)

- **§3.4.6's `E2E_REUSE=1` skips the leading build.** If no server happens to be running,
  `reuseExistingServer: true` still runs the command — now without a build — so on a fresh clone
  with no `dist/` every spec fails confusingly. The CLAUDE.md wording covers "serves whatever
  `dist` is already built"; it should also say "and requires that one exist."
- **§3.4.1a's 8787 probe is a port probe, not a `dist` probe.** A developer running the dev
  watcher on a non-default port, or an unrelated service on 8787, produces a false negative or
  false positive respectively. Acceptable proxy; say it is a proxy.

## 2.3 One real defect introduced by required change 11 — the probe fires after the damage

Blocking, and **independent of the Alternative B decision** because §3.4.1a survives under both
designs.

The mermaid flow at `:479-504` places the 8787 collision probe inside `globalSetup`, which runs
**after** `webServer` has started — the diagram itself shows `C` (build → migrate → serve) → `D`
(wait for URL) → `E` (globalSetup) → `P` (the probe). But step 1 of `webServer.command` is
`npm run build`, i.e. `vite build` with `emptyOutDir: true` (`vite.config.ts:15`). **By the time
the probe fires and prints "stop `npm run dev` first", it has already deleted and rebuilt the
shared `dist/` and broken the dev session it is warning about.** The message is accurate and the
advice is correct; it just arrives after the destructive act.

Fix: move the probe to the **front of `webServer.command`**, chained with `&&` before
`npm run build`, so it aborts before anything is written. A short node one-liner
(`node e2e/preflight-port.mjs`) or a shell `lsof`/`nc` check both work; the node form is portable
and can carry the same message. This also makes the guard independent of Playwright's
`globalSetup`/`webServer` ordering, which has changed across Playwright versions and should not be
something this harness's safety depends on.

Keep the `globalSetup` copy too if you like — belt and braces costs nothing — but the *load-bearing*
copy must be pre-build.

---

# Adjudication: Alternative B (route-mocked API)

## 2.4 Ruling

**Adopt Alternative B, with the seven refinements in §2.8 and one short, scoped round 3.**

I want to be direct about the reasoning, because the coordinator has stated a preference for
shipping the reviewed design and that preference deserves a real answer rather than a
technicality.

B is better on the merits and the margin is not small. My round-1 indictment was that §3.4 is
~60% of the plan's complexity serving ~0% of its value: all three defect classes are pure
rendering claims, and every operational risk in the plan — the TTY/prompt hazard, the `--var`
precedence question, the sweep, the leftover-rows failure mode, `workers: 1`, R7's month-boundary
flake — is a downstream consequence of the decision to put five rows in a database so that a
calendar draws five chips. B answers that indictment without giving up either of the two things
that made Playwright beat Alternative A: the **real `vite build` output served by the real Static
Assets path**, and **per-test viewport and `colorScheme`**.

Note what that means against the plan's own §3.3a reasoning: **B keeps A's benefits while
avoiding A's four stated costs.** Reason 1 (Vitest/pool-workers version coupling) — B adds no
dependency; `@playwright/test` is already at `package.json:39`. Reason 3 (per-project-only
environment granularity) — B keeps Playwright's per-test granularity. Reason 4 (tests components
through Vite's dev pipeline, not the built output) — B keeps `npm run build` + `wrangler dev`
verbatim. Only reason 2 cuts the other way, and it is the one place I think the plan overreaches
(see §2.7).

The decisive point on risk: **the seeded design is not actually "ready to code" in the way that
"ship the reviewed one" implies.** It carries two empirical unknowns that gate the Coder and could
still change the harness — R2b's unmeasured `--var`/`.dev.vars` precedence (§8 step 1) and the
non-interactive `d1 migrations apply` behaviour (§8 step 0b), which the plan itself says could
otherwise surface as "the least informative failure this harness could produce." B deletes both
outright rather than measuring them. So the choice is not "reviewed and certain" versus "new and
uncertain" — it is "reviewed, with two open measurements and a large operational surface" versus
"new, with zero open measurements and a small one."

**The condition under which I would take the seeded design instead:** if the operator judges that
one more review round is unaffordable right now. In that case ship §3.4 as written — it is
complete, correct, and I stand behind the round-1 verification of `workers: 1`, `--persist-to`,
and the sweep. That is a schedule decision, not a technical one, and it should be made as such.

## 2.5 Q1 — does B deliver what it claims?

**Mostly yes, with one claim overstated and one hazard the plan has not seen.**

**What survives intact.** `npm run build` + `wrangler dev` + real `dist` are kept, so the CSS and
JS under test are the deployed artifacts served by the deployed serving path. That is what defect
classes 1, 2 and 3 need, and it is untouched. E3 beat 2's `/sw.js` claim survives completely — it
goes through `APIRequestContext`, not the page, so no mocking is involved.

**Overstated: "E3 and prod parity survive."** E3 beat 2 survives. **E3 beat 1 does not survive in
the form its justification claims.** §3.2 E3's first stated reason for existing is diagnosability:
*"is the app even up and authenticated?"* Under B there is no authentication in the harness at
all — `GET /api/me` is fulfilled by the mock, so beat 1 degrades to "does React render given a
canned payload," which the 300 jsdom tests already establish. Under B, E3's honest justification
collapses to its second reason only, and the plan must say so rather than carrying the
diagnosability sentence forward.

That has a follow-on the plan should confront: **under B, `wrangler dev` earns its place solely
through E3 beat 2.** If no `/api/*` request reaches the Worker, the Worker is being used as a
static file server, and `vite preview` or any static server would do — which would also delete
`--persist-to`, the D1 lock note, and the `workerd` teardown. The reason not to do that is exactly
E3 beat 2: `wrangler dev` is the Static Assets path that actually deploys, and beat 2 asserts
against it. That coupling is worth writing down, because the day someone trims E3 the harness's
whole justification quietly changes.

**The hazard the plan has not seen — and it is the sharpest thing in this section.**
`getItems` and `getOccurrences` **hit the same URL path**:

```
apiClient.ts:104   getItems(listId)                  -> GET /api/lists/${listId}/items
apiClient.ts:117   getOccurrences(listId, from, to)  -> GET /api/lists/${listId}/items?from=…&to=…
```

They are distinguished **only by the presence of the `from`/`to` query string**, and they return
**different shapes** — `{ items: Item[] }` versus `{ occurrences: OccurrenceEntry[] }`. A natural
`page.route("**/api/lists/*/items*")` glob matches both. And this is not a hypothetical
collision on a path nothing visits: `App.tsx:25` initialises `activeView` to `"list"`, so
**`ItemListView` mounts and fires `getItems` before any spec clicks the Calendar nav.** Both
requests happen, in that order, on every E1 and E2 run.

Get the branch wrong and the calendar receives `{ items: [...] }`, `r.occurrences` is `undefined`,
`flatMap` throws or yields nothing (`CalendarView.tsx:66`), and the grid renders empty. E2's new
cardinality beat 0 catches that loudly — good — but E1's beat 2 ("exactly one
`[data-cal-id][tabindex="0"]`") would fail as a confusing selector timeout rather than as
"your mock returned the wrong shape."

**Service workers and `page.route()`.** Playwright's guidance is that page-level routing is
reliable only when a service worker is not controlling the page, which is why `serviceWorkers:
"block"` exists as a context option. This app registers one (`main.tsx:7-18`) and E3 beat 2
asserts the registration exists — so the two needs conflict. **In practice B is safe today**,
because `web/sw.ts` has **no `fetch` handler** (it registers only `push`, `notificationclick`,
`install`, `activate`), and a service worker without a `fetch` handler does not interpose on
navigation or fetch. But that is a **hidden coupling**: the day someone adds offline caching — an
entirely plausible PWA feature — page routing could start being bypassed. The clean answer is
per-project context options: `serviceWorkers: "block"` for E1/E2, allowed for E3. Cheap, explicit,
and it removes the coupling instead of documenting it.

## 2.6 Q2 — mock drift, and whether the typecheck defence holds

You are right to flag that the defence does not exist today. Verified: `package.json:10` is
`tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json`, and there is no
`tsconfig.e2e.json` anywhere. So §3.3a's argument rests on a change this same plan introduces
(§4.2). That is legitimate — the plan is allowed to lean on its own deliverables — but it must be
stated as such, and the deliverable must actually be strong enough. It is **partly** strong
enough. Three holes, in increasing order of importance:

**(a) The typed-factory discipline is a norm, not a mechanism.** `route.fulfill()` takes a
`string` body. A payload written as `JSON.stringify({ occurrences: [{ … }] })` inline in a spec
typechecks perfectly and is never compared to `OccurrenceEntry` at all. The type check bites only
if every fulfilled body flows through a factory annotated `(): OccurrenceEntry[]`. Nothing forces
that. This plan has just spent §6 drawing the mechanism/norm distinction and §4.2a converting its
most important invariant from one to the other — the same move is available here and costs the
same six lines: a `no-restricted-syntax` rule banning `route.fulfill` whose body is not a call
into `e2e/fixtures/api-mocks.ts`, or more simply banning `JSON.stringify` inside `e2e/**/*.spec.ts`.
Without it, B's drift defence is exactly the kind of claim §4.2a exists to stop the plan making.

**(b) `OccurrenceEntry` is a hand-maintained client mirror, not a server contract.**
`web/src/types.ts:54-59` declares it; `apiClient.ts:112-118` asserts the JSON into it. Nothing
generates it from the Worker and nothing cross-checks it. So a mock typed `(): OccurrenceEntry`
proves it matches **what the client expects**, not **what the server sends**. If the Worker's
response shape drifts and `types.ts` is not updated, the mock, the client, and the type all stay
consistent — and all stay wrong together, silently. That is a materially weaker guarantee than
§3.3a's phrasing ("fails the pre-PR gate on shape drift") implies, and the plan should say so in
one sentence rather than leave the stronger reading standing.

The mitigation is not to build contract testing here. It is to note that the *server* side of that
seam is covered by `tests/unit/list-isolation-http.test.ts` and the worker HTTP tests, and that
the client-mirror risk is one this repo already carries everywhere.

**(c) Type-correct but behaviourally wrong — yes, and §2.5 is the concrete case in this
codebase.** The `getItems`/`getOccurrences` path collision is precisely a defect that two
perfectly-typed factories cannot prevent, because what is wrong is the *routing*, not the shape.
That is the direct answer to your question: type-shape agreement is **not** sufficient, and this
repo supplies the counterexample rather than requiring a hypothetical one.

A second, milder instance: under B the mock ignores `from`/`to`, so E1/E2 never demonstrate that
the app requests the right range or that anything answers it correctly. Under the seeded design
that was not asserted either, but it would *fail* if the range were wrong. §3.3a counts the
disappearance of R7 (month-boundary flake) as a win; it is more honestly a small **coverage
reduction** presented as a risk deletion. Worth one honest sentence, not worth changing the
decision.

**One point in B's favour that §3.3a does not make.** The 300 existing tests mock `getOccurrences`
at the *module* boundary (`CalendarView.test.tsx`, per `calendar-show-more.md:296-297`). B mocks
at the *network* boundary, which is one layer more real: it exercises `apiClient.ts`'s URL
construction, `fetch`, JSON parsing, and error handling, none of which the jsdom tests touch. So
B's seam is strictly better than the seam the repo has already accepted — the argument §3.3a makes
("an exposure the repo has already accepted") undersells itself.

## 2.7 Q3 — is B strictly better? What is lost

Not *strictly* better. Here is the honest ledger.

**Gained:** §3.4.3, §3.4.4 and §3.4.5 delete entirely; §3.4.2 shrinks to the lock note; R2b and R7
disappear; required changes 1 and 12 are resolved by removal, which is the strongest form of
closing a finding. E1/E2 become hermetic — no D1 state, no leftover-rows failure mode, no "what a
failed run leaves behind" section, no `.dev.vars` member-identity hazard. E2's exact cardinality
assertions become trivially reliable instead of depending on the sweep, the teardown, and no other
list being visible. Done condition 2 becomes true by construction rather than by argument.

**Lost:**

1. **The incidental integration signal.** The seeded design would catch a Worker route,
   authorization, or serialisation regression as a side effect of running. B cannot. The counter —
   that the worker HTTP tests and `list-isolation-http.test.ts` cover this on every `npm test` —
   is sound, and §3.3 already rejects CRUD and authz specs for the same reason. Accepted.
2. **E3 beat 1's stated rationale** (§2.5). Real, and it needs a rewrite rather than a footnote.
3. **The occurrence-range claim** (§2.6). Small.
4. **`wrangler dev`'s justification narrows to a single beat** (§2.5). Structural, worth recording.
5. **A new characteristic failure mode: the incomplete mock set.** Under the seeded design a
   missed endpoint simply worked. Under B it 401s against the real Worker or falls through the
   handler. Every request on the E1/E2 path must be enumerated: `GET /api/me` (`App.tsx:48`),
   `getItems` for the initially-active list view (`App.tsx:25`, `apiClient.ts:104`),
   `getOccurrences` per list (`CalendarView.tsx:64`), and the attachments fetch that
   `AttachmentsView` issues lazily on mount when a view-mode modal opens — which E1 beat 8 does,
   and which `calendar-roving-tabindex-report.md:158` confirms fires in a real session
   (`/api/items/:id/attachments`, `apiClient.ts:192`).

**On §3.3a reason 2 (the gate dilemma), which I think slightly overreaches.** The plan argues that
Alternative A's `npm test` benefit is unavailable because the mitigation — a separate Vitest
project excluded from the default run — "reproduces 'runs only when a human remembers' exactly."
That is not quite right. A separate project added to the documented **pre-PR** gate (but not the
Coder loop) would be exactly as enforced as `npm run build` is today: a norm attached to a
checklist people actually follow, paid once per branch rather than many times. So the dilemma has
a third horn the plan does not name. It does not change the ruling — **reason 1 is sufficient on
its own**, and I verified it (`vitest ^2.0.5` at `package.json:61`, `@cloudflare/vitest-pool-workers
^0.6.0` at `:36`, and `docs/backlog.md:145` names the sweep and flags the miniflare D1/R2
compatibility constraint explicitly). Coupling a tooling bootstrap to a scheduled major-version
sweep is the wrong risk trade, and B avoids the question entirely. But reason 2 should be softened
to what it can carry, so that a future reader re-opening this decision after the sweep lands is
not working from an overstated record.

## 2.8 Q4 — what B needs beyond deleting §3.4, and whether it needs a round

**Beyond the deletions §3.3a already lists**, seven things — none large, all specifiable now:

1. **Fail loudly on an unmatched `/api/*` URL.** The route handler must end in an explicit `else`
   that throws with the full unmatched URL and method. Never fall through to the network, never
   fulfil an empty 200. This is the single most important mechanical requirement for B: without
   it, B's characteristic failure is a silently-empty calendar.
2. **Disambiguate `getItems` from `getOccurrences` on the shared path** (`apiClient.ts:104` vs
   `:117`), branching on the presence of `from`/`to`, and say in a comment that they collide and
   why. Cover `getItems` explicitly — `App.tsx:25` guarantees it fires first on every run.
3. **Enumerate the complete mock set** (§2.7 item 5), including the attachments fetch that E1
   beat 8 triggers.
4. **Make the typed-factory discipline a mechanism, not a norm** (§2.6a): all fulfilled bodies
   come from `e2e/fixtures/api-mocks.ts`, enforced by a `no-restricted-syntax` rule alongside
   §4.2a's. State plainly that `OccurrenceEntry` is a client mirror (§2.6b), so the drift claim is
   not read as stronger than it is.
5. **Set `serviceWorkers` per project** — `"block"` for E1/E2, allowed for E3 — and record that
   routing is reliable today only because `web/sw.ts` has no `fetch` handler.
6. **Keep `workers: 1`, for a different reason.** §3.3a lists parallelism as a win. Decline it.
   Three spec files on one machine gain almost nothing from parallelism, and E1 is a focus- and
   geometry-sensitive suite running in a headless browser with *documented* focus artifacts (R3,
   `calendar-roving-tabindex-report.md:104-131`). Competing browser processes perturb layout
   timing and focus. Keep serial execution for determinism; just rewrite §3.4.4's justification,
   which no longer applies.
7. **Rewrite E3 honestly** (§2.5): drop or requalify beat 1's diagnosability claim, and record
   that `wrangler dev` is retained solely for beat 2's Static Assets path.

Plus, independent of B: **§2.3's probe-ordering fix**, which applies to either design.

**Does it need another round? Yes — but a cheap, scoped one, and it should be scoped explicitly.**
E1 beats 2-9 and all of E2 are unchanged by B; only "seed via the API" becomes "fulfil via the
route handler", and §3.4.1/§3.4.1a/§3.4.6/§3.5/§3.6/§3.7/§4.2/§4.2a/§6 are untouched. So round 3
should be **limited to the §3.3a-derived delta plus §2.3**, and should not re-open anything
verified in rounds 1 and 2. Stated that way it is a short pass, not a restart — and it is worth
paying, because it is the round in which items 1, 2 and 4 above get checked, and item 2 in
particular is the sort of defect that would otherwise cost a Coder an afternoon.

---

## Required changes (round 2)

1. **Adopt Alternative B** (§3.3a / §7 OQ1) and restructure accordingly: delete §3.4.3, §3.4.4 and
   §3.4.5; shrink §3.4.2 to the D1-lock note; update §5's endpoint table into a **mock contract**
   table; update §9 DC2/DC3 and §8 steps 0, 1, 2, 4, 6, 13. Retain §3.4.1, §3.4.1a, §3.4.6, §3.5,
   §3.6, §3.7, §4.2, §4.2a and §6 unchanged. *(If the operator judges a further round unaffordable,
   shipping §3.4 as written is an acceptable schedule decision — see §2.4 — but it should be taken
   knowingly, and required changes 2-9 below still apply to whichever design ships.)*
2. **Fix the 8787 collision probe's position** (§2.3). It currently runs in `globalSetup`, after
   `webServer.command`'s `npm run build` has already emptied the shared `dist/`
   (`vite.config.ts:15`) and broken the dev session it warns about. Move the load-bearing copy to
   the **front of `webServer.command`**, chained with `&&` before the build, so it aborts before
   anything is written — and so the guard does not depend on Playwright's `globalSetup`/`webServer`
   ordering. Applies to both designs; update the §3.4 mermaid flow to match.
3. **Route handler must fail loudly on any unmatched `/api/*` request** — explicit `else` throwing
   with the full method and URL. No network fall-through, no empty 200.
4. **Disambiguate the shared items path.** `getItems` (`apiClient.ts:104`) and `getOccurrences`
   (`apiClient.ts:117`) both resolve to `GET /api/lists/:id/items`, differing only by the
   `from`/`to` query string, and return different shapes. `App.tsx:25` makes `getItems` fire first
   on every run. Branch on the query string and comment the collision.
5. **Enumerate the complete mock set**: `GET /api/me` (`App.tsx:48`), `getItems`
   (`apiClient.ts:104`), `getOccurrences` per list (`CalendarView.tsx:64`), and the attachments
   fetch `AttachmentsView` issues on mount when E1 beat 8 opens a view-mode modal
   (`apiClient.ts:192`; confirmed live in `calendar-roving-tabindex-report.md:158`).
6. **Make the drift defence a mechanism and state its true strength.** All fulfilled bodies must
   come from typed factories in `e2e/fixtures/api-mocks.ts`, enforced by a `no-restricted-syntax`
   rule alongside §4.2a's — otherwise `route.fulfill({ body: JSON.stringify({…}) })` typechecks
   fine and the defence never fires. Also record that `OccurrenceEntry` (`web/src/types.ts:54-59`)
   is a hand-maintained **client mirror**, not a server contract, so shape agreement proves the
   mock matches what the client expects, not what the server sends.
7. **Set `serviceWorkers` per project** — `"block"` for E1/E2, allowed for E3 — and record that
   `page.route()` is reliable today only because `web/sw.ts` registers no `fetch` handler.
8. **Keep `workers: 1` under B**, justified by focus/geometry determinism under R3's documented
   headless focus artifacts rather than by shared state. Rewrite §3.4.4's now-obsolete reasoning
   rather than deleting the setting with it.
9. **Restate E3 honestly under B**: beat 1 can no longer answer "is the app up and authenticated"
   because there is no authentication in the harness, so requalify or drop it; and record that
   `wrangler dev` is retained **solely** for beat 2's Static Assets path. Also soften §3.3a
   reason 2 to what it can carry (§2.7) — a separate Vitest project attached to the *pre-PR* gate
   is a third horn the dilemma does not address; reason 1 remains sufficient on its own.
10. **Scope round 3 explicitly** in the plan's revision note: limited to the §3.3a-derived delta
    plus change 2. E1 beats 2-9, all of E2, and §§3.4.1/3.4.1a/3.4.6/3.5/3.6/3.7/4.2/4.2a/6 are
    verified and must not be re-opened.

APPROVE WITH CHANGES

---

# Round 3

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-08-22
Plan revision reviewed: v3
Round: 3 — scoped to the §3.3a delta plus the probe fix, as agreed

## 3.0 Delta verification — all 10 landed, and the citations hold

| # | Landed at | Note |
|---|---|---|
| 1 (adopt B) | §3.3a:464-537, §3.4:538-796, §5:992-1032 | §3.4.3/3.4.4/3.4.5 deleted; §3.4.4 replaced by a *record of what was cut* (:767-780), which is the right instinct — it stops someone reintroducing the auth path piecemeal, and it preserves the `.dev.vars`-write and root-`.env` rejections as standing precedent |
| 2 (probe) | §3.4.1a:616-649, command at :628, flow at :543-552, step 2 at :1183-1188 | Correct — see §3.1 |
| 3 (throw) | §3.4.3(c):731-738, §5.1:1010, R2c:1105-1109 | |
| 4 (collision) | §3.4.3(a):692-717, §5.1:1007-1008, §8 preamble :1178-1179 | Both `apiClient.ts` citations carried in the requirement |
| 5 (mock set) | §3.4.3(b):719-729, §5.1 table | |
| 6 (drift mechanism) | §4.2b:943-972 | Ban on `JSON.stringify` in `e2e/**/*.spec.ts`; client-mirror ceiling stated as an accepted residual at :965-972 |
| 7 (`serviceWorkers`) | §3.4.3(e):752-765, E3 note :374-378, R2d:1110-1112 | |
| 8 (`workers: 1`) | §3.3a:490-495 | Re-justified on determinism; v2's "parallelism returns" explicitly withdrawn |
| 9 (E3 + reason 2) | §3.2 E3:325-383, §3.3a:470-474 | |
| 10 (scope) | §10 v3:1328+ | |
| §2.2 (a) `E2E_REUSE` needs an existing `dist` | §8 step 11c:1254-1256 | I went looking for this in §3.4.6 and did not find it; it is in the CLAUDE.md instruction instead, which is the right home |
| §2.2 (b) probe is a proxy | §3.4.1a:646-649 | |

I re-checked the citations that are new in v3 rather than taking them on trust.
`AttachmentsView.tsx:24` is exactly the `listAttachments(itemId)` call, and `ItemDetails.tsx:138`
renders `<AttachmentsView itemId={item.id} />` — so E1 beat 8's modal really does fire it, and
§3.4.3(b)'s fourth row is right. `apiClient.ts:60/104/117/192`, `App.tsx:25/48`,
`CalendarView.tsx:64`, and `web/src/types.ts:54-59` all check out.

The Architect's independent re-verification of the `apiClient.ts:104`/`:117` collision, and its
promotion to the first thing §8's preamble tells the Coder to read (:1178-1179), is the right
handling. That is the one defect in this plan most likely to burn an afternoon.

## 3.1 Q1 — the `dist/` mtime check does prove what it claims

**Confirmed sound.** The command is

```
node e2e/preflight-port.mjs && npm run build && npx wrangler dev --port 8788 --persist-to .wrangler/e2e-state
```

A non-zero exit from the probe short-circuits `&&`, so `npm run build` — and therefore
`vite build`'s `emptyOutDir: true` (`vite.config.ts:15`) — never executes. `dist/` is untouched and
its mtime is unchanged. The reasoning behind replacing the message with the mtime is also right:
v2's probe *did* print the correct message, after the destructive act, so the message was never
evidence of the property. Asserting on the artifact rather than the announcement is the correct
correction and it generalises.

I enumerated the other routes by which a blocked run could touch `dist/` and found none:

- Playwright itself writes only `test-results/` and `playwright-report/` (§3.6, `.gitignore:17-18`).
- If `webServer.command` exits non-zero, Playwright aborts before any spec runs, so no spec-level
  code executes at all.
- If port 8788 is already held, `reuseExistingServer: false` makes Playwright fail to bind *before*
  running the command — so neither probe nor build runs. `dist/` untouched by a different path.

Two caveats, both minor and one already handled:

- **The check must be run in default mode.** `E2E_REUSE=1` skips the leading build (§3.4.6:792), so
  running the DC3 verification with that flag set would pass vacuously. Worth one clause in DC3.
- **DC3's wording presupposes the run was blocked** ("after a blocked run") without saying to
  confirm it. If the probe were buggy and always exited 0, there would be no blocked run to measure.
  **Already covered** — §8 step 2:1187-1188 requires verifying "the probe fires **and aborts before
  the build** (check `dist/`'s mtime is unchanged)", which is both halves. DC3 should mirror that
  wording so the checklist and the done condition say the same thing.

## 3.2 Q2 — DC4b is the weakest thing in v3, and it needs four corrections

You were right to single this out. The intent — make "the harness never touches the backend"
*verifiable* rather than merely architectural — is exactly right, and it is the kind of done
condition this repo should write more of. But as worded it does not hold up.

**(a) It names the wrong artifact, and the wrong artifact is empty.** DC4b says "the `webServer`
stdout in `playwright-report/`". `playwright-report/` is the HTML reporter's output; it carries
per-*test* stdout/stderr as attachments. `webServer` output is not attached to any test — with
`stdout: "pipe"` (§3.6:810) Playwright forwards it to the **runner's process stdout**, i.e. the
terminal and the `list` reporter, not into the HTML report. So a verifier who opens
`playwright-report/`, sees no `/api/*` lines, and ticks DC4b will have confirmed nothing at all —
they will have observed an artifact that could never have contained the evidence either way. That
is a *false-pass-shaped* done condition in a plan whose entire subject is false-pass-shaped tests.
Name the run output and say how to capture it (`npm run test:e2e 2>&1 | tee /tmp/e2e.log`, then
grep it).

**(b) The `[dev-auth]` half is silent in precisely the canonical configuration.** Trace it:
`auth.ts:210` calls `resolveDevIdentity`, which at `:182-183` returns `null` when
`env.DEV_AUTH_IDENTITY` is unset; the `console.warn` at `:215` is inside the `if (devIdentity)`
branch. Under B **no `--var` is passed at all**, and DC2's canonical case is a fresh clone with
**no `.dev.vars`**. In that configuration `DEV_AUTH_IDENTITY` is unset, so the line **never prints
even if `/api/*` requests are leaking** — a leaked request would fall through to the real
`verifyAccessJwt` path and 401 silently. The tripwire fires only for a developer who happens to
have `.dev.vars` populated, which is the *non*-canonical case. It is not wrong; it is presented as
general when it is conditional, and it is silent exactly where DC2 says the suite must work.

**(c) The scope excludes the one project where the guarantee is conditional.** DC4b says "during
E1/E2". But E3 also installs the `/api/*` mocks (§3.2 E3:377-378 — it must, or beat 1 renders the
error state), and E3 is the single project where `serviceWorkers` is **allowed** (§3.4.3(e):764-765).
So the property is **structurally** guaranteed for E1/E2 (`serviceWorkers: "block"`) and only
**conditionally** guaranteed for E3 — conditional on `web/sw.ts` never gaining a `fetch` handler,
which is R2d. DC4b omits the one project that carries the residual risk. It should cover all three
and say which guarantee applies where.

**(d) It is framed as the proof when it is corroboration.** The thing that actually makes "no
`/api/*` reaches the Worker" true is §3.4.3(c): every `/api/*` is either matched by a typed factory
or **throws**. A log observation cannot prove a negative across all future runs; the throw makes the
negative structural. DC4b should say it is a tripwire confirming §3.4.3(c) held on this run, not the
evidence the property exists.

**Direct answer to your question:** the `/api/*`-request-log half is reachable in practice, but only
if you look in the terminal output rather than the HTML report. The `[dev-auth]` half is not
reachable in the canonical fresh-clone case. And yes, it holds for E3 today — for the non-obvious
reason §3.4.3(e) already documents — but E3's guarantee is the conditional one and the DC does not
say so.

## 3.3 Q3 — §3.4.0's honest version does **not** survive contact, and it fails in the opposite direction

You asked whether a single beat can justify a whole dev server. Having checked the Worker, my
answer is that **the question is built on a false premise the plan itself introduced**: the
justification was never a single beat, §3.4.0 *under*-claims, and the under-claim has been converted
into an instruction that would cause a regression.

`src/worker/index.ts:58-61`:

```ts
app.all("*", async (c) => {
  // For non-API paths, serve the PWA via Static Assets
  return c.env.ASSETS.fetch(c.req.raw);
});
```

That catch-all sits after `app.use("/api/*", requireAuth)` at `:28` and every `app.route("/api/…")`
registration at `:33-53`. **So every static request — `/`, `/assets/main-<hash>.js`, the compiled
CSS, and `/sw.js` — is routed through the Hono app first and served via the `ASSETS` binding.** That
is not a property E3 beat 2 uniquely exercises. It is exercised on **every `page.goto("/")` in every
spec**: E1's ring assertions depend on the compiled Tailwind stylesheet arriving through
`index.ts:58-61`, and E2's geometry assertions depend on it just as much.

Consequences, in order of importance:

1. **§3.4.0:570-573's "the one reason not to: E3 beat 2" is too narrow.** The prod-parity property
   `wrangler dev` supplies is "the deployed Worker's routing sits in front of the deployed Static
   Assets binding," and all three specs consume it. A generic static server (`vite preview`, `serve
   dist`) bypasses `index.ts:58-61` entirely and would silently drop that for every spec, not just
   for beat 2.
2. **§3.4.0:575-577 and §7 OQ3:1168-1170 therefore give harmful advice.** Both say that anyone
   removing E3 beat 2 should replace `wrangler dev` with a static server *in the same change*.
   Following that instruction would delete the Worker-fronts-assets parity that E1 and E2 currently
   rely on, in a change whose stated rationale is "beat 2 is gone" — i.e. a maintainer would be
   walked into a regression by a section written to prevent exactly that. **This is a booby trap
   planted by the honesty exercise**, and it is worse than the smoothed-over version would have
   been, because it carries the authority of a deliberate, flagged decision.
3. **In fairness, the guarded defect class is small but real and free.** The realistic breakage is a
   new non-API Worker route shadowing a static path, or an edit to the `app.all("*")` fallback or to
   `[assets]` handling. Low probability. But `wrangler dev` costs nothing extra here — it is already
   this project's dev command (`package.json:8`) and already how QA drives the app — whereas
   `vite preview` or `serve` would be *new* machinery introduced to save nothing. So the conclusion
   is not "the server is unjustified"; it is "the justification written down is the wrong one."

**Fix:** restate §3.4.0 as *"`wrangler dev` is retained because every spec loads the app through
`src/worker/index.ts:58-61`'s catch-all into the `ASSETS` binding — the deployed serving path. E3
beat 2 is the most explicit assertion against that path, not the only consumer of it."* Then delete
the swap instruction from §3.4.0 and §7 OQ3 and replace it with: *"If E3 beat 2 is ever dropped,
`wrangler dev` still stands on the page-load path; do not swap in a static server without
re-arguing §3.4.0 from `index.ts:58-61`."*

I raised this coupling in round 2 and the Architect stated it faithfully as I described it. The
error is mine as much as the plan's — I framed it as "narrows to a single beat" without having
checked the Worker's fallback. Checking it now inverts the conclusion.

## 3.4 Two stale cross-references introduced by the restructure (non-blocking)

Both are artefacts of section renumbering, and I flag them only because this plan's own standard is
citation accuracy and I have spent two rounds on it:

- **§7 R1:1093-1094** cites "(§3.4.3)" for the `--var` flag's existence. §3.4.3 is now *"The mock
  contract"* and says nothing about `--var`; that material lives in §3.4.4's deletion table
  (:774). Point R1 at §3.4.4, or fold R1 into the deletion record — it is a risk about a mechanism
  the plan no longer uses.
- **§3.4.1a:613-614** says the watcher hazard arrives "through a door §3.4.2 opens by advertising
  coexistence." v3's §3.4.2 (:657-684) no longer advertises coexistence — it was rewritten to the
  lock note. The sentence is describing v1's §3.4.2. Reword or drop the clause.

One trivial note: §9's list runs 1, 2, 3, 4, **4b**, 5, 6, 7, 8. Done conditions are the checklist
QA ticks; an interpolated `4b` is easy to skip. Renumber.

## 3.5 What I am explicitly not re-opening

Per the agreed scope: E1 beats 2-9, all of E2, §3.4.1, §3.4.1a's analysis (as distinct from the
probe placement, now fixed), §3.4.6, §3.5, §3.6, §3.7, §4.2, §4.2a and §6 were verified in rounds 1
and 2 and are unchanged in v3. I re-read §3.2 E1 and E2 to confirm they are in fact unchanged apart
from "seed" → "mock" wording, and they are.

---

## Required changes (round 3)

All four are documentation-level. None changes the design, and none needs a further review round —
fold them in and proceed to the Coder.

1. **Rewrite §3.4.0's justification and delete the static-server swap instruction** (§3.3).
   `src/worker/index.ts:58-61`'s `app.all("*") → c.env.ASSETS.fetch(...)` means **every** spec's
   page load goes through the Worker into the `ASSETS` binding, so `wrangler dev` is justified by
   the page-load path, not by E3 beat 2 alone. Remove the "replace `wrangler dev` with a static
   server in the same change" advice from **both** §3.4.0:575-577 and §7 OQ3:1168-1170 — as written
   it would walk a future maintainer into dropping prod parity for E1 and E2. Replace with: if beat
   2 is dropped, the server still stands on the page-load path and must not be swapped without
   re-arguing §3.4.0 from `index.ts:58-61`.
2. **Fix DC4b** (§3.2), four ways: (a) name the **run/terminal output**, not `playwright-report/`,
   which structurally cannot contain `webServer` stdout, and say how to capture it; (b) mark the
   `[dev-auth] shim active` half as a **conditional** tripwire — `auth.ts:182-183,215` means it
   never prints when `DEV_AUTH_IDENTITY` is unset, which is the canonical fresh-clone case from
   DC2, so it proves nothing there; (c) extend the scope to **all three specs**, noting the
   guarantee is structural for E1/E2 (`serviceWorkers: "block"`) and conditional for E3 (allowed
   service workers; safe only per R2d); (d) reframe it as a tripwire corroborating §3.4.3(c)'s
   throw-on-unmatched, which is what actually makes the property structural.
3. **Tighten DC3** (§3.1): state that it must be verified in **default mode** (`E2E_REUSE=1` skips
   the build and would pass vacuously), and mirror §8 step 2's wording so the done condition
   requires confirming **both** that the run aborted **and** that `dist/`'s mtime is unchanged —
   not the mtime alone.
4. **Repair the two stale cross-references and renumber §9** (§3.4): §7 R1's "(§3.4.3)" should point
   at §3.4.4's deletion table; §3.4.1a:613-614's "a door §3.4.2 opens by advertising coexistence"
   describes a section that no longer exists in that form; and §9's `4b` should become `5` with the
   rest renumbered.

APPROVE WITH CHANGES

---

# Round 4

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-08-22
Plan revision reviewed: v4
Round: 4 — verification only

## 4.0 The four items

| # | Landed | Verified at |
|---|---|---|
| 1 | §3.4.0 rewritten around the page-load path | :564-592 |
| 1 | Swap instruction deleted from §3.4.0 and inverted in §7 OQ3 | :585-587, :1186-1189 |
| 2 | DC4b → DC5, reframed as a corroborating tripwire | :1335-1347 |
| 3 | DC3 requires abort **and** mtime, in default mode | :1327-1332 |
| 4 | §7 R1 repointed; §3.4.1a coexistence clause repaired; §9 renumbered 1-9 | :1112, :629, :1319-1354 |

**§3.4.0 (:564-592) is right, and better than what I specified.** It quotes `index.ts:58-61`
inline, states that prod-parity is consumed by every `page.goto("/")`, demotes beat 2 to "one
*additional* thing that path buys," and — the part I would not have thought to ask for — carries a
short retraction note at :589-592 recording that v3 asserted the opposite and why that was a booby
trap. Keeping the retraction visible is the right call: it stops the next reader "simplifying" the
section back to the wrong version.

**§7 OQ3 (:1186-1189)** now says the server keeps its justification, tells the reader not to swap,
and states that the entry previously said the opposite and was wrong. Correct.

**DC5 (:1335-1347) is better than my round-3 prescription.** All four corrections are in, and the
"structurally cannot contain this evidence either way, and ticking it from there would be a false
pass inside a plan about false passes" framing at :1340-1341 makes the *reason* portable rather
than just fixing the path. **DC3 (:1327-1332)** likewise carries both halves plus the default-mode
caveat.

## 4.1 The `§3.4.3` spot-check you asked for — and it found three survivors

I re-derived every `§3.4.x` reference against v4's actual headings rather than trusting the
changelog. **The reverted global replace is clean** — all twenty-odd live `§3.4.3` citations
resolve correctly to the mock-contract section, including the sub-part references (`(a)` at :280,
:1024, :1197, :1250; `(c)` at :791, :1026, :1125, :1172, :1336; `(d)` at :903; `(e)` at :375, :882,
:1129). §7 R1 (:1112) and the `CLAUDE.md` row now say the auth question is moot rather than
pointing anywhere, which is the right resolution. Nothing was left mangled.

**But the round-3 fix did not reach every site, and the same retracted claim survives in two more
places.** This is the identical failure mode to the one you described catching in the replace —
one claim, several homes:

1. **§3.2 E3:345-346 — the most consequential of the three.** Beat 2's justification still reads:
   *"It is also the **sole remaining justification** for `wrangler dev` being in this harness at all
   (§3.4.0) — so trimming it has consequences well beyond this file."* That is the retracted claim,
   and it **cites the rewritten §3.4.0 as its authority** — a reader who follows the pointer lands
   on text saying the opposite. It also sits in the E3 section, i.e. exactly where someone
   contemplating trimming E3 would read before acting. The corrected guidance is one section away
   and this sentence would send them past it.

2. **§3.3a:509 — B's honest ledger, item 4.** Still reads *"**`wrangler dev`'s justification narrows
   to a single beat.** See §3.4.0."* Same retracted claim, same broken pointer. Second-order
   consequence worth noticing: the ledger of "four things B loses" now books a loss **B does not
   incur**. Either drop item 4 (leaving three, which is still an honest ledger) or restate it as
   "no narrowing — see §3.4.0," so the ledger's arithmetic matches the section it cites.

3. **§3.3a:529 — a wrong cross-reference, and this one is my miss, not a v4 regression.**
   *"see §3.4.2's path collision"* — §3.4.2 is the `workerd` D1 lock note (:673-700). The path
   collision is **§3.4.3(a)** (:692-717). This was already wrong in v3 and I did not catch it in
   round 3 despite reading that block. Flagging it now rather than leaving it.

Note that (1) and (2) are invisible to a changelog check — the changelog correctly records that
§3.4.0 and §7 OQ3 were fixed, and both were. They are only visible by re-deriving, which is why
you were right to ask for it rather than for a confirmation.

## 4.2 One non-blocking note on §10

Historical entries in the revision log cite section numbers from the revision they describe — §10's
v2 entry cites `§3.4.3` for the auth path (:1463) and `§3.4.5` for the sweep (:1458), and its v3
entry row 9 says `wrangler dev` is "retained **solely** for beat 2" (:1390). That is legitimate for
a revision log, and I am not asking for it to be rewritten. But it does put the retracted claim on
the page a fourth time, where a skimmer could take it as current. One line at the head of §10 —
*"section numbers and claims in historical entries describe the revision they document, not the
current plan"* — would close it.

## 4.3 On the attribution

Noted, and I will not belabour it. The correction stands on `src/worker/index.ts:58-61` regardless
of who framed it. Worth recording only this, because it is a process finding rather than a
courtesy: the retracted claim propagated to **four** sites before anyone questioned it, and it
survived at two of them through a fix that everyone involved believed was complete. That is the
argument for verifying by re-derivation instead of by changelog — which is what caught it here, and
what caught the two CSS errors in round 1.

## 4.4 Status

Everything else is verified and closed. E1 beats 2-9, all of E2, §§3.4.1 / 3.4.1a / 3.4.2 / 3.4.3 /
3.4.6 / 3.5 / 3.6 / 3.7 / 4.2 / 4.2a / 4.2b / 5 / 6 / 8 / 9 are unchanged from the versions verified
in rounds 1-3 or corrected in this one. **No round 5 is required** — the three items below are
one-line edits with no design consequence. Fold them in and send it to the Coder.

---

## Required changes (round 4)

1. **§3.2 E3:345-346** — delete "the **sole remaining justification** for `wrangler dev` being in
   this harness at all" and the "consequences well beyond this file" clause. Replace with beat 2
   being the most explicit assertion against the `ASSETS` path, per the rewritten §3.4.0 (:583).
2. **§3.3a:509** — ledger item 4 still claims the justification "narrows to a single beat." Drop
   the item (a three-item ledger is still honest) or restate it so it agrees with §3.4.0.
3. **§3.3a:529** — "§3.4.2's path collision" should be **§3.4.3(a)**; §3.4.2 is the D1 lock note.
   Pre-existing in v3 and missed in my round-3 pass.

*Non-blocking:* add a one-line header note to §10 that historical entries use the section numbers
and claims current at the revision they describe (§4.2).

APPROVE WITH CHANGES

---

# Round 5

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-08-22
Plan revision reviewed: v5
Round: 5 — verification only

## 5.0 The three round-4 items

All three landed, and item 1 is handled better than I asked.

- **§3.2 E3:345-349.** The retracted claim is not merely removed — it is inverted, with the
  `index.ts:58-61` reason quoted inline rather than delegated to §3.4.0, and with the consequence
  spelled out where it will be acted on: *"Trimming this beat therefore costs the `sw.js` guard and
  nothing else; it does **not** license swapping the server for a static one."* A maintainer who
  reads only this section now gets the right answer without following a pointer. That was the whole
  problem with the v4 text, and it is closed.
- **§3.3a:512-515.** Ledger item 4 struck through and marked retracted, with the reason and a
  pointer to §3.4.0, and an explicit note that it is left visible so the ledger's arithmetic can
  still be audited. Better than deletion: someone checking whether B's costs were counted honestly
  can now see both the claim and its withdrawal, which is the point of an honest ledger.
- **§3.3a:535.** `§3.4.2` → `§3.4.3(a)`. Correct — §3.4.2 is the D1 lock note (:673-700), the
  collision is §3.4.3(a) (:692-717).

## 5.1 The sweep — re-derived, not confirmed

I extracted every `§n.n` cite in the document and diffed against the actual headings rather than
checking your two findings and stopping. Both check out:

- **`§3.4.5`** appears exactly once, at :1464, in the §10 v2 entry, now reworded to *"in the
  then-§3.4.5, since deleted with the rest of the seeded harness by the §3.3a ruling — the gap it
  described no longer exists, because there is no D1 state to sweep."* That is the right form: it
  preserves the historical record and tells the reader the concern is void, rather than leaving a
  dangling pointer to a live-sounding gap.
- **`§2.1` / `§2.2`** at :1399 and :1404 are both labelled "the review's §2.2" / "the review's own
  §2.1". Unambiguous.
- **Sub-part cites are normalised** — `§3.4.3(a)`, `(c)`, `(d)`, `(e)` throughout; I found no
  surviving bare-letter form.
- Every other internal cite resolves: §1, §1.1, §1.2, §1.3, §2, §3.1, §3.2, §3.3, §3.3a, §3.4,
  §3.4.0, §3.4.1, §3.4.1a, §3.4.2, §3.4.3, §3.4.4, §3.4.6, §3.5, §3.6, §3.7, §4.2, §4.2a, §4.2b,
  §4.3, §5, §5.1, §5.2, §6, §7, §8, §9 all exist as headings.

## 5.2 One refinement to the sweep method (non-blocking, no action required)

A cite can resolve to a real heading and still point at the wrong thing. Three bare cross-document
cites collide with this plan's own numbering:

- **:249** — *"`calendar-roving-tabindex.md` §9 check 1 — per **§5.2**'s third rung"*. The bare
  `§5.2` means `calendar-show-more.md` §5.2 (the falsification rule, established at :127). The plan
  has its own §5.2, *Security posture*.
- **:252** — *"`role`-mimicking div (**§5.2**)"*. Same referent, same collision.
- **:46** — *"risk R2 of `calendar-roving-tabindex.md` … (**§9**)"*. The plan has its own §9, *Done
  conditions*.

An existence-based sweep passes all three, because the headings exist. Each is recoverable in
context — the source document is named in the same sentence or cell, and :1286's `(§5.2)` genuinely
does mean the plan's own §5.2, correctly. So this is a readability nit, not a defect, and I am
**not** asking for a change.

I raise it only because it sharpens the rule you have adopted: **the sweep should check *referent*,
not just existence.** The mechanical version of that is cheap — flag any bare `§n.n` that matches a
local heading *and* occurs in a sentence naming an external document. It is the same failure mode
as the §3.4.0 booby trap (a pointer landing the reader on text about something else), several
orders of magnitude less serious.

## 5.3 On the method

Agreed, and worth stating once for the record since it is now the working rule: across five rounds
the artifact was wrong four times in ways the changelog was right about — the two CSS assertions
(round 1), `playwright-report/` as an evidence file (round 3), the retracted claim surviving at two
further sites (round 4), and the sub-part/deleted-section cites (your sweep). In each case the
changelog accurately described a change that had been made; what it could not describe was what
remained. Re-derivation is the only thing that sees the remainder.

## 5.4 Status — closed

Every required change from rounds 1-4 (16 + 10 + 4 + 3 = 33) is folded in and verified by
inspection of the plan text, not the changelog. Nothing is open.

The residuals that remain are **deliberate and labelled as such**, which is the correct end state
rather than a gap: ring *contrast* is not asserted (paired with the manual check in
`calendar-roving-tabindex.md` §9); no font-size floor in E2 (paired with
`calendar-show-more-report.md:56-58`); the `OccurrenceEntry` client-mirror ceiling on the drift
defence (§4.2b); the lost occurrence-range coverage (§3.3a ledger item 3); R2d's conditional
guarantee for E3; R8's possibility that E2 legitimately fails at 390px, with an escape hatch that
forbids weakening the assertion; and §6's honest statement that two of its four anti-rot measures
are norms rather than mechanisms because there is no CI.

The plan is implementable as written, its done conditions are checkable, and its known limits are
written down where the person who hits them will be standing. Send it to the Coder.

APPROVE
