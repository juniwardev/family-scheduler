# QA Report — `item-archive` (branch `feat/item-archive`)

**Plan:** `docs/plans/item-archive.md` (v6, APPROVED)
**Impl notes:** `docs/plans/item-archive-impl-notes.md`
**Tester environment:** local `wrangler dev` (`localhost:8787`), dev-auth shim as `owner`
(`juniwar.dev@gmail.com`), local D1, real API — per `docs/dev-fixtures.md`.
**Browser tool used:** Playwright MCP for all functional testing (navigation, forms, snapshots,
console/network checks, screenshots). Chrome DevTools MCP was not needed — no network-timing,
performance, or deep-debugging surface came up. `wrangler d1 execute --local` (via Bash) was used
to directly inspect `items`, `item_reminders`, and `reminder_dispatch` rows where the browser
can't observe server-side state (dispatch purge/creation), and `curl .../cdn-cgi/handler/scheduled`
was used to manually fire the `*/5` cron locally per the project's own documented workaround
(wrangler does not auto-trigger scheduled workers in dev).

## Setup notes

- Followed the prescribed order: `pkill -f workerd` → `wrangler d1 migrations apply --local`
  (reported "No migrations to apply!" — the Coder's M1b rehearsal had already left local D1 fully
  migrated, consistent with the impl notes) → `npm run build` → `npm run dev`.
- **M1b (deploy-order rehearsal) was not re-run**, per the task brief — the Coder's own real run
  (captured in the impl notes) is taken as already-verified.
- `npm run test:e2e` was run after stopping `npm run dev` and confirming port 8787 was free, per
  `CLAUDE.md`'s "do not run dev and test:e2e concurrently" rule.

## Summary verdict

**PASS WITH NITS** — see below.

Every behavior explicitly named in the task brief was exercised in a real browser against the real
Worker/D1 and matched the plan exactly, including the two highest-value checks (the all-day
`ANCHOR_AT + 25h` gate, and the "reminders return only after a date edit" restore claim). No
console errors, no failed network requests, no dead buttons. The nits are all UX/polish
observations already flagged by the Coder as deliberate, out-of-scope, or unaddressed by the plan
— none of them are correctness defects.

## What was verified, and how

### 1. Archive round trip — PASS

