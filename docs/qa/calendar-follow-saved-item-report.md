# QA Report: `calendar-follow-saved-item`

Plan: `docs/plans/calendar-follow-saved-item.md`
Impl notes: `docs/plans/calendar-follow-saved-item-impl-notes.md`
Component: `web/src/components/CalendarView.tsx` (+ `CalendarView.test.tsx`)

## Summary verdict

**PASS**

The manual browser check the Coder deferred is the whole point of this QA pass, and it confirms
the fix works exactly as designed: a moved non-recurring item is followed to its new month, a
recurring item's title-only edit does not disturb the grid, a same-month edit updates in place,
and the one documented exception (clearing recurrence while browsing a different month than the
series seed) behaves exactly as plan §3 predicts. R2b's narrower vanish case was also reproduced
and looks exactly as the plan describes — indistinguishable from a failed save, but now confined
to the "add a recurrence and move the date in the same save" case rather than every reschedule.
`npm run test:e2e` is green (6/6), `npm test -- CalendarView` is green (35/35, independently
re-run), and no console errors or network failures occurred during any scenario. See "Issues
found" for one UX observation on the documented exception (not a defect, a judgment call the
plan explicitly asked for) and one pre-existing nit unrelated to this feature.

## Environment / setup

- `pkill -f workerd` before starting (repo gotcha #1) — no stray process found.
- `npm run build` run before `npm run dev` (gotcha #2) — confirmed the dev server served the
  fresh `dist/` build (`main-Q_9C7O3m.js`, `main-DKOuuaMu.css`, matching the impl notes' hashes).
- `.dev.vars` already had `DEV_AUTH_IDENTITY` set; confirmed active via the
  `[dev-auth] shim active as juniwar.dev@gmail.com` log line and the Worker's binding table.
- `npx wrangler d1 migrations apply family-scheduler --local` → "No migrations to apply!".
- Created 5 fixture items via the UI's "+ New Item" (which calls `POST /api/items` per the
  repo's `list_id`-in-body convention) inside the pre-existing "QA Dev Auth Shim Test List":
  - `QA-N1-MoveMe` — non-recurring, Sep 10, 2026 (for the fix)
  - `QA-N3-SameMonth` — non-recurring, Sep 15, 2026 (for the same-month case)
  - `QA-N4-RecurringGuard` — weekly, seeded Aug 8, 2026 (occurrences land in September; for the
    guard)
  - `QA-Exception-ClearRecurrence` — weekly, seeded Aug 15, 2026 (separate item from N4 so
    clearing its recurrence didn't consume the guard fixture; for the documented exception)
  - `QA-R2b-AddRecurrenceMove` — non-recurring, Sep 12, 2026 (for R2b)
  All 5 were deleted afterward via `DELETE /api/items/:id` (all returned 204) through the app's
  own API rather than raw SQL, per this project's "cleanup pending dispatch rows before FK
  cascade deletes" convention (CLAUDE.md) — a manual `DELETE FROM items` would have bypassed
  whatever cleanup the route handler does.
- Independently re-ran: `npm test -- CalendarView` (35/35, matches impl notes), `npm run
  test:e2e` (6/6, matches impl notes). Did not re-run `npm run typecheck`/`npm run lint` since
  the impl notes' output was specific and verifiable (clean/0-errors-2-warnings) and the working
  tree is unchanged from what they describe (`git status --short` matched at both the start and
  end of this session, save for the two new/expected files).
- Dev server torn down with `pkill -f workerd` at the end (twice — once after the manual browser
  pass, once more after a short restart used only for fixture cleanup).

## Manual browser checks (Playwright MCP, the reason for this QA pass)

1. **The fix — PASS.** Opened `QA-N1-MoveMe` (Sep 10) from the calendar, clicked Edit, changed
   Start to Oct 5, clicked Save. The modal closed onto a grid whose heading read **"October
   2026"** with the chip visible on Oct 5. This reads unambiguously as a successful save — the
   exact defect (`docs/plans/calendar-follow-saved-item.md` §1) is gone. Confirmed via the
   `browser_snapshot` accessibility tree, not just visually.
2. **The guard — PASS.** Opened the September 19 occurrence of `QA-N4-RecurringGuard` (seeded
   Aug 8, weekly — confirmed via the view dialog: "Recurrence: Every week", "This is one
   occurrence of a repeating item"), clicked Edit (editor correctly pre-filled Start with the
   **series seed**, Aug 8, not the clicked occurrence), changed only the title to
   `QA-N4-RecurringGuard-Edited`, and saved. The heading stayed **"September 2026"** — no jump to
   August — and the renamed title appeared on all four occurrences in the September grid (Sep 5,
   12, 19, 26), correctly reflecting a series-wide edit.
3. **Same-month edit — PASS.** Opened `QA-N3-SameMonth` (Sep 15), changed the time from 10:00 AM
   to 3:00 PM (date unchanged), saved. Heading stayed "September 2026" throughout, and re-opening
   the item confirmed "Tue, Sep 15, 2026, 3:00 PM PDT" — the change landed and the grid did not
   move.
4. **The documented exception (plan §3) — PASS, and it happens exactly as specified.** With the
   grid on September, opened the Sep 19 occurrence of `QA-Exception-ClearRecurrence` (seeded Aug
   15, weekly), set Repeat to "Does not repeat" without touching the Start field, and saved. The
   grid navigated to **"August 2026"**, and the item now shows as a single, non-recurring
   occurrence on Aug 15 only (the September/other-month chips were gone on the next visit to
   September). This is the guard reading the post-save `rrule`: the item genuinely is
   non-recurring now, and its sole occurrence is the August seed, so by the fix's own logic the
   navigation target is "correct."
   **Judgment call requested by the task: this feels mildly jarring in practice**, more than the
   plan's prose fully conveys. The user's mental model when they open a chip is "I am editing the
   thing I am looking at, on Sep 19." Clicking Save and finding themselves rewound to August with
   no UI cue about *why* (no toast, no "moved to August" indicator) is a smaller version
   of the disorientation the original bug caused — the target is defensible, but the *lack of any
   affordance explaining the jump* is exactly what made the pre-fix bug feel like a failure, not
   the direction of navigation. I'd call this acceptable to ship (it's a genuine edge case:
   clearing recurrence on an item seeded in a different month than you're browsing), but if this
   exception turns out to be reachable more than incidentally, a one-line toast ("Moved to
   August — that's this item's only date now") would fully close the gap the plan leaves open.
   This is not a regression from the fix — the guard's job is to be a no-op unless the user
   changed the date *or* removed the recurrence, and it is exactly that.
5. **R2b (plan §6) — PASS (confirmed, and it looks as bad as described).** On
   `QA-R2b-AddRecurrenceMove` (Sep 12, non-recurring), changed Start to Oct 12 **and** set Repeat
   to Weekly in the same save. The modal closed onto a grid that stayed on **"September 2026"** —
   the item vanished from the September grid entirely (confirmed by re-inspecting Sep 12, which
   now shows only the unrelated recurring item). Navigating forward to October confirmed the save
   actually succeeded: the item is there, recurring weekly from Oct 12 (Oct 12, 19, 26 all show
   the chip). So this is a **real, successful save that a user watching the calendar would read
   as a failure** — the original bug, reproduced in the narrower case plan §6 R2b names. It looks
   exactly as bad as the pre-fix defect for this one case: no error, no toast, item just isn't
   where you left it and isn't where you are either. Explicitly accepted by the plan as unfixed
   (no correct navigation target exists for a newly-created series), so this is not a new defect
   introduced by the fix — it's the plan's own documented residual risk, confirmed present.
6. **Focus after navigating (plan §6 R1) — observed, as expected.** After the Test 1 navigation
   (Sep → Oct), `document.activeElement` was `<body>` (verified via `browser_evaluate`) — the
   originating Sep-10 chip had unmounted, so Radix's focus-restore had nothing to return to. This
   matches the plan's characterization exactly: inherited from the pre-existing close-onto-empty-
   grid behavior, not introduced by this fix, and not worth flagging as new. By contrast, closing
   the Sep-15 same-month-edit dialog with Escape *did* restore focus to its originating chip,
   confirming the distinction is specifically about the chip unmounting (different month), not
   about focus-restore being broken in general.

## Automated verification (independently re-run, not just trusted)

- `npm test -- CalendarView` → **35/35 passed** (30 pre-existing + 5 new: N1–N5), matching the
  impl notes exactly.
- `npm run test:e2e` → **6/6 passed** — `boot.spec.ts` (2), `calendar-density.spec.ts` (2),
  `calendar-keyboard.spec.ts` (2, chromium + chromium-dark). As the impl notes note, no e2e spec
  performs a save (all `/api/*` traffic is mocked via `page.route()` and the suite never reaches
  `ItemEditor`'s save path), so this run is a smoke check on the surrounding calendar/keyboard/
  boot behavior, not e2e coverage of the fix itself — the manual browser pass above is what
  actually exercises `onSaved`.

## Console errors and warnings

- One pre-existing warning (`apple-mobile-web-app-capable` meta tag deprecated) and one
  pre-existing 404 (`/favicon.ico`) on every page load — unrelated to this feature, present
  before this branch, not worth blocking on.
- No errors or warnings were introduced by any of the six manual scenarios above.

## Network failures and slow responses

- All `PATCH /api/items/:id` and `PUT /api/items/:id/reminders` calls across every save in this
  session returned `200 OK`. All fixture-creation `POST /api/items` calls returned `201
  Created`. All cleanup `DELETE /api/items/:id` calls returned `204 No Content`. No failed
  requests, no requests over ~20ms observed in the network panel.

## Accessibility observations

- The recurring-item view dialog clearly states "This is one occurrence of a repeating item.
  Editing changes the whole series." before the user commits to an edit — good, relevant context
  that makes the guard's behavior (editing one occurrence's title relabels the whole series)
  unsurprising once you've read it.
- Focus-to-`<body>` after a cross-month navigation (R1) is a genuine, if inherited, rough edge
  for keyboard/screen-reader users: after saving a moved item, a keyboard user has to re-discover
  where they are on the page rather than landing somewhere sensible (e.g., the new month's
  heading, or the moved item's new chip). Plan and prior QA (`ItemListView.test.tsx:211-233`)
  have already accepted this as correct-for-a-detached-trigger; noting it again here only because
  the task asked me to observe rather than be surprised by it, not because it's new.

## Performance notes

None. All interactions were sub-second; no jank observed navigating months or during save/reload.

## Screenshots

None captured — every check in this pass was resolved definitively via the accessibility-tree
snapshot (heading text, chip presence/absence, dialog field values), which is a stronger signal
than a screenshot for "did the grid navigate to the right month." No purely visual defect arose
that would need a screenshot to convey.

## Issues found

1. **UX nit — the documented exception (plan §3) navigates with no explanation, and could
   surprise a user more than the plan's prose implies.** Severity: low/informational, not a
   defect — this is exactly the judgment call the task asked for. Repro: view September, open a
   recurring item seeded in August, clear its recurrence without touching the date, save. Grid
   jumps to August with no toast or indicator of why. MCP used: Playwright.
2. **Pre-existing, unrelated: deprecated `apple-mobile-web-app-capable` meta tag warning and a
   404 on `/favicon.ico`.** Severity: cosmetic, present on every page load before this branch,
   out of scope for this feature. MCP used: Playwright (`browser_console_messages`).

Neither issue blocks the fix. R2b (plan §6) is a confirmed, plan-accepted residual limitation,
not a new issue — listed under "Manual browser checks" above rather than here because the plan
already names it as expected and unfixed.

PASS
