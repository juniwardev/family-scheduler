# Implementation notes: `feat/item-view-mode`

Coder implementation of `docs/plans/item-view-mode.md` (verdict `APPROVE`, round-3 follow-up
verification, in `docs/reviews/item-view-mode-review.md`). Branch: `feat/item-view-mode`,
starting commit `ae58e7b` (plan + review only, no application code). Implemented step-by-step
per §8, running `npm run typecheck && npm run lint` after every step and confirming both were
clean before moving on, per the task instructions. Changes are left uncommitted in the working
tree per instruction.

## 1. §7.1 harness choice

Chose **option (a)**: widened `vitest.workspace.ts`'s `web` project `include` from
`["web/**/*.test.tsx"]` to `["web/**/*.test.ts", "web/**/*.test.tsx"]` (both globs required —
micromatch's `*.test.ts` does not match `*.test.tsx`). Did not rename any lib test to
`.test.tsx`.

## 2. Vitest file list — every new file confirmed collected and passing

Full `npm test` output (`grep -E "^\s*✓ \|"`) at the final state, 32 files / 244 tests, 0
failures:

```
 ✓ |web| web/src/components/AttachmentsEditor.test.tsx  (5 tests)
 ✓ |web| web/src/components/NotificationSetup.test.tsx  (8 tests)
 ✓ |web| web/src/components/ItemDetails.test.tsx  (14 tests)          <- NEW
 ✓ |web| web/src/RadixSpike.test.tsx  (4 tests)
 ✓ |web| web/src/components/CalendarView.test.tsx  (5 tests)         <- NEW
 ✓ |web| web/src/components/ItemListView.test.tsx  (8 tests)         <- NEW
 ✓ |web| web/src/App.deeplink.test.tsx  (3 tests)                    <- MODIFIED (Decision 8)
 ✓ |web| web/src/components/ItemEditor.test.tsx  (3 tests)
 ✓ |web| web/src/App.test.tsx  (4 tests)
 ✓ |web| web/src/lib/rrule.test.ts  (21 tests)                       <- NEW (.test.ts, needs §7.1)
 ✓ |worker| tests/unit/push-encrypt.test.ts  (1 test)
 ✓ |web| web/src/components/InstallBanner.test.tsx  (2 tests)
 ✓ |web| web/src/components/AttachmentsView.test.tsx  (4 tests)
 ✓ |worker| tests/unit/push-vapid.test.ts  (3 tests)
 ✓ |web| web/src/lib/permissions.test.ts  (5 tests)                  <- NEW (.test.ts, needs §7.1)
 ✓ |web| web/src/lib/itemDisplay.test.ts  (11 tests)                 <- NEW (.test.ts, needs §7.1)
 ✓ |web| web/src/components/ItemModal.desktop.test.tsx  (2 tests)    <- NEW
 ✓ |worker| tests/unit/notification-content.test.ts  (19 tests)
 ✓ |worker| tests/unit/attachments-binding.test.ts  (1 test)
 ✓ |worker| tests/unit/location.test.ts  (25 tests)
 ✓ |worker| tests/unit/recurrence.test.ts  (6 tests)
 ✓ |worker| tests/unit/digest-content.test.ts  (7 tests)
 ✓ |worker| tests/unit/items-get-by-id.test.ts  (4 tests)
 ✓ |worker| tests/unit/auth-deactivated.test.ts  (6 tests)
 ✓ |worker| tests/unit/me-maps-provider.test.ts  (7 tests)
 ✓ |worker| tests/unit/attachments-cascade.test.ts  (4 tests)
 ✓ |worker| tests/unit/routing.test.ts  (6 tests)
 ✓ |worker| tests/unit/dev-auth-shim.test.ts  (11 tests)
 ✓ |worker| tests/unit/attachments-routes.test.ts  (7 tests)
 ✓ |worker| tests/unit/items-validation.test.ts  (10 tests)
 ✓ |worker| tests/unit/db.test.ts  (14 tests)
 ✓ |worker| tests/unit/attachments-validation.test.ts  (14 tests)

 Test Files  32 passed (32)
      Tests  244 passed (244)
```

The three new `web/src/lib/*.test.ts` files (`rrule.test.ts`, `permissions.test.ts`,
`itemDisplay.test.ts`) are proof the §7.1 harness fix works — before step 1, none of these would
have been collected by either Vitest project (the trap the plan calls out).

Baseline before this branch: 25 files / 178 tests. Net new: 7 files / 66 tests.

## 3. Lint warning sites (before / after, by file:line — not just the count)

**Before (baseline, re-measured fresh at the start of this task, not trusted from the plan's
stale "4 warnings" reference — see §5 Deviations):**
- `src/worker/channels/push.ts:150` — unused `eslint-disable` directive.
- `web/src/components/ItemListView.tsx:74` — `react-hooks/exhaustive-deps`, missing
  `onItemsChange` dep on the items-fetch effect.

**After (final state, same two sites, same rules, one line shifted by the file edit):**
- `src/worker/channels/push.ts:150` — unchanged (untouched file).
- `web/src/components/ItemListView.tsx:74` — same warning, same effect (this effect was not
  touched by the plan; its line number is coincidentally unchanged since the edits landed below
  it).

`npm run lint` = **0 errors, 2 warnings** throughout every step. No new warning was introduced;
the `useItemModal()` hook's callbacks are `useCallback`-stabilized with empty dep arrays exactly
as Decision 2 specifies, which is what let the create-token effect list `openCreate` in its dep
array without a third warning appearing.

## 4. `App.deeplink.test.tsx` — confirmed assertions/test-names/comments only, no structural change

Full `git diff -- web/src/App.deeplink.test.tsx`:

```diff
--- a/web/src/App.deeplink.test.tsx
+++ b/web/src/App.deeplink.test.tsx
@@ -1,17 +1,18 @@
 // App.deeplink.test.tsx — deep-link resolution + NEW-1 (round-2 review) remount-safe one-shot.
 //
 // Covers done-condition #3 (plan §10): "?item=<id>" deep link point-reads the item via
-// GET /api/items/:id (mocked here as apiClient.getItem) and opens that item's ItemEditor.
+// GET /api/items/:id (mocked here as apiClient.getItem) and opens that item in VIEW mode
+// (item-view-mode plan Decision 8, settled by the owner 2026-08-21).
 //
 // NEW-1 (load-bearing): App — not ItemListView — owns the one-shot guard. It clears
 // initialOpenItem back to null the first time ItemListView reports consumption, so
 // switching to Calendar and back (which unmounts/remounts ItemListView) does NOT reopen
-// the editor a second time. A purely local useRef guard in ItemListView would NOT survive
+// the modal a second time. A purely local useRef guard in ItemListView would NOT survive
 // that remount — this test is the regression guard for that gap.
 /// <reference types="@testing-library/jest-dom/vitest" />
 import React from "react";
 import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
-import { render, screen, waitFor } from "@testing-library/react";
+import { render, screen, waitFor, within } from "@testing-library/react";
 import userEvent from "@testing-library/user-event";
 import App from "./App";
 import type { User, List, Item, OccurrenceEntry } from "./types";
@@ -88,16 +89,23 @@ function setDeepLinkSearch(itemId: string) {
   window.history.replaceState(null, "", `${window.location.pathname}?item=${itemId}`);
 }

-describe("App — deep link (?item=<id>) opens the item's editor", () => {
-  it("point-reads the item via GET /api/items/:id and opens its ItemEditor (no N-list fan-out)", async () => {
+describe("App — deep link (?item=<id>) opens the item in view mode", () => {
+  it("point-reads the item via GET /api/items/:id and opens it in view mode (no N-list fan-out)", async () => {
     setDeepLinkSearch(DEEP_LINKED_ITEM.id);
     vi.mocked(apiClient.getMe).mockResolvedValue({ user: MEMBER_USER, lists: LISTS });
     vi.mocked(apiClient.getItem).mockResolvedValue({ item: DEEP_LINKED_ITEM });

     render(<App />);

-    expect(await screen.findByText("Edit Item")).toBeInTheDocument();
-    expect(screen.getByDisplayValue("Deep-linked birthday party")).toBeInTheDocument();
+    const dialog = await screen.findByRole("dialog");
+    // Scoped, not an unscoped getByText: the item title also appears in the list row's title
+    // button (Decision 6) once the modal is open, so an unscoped query throws "Found multiple
+    // elements". within(dialog) restricts the match to the modal subtree.
+    expect(within(dialog).getByText("Deep-linked birthday party")).toBeInTheDocument();
+    // The one explicit view-mode assertion: no form controls in the document. Safe unscoped
+    // because Radix's hideOthers(content) marks everything outside the portal aria-hidden
+    // while the modal is open, and *ByRole queries respect aria-hidden (*ByText does not).
+    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

     // Point-read, not a fan-out: exactly one getItem call for the deep-linked id.
     expect(apiClient.getItem).toHaveBeenCalledTimes(1);
@@ -114,11 +122,11 @@ describe("App — deep link (?item=<id>) opens the item's editor", () => {
     render(<App />);

     expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
-    // Falls back to the normal list view — no editor forced open.
-    expect(screen.queryByText("Edit Item")).not.toBeInTheDocument();
+    // Falls back to the normal list view — no modal forced open.
+    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   });

-  it("NEW-1: after the deep-linked editor is closed, switching to Calendar and back to List does NOT reopen it", async () => {
+  it("NEW-1: after the deep-linked modal is closed, switching to Calendar and back to List does NOT reopen it", async () => {
     setDeepLinkSearch(DEEP_LINKED_ITEM.id);
     vi.mocked(apiClient.getMe).mockResolvedValue({ user: MEMBER_USER, lists: LISTS });
     vi.mocked(apiClient.getItem).mockResolvedValue({ item: DEEP_LINKED_ITEM });
@@ -126,23 +134,25 @@ describe("App — deep link (?item=<id>) opens the item's editor", () => {
     const user = userEvent.setup();
     render(<App />);

-    // Editor opens once on boot.
-    expect(await screen.findByText("Edit Item")).toBeInTheDocument();
+    // Modal opens once on boot.
+    expect(await screen.findByRole("dialog")).toBeInTheDocument();

-    // Close it via Cancel.
-    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
-    await waitFor(() => expect(screen.queryByText("Edit Item")).not.toBeInTheDocument());
+    // Close it via Esc. (Not a button named /^close$/i: both the shell's built-in dismiss AND
+    // ItemDetails' footer Close are named "Close" inside the dialog, so that query would throw
+    // "Found multiple elements". Escape routes through the same close() path either way.)
+    await user.keyboard("{Escape}");
+    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

     // Switch to Calendar (unmounts ItemListView) ...
     await user.click(screen.getByRole("button", { name: "Calendar" }));
     expect(await screen.findByRole("button", { name: "‹" })).toBeInTheDocument();

     // ... and back to List (remounts ItemListView). Pre-NEW-1-fix, a component-local
-    // useRef one-shot guard would reset on remount and reopen the editor here.
+    // useRef one-shot guard would reset on remount and reopen the modal here.
     await user.click(screen.getByRole("button", { name: "List" }));

     // Give any errant re-open effect a chance to run, then assert it did NOT reopen.
     await waitFor(() => expect(screen.getByRole("heading", { name: /Groceries/ })).toBeInTheDocument());
-    expect(screen.queryByText("Edit Item")).not.toBeInTheDocument();
+    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   });
 });
```

Confirmed: the `vi.mock("./apiClient", ...)` factory, the `DEEP_LINKED_ITEM`/`LISTS`/
`MEMBER_USER` fixtures, `beforeEach`/`afterEach`, and the open→close→Calendar→List→assert
structure of the NEW-1 test are byte-for-byte untouched. The only non-assertion/non-comment
change is one new named import (`within`, already imported from the same
`@testing-library/react` module the file already used). No new act warnings appeared running
this file in isolation (`npx vitest run web/src/App.deeplink.test.tsx --project web`, checked
for `act(...)`/`Warning` output — none beyond the pre-existing Node experimental-flag noise).

## 5. HC1 / HC2 / HC3 — confirmed honoured

- **HC1** (`web/src/components/ItemModal.tsx`): `useItemModal()` is `const [state, setState] =
  useState<ItemModalState | null>(null)` — plain per-instance `useState`, no Context, no
  module-scope variable, no external store. `ItemListView` and `CalendarView` each call
  `useItemModal()` independently and get their own state cell. Guarded by two tests: the
  existing `App.deeplink.test.tsx` NEW-1 test (list side) and the new
  `CalendarView.test.tsx`'s "opening a chip's modal then unmounting/remounting CalendarView
  shows NO dialog" test (calendar side, the analogue §7.2 required).
- **HC2** (`web/src/components/ItemListView.tsx`'s deep-link effect): dep array `[initialOpenItem]`
  and the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment are unchanged
  byte-for-byte (see the diff excerpt in §4's underlying file — only the call inside the effect
  body changed, from `setEditingItem(initialOpenItem)` to `itemModal.openView(initialOpenItem)`).
- **HC3** (`web/src/lib/rrule.ts`): `parseRRule`/`buildRRule`/`Freq`/`Weekday`/`DAYS`/
  `DAY_LABELS`/`RRuleState` are a verbatim move (diffed against the pre-move
  `RecurrenceEditor.tsx` — logic unchanged, only exported instead of module-private). All
  hardening (`INTERVAL=abc` → 1, unrecognised `BYDAY` tokens dropped, `COUNT=abc` omitted,
  malformed `UNTIL` omitted, BYDAY sorted into `DAYS` order) lives exclusively in the new
  `describeRecurrence` function. `rrule.test.ts` includes an explicit guard test
  ("HC3 guard: hardening lives in describeRecurrence, not parseRRule") asserting
  `parseRRule("FREQ=DAILY;INTERVAL=abc").interval` is still `NaN` (unguarded) while
  `describeRecurrence` of the same string returns `"Every day"`.

## 6. Files changed / created

**New:**
- `web/src/lib/permissions.ts` + `.test.ts` — `canWriteList`, faithful mirror of
  `src/worker/db.ts`'s `canWriteList` including the lowercase-both-sides comparison.
- `web/src/lib/rrule.ts` + `.test.ts` — moved RRULE parse/build + new `describeRecurrence`.
- `web/src/lib/itemDisplay.ts` + `.test.ts` — moved `splitOffsetMinutes` (from `ReminderEditor`'s
  private `fromMinutes`) + new `describeReminder`.
- `web/src/components/ItemDetails.tsx` + `.test.tsx` — bare read-only item presentation.
- `web/src/components/ItemModal.tsx` — `ItemModalState`, `useItemModal()`, the responsive
  Dialog/Sheet shell.
- `web/src/components/ItemModal.desktop.test.tsx` — the desktop `Dialog`-branch test (R11),
  `vi.mock("../hooks/useMediaQuery")` in its own file.
- `web/src/components/ItemListView.test.tsx` — new list-view specs (title-click, row Edit,
  View→Edit-in-place, action order, R2 class guard, D-OQ5 date-line guard, keyboard activation).
- `web/src/components/CalendarView.test.tsx` — new calendar specs (chip role/aria-label, click
  opens view mode, R9 occurrence-range guard, HC1 remount guard, month-nav regression).

**Modified:**
- `vitest.workspace.ts` — widened the `web` project's `include` glob (§7.1/step 1).
- `web/src/components/RecurrenceEditor.tsx` — imports the moved symbols from `@/lib/rrule`
  (actually `../lib/rrule`, relative — the alias is only configured for `@/lib/utils`-style
  imports in existing `ui/*` files; kept the existing relative-import convention this file
  already used for `../lib/utils`), deleted local copies. `useEffect`/`eslint-disable` untouched.
- `web/src/components/ReminderEditor.tsx` — imports `splitOffsetMinutes` from
  `../lib/itemDisplay`, deleted local `fromMinutes`, updated its one call site. `toMinutes`
  stays.
- `web/src/components/ItemListView.tsx` — replaced `showCreate`/`editingItem`/`closeEditor`/
  `editorModal` with `useItemModal()` + `<ItemModal>`; `ItemRow` gained `onView`, a title
  `<button>`, and stacked View/Edit/Delete actions; `canWrite` now uses `canWriteList`; the row
  date line now uses `formatOccurrenceTime` (D-OQ5 bug fix).
- `web/src/components/CalendarView.tsx` — gained the required `user: User` prop, converted the
  chip `<div>` to an `aria-label`led `<button>`, added its own `useItemModal()` + `<ItemModal>`,
  added `reloadToken` so an edit-save refetches occurrences.
- `web/src/App.tsx` — one line: `<CalendarView lists={lists} />` → `<CalendarView lists={lists}
  user={user} />`.
- `web/src/App.deeplink.test.tsx` — see §4 above.
- `docs/backlog.md` — append-only: five deferral entries (Playwright bootstrap, calendar "+N
  more" dead end, server-supplied `can_write`, View→Edit→Save-returns-to-view, calendar roving
  `tabindex` + `button.tsx` `ring-offset-background` retrofit).

**Untouched, as required:** `src/worker/`, `migrations/`, `wrangler.toml`,
`web/src/apiClient.ts`, `src/shared/itemLabels.ts`, `src/shared/location.ts`,
`web/src/components/AttachmentsView.tsx`, `web/src/components/ItemEditor.tsx`,
`web/src/components/ui/*`, `web/src/hooks/useMediaQuery.ts`, `tests/setup/jsdom.setup.ts`.
Verified via `git status --short` — no file outside the plan's §4 inventory was touched.

## 7. Commands to run the feature locally

```
npm install
npx wrangler d1 migrations apply family-scheduler --local   # if not already applied
npm run dev                                                  # wrangler dev, serves Worker + PWA
```

Then in the app: click an item's title in the List view, or an event chip in Calendar view —
both open the shared modal in view mode. "Edit" (row button, or the modal's footer Edit) opens
edit mode in place. A `?item=<id>` URL also opens view mode.

To run just this feature's new tests: `npx vitest run web/src/lib/rrule.test.ts
web/src/lib/itemDisplay.test.ts web/src/lib/permissions.test.ts web/src/components/ItemDetails.test.tsx
web/src/components/ItemModal.desktop.test.tsx web/src/components/ItemListView.test.tsx
web/src/components/CalendarView.test.tsx web/src/App.deeplink.test.tsx --project web`

## 8. Final gate results

- `npm run typecheck` — **clean** (both `tsconfig.worker.json` and `tsconfig.web.json`), at
  every one of the plan's 8 numbered §8 steps and at the final state.
- `npm run lint` — **0 errors, 2 warnings** (baseline; see §3) at every step and at the final
  state.
- `npm test` — **32 test files passed (32), 244 tests passed (244)**, 0 failures, at the final
  state (also green after every step that added/changed tests, per-step counts climbing from
  25/178 baseline to 32/244 final).
- `npm run build` — production build succeeds (`vite build`, 1888 modules transformed, clean
  Tailwind/PostCSS extraction, no warnings beyond the pre-existing `MODULE_TYPELESS_PACKAGE_JSON`
  Node notice).
- `npm run test:e2e` — **not run**, per the plan's explicit instruction (no Playwright config
  exists in this repo; running it would prove nothing and is not a gate).

## 9. Deviations from the plan, and why

1. **Baseline lint-warning count.** The plan's §3.3/§6/R4 references "the repo currently has 4
   lint warnings (`docs/backlog.md:78`)". Re-measuring `npm run lint` fresh at the start of this
   task (before any edit) showed **2** warnings, not 4 — `push.ts:150` and
   `ItemListView.tsx:74` (`onItemsChange` missing dep). The backlog entry the plan cites is from
   2026-07-11 and predates at least one other branch (`feat/ui-redesign`) that, per its own
   impl-notes §5, already reduced the warning count from 4 to 2 as a side effect of its restyle
   (the `App.tsx`/`RecurrenceEditor.tsx` exhaustive-deps warnings it lists as having
   "disappeared"). The plan's stale reference does not change the substance of R4/§8 step 11's
   requirement — "no more than the current baseline, sites documented" — so I used the
   **actually-measured** baseline (2) as the ceiling, confirmed it held at every step (§3 above),
   and am flagging the discrepancy here rather than silently treating "4" as authoritative or
   silently correcting the old backlog entry (out of scope; append-only per the plan).
2. **`ItemModal`'s `defaultListId` guard.** §5's `ItemModalProps` comment marks `defaultListId`
   as "create mode only", which reads as if the edit-mode `<ItemEditor>` render should also be
   gated on it being defined. It should not be: `ItemEditor`'s own prop is optional and, in edit
   mode, `item.list_id` (always present) makes `defaultListId` irrelevant — `CalendarView`'s
   `<ItemModal>` never passes `defaultListId` at all (calendar has no "selected list" concept and
   never offers create), so gating `<ItemEditor>`'s render on `defaultListId !== undefined` would
   have silently broken Calendar's View→Edit-in-place transition. I render `<ItemEditor>`
   whenever `effective.mode` is `"edit"` or `"create"`, with no `defaultListId` gate — matching
   the pre-existing behavior where the *only* real guard against a listless create was
   `ItemListView`'s `if (!listId) return` before the modal is ever rendered at all (edge case 7),
   which I preserved unchanged. Not a plan defect, just a spot where the plan's prose needed one
   more clause (noted here per the review's own NB-numbered-nit convention, not a stop-and-report
   — the resolution was unambiguous once edge case 7 is re-read).
3. Everything else matched the plan as written: §8's step order, the `effective`/`key=` union-tag
   form, the `open`/`effective` split in Decision 7, the `canWriteList` call site inside the
   narrowed `view` branch in `ItemModal`, hooks-before-early-return ordering, the copy-then-delete
   split across steps 6/7a, and all of §3.6's field-rendering rules (location null/whitespace
   guard, `offset_minutes === 0`, Completed-badge-only-when-non-recurring, series hint,
   `break-words` on the title, no same-day range collapsing).

## 10. Out-of-scope observations (not fixed, filed here per guardrails)

- The two pre-existing lint warnings (`push.ts:150`, `ItemListView.tsx:74`) predate this branch
  and are unrelated to this feature; left untouched.
- `ItemDetails.tsx`'s "Provenance" footer line renders `item.created_by` (a raw email address) —
  this is the plan's own deliberate, documented choice (§3.6), not something I introduced or
  reconsidered.

## 11. What QA should pay particular attention to

- **§7.5's manual sweep is the only gate for every CSS-only item** — jsdom cannot evaluate CSS.
  In particular: completed-task title hover (strike-through must survive hover, must not become
  an underline), dark-mode focus-ring halo on the new title button and calendar chips, row-height
  cost at 375px (stacked View/Edit/Delete), long-title wrapping in the modal header, and the
  desktop `Dialog` branch in a real browser (jsdom/`useMediaQuery` mock only proves the wiring,
  not real media-query behavior).
- **Recurring-occurrence range end-to-end**, clicking a non-first occurrence's calendar chip:
  confirm the shown range is that occurrence's start/end (not the first occurrence's), matching
  the automated R9 guards in `ItemDetails.test.tsx` and `CalendarView.test.tsx`.
- **Focus after a calendar edit-save that changes the item's date** — edge case 15, accepted and
  documented as a known behavior (focus may land on `document.body`), not a bug to file.
- **`RecurrenceEditor`/`ReminderEditor` manual round-trip** (R5) — both had internals moved to
  `web/src/lib/` with no logic change, but neither has (or gained) a component test; a manual
  create/edit with a weekly BYDAY rule and a reminder is the only check beyond the new
  `rrule.test.ts`/`itemDisplay.test.ts` pure-function coverage.

## 12. Re-QA fix pass (2026-08-21) — the two nits from `docs/qa/item-view-mode-report.md`

Starting point: clean tree at `0c1efbf` (the commit that landed everything in §1-11 above).
Both fixes left uncommitted in the working tree, per instruction.

### Fix 1 — focus restored to the triggering element on modal close

**Root cause (confirmed QA's diagnosis):** `ItemModal` is a controlled Radix Dialog/Sheet with
no `DialogTrigger`/`SheetTrigger` wrapping the opener, so Radix's automatic return-focus (which
depends on that trigger ref) never fires; every dismissal path left `document.activeElement` on
`<body>`.

**Fix, exactly per the task's required approach:**
- `useItemModal()` (`web/src/components/ItemModal.tsx`) gained a `triggerRef =
  useRef<HTMLElement | null>(null)`, set to `document.activeElement as HTMLElement | null`
  inside each of `openCreate`/`openView`/`openEdit`, immediately before the existing
  `setState(...)` call. The hook's `useCallback` empty-dep-array pattern is unchanged (only
  `setState`/`triggerRef` are captured, both stable) — callers that list these in effect dep
  arrays (`ItemListView`'s `createRequestToken` effect) are unaffected. This is per-instance
  `useState`/`useRef` state exactly like the existing `state` cell, so **HC1 is preserved**: no
  Context, no module scope, no external store.
- `ItemModal` takes a new, **optional** `triggerRef?: React.RefObject<HTMLElement | null>` prop
  (optional so the two direct `<ItemModal>` test-only call sites in
  `ItemModal.desktop.test.tsx`, which don't go through `useItemModal()`, keep compiling and keep
  passing — omitting it just means "nothing to restore", which is exactly the pre-fix behavior).
  Both real mount sites (`ItemListView.tsx`, `CalendarView.tsx`) now pass
  `triggerRef={itemModal.triggerRef}`.
- Restoration happens via `onCloseAutoFocus` on **both** `DialogContent` (desktop branch) and
  `SheetContent` (mobile branch) — confirmed both already spread `...props` onto the underlying
  Radix primitive (`ui/dialog.tsx:39`, `ui/sheet.tsx:55`), so no primitive edits were needed:

  ```tsx
  const handleCloseAutoFocus = (event: Event) => {
    const trigger = triggerRef?.current;
    if (trigger && document.contains(trigger)) {
      event.preventDefault();
      trigger.focus();
    }
  };
  ```

  Guarded exactly as specified: `document.contains(trigger)` before calling `.focus()`, and no
  `preventDefault()` (i.e. fall back to Radix's default close-focus behavior) when there is
  nothing valid to restore to — covers the item-deleted / list-refreshed case, and the
  mouse/touch-in-Safari case where the captured element was never really focused in the first
  place.
- Scope held to the plan's instruction: no explicit-element parameter threaded through every
  `openView`/`openEdit` call site; `document.activeElement` capture at open time is the only
  mechanism, exactly as specified.

**Tests added** (`web/src/components/ItemListView.test.tsx`, new `describe` block "ItemListView
— focus restore on modal close (QA nit 1)"):
- "closing the modal (Esc) returns focus to the row title button that opened it" — open via the
  title button, close via Esc, assert `titleBtn` has focus.
- "does not restore focus to a trigger element that was removed from the DOM while the modal was
  open" — open via the title button, `rerender(...)` the same `ItemListView` instance with
  `items={[]}` (simulating the row disappearing, e.g. a delete elsewhere), confirms the button is
  genuinely detached (`document.body.contains(titleBtn) === false`), then closes via Esc and
  asserts no throw and `titleBtn` does not end up focused.

Both run under jsdom (`document.activeElement`/`.focus()` are supported there) and both pass
alongside the file's existing 8 tests (10/10 total in that file after this change).

### Fix 2 — dark-mode focus-ring white halo on `Button` (one class)

Added `ring-offset-background` to `web/src/components/ui/button.tsx:8`'s `buttonVariants` base
class string, next to the existing `focus-visible:ring-offset-2`, matching every sibling
primitive (`ui/sheet.tsx:57`, `ui/dialog.tsx:42`, `ui/select.tsx:18`, `ui/tabs.tsx:30`). No other
class touched, no other variant restyled. This closes `docs/qa/item-view-mode-report.md`'s Nit 2,
which is also the plan's own Decision 10 deferred backlog item — `docs/backlog.md`'s "Calendar
roving `tabindex` + `button.tsx` `ring-offset-background` retrofit" entry has been split: the
`button.tsx` half is now marked `✅ RESOLVED`, the roving-`tabindex` half remains open under its
own entry.

### Gates (both fixes, final state)

- `npm run typecheck` — clean (`tsconfig.worker.json` + `tsconfig.web.json`).
- `npm run lint` — 0 errors, 2 warnings, same two baseline sites
  (`src/worker/channels/push.ts:150`, `web/src/components/ItemListView.tsx:74`'s
  `onItemsChange` exhaustive-deps) — no new warning introduced.
- `npm test` — 32 test files, **246 tests passing** (244 baseline + 2 new focus-restore tests),
  0 failures.
- `npm run test:e2e` — not run, per instruction (no-op in this repo).

### What QA should re-check

- Re-run the exact Nit 1 reproduction from the report (open via row View button / title button /
  calendar chip; close via Esc, overlay click, shell X, and footer Close — all four paths) in a
  real browser and confirm `document.activeElement` is now the opener, not `<body>`, for all four
  dismissal paths and all three entry points (row title button, row View button, calendar chip).
- Re-check the Nit 2 dark-mode ring-offset on the row's View/Edit/Delete buttons specifically
  (the previously-affected `Button` instances) using the report's documented
  `:focus-visible`-qualifying keyboard-Tab methodology (script-focus the previous element, then
  one real `Tab` keypress) — expect the ring-offset color to now match the dark background
  (`rgb(17,22,24)`-ish), not white.
- The deleted/removed-trigger fallback path (Fix 1's second test) is unit-tested but not
  independently re-verified in a real browser in this pass; QA may want a quick manual check
  (open an item's modal, delete a *different* item from the same list while it's open — the
  trigger itself stays attached in that case, so a truer repro is: open, then have the list
  refresh out from under the row, e.g. via another tab/window — optional, not required to close
  this task).
