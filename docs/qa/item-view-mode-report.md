# QA Report: `feat/item-view-mode`

Date: 2026-08-21 (session run 2026-08-22 per environment clock)
Branch under test: `feat/item-view-mode` (uncommitted working tree on top of `main` @ post-`daf7e28`)
Environment: `npm run dev` (Wrangler local, D1 + R2 emulated) on `http://localhost:8787`, dev-auth
shim active as `juniwar.dev@gmail.com` (`DEV_AUTH_IDENTITY="owner"`, admin/owner role). Browser
tools: **Playwright MCP** (Chromium) for the primary flow sweep (desktop Dialog dismissal paths,
mobile Sheet dismissal paths, R9 occurrence-range check, keyboard chip activation, deep link/NEW-1,
completed-task hover CSS check, touch-target measurement) and **Chrome DevTools MCP** for
`prefers-color-scheme: dark` emulation (Playwright MCP has no color-scheme emulation primitive) and
for the focus-visible ring / `ring-offset-background` dark-mode halo check, which needed a
`:focus-visible`-accurate keyboard-focus sequence. Both are noted per-issue below.

Automated gates were **not** re-run (per instructions) — `npm run typecheck` (clean),
`npm run lint` (0 errors / 2 pre-existing warnings), `npm test` (244/244) were taken as verified by
the Coder. This report covers exactly what jsdom cannot: real desktop `Dialog` rendering, real CSS
(hover strike-through, dark-mode focus rings), real keyboard focus/`:focus-visible` behavior, and
live network/console behavior.

## Summary verdict: **PASS WITH NITS**

Every explicitly-flagged risk area verified correctly in a real browser: the desktop `Dialog` branch
renders and dismisses correctly via all four paths (Esc, overlay click, shell `X`, footer Close); the
mobile `Sheet` branch does the same; the Decision 9 occurrence-range bug is fixed — clicking a
**non-first** occurrence (Aug 26 of a weekly series started Aug 5) renders that occurrence's own
start/end, not the first occurrence's; completed-task title strike-through survives hover (CSS
`text-decoration-line` stays `line-through` under `:hover`, confirmed via computed style, not just
visual inspection); all-day items render date-only with no spurious time in both the list row and the
modal; the `?item=<id>` deep link opens VIEW mode with zero form controls in the document and the
NEW-1 invariant (close → Calendar → List → does not reopen) holds when driven manually, not just via
the unit test; calendar chips are real `<button>`s, Tab-reachable, activate with both Enter and Space,
and show a visible non-white focus ring in dark mode; touch targets measure exactly 36px tall with
exactly 6px gaps (at the plan's stated floor, not below it); the smart location link renders a real
`<a>` for both `address` (`123 Test St (open in maps)`) and `meeting` kinds (`Tap to join` for a
`zoom.us` URL — confirmed a non-allowlisted host like `meet.example.com` correctly falls back to a
plain generic link, which is pre-existing `location.ts` behavior, not new); attachments render via
`AttachmentsView` in view mode; and View→Edit-in-place transition works with no flash, saves
correctly, and the list refreshes immediately. No console errors, no failed network requests, no
unhandled rejections across the entire session.

Two items keep this at **PASS WITH NITS** rather than a clean PASS:

1. **Focus is not restored to the trigger element after the modal closes** (Nit 1 below) — every
   dismissal path (Esc, overlay, X, footer Close) leaves `document.activeElement` on `<body>` instead
   of returning it to the row's View button or the calendar chip that opened the modal. This is a
   real, reproducible a11y regression risk for keyboard/screen-reader users (they lose their place in
   the page), though it does not block any functional flow and was not explicitly called out as a gate
   in the plan.
2. **The shadcn `Button` component's dark-mode focus-ring halo (pre-existing, explicitly deferred by
   the plan)** is still present on the row's View/Edit/Delete buttons — confirmed live
   (`rgb(255,255,255)` ring-offset in dark mode). The plan's Decision 6 fixed this **only** on the two
   *new* elements (title button, calendar chip), which I verified do **not** have the halo
   (`rgb(17,22,24)` ring-offset, matching the dark background). Filing this as a nit only because the
   plan itself documents it as an accepted, out-of-scope, already-backlogged deferral — not something
   this branch was supposed to fix.

Neither nit blocks merge on its own; Nit 1 is worth a follow-up ticket since it is a new-code
regression risk (the pre-`ItemModal` code had no dialogs opened by non-`DialogTrigger` buttons in this
flow, so this focus-loss pattern is newly introduced by this feature, not merely inherited).

