# QA Report: `feat/ui-redesign`

Date: 2026-07-12
QA branch under test: `feat/ui-redesign` @ `802da1d` (docs(ui-redesign): add implementation notes)
Environment: `npm run dev` (Wrangler local, D1 + R2 emulated) on `http://localhost:8787`, dev-auth shim
active as `juniwar.dev@gmail.com` (admin/owner role). Browser tool: **Playwright MCP** (Chromium),
used for the entire sweep — Chrome DevTools MCP was not needed this run (no network-timing or
performance-trace question came up).

## Summary verdict: **PASS WITH NOTES**

The redesign is cohesive and functions correctly end to end, including the highest-risk item (the
B1 deep-link NEW-1 invariant), which was verified **live in the browser**, not just via the unit
test. Light/dark and mobile/desktop render consistently with the teal "clean & calm" system across
every view. I found **one real regression-adjacent defect** (Start/End date-row overflow inside the
mobile Sheet, native `datetime-local` fields clip off-screen) that should be fixed before merge, plus
a handful of expected native-vs-shadcn visual nits. No console errors were introduced by this branch;
no network failures; no behavior regressions in create/edit/delete/complete, list selection, view
switching, deep link, attachments, notifications, or admin roster.

---

## View × light/dark × mobile/desktop sweep

