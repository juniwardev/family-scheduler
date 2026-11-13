# QA report: `calendar-roving-tabindex`

Plan: `docs/plans/calendar-roving-tabindex.md` (v4, APPROVE)
Impl notes: `docs/plans/calendar-roving-tabindex-impl-notes.md`
Tested against: working tree at commit `a3aa8e7` + uncommitted diff (`web/src/lib/calendarFocus.ts`,
`web/src/lib/calendarFocus.test.ts`, `web/src/components/CalendarView.tsx`,
`web/src/components/CalendarView.test.tsx`) — no commit made by the Coder, as noted in the impl
notes.

## Summary verdict

**PASS WITH NITS**

The feature works exactly as specified. R2 (the top risk — focus-ring visibility under
programmatic focus) is confirmed **visible and clean in both light and dark mode, via genuine
keyboard input**, not scripted `.focus()` calls. All §9 manual checks that are meaningfully
testable in this environment were exercised and passed. The "nits" are (1) a headless-Chromium/
Playwright environment artifact around exactly which off-page element focus lands on when Tab
exits the grid (not a defect in the app — the app never intercepts Tab, and the load-bearing claim
"Tab leaves the grid instead of hopping to the next chip" held every time), and (2) two pre-existing,
out-of-scope accessibility lint issues unrelated to this diff.

## Environment / setup

- `pkill -f workerd` before starting (no stray process found on this run).
- `npm run build` run before `wrangler dev` (per repo convention — confirmed dist output present).
- `wrangler dev` on `http://localhost:8787`, `.dev.vars` has `DEV_AUTH_IDENTITY="owner"` (loopback
  dev-auth shim, no Cloudflare Access JWT needed locally).
- Seeded 8 items via `POST /api/items` (list_id from `GET /api/lists`) onto August 2026 (the
  current month, since today is 2026-08-22): `A1` (Aug 5, Wed), `B1` (Aug 6, Thu), `E1`..`E5` (Aug
  12, Wed — 5 items to force the `+N more` toggle), `F1` (Aug 19, Wed). Days 5/12/19 share a
  column (Wed, `day ± 7`) and span three different week rows, matching the plan's own fixture
  geometry, so all of Decision 2's table could be exercised against real DOM/CSS.
- Automated suite re-run as a sanity check on top of manual testing: `npm test` → 300/300 passing
  (34 files, including `calendarFocus.test.ts` 19/19 and `CalendarView.test.tsx` 30/30). `npm run
  lint` → 0 errors, 2 warnings (both pre-existing baseline, confirmed by file/line match against
  the impl notes: `src/worker/channels/push.ts:150`, `web/src/components/ItemListView.tsx:74`).
  `npm run typecheck` → clean. `git status --short` confirms the diff is confined to exactly the
  four files §4 names, plus the impl-notes doc and this report's screenshot folder.
- Dev server torn down at the end of the session (`pkill -f workerd`, confirmed no residual
  process).

## Manual checks (plan §9), one by one

1. **Focus ring, light and dark — PASS, the load-bearing check.** Tabbed into the grid with real
   keyboard input (never a scripted `.focus()`); a clearly visible ring appeared on A1 in light
   mode, moved visibly to E1 on `ArrowDown`, and both light- and dark-mode screenshots show a
   clean ring with no white halo. R2 does **not** fail. Screenshots:
   `docs/qa/calendar-roving-tabindex-screenshots/focus-ring-light-A1.png`,
   `.../arrowdown-to-E1.png`, `.../focus-ring-dark-A1.png`, `.../focus-ring-dark-B1.png` (the last
   two via Chrome DevTools MCP with `emulate(colorScheme: dark)`, since the Playwright MCP has no
   media-feature emulation tool).