---

## Desktop Dialog branch (≥768px) — the plan's highest-priority target

Tested at 1280×800 with Playwright MCP against `QA Test Event With Reminder` (event, location,
1 reminder, 1 attachment).

| Check | Result | Evidence |
|---|---|---|
| Opens via row "View" button | PASS | `role="dialog"`, heading = item title, `<dl>` body with Type/When/Location/Reminders/Attachments/Provenance rows, footer Edit + Close, shell `X` | `item-view-mode-desktop-dialog-light.png` |
| Esc dismisses | PASS | dialog absent from `find` after `Escape` keypress | — |
| Overlay click dismisses | PASS | dispatched a full trusted-shaped pointer/mouse event sequence at a point on the `bg-black/50` overlay outside the content box; dialog closed | — |
| Shell `X` dismisses | PASS | — | — |
| Footer "Close" dismisses | PASS | — | — |
| View → Edit in place (footer Edit) | PASS | Same modal surface flips to `Edit Item` heading + full `ItemEditor` form pre-populated with the item's data, no unmount flash observed | — |
| Location renders a real link | PASS | `123 Test St (open in maps)` → `https://maps.google.com/?q=123%20Test%20St` | — |
| Attachments render in view mode | PASS | `AttachmentsView` renders the image thumbnail as a link to the attachment URL | — |
| Focus lands somewhere sane on open | PASS (lands on footer "Edit" button, Radix default-first-focusable behavior) | — |
| Focus after close | **NIT 1 — see below** | `document.activeElement` = `<body>`, not the "View" button that opened it | — |

## Mobile Sheet branch (390×844)

Same item, same four dismissal paths, all confirmed working:

| Check | Result |
|---|---|
| Opens as full-height Sheet, correct layout | PASS — `item-view-mode-mobile-sheet-light.png` |
| Esc dismisses | PASS |
| Overlay click dismisses (Sheet top edge is at `y≈84px`; overlay above it is a valid click target) | PASS |
| Shell `X` dismisses | PASS |
| Footer "Close" dismisses | PASS |

---

## Decision 9 / R9 — occurrence end-time correctness (the plan's named "real bug")

Created a new weekly recurring event, `QA Weekly Recurring Meeting`, Wed 10:00–11:00 PDT starting
2026-08-05, `BYDAY=WE`. Confirmed via Calendar that occurrences appear on Aug 5, 12, 19, 26.

- Clicked the **Aug 26** chip (third occurrence, not the first): modal showed
  **"Wed, Aug 26, 2026, 10:00 AM PDT – Wed, Aug 26, 2026, 11:00 AM PDT"** — correct date on both
  ends, start before end, matching the clicked occurrence, not the Aug 5 first occurrence.
  Screenshot: `item-view-mode-occurrence-range-correct.png`.
- Cross-checked via keyboard: Tab-focused the Aug 5 chip and activated with `Enter` →
  "Wed, Aug 5, 2026, 10:00 AM – 11:00 AM PDT" (correct, first occurrence). Focused the Aug 12 chip
  and activated with `Space` → "Wed, Aug 12, 2026, 10:00 AM – 11:00 AM PDT" (correct, second
  occurrence).