| View | Light Desktop | Dark Desktop | Light Mobile | Dark Mobile | Notes |
|---|---|---|---|---|---|
| List (`ItemListView`) | PASS — `list-desktop-light.png` | PASS — `list-desktop-dark.png` | PASS — `list-mobile-light.png` | PASS — `list-mobile-dark.png` | Cards, badges, teal accent, complete-toggle strikethrough all themed correctly. |
| Calendar (`CalendarView`) | PASS — `calendar-desktop-light.png` | PASS — `calendar-desktop-dark.png` | not separately screenshotted (viewport only) | PASS — `calendar-mobile-dark.png` | Today highlighted in teal in both themes; event chips truncate with ellipsis on mobile. |
| Item form — Dialog (desktop) | PASS — `item-editor-dialog-desktop-light.png` | PASS — `item-editor-dialog-desktop-dark.png`, `item-editor-dialog-desktop-dark-scrolled.png` | n/a (Dialog is desktop-only) | n/a | Long form scrolls inside the Dialog; Save/Cancel reachable after scroll. See Defect 1 for the mobile Sheet issue. |
| Item form — Sheet (mobile) | n/a | n/a | **FAIL (see Defect 1)** — `item-editor-sheet-mobile-light.png`, `BUG-start-end-overflow-mobile.png` | not re-screenshotted after confirming the same defect persists (dark uses the same layout, same bug) | Full-screen Sheet renders correctly overall, but the Start/End row overflows the viewport. |
| Admin (`AdminPanel`) | PASS — `admin-desktop-light.png` | PASS — `admin-desktop-dark.png` | PASS (mitigated by design — table has intentional `overflow-x: auto`) — `admin-mobile-dark.png` | same | Active/Actions columns require horizontal swipe on mobile; this matches the plan's explicit mitigation (§9 edge cases: "ensure horizontal scroll... so it does not overflow"), so this is a nit not a defect — see Nit 2. |
| Notification setup (`NotificationSetup`) | PASS (in sidebar, `list-desktop-light.png`) | PASS (`list-desktop-dark.png`) | PASS (in Lists Sheet, `lists-sheet-mobile-light.png`) | PASS (`lists-sheet-mobile-dark.png`) | "Push notifications enabled." teal text; maps-provider select themed; second, fresh-session test showed the "Enable Push Notifications" button state also renders correctly. |
| Install banner (`InstallBanner`) | PASS (iOS UA emulation) — `install-banner-mobile-light.png` | not screenshotted separately (component doesn't reference light/dark-specific hardcoded colors beyond tokens; visually confirmed acceptable from the dark sweep of other bottom-fixed elements) | PASS — `install-banner-mobile-light.png` | not separately verified | Teal banner, readable text, "Dismiss" works and is idempotent (localStorage-backed). |
| Attachments — editor (`AttachmentsEditor`, inside Dialog/Sheet) | PASS (upload flow) | PASS — see Defect 2 (native file-input chrome) | PASS | PASS (same native-chrome nit) | Upload, list-with-Remove, "No attachments yet." empty state all correct. |
| Attachments — read-only (`AttachmentsView`) | PASS — `attachments-view-desktop-light.png` | not separately screenshotted (confirmed via snapshot the same session, themed background/cards) | not separately screenshotted | not separately screenshotted | Thumbnail renders correctly as an `<img>` inside a link to the attachment URL. |

Responsive breakpoint (~768px, sidebar ↔ bottom-tabs/top-bar) was exercised by resizing between
1200px and 390px viewports across the whole sweep — the switch is clean, with no duplicate state
and no remount glitches observed (matches the plan's CSS-breakpoint approach, not JS width
branching).

Native-vs-shadcn control cohesion: Type radios, all-day/task-complete checkboxes, the required List
`<select>`, and the location-kind `<select>` all render with intentional Tailwind-matched borders/
radius/height alongside the shadcn `Select` (Repeat, reminder unit, maps provider) — visually close
enough to read as one system in both themes on desktop and mobile (screenshots above). The one
exception is the native `<input type="file">`'s OS-chrome "Choose File" button, flagged as Nit 1
below.

---

## Behavior-regression table

| Flow | Result | Evidence |
|---|---|---|
| Create item (Dialog opens → fill → save) | PASS | Created "QA Test Event With Reminder" (event, with a reminder) and "QA Test All-Day Task" (task, all-day, with location) through the UI; both appeared correctly in the list immediately after Create. |
| Edit item | PASS | Opened Edit on "QA Test Event With Reminder"; existing title/location/reminder/attachment all pre-populated correctly; edited via Repeat=Weekly then Cancelled (discarded, confirmed no mutation). |
| Delete item | PASS | Deleted "QA Shim Smoke Test Item" via native `confirm()` dialog (unaffected by redesign, as expected); item removed from the list immediately. |
| Toggle complete | PASS | Toggled "QA Test All-Day Task" complete via the native checkbox; title strikethrough + muted row + faded Delete button applied correctly (`list-complete-toggle-desktop-light.png`). |
| List selection (sidebar desktop / Sheet mobile) | PASS | Created a second list ("QA Second List"), selected it (desktop sidebar): shown items switched to "No items in this list yet." empty state; verified the same selector inside the mobile Lists Sheet. Deleted the second list afterward (cleanup). |
| View switching (List/Calendar/Admin) via sidebar + bottom tabs | PASS | Verified both desktop nav row and mobile bottom-tab bar route through the same `activeView`; `aria-current`/active state visually consistent in both. |
| **Deep link `/?item=<id>` (B1 — highest risk, tested LIVE)** | **PASS** | Navigated to `/?item=<real-item-id>` fresh: editor Dialog opened exactly once showing "Edit Item" with the correct item's data (title, location, reminder, attachment). Clicked Cancel: dialog closed, no residual state. Switched to Calendar (no dialog). Switched back to List: **editor stayed closed** — confirmed via a full accessibility snapshot showing no `dialog` node and no "Edit Item" heading. This is the exact NEW-1 regression scenario and it holds correctly in a real browser, not just the unit test. |
| Attachments upload + read-only view | PASS | Uploaded a small PNG through the editor's native file input; it appeared in the editor's attachment list with a Remove button; after Save, the read-only `AttachmentsView` panel (expand "Attachments ▼" on the list row) rendered the image thumbnail correctly. |
| Deferred-persistence submit (Add reminder doesn't early-save; Save persists) | PASS | Clicked "+ Add reminder" while creating a new item — no network request fired until "Create" was clicked (confirmed via the network log: only one `POST`-equivalent flow around the eventual save; the reminder fields existed purely in local state beforehand). On Create, the reminder was correctly persisted ("1 reminder" shown on the list row immediately after). |
| Notification setup / Admin roster render | PASS | "Push notifications enabled." / "Enable Push Notifications" (fresh session) both rendered without error; Admin roster table rendered the single owner row with Active badge and disabled Deactivate button (can't deactivate self), correctly gated to the owner role. |

---

## Defects

### Defect 1 (Major) — Item-editor Sheet on mobile: Start/End date row overflows the viewport; the End field is unreachable without discovering hidden horizontal scroll
- **MCP used:** Playwright MCP (`browser_evaluate` for DOM measurement, `browser_take_screenshot` for visual confirmation).
- **Repro steps:**
  1. Resize viewport to 390×844 (mobile). Open the item editor (New Item or Edit).
  2. Observe the "Start \* / End" two-column row under the "All day" checkbox.
  3. Measure: the Sheet's scrollable content is `scrollWidth: 472px` vs `clientWidth: 390px` — an 82px horizontal overflow, all attributable to the `<div class="flex gap-3">` wrapping the Start/End fields, which has no responsive stacking (no `flex-col sm:flex-row`, no `flex-wrap`) and no shrink allowance for the native `datetime-local` input's intrinsic minimum width.
  4. The "End" field's bounding rect is `left: 254, right: 472` against a 390px-wide viewport — entirely past the right edge, reachable only via an undiscoverable horizontal swipe/scroll inside the Sheet.
- **Expected:** All form fields fit within the mobile viewport width (or wrap to a single column) with no horizontal scroll required, consistent with "clean & calm" and with how every other row in the form behaves.
- **Actual:** The Start/End row forces the entire Sheet content 82px wider than the viewport; a user must know to scroll sideways to reach/read the "End" label and field. Screenshots: `docs/qa/screenshots/item-editor-sheet-mobile-light.png` (End field visibly clipped at the right edge) and `docs/qa/screenshots/BUG-start-end-overflow-mobile.png` (scrolled to reveal the clipped End field and the "New Item" title clipped on the left as a result).
- **Likely component:** `web/src/components/ItemEditor.tsx` — the Start/End field wrapper (a `flex gap-3` row, per the Decision-5/§5.3 restyle). Needs a mobile-first stack (e.g. `flex flex-col gap-3 sm:flex-row`) or a `grid grid-cols-1 sm:grid-cols-2` swap so the two fields stack vertically below the `sm`/`md` breakpoint instead of forcing a fixed-width row.
- **Severity justification:** Major, not Blocker — the field is technically reachable via horizontal scroll and no data is lost, but this affects a frequently-used core form (every item's End time) on the primary mobile surface the redesign specifically targeted ("iPhone home-screen PWA" per spec goal #1), so it should be fixed before merge.

### Defect 2 (Nit, informational) — Native `<input type="file">` renders with un-themed OS-chrome "Choose File" button in dark mode
- **MCP used:** Playwright MCP (screenshot + `getComputedStyle` check).
- **Repro:** Open the item editor in dark mode, scroll to Attachments. The "Choose File" button (the browser's native `::-webkit-file-upload-button` pseudo-element) renders with default light-gray OS chrome, not matching the dark surface around it. The "No file chosen" text itself IS correctly themed (confirmed `color: rgb(228, 236, 241)` against the transparent input background — legible).
- **Expected/Actual:** Minor visual seam — a light button chip inside a dark dialog. Screenshot: `docs/qa/screenshots/item-editor-dialog-desktop-dark.png`.
- **Likely component:** `web/src/components/AttachmentsEditor.tsx` — the native file input is intentionally kept per the plan's M4/M5 mandate (test-DOM-structure dependency), so this is an accepted tradeoff, not a bug to "fix" without violating the native-control invariant. A CSS-only `::file-selector-button` style override (still a native input, just themed) would close this gap if desired — non-blocking.

---

## Visual-polish nits (expected/acceptable for a design-system migration)

1. **Native `<select>` vs shadcn `Select` size/chrome mismatch.** The two native selects (List, location-kind) and shadcn `Select` (Repeat, reminder unit, maps provider) are close in height/border/radius but not pixel-identical — the native selects show the OS-default caret glyph while shadcn shows a Lucide chevron. Acceptable per the plan's own N-A nit (native-vs-shadcn visual mismatch was called out and explicitly accepted as the tradeoff for behavior-safety).
2. **Admin table horizontal scroll on mobile has no visible scrollbar affordance.** Confirmed functional (`overflow-x: auto`, `scrollWidth: 560` vs `clientWidth: 356`) and matches the plan's explicit mitigation, but nothing signals to a first-time mobile user that the table extends further right (no shadow/fade edge cue). Low priority, cosmetic.
3. **Task-complete checkbox accent is browser-default blue, not the teal primary**, in both themes (`list-complete-toggle-desktop-light.png` — checkbox renders blue rather than `#4a9d8e`). This is standard behavior for a native, unstyled `<input type=checkbox>` (native checkboxes generally only take `accent-color`); a one-line `accent-color: hsl(var(--primary))` would align it with the teal system without giving up the native-control invariant. Non-blocking polish item.
4. **Dialog focus ring on List `<select>`** shows a green (teal) ring correctly on open — no issue, noted only because it's the one place a native control's focus state was directly compared against the Dialog's shadcn-styled siblings and it read as fully cohesive.

---

## Console errors and warnings

- **0 errors** attributable to this branch across the entire session (List/Calendar/Admin, both themes, both viewports, create/edit/delete/complete, deep link, attachments upload).
- One pre-existing, unrelated `[ERROR] Failed to load resource: 404 @ /favicon.ico` — not introduced by this migration (no favicon route exists in this project; out of scope).
- One pre-existing, unrelated `[WARNING] <meta name="apple-mobile-web-app-capable" content="yes"> is deprecated...` — a Chromium PWA-manifest deprecation notice unrelated to the Tailwind/shadcn migration (present in `web/index.html` before this branch); not introduced here.

## Network failures and slow responses

None observed. All `/api/*` calls during the session (`/api/me`, `/api/lists/:id/items`, `/api/items/:id/attachments`, item create/update/delete, attachment upload) returned `200 OK`. Static asset requests (`main-*.js`, `main-*.css`, manifest, icon) all `200 OK`. Build output confirms the new bundle sizes: **JS 310.48 kB (98.41 kB gzip)**, **CSS 26.62 kB (5.81 kB gzip)** — consistent with the ~174→310 kB JS growth noted in the task brief; this is the expected cost of Tailwind + shadcn/Radix and was not independently flagged as a problem (no slow-loading behavior observed on localhost).

## Accessibility observations

- `aria-current="page"` correctly applied to the active nav item in both the desktop sidebar and mobile bottom-tab bar (confirmed via snapshot; matches the plan's DC2 replacement for the removed `.btn-outline` assertion).
- Dialog/Sheet both trap focus and respond to Escape (confirmed: pressing Escape on the item editor closed it via the same cancel path as the Cancel button — no half-open state observed).
- Accessible names preserved exactly as the plan mandated: "Edit Item"/"New Item" headings, "Save"/"Cancel"/"Create" buttons, "+ Add reminder", "No attachments yet.", "Push notifications enabled.", "Add to Home Screen" copy in the install banner, "Admin — User Roster" heading — all present verbatim, matching what the preserved unit tests query.
- Theme-color meta pair confirmed present and correct: `#4a9d8e` for `(prefers-color-scheme: light)`, `#5cb3a3` for `(prefers-color-scheme: dark)`.
- `.dark` grep gate independently re-verified clean: `grep -rn "\.dark" web/src/components/ui web/src/index.css` returns only the two documentation-comment lines in `index.css`'s header, no live selector.

## Performance notes

- No Performance-panel trace was necessary this run (no jank, no slow paint observed locally; DevTools MCP was not invoked per the "use Playwright by default" guidance — nothing here warranted the heavier tool).
- Bundle-size increase (~174 kB → 310.48 kB JS, new 26.62 kB CSS bundle) is a known, accepted cost of the Tailwind + shadcn/Radix migration per the task brief; flagged here as an observation only, not a defect.

## Screenshots

All under `docs/qa/screenshots/`:
- `list-desktop-light.png`, `list-desktop-dark.png`, `list-mobile-light.png`, `list-mobile-dark.png`
- `calendar-desktop-light.png`, `calendar-desktop-dark.png`, `calendar-mobile-dark.png`
- `admin-desktop-light.png`, `admin-desktop-dark.png`, `admin-mobile-dark.png`
- `item-editor-dialog-desktop-light.png`, `item-editor-dialog-desktop-dark.png`, `item-editor-dialog-desktop-dark-scrolled.png`
- `item-editor-sheet-mobile-light.png` (shows Defect 1), `BUG-start-end-overflow-mobile.png` (Defect 1, scrolled to reveal clipped End field)
- `reminder-editor-mobile-light.png`
- `recurrence-weekly-desktop-light.png`, `repeat-select-open-desktop-light.png`
- `lists-sheet-mobile-light.png`, `lists-sheet-mobile-dark.png`
- `list-complete-toggle-desktop-light.png`
- `attachments-view-desktop-light.png`
- `install-banner-mobile-light.png`

---

## Notes on scope and constraints honored

- No application code was edited during this QA pass.
- Scope confirmed `web/src`-only per the task; calendar-click and custom-repeat were confirmed present-but-untouched (RecurrenceEditor's weekly/BYDAY UI renders and is restyled, but its logic was not exercised as a "new feature" — out of scope per plan, correctly deferred).
- Dev server was stopped at the end of the session (`wrangler dev` / `vite build --watch` / `concurrently` processes killed).

---

## Re-QA — admin sidebar nav overflow fix

Date: 2026-07-12
Scope: Focused re-verification of the desktop sidebar primary-nav overflow fix in `web/src/App.tsx`
only (not a full redesign re-sweep). Branch: `feat/ui-redesign` (working tree clean at time of test).
Environment: `npm run dev` on `http://localhost:8787`; dev-auth shim confirmed active via the log line
`[dev-auth] shim active as juniwar.dev@gmail.com` (owner/admin identity, per `.dev.vars`
`DEV_AUTH_IDENTITY="owner"` — this is the identity that reproduces the original bug since it renders
the 3rd "Admin" nav button). Browser tool: **Playwright MCP** (Chromium) for the entire re-QA — Chrome
DevTools MCP was not needed (no network-timing/perf question, and `browser_evaluate` gave sufficient
DOM-measurement precision).

**Pre-check note (environment, not app):** on first `npm run dev`, the Worker failed to start with
`SQLite failed... database is locked: SQLITE_BUSY` — caused by a stale `wrangler dev`/`workerd`
process left running from an earlier session, still holding the local D1 file lock (confirmed via
`ps aux` — a `wrangler dev` process from ~22:41 was still alive). Killed the stale process tree and
restarted cleanly; this was a leftover-process issue unrelated to the sidebar-nav fix and is noted
only for completeness. Also note: the actual dev port is `8787` (matches `docs/dev-fixtures.md`);
an earlier stray log line showing `8788` came from the same stale/conflicting process and is not
relevant once the stale process was killed.

### Verdict: **PASS**

The admin sidebar nav overflow bug is fixed. The Admin button (3rd nav item, admin-only) no longer
overflows or spills behind the main content. All three nav buttons (List, Calendar, Admin) render as
a vertical stack, fully contained inside the 256px desktop sidebar, in both light and dark mode.

### 1. Vertical stack / no overflow (desktop, ~1200px width)

Confirmed via accessibility snapshot: `navigation "Primary"` contains three `button` elements (List,
Calendar, Admin) as siblings with no wrapping container change — visually stacked per the
`flex flex-col gap-2` container and `w-full justify-start` button classes present in
`web/src/App.tsx` (lines ~154, 162, 171).

DOM measurement (`browser_evaluate`, light mode, 1200×900 viewport):

```
asideClientWidth: 255   asideScrollWidth: 255   (no overflow: scrollWidth == clientWidth)
navClientWidth:   223   navScrollWidth:   223   (no overflow)
asideRight: 256
List:     left 16, right 239, top  76, width 223
Calendar: left 16, right 239, top 116, width 223
Admin:    left 16, right 239, top 156, width 223
```

Identical measurements were re-taken in dark mode (`isDark: true` via
`window.matchMedia('(prefers-color-scheme: dark)').matches`) — same `255/255` and `223/223`
scroll-vs-client widths, same button rects. The Admin button's `right: 239` sits comfortably inside
`asideRight: 256` in both themes — no horizontal overflow, no spill past the sidebar border, no
painting behind the main content. This directly refutes the original bug ("3rd button overflowed the
sidebar width, spilling past the border and being painted over by the main content").

### 2. Nav buttons clickable, view switching correct, active state correct

Clicked all three buttons in both light and dark mode:
- **List → Calendar:** Calendar view rendered (`heading "July 2026"`, calendar grid with day cells,
  event chips on 7/11 for the two QA test items); `button "Calendar" [active]` in the snapshot
  (i.e. `aria-current="page"` applied).
- **Calendar → Admin:** Admin view rendered (`heading "Admin — User Roster"`, roster table with the
  owner row); `button "Admin" [active]` in the snapshot.
- **Admin → List** (repeated in dark mode after reload with `page.emulateMedia({colorScheme:'dark'})`):
  List view rendered correctly with the two QA test items; active state moved correctly on each
  click, verified fresh in dark mode as well (`button "Admin" [active]` confirmed again after
  clicking Admin in dark mode).

No stale/duplicate active state, no console errors introduced by any of the clicks (console stayed
at 0 errors / 1 pre-existing warning throughout).

### 3. Surrounding sidebar unaffected (brand header, list selector)

Confirmed in both themes via screenshot and snapshot: "Family Scheduler" brand heading + user email
render above the nav; the "LISTS" section (list picker, "+ " add-list control, "Enable Push
Notifications" button, "Maps app for addresses" select) renders correctly below the nav in both
light and dark, with correct theming (teal accent list swatch, dark surface/border colors in dark
mode). No layout shift or clipping introduced by the nav becoming a vertical stack.

### 4. Screenshots

Saved to `docs/qa/screenshots/`:
- `admin-sidebar-nav-fixed-light.png` — desktop, light mode, List/Calendar/Admin stacked vertically,
  fully inside the sidebar, "List" active (teal).
- `admin-sidebar-nav-fixed-dark.png` — desktop, dark mode, same layout, correctly dark-themed.

Both screenshots visually confirm: no button spills past the sidebar's right border (dashed vertical
divider at x≈256px in the screenshots), no overlap with the main content area's "QA Dev Auth Shim
Test List" heading/card.

### 5. Mobile bottom-tab nav sanity (~390px)

Resized to 390×844 (dark mode, carried over from step 2/4). Snapshot confirms a separate
`navigation "Primary (mobile)"` element fixed to the bottom of the viewport with all three tabs
present and correctly labeled for accessibility (`"List (bottom tab)"`, `"Calendar (bottom tab)"`,
`"Admin (bottom tab)"`), visible text unchanged ("List", "Calendar", "Admin"). Screenshot
(`docs/qa/screenshots/mobile-bottom-tabs-sanity-dark.png`) confirms all three render across the
bottom bar side-by-side as before — the desktop sidebar fix (scoped to the `<aside>` `flex flex-col`
container) did not touch or regress the separate mobile `<nav>` element, as expected since they are
two independent JSX blocks in `App.tsx` (lines ~162 and ~254).

### Other observations near the sidebar

- No new console errors or warnings introduced by this fix. Console total across the whole re-QA
  session: 0 errors, 1 warning (the same pre-existing, unrelated
  `<meta name="apple-mobile-web-app-capable">` deprecation notice already logged in the main sweep
  above) — consistent with the original report's baseline.
- No network failures observed (`/api/me` and list/item fetches all `200 OK` during this session).
- The fix is minimal and scoped exactly as described (container `flex flex-col gap-2` +
  `w-full justify-start` on each `Button`) — no incidental changes to the `ListSidebar` component,
  brand header markup, or mobile nav were detected.

### Summary for this re-QA

- **MCP used:** Playwright MCP only (navigation, snapshot, evaluate for DOM measurement, screenshots,
  emulateMedia for dark mode via `browser_run_code_unsafe`). Chrome DevTools MCP was not needed.
- **Bug status: FIXED.** Admin button no longer overflows the sidebar in either theme at desktop
  width; `scrollWidth <= clientWidth` holds for both the `<aside>` and the nav container ( both
  exactly equal, i.e. zero overflow, not just "under some tolerance"). View switching and active-state
  indication work correctly for all three nav items in both light and dark. Mobile bottom-tab nav is
  unaffected.
- **Dev server stopped** at the end of the session (`wrangler dev` / `vite build --watch` /
  `concurrently` processes killed); the earlier stale-process port conflict was resolved before
  testing and does not reflect an app defect.