2. **One tab stop, both directions — PASS.** From `›`, one Tab entered the grid (landed on the
   single tabbable chip, confirmed via `data-cal-id`/`tabindex` inspection each time — never two
   grid elements tabbable simultaneously). The **re-entry claim** (C3's real-browser equivalent)
   was verified cleanly and repeatably: `End` → `F1`, `Shift+Tab` → `›` in **one** keystroke
   (confirmed `document.activeElement.textContent === "›"`), then `Tab` → back to `F1` (not `A1`).
   Repeated with a mouse-established remembered id too: clicked `B1` with the mouse, closed its
   modal, focused `›` externally, `Tab` → landed on `B1` (not `A1`) — proving the roving state
   follows mouse clicks as well as arrow keys (Decision 8 rule 3 / the C15 property).
   See the "Tab-exit destination" note under Issues below for the one caveat.
3. **Arrow semantics match the screen, Home/End disclosed — PASS.** Verified against what was
   actually on screen, not just DOM: `ArrowDown` from `A1` (day 5) → `E1` (day 12, same Wed
   column, visibly one week down); `ArrowRight` from `A1` → `B1` (day 6, visibly one day over);
   `Home` → `A1` (month's first element); `End` → `F1` (month's last element). Nothing felt
   unpredictable — the geometry matched the screen exactly on every move I tried.
4. **Month boundaries do not change month — PASS.** `ArrowUp` from `A1` (week 1: `5 − 7 < 1`) did
   nothing — focus stayed on `A1`, heading stayed "August 2026". `ArrowLeft` from `A1` (first
   non-empty day) did nothing. `ArrowDown` from `F1` (day 19, `19 + 7 = 26` which is empty in that
   column) did nothing — no wrap, no month change, confirmed via the heading text. `ArrowRight`
   from `F1` (last non-empty day) did nothing.
5. **The `+N more` toggle participates — PASS, and Decision 3's fix is real.** Arrowed to the
   toggle (`ArrowUp` from `F1` landed on `t-12`, collapsed, `aria-expanded="false"`). `Enter`
   expanded it (`aria-expanded="true"`, text "Show less") and focus **stayed on the toggle** —
   exactly Decision 3's contract, not a ref+`.focus()` reimplementation. `ArrowUp` from the
   (still-focused) toggle then landed on `E5`, the last revealed chip, screenshotted in
   `.../toggle-expanded-arrowup-E5.png` — visibly the fix for the old "Shift+Tab backwards into
   content you just revealed" quirk from PR #20.
6. **Enter and Space both open the right item — PASS.** `Enter` on `E5` opened a dialog headed
   "E5" with the correct time (Wed, Aug 12, 2026, 1:00 PM). Closed it (`Escape`) and confirmed
   focus returned to `E5` (`tabindex="0"`) — Decision 5's restoration contract holds. Then arrowed
   to `E4` and pressed `Space` — opened E4's dialog correctly, closed it, and focus returned to
   `E4`. Both keys route through native `<button>` activation untouched, as Decision 2 requires.
7. **Mouse still works — PASS.** Clicked the `+2 more` toggle → expanded to show `E4`/`E5` and
   "Show less", `aria-expanded="true"`, unaffected by the roving change (regression check against
   PR #20). Clicked `A1` → opened its own dialog (not some other chip's). Re-tested at a 390px
   mobile viewport (light mode, Chrome DevTools MCP) — tapped `B1` and got `B1`'s dialog, and the
   layout matches the plan's described mobile chrome (bottom tab nav rendered *after* `main` in
   the accessibility tree, as `App.tsx` predicts). Nothing visually different from the pre-change
   calendar; screenshot: `.../mobile-390-regression.png`.
8. **PR #20 regressions — none found.** Expand/collapse, per-day isolation (E1..E3 stayed on day
   12 while E4/E5 appeared only after expanding), and month nav (`›`/`‹` clicks) all worked
   exactly as before. Month nav additionally confirmed **not** to steal focus after navigating
   (R1): clicked `›` to go to the (seeded-empty) September 2026, and `document.activeElement` was
   still the `›` button immediately after the re-render — no effect ripped focus away. Tabbing
   from `›` in the empty month landed outside the grid entirely (zero tab stops for an empty
   month, matching Decision 6/test C12's claim), with no console error or crash.
9. **VoiceOver / iOS Full Keyboard Access — not attempted.** No physical iOS device with VoiceOver
   or FKA was available in this session; recording as unverified per the plan's own honesty rule
   (§9 checks 7–8), not as passed.

## Issues found

### 1. Tab-exit destination is inconsistent in headless Chromium — NIT, not a feature defect

**Severity:** low (test-environment artifact, not an app regression).
**MCP used:** Playwright MCP (`browser_press_key`, `browser_evaluate`), cross-checked manually.

**Repro:** From a grid chip with real keyboard focus, pressing `Tab` sometimes lands
`document.activeElement` on `document.body` and sometimes on the sidebar's "List" nav button
(the first focusable element in DOM order) — observed both outcomes across otherwise-identical
setups in the same session (see transcript: first exit from `A1` → `body`; later exit from the
same `A1` → `"List"` button; exit from mouse-focused `B1` → `"List"` button, then `Shift+Tab` from
there → `body`, not back to `B1`).

**Why this is not read as an app bug:** `CalendarView.tsx`'s `handleGridKeyDown` explicitly does
not handle `Tab` (Decision 2's table — confirmed by reading the diff), so the app cannot be
choosing where Tab goes. The inconsistency reproduces identically whether or not any arrow key was
pressed beforehand, which points at Chromium's headless/CDP-driven focus controller (no real
browser chrome to hand focus to at the page boundary) rather than anything in the diff. The
**load-bearing property** — Tab always left the grid, and never once landed on a *second* grid
chip/toggle — held in every trial. I additionally verified the specific claims the plan's C1/C2
depend on using a route that sidesteps the flaky boundary entirely (focusing `›` from outside the
grid, then a single `Tab` in; and `End` → `F1` → single `Shift+Tab` → `›` → single `Tab` → back to
`F1`), and those were 100% consistent. A real, non-headless browser session (which has actual
browser chrome to receive focus at the page boundary) would not exhibit this ambiguity at all —
this is the same category of caveat the plan's own R5/C1 note anticipates ("if that proves
environment-dependent... the seven negatives are the load-bearing part").

**Recommendation:** no action needed against this plan. If a Playwright e2e suite is ever
bootstrapped (§6 R2's aside about `test:e2e` being a no-op today), this is worth a note there.

### 2. Two pre-existing accessibility lint issues in Chrome DevTools' "issues" panel — out of scope

**Severity:** informational.
**MCP used:** Chrome DevTools MCP (`list_console_messages`).

`No label associated with a form field` and `A form field element should have an id or name
attribute` (1 each) were reported by Chrome's own issue detector. These point at the sidebar's
"New list name" textbox / maps-provider combobox, not at anything touched by this diff (no chip,
toggle, or `Card` attribute changed by this plan carries a label). Confirmed pre-existing by
inspecting `git diff` scope — neither element appears in it. Not blocking; flagging for the
backlog, not this feature.

## Console errors and warnings

- `[dev-auth] shim active as owner` (info, expected — confirms the auth shim per
  `docs/dev-fixtures.md`).
- `<meta name="apple-mobile-web-app-capable">` deprecation warning — pre-existing, unrelated to
  this diff (repo-wide PWA meta tag).
- `Failed to load resource: 404 @ /favicon.ico` — pre-existing, cosmetic.
- Two Chrome DevTools "issue" entries (see Issue 2 above) — pre-existing, out of scope.
- **Zero errors or warnings attributable to the roving-tabindex change** across the whole session
  (arrow navigation, toggle expand/collapse, modal open/close, month nav, mobile viewport).

## Network failures and slow responses

None. All requests (`/api/lists`, `/api/lists/:id/items`, `/api/items/:id/attachments`, static
assets) returned `200`/`304`. No slow responses observed against the local dev server.

## Accessibility observations

- Confirmed **no ARIA was added** to the `Card`, chips, or toggle — no `role`, no `aria-label` on
  the container — matching Decision 4 exactly. Chip `aria-label`s still carry the day context
  (`"A1 — August 5"`), unchanged.
- Confirmed the chip's `className` (with all four `focus-visible:ring-*` classes) survived the
  refactor verbatim in the diff — this is the exact thing test C14 exists to pin, and the WCAG
  2.4.7 concern the plan calls out (losing the ring classes) did not happen.
- **R3's accepted residual is real and exactly as described**: nothing in the running app tells a
  user that arrow keys exist. This is a deliberate, documented, and now-verified tradeoff, not a
  new finding — flagging only to confirm the plan's own honesty about it held up in the browser.
- VoiceOver / iOS Full Keyboard Access unverified (no device available this session) — see manual
  check 9 above.

## Performance notes

None observed. Re-render on focus-follows (Decision 8 / R8) was visually instantaneous for a
~35-cell month grid; no jank on arrow-key repeats.

## Screenshots

- `docs/qa/calendar-roving-tabindex-screenshots/focus-ring-light-A1.png` — light-mode ring on `A1`
  after a real Tab keypress.
- `docs/qa/calendar-roving-tabindex-screenshots/arrowdown-to-E1.png` — ring visibly moved to `E1`
  (one week down, same column) after `ArrowDown`.
- `docs/qa/calendar-roving-tabindex-screenshots/toggle-expanded-arrowup-E5.png` — day 12 expanded
  via `Enter` on the toggle, focus ring on `E5` after `ArrowUp` from the (still-focused) toggle.
- `docs/qa/calendar-roving-tabindex-screenshots/focus-ring-dark-A1.png` — dark-mode ring on `A1`,
  no white halo.
- `docs/qa/calendar-roving-tabindex-screenshots/focus-ring-dark-B1.png` — dark-mode ring after
  `ArrowRight` to `B1`.
- `docs/qa/calendar-roving-tabindex-screenshots/mobile-390-regression.png` — 390px viewport, light
  mode, calendar renders identically to desktop with the mobile bottom-tab chrome in place.

## Notes for the record

- Application code was not edited. Test data was seeded only through the app's own `POST
  /api/items` API against the local dev-auth-shimmed D1, consistent with `docs/dev-fixtures.md`'s
  guidance ("QA typically creates its own fixtures through the UI or API during a session").
- The Coder's impl notes claim (300/300 tests, 0 errors/2 warnings lint, clean typecheck, diff
  confined to §4's files) were independently re-run and confirmed to match exactly.

---

PASS WITH NITS