- Recurrence line rendered "Every week on Wed"; series hint ("This is one occurrence of a repeating
  item…") appeared correctly **only** when opened from a calendar chip (`occurrenceAt != null`), and
  was correctly **absent** when the same item was opened via the list row's View button
  (`occurrenceAt == null`) — confirms the conditional in §3.6 is wired correctly, not just present.

**Verdict: PASS.** This is the fix the plan was most worried about, and it holds for both the first
and later occurrences, via mouse and via keyboard.

---

## Completed-task hover strike-through (R2) — CSS-only, jsdom-blind

Playwright MCP, desktop viewport, on `QA Test All-Day Task` (checked complete):

- Before hover: `getComputedStyle(titleButton).textDecorationLine === "line-through"`.
- After a real `hover()` (confirmed `button.matches(':hover') === true`):
  `textDecorationLine` **still** `"line-through"`; only `color` changed
  (`rgb(72, 153, 142)`, the teal accent) — confirming the hover affordance is color-only and does
  **not** collide with the strike-through utility group, exactly as Decision 6's "no `hover:underline`"
  hard requirement specifies.

Screenshot: `item-view-mode-completed-task-hover.png`.

**Verdict: PASS.**

---

## All-day items (D-OQ5)

- List row for `QA Test All-Day Task`: `"Sat, Jul 11, 2026 · Test Location Address"` — date only, no
  time, no `12:00:00 AM` artifact.
- View-mode modal for the same item: `WHEN: "Sat, Jul 11, 2026"` — date only.

**Verdict: PASS.**

---

## `?item=<id>` deep link (D-OQ1) + NEW-1 invariant

Fetched a real item id via `fetch('/api/lists/.../items')` in-page (not guessed), then navigated to
`http://localhost:8787/?item=b88a6e17-903b-4de1-8650-7907e92062de` in a fresh navigation.

- Modal opened automatically on load, in **view mode**: `role="dialog"`, title `"QA Test Event With
  Reminder"`, full read-only field list, **0 console errors**.
- Confirmed no form controls belong to the modal: `document.querySelectorAll('input:not([type=checkbox])')`
  returned exactly 1 element, and it was the sidebar's unrelated "New list name" input — zero inputs
  inside the dialog subtree.
- Closed via Esc → switched to Calendar (chips rendered, no dialog) → switched back to List → searched
  the whole page for `role=dialog`: **no match**. The NEW-1 one-shot invariant holds when driven by
  real navigation and real clicks, not only through the mocked unit test.

**Verdict: PASS.**

---

## Calendar chips as buttons — keyboard reachability (item 5)

- Chips are genuine `<button type="button">` elements with `aria-label="{title} — {Month} {day}"`
  (confirmed format: `"QA Weekly Recurring Meeting — August 5"`).
- From the month-nav "›" button, a single `Tab` press landed directly on the first chip (day cells are
  non-interactive `<div>`s, exactly as the plan's "conflicting-handler audit" documents — no dead Tab
  stops before reaching a chip).
- `Enter` on the focused Aug 5 chip opened the modal with the correct occurrence.
- `Space` on the focused Aug 12 chip (via programmatic focus + real `Space` keypress) also opened the
  modal with the correct occurrence.
- Visible focus ring confirmed via `getComputedStyle(...).boxShadow` showing an offset ring, not
  `outline: none` with nothing visible.
- **Tab-stop volume**: this month only had one recurring item (4 chips). I did not construct a
  pathologically busy month (the plan's "+N more" truncation caps visible chips at 3/day anyway, per
  §2 non-goals), so I can't speak to whether a very busy month "feels unreasonable" in practice beyond
  noting the truncation cap already bounds worst-case Tab-stop count per day to 3. Not a defect; noting
  the limit of what I tested.

**Verdict: PASS** (with the scope note above).

---

## Touch targets (Decision 10) — measured, not eyeballed

Mobile viewport (390×844), Playwright MCP, `getBoundingClientRect()` on all View/Edit/Delete buttons
across three item rows:

| Row | Button heights | Gaps between stacked buttons |
|---|---|---|
| Row 1 | 36px, 36px, 36px | 6px, 6px |
| Row 2 | 36px, 36px, 36px | 6px, 6px |
| Row 3 | 36px, 36px, 36px | 6px, 6px |

Exactly at the plan's stated floor (≥36px tall, ≥6px spacing) — not below it, and consistent across
every row. Total stacked-button column height per row: 36×3 + 6×2 = 120px, which does not read as
excessive against a full-width mobile card.

**Verdict: PASS.**

---

## Smart location links (R6)

- Address kind: `123 Test St` → `<a href="https://maps.google.com/?q=123%20Test%20St">123 Test St
  (open in maps)</a>`. PASS.
- Meeting kind, allowlisted host: created a test item with `https://zoom.us/j/123456789` as the
  location → rendered `<a href="https://zoom.us/j/123456789">Tap to join</a>`. PASS.
- Meeting-*shaped* but non-allowlisted host (`https://meet.example.com/qa-room`, "Auto" location
  type): rendered as a plain generic link with the raw URL as both text and href — **not** mislabeled
  "Tap to join". This is correct per `src/shared/location.ts`'s documented allowlist
  (`zoom.us`/`zoom.com`/`teams.microsoft.com`/`teams.live.com`/`meet.google.com`) and is unchanged,
  pre-existing behavior, not a defect in this branch.

**Verdict: PASS.**

---

## Attachments in view mode

Confirmed on two items: an image attachment renders as a thumbnail `<img>` inside a link to
`/api/items/:id/attachments/:attachmentId` (both light and dark, desktop and mobile screenshots);
an item with none renders `"No attachments."` text, not an empty list.

**Verdict: PASS.**

---

## Light / dark theme (Chrome DevTools MCP — `emulate({ colorScheme })`)

| Surface | Light | Dark |
|---|---|---|
| Desktop Dialog | `item-view-mode-desktop-dialog-light.png` | `item-view-mode-desktop-dialog-dark.png` |
| Mobile Sheet | `item-view-mode-mobile-sheet-light.png` | `item-view-mode-mobile-sheet-dark.png` |
| Calendar chip + focus ring | (see Playwright section above) | `item-view-mode-calendar-chip-focus-dark.png` |
| Title-button focus ring (list row) | not separately screenshotted (light-mode ring has no halo risk — Tailwind's default white ring-offset is invisible on a white/light background) | `item-view-mode-focus-ring-dark.png` |

Dark theme renders cleanly across every surface: correct background/border/text contrast, teal accent
consistent with the existing design system, no unstyled/native-chrome elements standing out. The
Decision 6 `focus-visible:ring-offset-background` fix was specifically verified via a real
`:focus-visible`-qualifying keyboard-Tab sequence (see Nit 2 methodology note below) — both the new
title button and the new calendar chip show a dark ring-offset (`rgb(17,22,24)`, matching the dark
background) in dark mode, **not** the default Tailwind white halo.

---

## View → Edit → Save round trip (list refresh confirmation)

Opened `QA Test Event With Reminder` in view mode → clicked footer Edit (in-place transition, no
flash) → changed the title to `"QA Test Event With Reminder (edited)"` → Save. Result: modal closed
(per Decision 7 — no View return after Save), list row updated to the new title **immediately**, no
manual refresh needed. Reverted the title back to the original value via the same flow to leave test
data as found (net-zero change to pre-existing fixtures).

Also incidentally re-confirmed the row's direct "Edit" button (bypassing View) still opens
`ItemEditor` correctly — requirement 3 (Edit continues to open edit mode) holds both via the row
button and via the modal's footer Edit.

**Verdict: PASS.**

---

## Console errors / network failures

Checked at every major step across both Playwright MCP and Chrome DevTools MCP sessions:

- **Console errors**: 0, across the entire session (list, calendar, deep link, all four dismissal
  paths on both breakpoints, item create/edit/delete, dark-mode focus checks). The only console
  output was a single pre-existing deprecation warning
  (`apple-mobile-web-app-capable` meta tag, unrelated to this feature, present on every page load
  regardless of branch) and pre-existing Lighthouse-style "issue" entries about unlabeled form fields
  inside `ItemEditor` (pre-existing, `ItemEditor.tsx` untouched by this plan).
- **Network failures**: 0. Every `/api/*` call observed (`GET /api/me`, `GET /api/lists/:id/items`,
  `POST /api/items`, `PATCH /api/items/:id`, `PUT /api/items/:id/reminders`,
  `GET /api/items/:id/attachments`) returned 200/201.
- **Unhandled rejections**: none observed. The plan's own §3.11 anticipated an unmocked
  `listAttachments` fetch firing on every modal open (both view and edit mode) — confirmed as
  expected, non-erroring behavior, consistent with the plan's prediction.

---

## Accessibility observations

**Nit 1 — Focus is not restored to the triggering element when the modal closes (any dismissal
path).** Reproduction: open the desktop Dialog via the row's "View" button (or a calendar chip),
close it via Esc (or overlay/X/footer Close — all four paths behave the same), then inspect
`document.activeElement`. Expected: focus returns to the button that opened the dialog (Radix's
default behavior when the trigger is a real `DialogTrigger`/`Trigger` ref). Actual: focus lands on
`<body>`. Root cause (inferred from the plan's Decision 1/3): `ItemModal` is a controlled
`open`/`state` component with no `<DialogTrigger>`/`<SheetTrigger>` wrapping the row title button or
calendar chip — Radix's automatic "return focus to trigger" mechanism depends on that ref, and a
purely-controlled dialog with an external trigger button doesn't get it for free. Severity: **minor
but real** — keyboard and screen-reader users lose their place in a list/calendar after closing an
item, which is a regression risk introduced by this feature (there was no prior flow where clicking
something opened a Radix dialog whose trigger wasn't itself the `DialogTrigger`). Not a hard blocker:
the item that was open is still visible in the list/calendar (usually near the viewport center), and
Tab from `<body>` starts a predictable traversal from the top of the page. Suggest a follow-up: track
the triggering element in `useItemModal()` (or store a ref in `ItemModal` set at `open()` time) and
call `.focus()` on it in the `onOpenChange(false)` handler. Found via **Playwright MCP** (evaluate +
Escape/overlay-click sequences) and reconfirmed via **Chrome DevTools MCP** in the dark-mode/keyboard
pass.

**Nit 2 — pre-existing shadcn `Button` white ring-offset halo in dark mode, confirmed still present
but explicitly out of scope.** The row's View/Edit/Delete buttons (variants from
`web/src/components/ui/button.tsx`) show `box-shadow: rgb(255,255,255) 0 0 0 2px, rgb(94,186,168) 0
0 0 4px, ...` when focus-visible in dark mode — a white halo against the near-black background. This
is the exact issue the plan's Decision 6 section names and explicitly declines to fix
("Retrofitting `button.tsx` is out of scope; backlog it"), and the plan confirms a backlog entry was
filed. I verified it is **not** present on the two *new* elements this plan added (title button:
`rgb(17,22,24)` dark ring-offset; calendar chip: same) — so the scoped fix landed correctly, and this
nit is purely the pre-existing, already-tracked deferral, restated here for completeness since I was
in dark mode anyway. Found via **Chrome DevTools MCP** (`:focus-visible`-qualifying keyboard sequence
+ `getComputedStyle`).

**Methodology note on `:focus-visible` testing:** Chrome only applies `:focus-visible` styling based
on input-modality heuristics — a bare `element.focus()` call from `evaluate()` does not reliably
qualify. The working pattern used throughout this report: script-focus the *previous* element in tab
order, then issue one real `Tab` keypress via the MCP tool (not `evaluate`), then inspect the newly
active element. This reliably produces `:focus-visible === true` and accurate `box-shadow` /
ring-offset values. Documenting this because a naive `el.focus()` + computed-style check silently
reports `box-shadow: none` and would produce a false "no focus ring" finding.

Dialog labelling: both the Dialog and Sheet correctly set `aria-labelledby` to the title heading
(confirmed via the `dialog` role's accessible name matching the item title in every snapshot above);
Radix's `hideOthers()` correctly marks the rest of the page `aria-hidden` while a modal is open
(relied upon by the deep-link test's `queryAllByRole('textbox')` assertion per the impl notes, and
observed indirectly — no duplicate-name query collisions during manual testing).

---

## Performance notes

None. No Performance trace was warranted — this is a small modal/dialog feature with no
scroll-jank, layout-thrash, or asset-loading concern raised by the plan, and none was observed
incidentally (attachment thumbnails are small test fixtures, not large images).

---

## Screenshots

All under `docs/qa/screenshots/`:

- `item-view-mode-desktop-dialog-light.png` — desktop Dialog, view mode, light theme.
- `item-view-mode-desktop-dialog-dark.png` — desktop Dialog, view mode, dark theme (recurring
  item, correct Aug-5 occurrence range, series hint visible).
- `item-view-mode-mobile-sheet-light.png` — mobile Sheet, view mode, light theme.
- `item-view-mode-mobile-sheet-dark.png` — mobile Sheet, view mode, dark theme.
- `item-view-mode-completed-task-hover.png` — completed task title mid-hover, strike-through intact.
- `item-view-mode-occurrence-range-correct.png` — Aug 26 occurrence of a weekly series showing its
  own correct start/end range (Decision 9 / R9 fix confirmed).
- `item-view-mode-calendar-chip-focus-dark.png` — calendar chip with keyboard focus ring, dark theme,
  no white halo.
- `item-view-mode-focus-ring-dark.png` — desktop Dialog's footer Edit button focus ring, dark theme
  (documents the pre-existing `button.tsx` white-halo nit for contrast against the new elements'
  correctly-fixed ring).

---

## Test data hygiene

Created and cleaned up during this session: `QA Weekly Recurring Meeting` (weekly recurring event,
deleted at end) and `QA Meeting Link Item` (deleted at end). `QA Test Event With Reminder`'s title
was temporarily changed to `"QA Test Event With Reminder (edited)"` to verify the save round-trip and
was reverted to its original value before the session ended. Final list state matches the state found
at the start of the session (`QA Test Event With Reminder`, `QA Test All-Day Task`).

Dev server was started fresh for this session and terminated at the end (`kill` on the `wrangler dev`
process, confirmed port 8787 free afterward).

PASS WITH NITS

---

## Re-QA (fix pass)

Date: 2026-08-22 (re-QA of the two nits above, per `docs/plans/item-view-mode-impl-notes.md` §12
"Re-QA fix pass"). Repo state: branch `feat/item-view-mode`, base implementation committed at
`0c1efbf`; the two fixes are **uncommitted** in the working tree (confirmed via `git diff --stat`
against the exact diff described in the impl notes — `ItemModal.tsx` (`triggerRef` +
`onCloseAutoFocus`), `ui/button.tsx` (`ring-offset-background`), plus the two mount-site prop
threads in `ItemListView.tsx`/`CalendarView.tsx`). Automated gates (typecheck clean, lint 0
errors/2 pre-existing warnings, `npm test` 246/246) were re-verified by the orchestrator before this
pass and were **not** re-run here, per instruction — this pass is browser-only.

Environment: `npm run dev` on `http://localhost:8787`, `.dev.vars` `DEV_AUTH_IDENTITY="owner"` dev-auth
shim (no Cloudflare Access JWT needed), same fixtures as the original pass
(`QA Test Event With Reminder`, `QA Test All-Day Task` in `QA Dev Auth Shim Test List`). Dev server
started fresh for this session and killed at the end (port 8787 confirmed free afterward). Tools:
**Playwright MCP** for the focus-restore matrix (desktop + mobile, all four entry points × all four
dismissal paths, the guard path, and the regression sweep) and **Chrome DevTools MCP** for the
dark-mode `:focus-visible` ring-offset re-check and the light-mode regression check (same
`prefers-color-scheme` emulation need as the original pass — Playwright MCP still has no
color-scheme-emulation primitive).

### Fix 1 — focus restoration: re-tested and confirmed fixed

Diffed `web/src/components/ItemModal.tsx` against the impl notes' described change before testing:
`useItemModal()` gained `triggerRef = useRef<HTMLElement | null>(null)`, set to
`document.activeElement` inside each of `openCreate`/`openView`/`openEdit` immediately before
`setState(...)`; `ItemModal` takes an optional `triggerRef` prop, wired via `onCloseAutoFocus` on
both `DialogContent` and `SheetContent`, guarded by `document.contains(trigger)` before
`preventDefault()` + `.focus()`. Matches the impl notes exactly, no drift.

**Entry point × dismissal path matrix** (measuring `document.activeElement` explicitly via
`evaluate()` before and after each open/close, keyboard-driven: script-focus the trigger, then a
real `Enter`/`Space` keypress via the MCP tool to open — not a synthetic `.click()`):

| Breakpoint | Entry point | Open method | Dismissal | Result |
|---|---|---|---|---|
| Desktop 1280×800 | Row "View" button | keyboard focus + `Enter` | `Escape` | **PASS** — focus returned to "View" button (`document.activeElement.textContent === "View"`) |
| Desktop 1280×800 | Row title button | keyboard focus + `Enter` | Overlay click (trusted-shaped pointer/mouse event sequence dispatched on the `bg-black/50` overlay div, confirmed via `elementFromPoint`) | **PASS** — focus returned to the title button |
| Desktop 1280×800 | Row "Edit" button | keyboard focus + `Enter` | Shell `X` (mouse click) | **PASS** — focus returned to the "Edit" button |
| Desktop 1280×800 | Calendar chip | keyboard focus + `Space` | Footer "Close" (mouse click, scoped to the `<dl>`'s Close, not the shell's) | **PASS** — focus returned to the chip (`aria-label="QA Test Event With Reminder — July 11"`) |
| Mobile 390×844 | Calendar chip | keyboard focus + `Enter` | `Escape` | **PASS** — focus returned to the chip |
| Mobile 390×844 | Row "View" button | keyboard focus + `Enter` | Shell `X` | **PASS** — focus returned to "View" |
| Mobile 390×844 | Row title button | keyboard focus + `Enter` | Footer "Close" | **PASS** — focus returned to the title button |
| Mobile 390×844 | Row "Edit" button | keyboard focus + `Enter` | Overlay click (verified an overlay strip exists above the full-height Sheet at `y<84px` and is a valid click target; `elementFromPoint` confirmed the `bg-black/50` div was hit) | **PASS** — focus returned to "Edit" |

All four entry points and all four dismissal paths are each represented at least once, on both
breakpoints, driven by genuine keyboard activation (`Tab`-equivalent focus + real `Enter`/`Space`
keypress) as the task required — not mouse clicks, so this exercises exactly the code path the fix
targets (`document.activeElement` captured at open time). No case left focus on `<body>`; no case
threw.

**Guard path (detached trigger).** The UI has no in-modal delete action (`ItemEditor` has no delete
button — confirmed via `grep -in delete ItemEditor.tsx`, no match), so "delete from within the
modal" as literally described isn't a reachable flow; the closest real analogue is a list refresh
that removes the row while the modal is open (e.g. the item was deleted elsewhere). Simulated this
directly: created a disposable item (`QA Trigger Detach Test Item`), opened its View modal via the
row's "View" button (real keyboard `Enter`), then — while the modal was still open — removed the
row's containing DOM node via `evaluate()` (confirmed `target.isConnected` flipped `true → false`),
then dismissed via `Escape`. Result: **no throw**, 0 new console errors (checked via
`browser_console_messages({level: "error"})` immediately after), dialog closed, and
`document.activeElement` fell back to `<body>` — the correct, documented fallback per the guard's
`if (trigger && document.contains(trigger))` condition, matching the second unit test's assertion
in `ItemListView.test.tsx`. Reloaded the page afterward to reset real DOM state (the underlying item
was never actually deleted from the API — confirmed it was still present in the list post-reload —
so this was a pure DOM-detach simulation, not data loss), then deleted the item normally via its row
Delete button to clean up test data.

**View→Edit→Save round trip.** Opened `QA Test Event With Reminder` via keyboard on the title
button, transitioned to edit mode via footer Edit, re-saved the (unchanged) title. Result: no throw,
0 console errors, modal closed (per Decision 7, no return to View after Save), and
`document.activeElement` landed on `<body>` — **not** back on the title button. This is expected and
matches impl notes' "edge case 15" acceptance: Save triggers a list refetch that replaces the row's
DOM nodes, so the `triggerRef` captured at `openView` time is now a detached node by the time
`onCloseAutoFocus` fires — `document.contains(trigger)` correctly returns `false` and the guard
falls back to Radix's default (`<body>`) rather than focusing a stale node or throwing. This is the
same guard path exercised deliberately above, occurring here as a natural side effect of a normal
save — confirms the guard holds under the real (not simulated) trigger-replacement scenario, not
just the synthetic DOM-removal test.

**Verdict: Fix 1 confirmed working** for every entry point, every dismissal path, both breakpoints,
and the guard path (both simulated and naturally-occurring via Save). **Nit 1 is resolved.**

### Fix 2 — dark-mode focus-ring halo: re-tested and confirmed fixed

Diffed `web/src/components/ui/button.tsx` — confirmed the single-line change (`ring-offset-background`
added to `buttonVariants`'s base class, next to `focus-visible:ring-offset-2`) matches the impl notes
exactly.

Used the same `:focus-visible`-qualifying methodology documented in the original report
(script-focus the *previous* element in tab order, then one real `Tab` keypress, then inspect
`getComputedStyle(...).boxShadow` on `document.activeElement`), via Chrome DevTools MCP with
`emulate({ colorScheme: "dark" })`:

| Button | Dark-mode ring-offset (was `rgb(255,255,255)`) | Result |
|---|---|---|
| Row "View" | `rgb(17, 22, 24) 0px 0px 0px 2px, rgb(94, 186, 168) 0px 0px 0px 4px, ...` | **PASS** — matches dark background token, no white halo |
| Row "Edit" | same | **PASS** |
| Row "Delete" | same | **PASS** |

Spot-checked `Button` instances **outside** this feature, app-wide, in dark mode (`focus()` +
`:focus-visible` check, verified `el.matches(':focus-visible') === true` in each case since the
session was already in an active keyboard-Tab context):

- Sidebar "+ New Item" — `rgb(17, 22, 24)` ring-offset. PASS.
- Sidebar "Enable Push Notifications" — `rgb(17, 22, 24)` ring-offset. PASS.
- `ItemEditor` "Create"/"Cancel" (opened the create-item form to check) — both `rgb(17, 22, 24)`
  ring-offset. PASS.

All four instances checked (the three feature-adjacent row buttons plus four app-wide buttons) show
the corrected dark ring-offset — the fix is a genuine shared-primitive fix, not scoped narrowly.
Screenshot: `item-view-mode-focus-ring-dark-refix.png`.

**Light-mode regression check** (same methodology, `emulate({ colorScheme: "light" })`): row "View"
button's ring-offset is `rgb(252, 252, 253)` — the light `--background` token (`240 33% 99%`), not
pure white `rgb(255,255,255)`, but visually indistinguishable from the prior white ring-offset (both
are near-white against a near-white page). No visible regression. Screenshot:
`item-view-mode-focus-ring-light-refix.png`.

One button type was excluded from the app-wide spot-check: the Admin roster's "—" (edit name)
control renders as a `<span>` inside a non-`button.tsx`-styled wrapper (confirmed via
`document.activeElement.tagName === "SPAN"` after a real Tab into it), so it is not a `ui/button.tsx`
instance and is out of scope for this fix.

**Verdict: Fix 2 confirmed working** — the halo is gone on both the previously-affected row buttons
and on other `Button` instances app-wide, in dark mode, with no visible light-mode regression.
**Nit 2 is resolved** (the `button.tsx` half of the backlog entry the impl notes describe as now
"✅ RESOLVED" is confirmed live).

### Regression sweep

Re-verified briefly per the task's explicit list, since Fix 2 touches a component used app-wide:

- **List row click → view modal**: PASS (exercised repeatedly throughout the focus-restore matrix
  above).
- **Calendar chip → view modal with correct occurrence times (R9)**: created a fresh weekly
  recurring item (`QA ReQA Weekly Recurring`, Fridays, starting Aug 21 2026), clicked the **Aug 28**
  chip (a later, non-first occurrence) — modal correctly showed `"Fri, Aug 28, 2026, 11:36 PM PDT"`
  and the series hint ("This is one occurrence of a repeating item…"), not the Aug 21 first
  occurrence's date. **PASS**, no regression from Fix 2. Cleaned up (deleted the test item) after.
- **View→Edit→Save refreshing the list**: covered above under Fix 1's round-trip check — save
  succeeded, list updated immediately, 0 console errors. **PASS**.
- **`?item=<id>` deep link opening view mode**: fetched the real item id via an in-page `fetch`,
  navigated fresh to `http://localhost:8787/?item=<id>`. Modal opened automatically in view mode
  (`role="dialog"`, correct title, full read-only field list, Radix `hideOthers()` correctly hid the
  rest of the page from the a11y tree). **PASS**.
- **NEW-1 (close → Calendar → List → does not reopen)**: from the deep-link state above, closed via
  `Escape`, switched to Calendar (rendered correctly, no dialog), switched back to List — no dialog
  reopened, confirmed via a full accessibility snapshot showing the plain list view. **PASS**.
- **Console**: 0 errors across the entire re-QA session (both Playwright MCP and Chrome DevTools MCP
  sub-sessions), checked after every state-changing action. `browser_console_messages`/
  `list_console_messages` calls returned either 0 messages or only the single pre-existing
  `favicon.ico` 404 (a static-asset 404 unrelated to this feature, present on cold navigation
  regardless of branch — not a regression).
- **Network**: 0 failed requests. All observed `/api/*` calls (`GET /api/me`, `GET .../items`,
  `GET .../items?from=...&to=...` (calendar range fetch), `POST /api/items`,
  `PATCH /api/items/:id`, `PUT /api/items/:id/reminders`, `DELETE /api/items/:id`,
  `GET .../attachments`) returned 200/201/204 across both MCP sessions
  (`list_network_requests`/`browser_network_requests`).

### Test data hygiene (re-QA session)

Created and cleaned up: `QA Trigger Detach Test Item` (created via "+ New Item", used for the guard
path, deleted via its own row Delete button afterward) and `QA ReQA Weekly Recurring` (weekly
recurring event created for the R9 regression re-check, deleted afterward). `QA Test Event With
Reminder`'s title was re-saved with its unchanged value during the View→Edit→Save round-trip check
(no net change). Final list state, confirmed via a closing snapshot, matches the state at the start
of this session (`QA Test Event With Reminder`, `QA Test All-Day Task`, nothing else). Dev server
was started fresh for this session and killed at the end (`lsof -ti:8787 | xargs kill`, port 8787
confirmed free afterward).

### Re-QA verdict

Both nits from the original pass are fixed and hold up under a deliberately adversarial re-test:
the full entry-point × dismissal-path matrix (8 combinations across two breakpoints, all
keyboard-driven), the guard path (both a direct DOM-detach simulation and the naturally-occurring
Save-triggered refetch case), and the dark-mode ring-offset check (both the originally-affected
buttons and a spot-check of unrelated `Button` instances app-wide, with an explicit light-mode
no-regression check). No new issues were found. The regression sweep confirms Fix 2's app-wide
`button.tsx` change did not disturb any of the feature's headline flows.

PASS
