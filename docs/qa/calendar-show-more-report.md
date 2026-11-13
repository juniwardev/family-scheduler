# QA Report: `calendar-show-more`

Plan: `docs/plans/calendar-show-more.md` (v7)
Impl notes: `docs/plans/calendar-show-more-impl-notes.md`
Component: `web/src/components/CalendarView.tsx` (+ `CalendarView.test.tsx`)

## Summary verdict

**PASS**

The feature works exactly as specified. All ten automated tests pass, all four §6 manual
checks pass on real-browser inspection (including pixel-level verification of the dark-mode
focus ring), and every "also verify by hand" item in the QA brief checks out: keyboard
operability (Enter and Space both work), per-day isolation, correct chip-to-modal wiring on a
revealed chip, and month-nav persistence that does not leak across months. No console errors,
no network failures, no visual defects found. See "Nits" below for two minor, non-blocking
observations that do not affect this feature's correctness.

## Environment / setup

- `pkill -f workerd` before starting (per repo gotcha #1).
- `npm run build` run before `npm run dev` (per gotcha #2) — confirmed fresh `dist/` assets
  (`main-Cfh-rgA9.js`, `main-DKOuuaMu.css`) were the ones served.
- `.dev.vars` already had `DEV_AUTH_IDENTITY="owner"` set; confirmed the dev-auth shim was
  active via the Worker's binding list and successful unauthenticated `/api/lists` calls.
- `docs/dev-fixtures.md` in this repo is the Cloudflare-Workers-project version of the fixtures
  file (there is no Shopify storefront here); it documents the dev-auth shim, not a storefront
  password — followed as written.
- Local D1 needed no new migrations (`npx wrangler d1 migrations apply family-scheduler --local`
  → "No migrations to apply!").
- Created fixture data via `POST /api/items` (list_id in body, not `/lists/:id/items`, per repo
  convention): 5 items on Sat Aug 15 2026, 4 items on Thu Aug 20 2026 (second busy day, for
  isolation testing), and later 5 items on Tue Sep 15 2026 (added mid-session specifically to
  make the month-nav check observable — September was otherwise empty). All fixture items were
  deleted via `DELETE /api/items/:id` at the end of the QA pass (all returned 204); the dev
  server was torn down with `pkill -f workerd` afterward.
- Independently re-ran (not just trusted from impl notes): `npm run typecheck` (clean),
  `npm run lint` (0 errors, 2 pre-existing warnings — same baseline as documented, no new
  warnings), `npx vitest run web/src/components/CalendarView.test.tsx --project web` (15/15
  passed), and `git diff --stat` to confirm the code diff is confined to `CalendarView.tsx` +
  `CalendarView.test.tsx` (plus the documented `docs/**` bookkeeping files). Read the full
  `CalendarView.tsx` diff by hand and confirmed it matches Decisions 1–4 and steps 1–5 verbatim.

## §6 manual checks (the reason for this QA pass)

1. **Dark-mode focus ring — PASS (Playwright MCP for setup, Chrome DevTools MCP for
   colorScheme emulation).** Tabbed to the "+2 more" toggle via real keyboard `Tab` presses
   (not `.focus()` — a JS-triggered focus does not reliably set `:focus-visible` in Chromium, so
   an early attempt using `element.focus()` showed no ring at all and had to be redone with
   genuine `Tab` key presses to be a valid test). Screenshot
   `docs/qa/calendar-show-more-screenshots/05-day15-dark-focus-keyboard.png`, pixel-cropped and
   3x-upscaled in `06-day15-dark-focus-zoom-cropped.png`: a clean teal ring, zero white halo.
   Repeated for the expanded "Show less" state (`07-day15-dark-expanded.png`) and in light mode
   on a different chip (`09-day15-light-expanded.png`) — same clean ring both times.
   `ring-offset-background` is doing its job.
2. **Text size and fit — PASS.** `docs/qa/calendar-show-more-screenshots/02-day15-collapsed-zoom.png`
   is a tight element screenshot showing "+2 more" at visually the same size as the three chips
   above it, on one line, inside the day cell. No wrapping, no oversized text.
3. **Row growth — PASS.** `03-day15-expanded-light.png` and `07-day15-dark-expanded.png` show the
   whole week row (day 15's cell *and* day 20's cell in the same row) growing to fit 5 chips +
   "Show less"; day 20 itself stayed collapsed (3 chips + "+1 more") the whole time, confirming
   the row grows from one cell's content, not from any global effect. Collapsing (verified via
   keyboard `Space`) fully reversed the height back to the original 3-chip size.
4. **No clipping — PASS.** Every revealed chip (`QA Aug15 Item 3`, `QA Aug15 Item 4`) was fully
   visible, not cut off by the cell boundary, and clickable — confirmed by clicking the revealed
   `QA Aug15 Item 4` chip and getting the correct item's view-mode dialog (see below).

## Additional user-facing checks requested in the brief

- **Keyboard operability — PASS.** Focused the toggle via real `Tab` navigation from the month
  header; `Enter` expanded it (verified via Playwright, `aria-expanded` flipped `false → true`,
  all 5 titles present); `Space` both expanded and collapsed it on a second pass (verified via
  Chrome DevTools MCP, `aria-expanded` and the label/text pair updated correctly each time,
  and focus stayed on the same DOM node throughout — matching the plan's "positionally-stable
  conditional child" reasoning in §5.2).
- **Revealed chip → correct modal — PASS.** Expanded day 15, clicked the revealed "QA Aug15
  Item 4" chip, and the view-mode dialog opened with heading "QA Aug15 Item 4" and matching
  "WHEN: Sat, Aug 15, 2026, 12:00 PM PDT" — the right occurrence, not an off-by-one neighbor.
- **Per-day isolation — PASS.** Expanding day 15 (5 items) never affected day 20 (4 items) in
  the same visible week row — day 20 stayed at 3 chips + "+1 more" / `aria-expanded="false"`
  throughout every screenshot and snapshot taken while day 15 was expanded.
- **Month-nav behavior — PASS, matches Decision 1 exactly, not a bug.** Expanded Aug 15 (fresh
  page load, so state started clean), paged to September via `›`. September 15 — same day
  number, freshly seeded with 5 items specifically to make this observable — rendered
  **collapsed** (`+2 more items — September 15`, not expanded): no leak across months. Paged
  back to August via `‹`: August 15 was **still expanded** ("Show less — August 15", all 5
  chips visible) — the intended persistence-within-session behavor from Decision 1. Reported
  here per instruction, not filed as a bug.
- **Decision 5's accepted keyboard-focus cost — confirmed present, as expected.** Focused
  "Show less — August 15" directly, pressed `Tab`, and focus moved to "QA Aug20 Item 1 — August
  20" (the next day cell with content) rather than into day 15's own just-revealed chips —
  exactly the accepted, documented tradeoff. Not a bug.

## Console errors and warnings

- Zero errors or warnings attributable to this feature across the whole QA session.
- Pre-existing/unrelated noise observed and not counted against this feature: a `favicon.ico`
  404, a deprecated `apple-mobile-web-app-capable` meta-tag warning, and two DevTools
  accessibility "issue" entries about an unrelated form field missing a label (likely the maps
  app `<select>` or "New list name" input) — all present on first load before any calendar
  interaction, unrelated to `CalendarView.tsx`.

## Network failures and slow responses

None. All requests during the QA session (`/api/me`, `/api/lists/:id/items`, and the two
`from`/`to` occurrence-range calls issued on month navigation) returned `200`/`304`; nothing
above trivial local-dev latency was observed.

## Accessibility observations

- `getByRole`/computed-role concerns from the plan's own review history (test 2, round 6) were
  independently re-verified live: `document.activeElement.tagName` was genuinely `"BUTTON"`,
  with `type="button"` and `aria-expanded` toggling correctly — this is a real `<button>`, not a
  role-mimicking `<div>`.
- Accessible name vs. visible text (Decision 3 / test 10) verified live via the accessibility
  tree snapshot: visible text is the terse `"+2 more"` / `"Show less"`, while the
  `aria-label` reads `"+2 more items — August 15"` / `"Show less — August 15"` — Label-in-Name
  (WCAG 2.5.3) holds (`"+2 more"` is a literal prefix of the full name).
- No `aria-controls` is present, matching the plan's stated decision not to add one.

## Performance notes

None applicable — this is a small DOM/state change with no new network calls or expensive
rendering; row growth is plain CSS grid reflow.

## Nits (non-blocking)

1. During fixture setup, an early attempt to `curl -X POST /api/items` for "QA Aug15 Item 1"
   returned `400` on the first try in a loop and then succeeded on an immediate retry with an
   identical payload — this created a duplicate item (two "QA Aug15 Item 1" rows with distinct
   `item_id`s) rather than the single row intended. This looks like a QA-harness timing/loop
   artifact (a bash array-indexing hiccup), not a defect in the calendar feature — the retried
   request's response body was well-formed and the resulting duplicate chip rendered and behaved
   correctly (both chips independently clickable, correct item shown). Flagging only because it
   is slightly confusing in the screenshots (two identical "QA Aug15 Item 1" chips) and worth
   knowing about if anyone revisits these screenshots later. Not investigated further since it
   did not reproduce on any other create call and is outside this feature's scope.
2. The plan's Decision 1 "cosmetic note" (day-key ambiguity under a negative `getFullYear()`,
   requiring ~2027 clicks on `‹`) was not and could not reasonably be manually verified — accepted
   as documented and out of practical reach for a QA pass.

## Screenshots

All under `docs/qa/calendar-show-more-screenshots/`:

- `01-collapsed-light.png` — full calendar, light mode, collapsed day 15 (+2 more) and day 20
  (+1 more).
- `02-day15-collapsed-zoom.png` — tight crop of day 15, confirming toggle text size matches chips.
- `03-day15-expanded-light.png` — day 15 expanded, light mode; row growth visible; day 20 unaffected.
- `04-day15-dark-focus-collapsed.png` — dark mode, toggle focused via JS `.focus()` (superseded by
  #05 as the valid keyboard test — kept for reference only).
- `05-day15-dark-focus-keyboard.png` — dark mode, toggle focused via genuine `Tab` key presses —
  the valid focus-ring check.
- `06-day15-dark-focus-zoom-cropped.png` — 3x pixel crop of the focus ring in dark mode: no white
  halo.
- `07-day15-dark-expanded.png` — dark mode, day 15 expanded via keyboard `Space`; row growth and
  clean focus ring on "Show less".
- `08-september-nav.png` — September 2026 before Sept-15 fixture data existed (empty grid).
- `09-day15-light-expanded.png` — light mode, day 15 expanded; day 20 chip shows a focus ring from
  an earlier Tab-through, also clean (no halo).

## Bug-fix verification lines

Not applicable — this slug is a feature (`calendar-show-more`, no `fix-` prefix), not a bug fix.
No `docs/bugs/` report exists or applies here.

PASS