Created a past timed event ("Past Timed Event", Fri Sep 18 2026 10:00 AM, with a 30-min
Email+Push reminder). Confirmed present in both the Active list and the Sept calendar grid.
Opened it **from the calendar** (chip → view modal) and clicked **Archive**:
- Modal closed immediately, no confirmation dialog.
- The chip disappeared from the calendar grid with no manual reload (confirms
  `CalendarView`'s `onArchiveChanged` → `setReloadToken`, not `setCurrentMonth`, per Decision 9).
- Active list view: item gone. Archived toggle: item present, row reduced to **View only**
  (no Edit/Delete), an "Archived" badge shown in the view modal, Restore + Duplicate buttons
  present, no Edit button.
- Clicked **Restore**: modal closed, Archived view refreshed to "No archived items." immediately.
  Active list and calendar grid both showed the item again, in its original slot (Sept 18).

Round trip confirmed working identically from both hosts (`ItemListView` and `CalendarView`),
matching the ownership table in plan §5.7/Decision 9.

### 2. The all-day gate (`ANCHOR_AT + 25h`) — PASS, the highest-value check

Verified local time was 22:36 PDT at test time — well clear of the plan's documented
00:00–01:00 danger window.

- Created an all-day event dated **today** (Sept 20, 2026). Opened its view modal: only
  **Edit** and **Close** were present — **Archive was absent, not disabled.** This is exactly
  the D1.1/D1.2 blocker fix and the UI-affordance decision (§4.5, "absence matches the existing
  row-action idiom") working as designed.
- Created an all-day event dated **two days ago** (Sept 18, 2026). Opened its view modal:
  **Archive was present** and worked.

This is a clean pass on the plan's stated blocker-fix and its highest-value verification target.

### 3. Recurring items cannot be archived — PASS

Created a weekly-recurring event with `start_at` three weeks in the past (Sept 1, 2026, well
past any plausible archive threshold). Opened its view modal: only **Edit** and **Close** were
present. No Archive affordance appeared regardless of how far in the past the anchor date was —
confirms the `rrule IS NOT NULL` exclusion is absolute, not date-gated.

### 4. Duplicate — PASS, all claimed semantics confirmed

Added a reminder (30 min, Email+Push) to the "two days ago" all-day item, archived it, then
clicked **Duplicate** from the Archived view. The resulting **create-mode** editor:
- **Prefilled from the archived item**: title, all-day flag, list selection, reminder (30 min /
  Email+Push, fully copied).
- **Landed on a sensible future date**: source was Sept 18 (all-day); current time was ~22:38 on
  Sept 20, so the source's local midnight for "today" had already passed — the editor correctly
  shifted to **Sept 21** (tomorrow), not "today" (which would have produced an immediately-dead
  reminder — exactly the failure mode §Decision 7 says the shift rule exists to prevent).
- **Attachments not copied**: the editor showed the standard create-mode hint ("Save the item
  first, then add attachments.") rather than any copy-from-source affordance. (Note: I could not
  test copying an *existing* attachment end-to-end — see Limitations below — but the UI-level
  claim, that Duplicate offers no attachment-copy path, is directly observable and confirmed.)
- **Saving created a new item, source untouched**: confirmed via direct D1 query
  (`wrangler d1 execute --local`) — two distinct rows with the same title exist after save, the
  original still has `archived_at` set (non-null) and its original `start_at` (Sept 18), the
  duplicate has `archived_at = NULL` and the new `start_at` (Sept 21), `rrule = NULL` on both.
  Also confirmed in the UI: the Archived view still shows the original; the Active view shows the
  new item with full Edit/Delete controls and its own "1 reminder" badge.

### 5. Reminders across archive/restore/reschedule — PASS, matches the plan's stated position exactly

Using the "Past Timed Event" item with its 30-min Email+Push reminder:
- **Before archiving**: `item_reminders` had 1 definition row (confirmed via D1 query).
- **After archiving**: `reminder_dispatch` had **zero** rows for this item (purge confirmed).
- **After Restore**: `reminder_dispatch` still had **zero** rows — restore performs no dispatch
  work, as Decision 8 states. `item_reminders` still had the definition intact (30 min,
  Email+Push) — the plan's "definitions survive, dispatch does not" claim held exactly.
- **After editing the date forward** (Sept 18 → Sept 25, a future date) and manually firing the
  local cron (`curl localhost:8787/cdn-cgi/handler/scheduled?cron=*/5 * * * *`, since wrangler
  dev does not auto-trigger scheduled workers): the worker log showed
  `[cron] materialize inserted=2 send={...}`, and a D1 query confirmed **two** new `pending`
  `reminder_dispatch` rows (Email + Push) at the new `fire_at`. This is byte-for-byte the §8.3
  "reschedule path" the plan describes — reminders return **only** after the date edit, with no
  archive-specific code involved.

This is exactly what the task asked me to check against reality, and reality matched the plan.

### 6. The dead-button shape — PASS

Every Archive/Restore/Duplicate control encountered was clicked and produced an observable,
correct effect (item moved between views/scopes, calendar chip appeared/disappeared, new item
created). No button was inert. Network trace confirmed every archive/restore/duplicate action
produced the expected `POST .../archive` (200) or `POST /api/items` (201) followed by a refetch
of the relevant list(s) — no case where a click did nothing.

## Judgement calls (not required by the plan, reported per the task brief)

- **The Archived view reads as a useful, legible place, not a dumping ground.** The Active/
  Archived toggle uses the same visual idiom as the primary nav (`aria-pressed`, filled vs.
  outline), is present at the top of the list on both desktop and mobile (390px checked via
  screenshot — see `docs/qa/item-archive-screenshots/mobile-list-view.png` and
  `mobile-archived-view.png`), and the empty state ("No archived items.") is distinct from the
  active empty state ("No items in this list yet."), so an empty Archived tab doesn't look like a
  bug.
- **Restore feels reasonably safe.** The view modal shows exactly what's being restored before
  the click (title, date, reminders, an explicit "Archived" badge), and Restore has no
  destructive side effect to hide — but there is **no confirmation step and no undo toast** on
  either Archive or Restore; both fire immediately on click. Given Restore is cheap and reversible
  by re-archiving, and Archive is cheap and reversible by restoring, this seems like a reasonable
  trade the plan made deliberately (§4.5 "considered action" reasoning is about requiring the
  view-modal detour, not about a second confirmation) — flagging only because the task asked
  whether it "feels safe," not because it's a defect.
- **Discoverability of Archive itself is a live tradeoff the plan already named and accepted**
  (§4.5's "accepted cost: a user may wonder where Archive went"): there's no Archive icon or
  affordance on the list row itself, and no in-app explanation of *why* the button is missing
  for a future item. I did not find this confusing once I understood the rule, but a first-time
  user hitting the all-day-today case would see no Archive button and no clue that it's
  time-gated rather than broken. Matches the plan's own accepted-cost note; not a new finding.

## Nits (non-blocking)

1. **"+ New Item" stays visible and enabled in the Archived scope** (impl notes' deviation #4,
   confirmed in browser). Creating from the Archived tab makes a new *live* item that doesn't
   appear in the tab you're looking at until you switch to Active. Mildly surprising but matches
   what the impl notes already flagged and chose not to fix; low severity.
2. **No confirmation/undo affordance on Archive or Restore** — both are single-click, immediate,
   no toast. Not a plan violation (the plan's "considered action" argument is about the view-modal
   detour, not a second confirm), but worth a product backlog note if the owner later reports
   mis-clicks.

## Limitations of this pass

- **Attachment-copy-on-duplicate was not end-to-end tested with a real uploaded file.** The
  Playwright MCP session's file-chooser modal (triggered by the "Choose File" input) has no
  corresponding upload tool in this tool set (`browser_file_upload` is referenced by the tool's
  own error message but is not present among the available Playwright MCP tools), and attempting
  to dismiss the file-chooser modal state deadlocked several subsequent tool calls until I opened
  a fresh tab and closed the stuck one. I verified the **structural** claim instead (Duplicate's
  create-mode editor shows the standard "save first" attachments hint rather than any
  copy-from-source UI), which is what's directly observable in the browser, but did not verify
  that an attachment physically present on an archived source is excluded from the duplicate's
  payload at the network/DB level. Given NG4 is enforced by the *absence* of any code path to do
  the copy (confirmed by reading `duplicateItem.ts`'s twelve explicit `ItemDraft` fields in the
  impl notes, and Decision 7's "no new server surface" constraint), and the Coder's own unit tests
  (`duplicateItem.test.ts`, T23) presumably cover this at the unit level, I'm not flagging this as
  a gap in coverage severe enough to change the verdict — but noting the limitation rather than
  silently claiming full coverage.
- **Dark mode was not verified.** The Playwright MCP tools available in this session don't expose
  a `prefers-color-scheme` emulation call (unlike `mcp__chrome-devtools__emulate`, which does, but
  I judged this not worth an MCP-switch for a feature that adds no new dark-mode-sensitive
  styling — the "Archived" badge and Active/Archived toggle both reuse the existing `Badge`/
  `Button` primitives, which are already dark-mode-covered by the rest of the app).
- **M1b (the deploy-order rehearsal) was not re-run**, per the task brief's explicit instruction —
  the Coder's own real run is taken as already-verified.
- **The Coder's independently-run gates (typecheck, lint, unit tests, sabotage checks on the 25h
  constant) were not re-run**, per the task brief.

## Console errors and warnings

- Zero console errors during any functional test.
- One pre-existing, unrelated warning throughout: `<meta name="apple-mobile-web-app-capable">
  is deprecated` — present on every page load, unrelated to this branch.
- One 404 on `/favicon.ico` on first load — pre-existing, unrelated.

## Network failures and slow responses

- Zero failed requests across the entire session. All `/api/*` calls involved in archive/restore/
  duplicate/edit returned 200/201 in single-digit-to-low-double-digit milliseconds (local dev, as
  expected). Verified via `mcp__playwright__browser_network_requests` and the `wrangler dev`
  worker log.

## Accessibility observations

- Active/Archived toggle uses `aria-pressed` correctly (confirmed in the accessibility-tree
  snapshot: `button "Active" [pressed]` / `button "Archived" [pressed]` toggling correctly).
- Archive/Restore/Duplicate/Edit/Close buttons are all real `<button>` elements, keyboard-focusable
  and present in the snapshot tree with clear accessible names — no icon-only or unlabeled
  controls introduced by this feature.
- Matches the plan's explicit rejection of a disabled-button-with-tooltip pattern for the
  time-gated Archive control (§Decision 5) — a real accessibility win, since disabled buttons with
  tooltips are unreachable by keyboard/touch, which the plan called out as the reason for the
  absent-not-disabled choice.

## Performance notes

None — this is a small, low-traffic local feature; no performance concerns observed or expected.
No trace was taken (not warranted for this change).

## e2e suite

```
npm run test:e2e
...
  ✓ 1 [chromium] › e2e/archive.spec.ts:25:7 › archive / restore / duplicate round trip (E1)
  ✓ 2 [chromium] › e2e/boot.spec.ts:39:7 › boot (E3) › beat 1
  ✓ 3 [chromium] › e2e/boot.spec.ts:56:7 › boot (E3) › beat 2
  ✓ 4 [chromium] › e2e/calendar-density.spec.ts:118:9 › desktop (1280x800)
  ✓ 5 [chromium] › e2e/calendar-density.spec.ts:140:9 › mobile (390x844)
  ✓ 6 [chromium] › e2e/calendar-keyboard.spec.ts:41:7 › roving tabindex ...
  ✓ 7 [chromium-dark] › e2e/calendar-keyboard.spec.ts:41:7 › roving tabindex ...

  7 passed (7.4s)
```

## Screenshots

- `docs/qa/item-archive-screenshots/mobile-list-view.png` — 390×844, Active tab, showing the
  toggle placement and all four test items created during this session.
- `docs/qa/item-archive-screenshots/mobile-archived-view.png` — 390×844, Archived tab, empty
  state after the Restore test.

## Final verdict

**PASS WITH NITS**

---

# §9 amendment (2026-09-21)

**Scope of this amendment:** verifies plan `docs/plans/item-archive.md` §9 (A9.1 scope-switch,
A9.2 confirmation, §9.2.1, §9.4 manual-check amendments) against
`docs/plans/item-archive-impl-notes.md`'s §9 section, branch `feat/item-archive`, tip `7bba724`
plus the uncommitted §9 working tree at the start of this pass. This section is additive — the
§§1–8 report above is left untouched as the record of that pass.

**Already independently verified before this pass (per the task brief, not re-run by me):**
typecheck, lint, `npm test` (385/39), `npm run build`, `npm run test:e2e` (7/7), sabotage of the
scope-switch placement (confirmed the fix lives in `onSaved`, not a per-handler patch — moving it
into the "+ New Item" `onClick` fails T31 and T36 while T32 stays green), and dark mode at 390px
(Archived view, toggle, badge, buttons).

## Setup notes (this pass)

- `pkill -f workerd` → `npx wrangler d1 migrations apply family-scheduler --local` → "No
  migrations to apply!" (0007 already applied from the §§1–8 pass) → `npm run build` → `wrangler
  dev` in the background, `.dev.vars` already had `DEV_AUTH_IDENTITY="owner"`.
- Reused the real D1 state left over from the §§1–8 QA pass (a "Test List" with several fixture
  items, including a leftover all-day item mislabeled "All Day Two Days Ago" now dated *today*
  relative to the new session date, Sept 21 2026 — a stale label from a prior session, not a
  defect; not touched).
- Local clock at test time: Mon Sep 21 2026, 08:18–08:20 PDT — outside the plan's documented
  00:00–01:00 all-day-gate danger window (irrelevant to this pass anyway; M3 was not re-run, it's
  unchanged by §9).
- Playwright MCP `browser_handle_dialog` was used for every `confirm()` encountered, per the
  task's explicit warning that an unhandled dialog auto-dismisses and reads as "still broken."
  Every dialog in this session was intercepted before it could auto-dismiss.

## What was verified, and how

### A. All three create entry points switch scope from Archived → Active — PASS

This was the highest-value check per the task brief, and a build that patched handlers
individually (rather than the shared `onSaved` convergence point) would pass some doors and fail
others. All three passed:

1. **Entry point 1 — the list's "+ New Item" button.** From Archived scope, clicked "+ New Item",
   filled title "Entry Point 1 Item", clicked Create. Result: scope control flipped to
   `Active [pressed]`, "Entry Point 1 Item" visible in the Active list. **PASS.**
2. **Entry point 2 — the mobile top-bar "+ New" (`createRequestToken`).** Resized viewport to
   390×844 (mobile layout, confirmed bottom-tab nav + top bar rendered), switched to Archived
   scope, clicked the top-bar "New" button. Result: same create-mode editor opened; filled title
   "Entry Point 2 Item", clicked Create; scope flipped to `Active [pressed]`, new item visible.
   **PASS.** This is the door the plan calls out as "plausibly the primary create affordance on
   an iPhone" and the one a per-handler patch would miss — confirmed working.
3. **Entry point 3 — Duplicate from an archived item.** Resized back to 1280×900, switched to
   Archived, opened the one remaining archived item ("All Day Two Days Ago", Sept 18 — its "type"
   row correctly showed an "Archived" badge), clicked Duplicate. The create-mode editor opened
   correctly prefilled (title, all-day flag, reminder 30 min/Email+Push, start date shifted to
   Sept 22 — tomorrow, since the source's own Sept 18 midnight had long passed, matching the
   Decision 7 date-shift rule). Clicked Create: scope flipped to `Active [pressed]`, the new item
   ("All Day Two Days Ago", Sept 22) appeared in the Active list with full Edit/Delete controls,
   and the original stayed correctly under Archived. **PASS.**

All three land the user in Active with the new item visible, exactly as A9.1 requires. This is
strong evidence the fix genuinely lives at the shared `onSaved` convergence point rather than
being duplicated (or missing) per door, consistent with what the code shows (see "Code read"
below) and what the impl notes' sabotage run demonstrated.

### B. Restore does NOT switch scope — PASS (the deliberate asymmetry)

From the Archived scope, opened the Sept 18 item and clicked Restore, accepted the confirm.
Result: item left the Archived list (now "No archived items."), and — critically — the scope
control **stayed on `Archived [pressed]`**; it did not flip to Active. This is exactly A9.1's
stated asymmetry ("Restore is the write this actually constrains... must leave the scope alone")
and matches T32. **PASS.**

### C. Both confirms work, and cancelling is a true no-op — PASS

- **Archive, cancel path.** Opened a live, past-dated all-day item (Sept 18), clicked Archive.
  Dialog message read exactly `Archive "All Day Two Days Ago"?` (item name + direction, per the
  plan's copy requirement). Dismissed with `browser_handle_dialog({accept:false})`. Verified via
  `browser_network_requests`: the request log ended at the pre-existing `GET .../attachments` call
  — **no `POST .../archive` was fired**. A follow-up snapshot showed the item still listed under
  Active, still un-archived, and the view modal still open with all its original content (Edit /
  Archive / Close buttons, reminder list, etc.) — a true no-op.
- **Restore, cancel path.** Same item, now archived; opened it, clicked Restore. Dialog read
  `Restore "All Day Two Days Ago"?`. Dismissed with `accept:false`. Network log showed no new
  `POST .../archive` call after the dismissal. The item remained under Archived, unchanged, modal
  still open.
- **Accept path, both directions.** Re-ran both Archive and Restore with `accept:true` and
  confirmed the full round trip completed exactly as the §§1–8 report already established (item
  moves between Active/Archived, calendar/list stay in sync). **PASS.**

### D. Cancel-path focus check (§9.4 / M2d) — PASS, and this is the one most likely to fool a naive check

After dismissing the Archive confirm, `document.activeElement` evaluated to the `<button>` element
whose text content was `"Archive"` — the exact button that opened the dialog — confirmed by
`browser_evaluate` returning `{tag: "BUTTON", text: "Archive"}`, and independently corroborated by
the snapshot marking that same button `[active]`. Repeated for Restore: `document.activeElement`
was the `<button>` with text `"Restore"`. In neither case did focus land on the Radix dialog
container or fall to `<body>` — both of which the plan calls out as the realistic failure modes
that a looser assertion ("somewhere sensible") would let through. **PASS**, and specifically not
vacuously so: this check would have failed (activeElement would read as `DIALOG` or `BODY`) had
the `handleCloseAutoFocus`/`triggerRef` wiring in `ItemModal.tsx` regressed.

### E. M2 / M2b / M2c — runnable as written, followed literally — PASS

Ran the archive-from-list (M2-equivalent), archive-from-calendar (M2c), and restore (M2b) steps
exactly as the amended plan text now reads — "click Archive/Restore **and accept the
confirmation**":
- **M2c, from the calendar specifically.** Navigated to Calendar view, found the "All Day Two
  Days Ago — September 18" chip (restored from step B, so it was back on the grid), opened it,
  clicked Archive, confirm dialog appeared with the same `Archive "..."?` message, accepted it.
  The chip disappeared from the grid **with no manual refresh** — confirmed by
  `browser_find` returning zero matches for "September 18" immediately after. **PASS**, and
  followable literally now that the "…and accept the confirmation" text is in place — before §9.4
  edited these steps in place, a QA engineer running the old prose would have clicked once, seen
  the dialog block, and (in an automated context) had it silently auto-dismissed, reading as "the
  chip never disappeared" — precisely the misdiagnosis §9.2.1 warns about. I did not attempt to
  re-run the literal *pre-amendment* wording to reproduce that misdiagnosis (the task didn't ask
  for it and the plan text is already corrected), but the mechanism checks out from the dialog
  behavior observed directly.
- M2 (list) and M2b (restore) were exercised as part of checks A/B/C above and match their
  amended wording.

### F. Code read — confirms the mechanism matches what was observed

- `web/src/components/ItemModal.tsx:190-200` (`handleSetArchived`): `if (!confirm(...)) return;`
  before any state mutation or `setItemArchived` call — cancellation is unconditionally a no-op,
  matching what was observed in the browser (no request, no state change).
- `web/src/components/ItemListView.tsx:256-263` (`onSaved`): `itemModal.close(); if (scope !==
  "active") { setScope("active"); } else { refresh(); }` — a single branch at the one place all
  three create doors and Duplicate-save converge, matching A9.1's placement requirement and the
  observed behavior in checks A/B.

## Issues found

1. **[NIT, cosmetic] Triplicated comment block in `ItemListView.tsx`.** The explanatory comment
   directly above the `onSaved={...}` prop (`web/src/components/ItemListView.tsx:220-255`) is
   **repeated verbatim three times in a row** — the same ~12-line block explaining the §9.1
   convergence-point rationale appears at lines 220–231, 232–243, and 244–255, before the single
   `onSaved={...}` handler at line 256. This has no runtime effect (it's a comment) and did not
   affect any test or behavior observed in this pass, but it reads as a copy-paste/tooling
   artifact from the amendment's editing process and is worth a one-line cleanup pass before this
   branch is considered fully tidy. Found via `grep`/`Read` while confirming the `onSaved`
   mechanism (check F above), not via the browser. Severity: cosmetic, non-blocking.

No functional defects were found. No console errors, no failed network requests, and every
network request observed matched what the UI action should have produced (a single `POST
.../archive` per accepted confirm, zero extra requests per cancelled one).

## Console errors and warnings

- Zero console errors throughout this pass (`browser_console_messages({level: "error"})` returned
  0 entries at the end of the session).
- Same one pre-existing, unrelated warning as the §§1–8 pass: `<meta
  name="apple-mobile-web-app-capable"> is deprecated`.

## Network failures and slow responses

- Zero failed requests. Every accepted confirm produced exactly one `POST
  .../api/items/:id/archive` → `200 OK` (three observed: initial Archive, Restore, and the
  calendar-triggered Archive), each followed by the expected scoped refetch(es). Every cancelled
  confirm produced **zero** additional requests, confirmed by diffing
  `browser_network_requests()` immediately before and after each `browser_handle_dialog({accept:
  false})` call.

## Accessibility observations

- Both confirms are native `confirm()` dialogs, which are inherently keyboard/screen-reader
  accessible by the browser's own chrome — consistent with the plan's stated reason for reusing
  this idiom rather than a custom Radix `AlertDialog`.
- The cancel-path focus return (check D) is a genuine accessibility win over the naive Radix
  default: without `ItemModal.tsx`'s `handleCloseAutoFocus`/`triggerRef` wiring, a keyboard user
  dismissing the dialog would land back on an unpredictable element (the dialog container or
  `<body>`) and have to re-tab to find the control they just used. Observed working correctly for
  both Archive and Restore.
- `aria-pressed` on the Active/Archived toggle correctly reflects state through every scope switch
  exercised in this pass (create-from-Archived, Restore-stays-in-Archived), confirmed via
  snapshot `[pressed]` markers at each transition.

## Performance notes

None new. This is a small client-side branch; no trace was taken.

## Judgement call: does confirming Restore feel right?

Asked for directly by the task brief. Having now used it: **no, and the plan's own escape hatch
("if it proves annoying in use, remove Restore's, keep Archive's") is the right call to make.**
Restore already carries meaningful friction before the confirm even fires — it's gated behind
opening the item's view modal, which itself requires switching to the Archived scope and finding
the item. By the time a user reaches the Restore button they have already made two deliberate
navigation choices; a third click-and-confirm for a fully reversible, non-destructive action reads
as friction without a matching safety benefit. Archive's confirm earns its place differently: it's
reachable from a single click inside a modal a user may have opened for an unrelated reason (View
a past item), and archiving hides the item from the default view, so a beat of "are you sure" has
a real job to do. Restore has no comparable "oops" to guard against — the worst case of an
accidental Restore is that the item briefly reappears in Active, which is exactly as recoverable
as the archive it undid. My recommendation, offered as the first real user of this control: drop
the confirm on Restore, keep it on Archive. This is a judgement call, not a defect — nothing here
changes the verdict below, since the plan explicitly anticipated this exact possibility and shipped
the symmetric version deliberately, with the asymmetric one on record as the fallback.

## Attachment-duplication — correctly out of scope, not tested

Per the task brief, this was split to its own backlog item and was not built here. Confirmed
nothing in the §9 diff (`ItemModal.tsx`, `ItemListView.tsx`, or the impl notes' "Files changed"
list) touches attachment handling. Not exercised in this pass, as instructed.

## Screenshots

None new for this amendment — the confirm-dialog and focus-return checks are DOM/network-state
assertions (`browser_evaluate`, `browser_network_requests`), not visual ones, and the affected
surfaces (toggle, badges, buttons) were already screenshotted in the §§1–8 pass with no styling
changes in §9.

## §9 amendment verdict

All three owner decisions from the task brief were verified working exactly as specified:
scope-switch-on-create from all three doors, Restore's deliberate non-switch, and both confirms
(including the true-no-op cancel path and the cancel-path focus-return guard, which is the check
most likely to silently regress). M2/M2b/M2c/M2d are runnable as amended. One cosmetic nit found
(triplicated comment block, no functional impact) and one judgement call offered (drop Restore's
confirm) — neither rises to a blocking defect.

**PASS WITH NITS**
