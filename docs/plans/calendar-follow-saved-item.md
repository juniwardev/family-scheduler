# Plan: Calendar follows a rescheduled item out of the displayed month

Slug: `calendar-follow-saved-item`
Type: frontend-only — `web/src/components/CalendarView.tsx` plus its test file.
No Worker, API, or schema change.
Source: `docs/backlog.md` — "Calendar does not follow a rescheduled non-recurring item out of the
displayed month", spun out of the D-OQ2 analysis (`docs/plans/view-edit-save-return.md` §1.1.3).
Written directly by the orchestrating session under the standing plan-edit authorization: the
design work was already done and adversarially reviewed across five rounds in the D-OQ2 plan.

## 1. Problem

Edit an item's date to another month from the calendar and save. The modal closes onto a grid
where the item is **nowhere** — it reads as a failed save.

Mechanism, all three steps verified:

- The fetch window is built from `currentMonth` (`CalendarView.tsx:57-58`).
- `reloadToken` re-runs that **same windowed fetch** (`:72`), so a post-save refetch asks for the
  month the user is still looking at.
- The render filters to the displayed year/month (`:82-89`).

So the saved item is neither fetched nor rendered. Nothing is lost — the save succeeded — but the
only feedback is absence, which is indistinguishable from failure.

**This is the defect that motivated D-OQ2.** That item proposed returning to view mode after save;
review established it only *defers* the vanished chip by one Esc press, while this fix closes the
hole outright, and D-OQ2 was closed WONTFIX on exactly that comparison.

## 2. Non-goals

- **No change to `ItemListView`.** The list does not have this problem: `refresh()` updates the row
  in place and the user keeps their position.
- **No return-to-view behavior.** That is the closed D-OQ2; this fix is its replacement, not a
  step toward it.
- **No change to the `onSaved` contract's signature.** `(saved: Item) => void` already carries what
  is needed; `CalendarView` simply stops ignoring the argument.
- No change to the fetch/merge/sort logic, the month-nav buttons, or `ItemModal`.
- **No create-path handling.** Verified: `CalendarView` never calls `openCreate` — there is no
  create affordance on the calendar, so the case cannot arise. If one is ever added, this decision
  must be revisited (see §6 R3).

## 3. Decision — navigate on save, guarded on `rrule`

`CalendarView`'s `onSaved` becomes:

```tsx
onSaved={(saved) => {
  // Follow a rescheduled item so it does not vanish from the grid (see plan §1). Guarded:
  // for a recurring item `saved.start_at` is the SERIES SEED, not the occurrence the user was
  // looking at, so navigating there would jump to an unrelated month.
  if (!saved.rrule) {
    setCurrentMonth(startOfMonth(new Date(saved.start_at)));
  }
  itemModal.close();
  setReloadToken((t) => t + 1);
}}
```

### Why the `rrule` guard is required, not defensive

For a **non-recurring** item, `saved.start_at` **is** its only occurrence
(`src/worker/recurrence.ts:39`), so the navigation target is exact.

For a **recurring** item it is the series seed. This repo's own fixture seeds a series **three
weeks before** the occurrence the test clicks (`CalendarView.test.tsx:58`) — so the unguarded
version would yank a December view back to August on a *title-only* edit. There is no correct
target for a series: the user was looking at one occurrence, and the save may have changed the
whole recurrence. Skipping navigation leaves them where they are, which is the least-wrong answer.

### Why this is not "the grid moves under you"

The guarded navigation is a **no-op unless the user changed the date or removed the recurrence**
(see the exception below — an earlier draft of this line omitted the second clause). Established in
D-OQ2 round-2 review and re-verified here:

- On the calendar the only way to open an item is a chip (`CalendarView.tsx:247`).
- Chips render only for the **displayed** month (`:82-89`).
- A non-recurring item's sole occurrence is its `start_at`.

So before the edit, `startOfMonth(saved.start_at)` **is** the displayed month. It changes only if
the user moved the item.

**One exception, which v1 of this plan asserted away.** The guard reads the **post-save** `rrule`.
Clear the recurrence on a series seeded in August while browsing December, and the item becomes
non-recurring — so the guard lets it through and the grid navigates to August, with no date edit.
The behavior is defensible (the item now genuinely lives in August and nowhere else), but the proof
does not cover it, and "provably a no-op unless the date changed" was overclaimed. State it as:
a no-op unless the user changed the date **or removed the recurrence**.

### Ordering, and why `reloadToken` is still needed

Both run, but **not for the reason v1 of this plan gave.** v1 said `reloadToken` covers the
same-month edit "where the month value does not change" — that is false. `startOfMonth` returns a
**fresh `Date`** (`:18-20`), so `currentMonth` changes by *reference* on every non-recurring save
and the effect at `:72` re-runs regardless of whether the month differs.

The case `reloadToken` actually covers is the **recurring** save, where the guard skips
`setCurrentMonth` entirely and nothing else would trigger a refetch. Without it, editing a
recurring item's title would leave the grid stale.

React batches both updates into **one** effect run, so there is no double fetch — verified in D-OQ2
round-2 review against `:72`, and re-confirmed here (React 18.3.1, `createRoot`).

## 4. Implementation

One edit in `web/src/components/CalendarView.tsx`, at the `onSaved` prop (`:287-290`). The handler
currently takes no parameter and ignores the saved item; it gains the `saved` parameter and the
guarded navigation above. `startOfMonth` (`:18-20`) and `setCurrentMonth` (`:91-92`) already exist
and are unchanged.

Nothing else changes.

## 5. Tests — `web/src/components/CalendarView.test.tsx`

Add a new `describe` with its own `beforeEach`. **Never edit the shared one at `:78-82`** — the 30
existing tests depend on it.

### 5.1 Two mock problems, both of which make naive tests vacuous

**(a) The save path is not mocked at all.** `CalendarView.test.tsx:14-21` spreads `actual` and
overrides only `getOccurrences` and `listAttachments`, so **`updateItem` and `replaceReminders` are
real**. In jsdom they fail, and `ItemEditor` *swallows it* — `onSave(saved)` sits inside the `try`
and the `catch` at `:119-121` only sets error state. So `onSaved` never fires, nothing navigates,
and **N3 and N4 pass while testing nothing**. Mock both in the new `describe`'s `beforeEach`.

**(b) The window-blind fixture.** `:80` returns one fixture regardless of the requested window, so
"the chip is visible in the new month" passes whether or not navigation happened.

**The fix for (b) must be *stateful*, and this is where v1 of this plan contradicted itself.** A
statically window-filtered fixture cannot satisfy both N1 and N2: N2 wants the next-month window
empty, N1 wants the chip present in the next month *after the save*. Both are right — at different
times. So:

```
let rows: OccurrenceEntry[];                      // mutable, seeded in the current month
getOccurrences: (listId, from, to) =>             // window-aware
  Promise.resolve({ occurrences: rows.filter(r => r.occurrence_at >= from && r.occurrence_at <= to) })

// BOTH of these must be mocked, and BOTH must return the exact shape ItemEditor destructures:
//   ItemEditor.tsx:86   const { item: saved } = await updateItem(...)     -> { item: Item }
//   ItemEditor.tsx:103  const { reminders } = await replaceReminders(...) -> { reminders: [...] }
// A bare vi.fn() on replaceReminders throws into the INNER handler (ItemEditor.tsx:102-114),
// which returns WITHOUT calling onSave — finding 2's failure mode through the back door, with
// N3 vacuously green again.
updateItem: (id, patch) => { rows = [ /* NEW entry object at patch.start_at */ ]; return { item: saved }; }
replaceReminders: () => ({ reminders: [] })
```

**Build a *new* entry object in `rows`, never mutate one in place.** The component's stale
`occurrences` state then still carries the old `occurrence_at` and is filtered out of the new
month's render (`CalendarView.tsx:82-89`), so the chip appears only *after* the refetch settles —
which is what makes §5.2's settle-signal rule load-bearing rather than ceremonial. Mutating a
shared object would let N1's chip half go green off stale state with no refetch at all.

N2 asserts the **pre-save** state. N1 asserts the post-save state. Nothing else changes.

### 5.2 Query rules inherited from `calendar-show-more.md` §5.2 — not optional

- **No literal month name in any assertion.** The heading is `toLocaleString`-derived against a
  `new Date()` fixture; a hard-coded `"October"` breaks on the 1st and in any non-English ICU
  environment. **Do NOT "match on the year" instead** — an earlier draft of this rule offered that,
  and for N1 it is *vacuous*: eleven of twelve month moves leave the year identical, so a
  year-match assertion is green on a component that never navigated. A rule written to prevent a
  brittle assertion would have licensed a hollow one, in the fix's only positive test. **Use the
  idiom already in this file** at `CalendarView.test.tsx:145-156`: capture `heading.textContent`
  before, and assert it *changed* after.
- **After a save that navigates, await the `Loading…` settle signal** (`CalendarView.tsx:190` — re-derived this pass; an earlier draft said `:103`, transplanted from `calendar-show-more.md:324` where it was true of the pre-roving-tabindex file) in
  the idempotent `waitFor` + `queryBy` form — **not** a `findBy*` on the chip. `occurrences` state
  is never cleared on nav, so a chip query can resolve off stale state before the refetch lands.
  This is the exact hollow-await this repo has now shipped twice.

### 5.3 The tests

| # | Test | What a wrong implementation would still pass |
|---|---|---|
| N1 | **A moved non-recurring item is followed.** Save with `start_at` in the next month; await the settle signal; assert the heading shows the new month **and** the chip is present | Heading alone passes on a navigation that fetched the wrong window; chip alone passes on the window-blind mock. Both, together, are the test |
| N2 | **The fixture is genuinely window-aware — N1's anti-vacuity control.** Assert **pre-save** that a next-month window returns no rows | Without this N1 is unfalsifiable: a window-ignoring mock makes N1 green under every implementation |
| N3 | **A same-month edit does not navigate.** Save with the month unchanged; assert the heading is unchanged | Passes on an implementation that never navigates — so it is meaningful **only** paired with N1, and only once 5.1(a) is fixed, or it also passes on a save that silently failed |
| N4 | **A recurring item does not navigate — the guard.** Use `RECURRING_ITEM`, whose `start_at` is 21 days before the clicked occurrence (`:58`), which review confirmed lands in the previous month for **every** month of the year. Assert the heading is unchanged | **Load-bearing.** Fails on the unguarded one-liner — the likeliest wrong implementation, and the one that ships a visible defect |
| N5 | **`reloadToken` is still required — asserted on the RECURRING save.** After a recurring save, assert `getOccurrences` was called again | **v1 asserted this on a same-month save, where it is backwards:** `startOfMonth` returns a fresh `Date` (`:18-20`), so `currentMonth` changes *by reference* on every save and the effect re-runs (`:72`) even within the same month — an implementation that deleted `setReloadToken` would still refetch, making the test green on the build it names. The recurring case is the only one where the guard skips `setCurrentMonth`, leaving `reloadToken` as the sole refetch trigger |

**Sabotage, both directions:** remove the `!saved.rrule` guard and confirm **N4 goes red and the
others do not**. Then confirm N1 is **red before the fix and green after** — a reproduction check,
not just a regression check.

## 6. Risks

- **R1 — focus falls to `<body>` after navigating.** Inherited, not introduced: the originating
  chip unmounts (different month), so `document.contains(trigger)` (`ItemModal.tsx:123`) is false
  and Radix's default applies. This is the **same** outcome as today's close-onto-empty-grid, and
  it is pinned as correct behavior for a genuinely detached trigger by
  `ItemListView.test.tsx:211-233`. Accepted; QA should observe it rather than be surprised by it.
- **R2 — the D1/timezone question.** `new Date(saved.start_at)` is device-local, which is exactly
  how the grid buckets days (`CalendarView.tsx:83-88`). Consistent by construction. Routing through
  `item.timezone` here would be the bug, not the fix.
- **R2b — adding a recurrence while also moving the date leaves the vanish case open.** The mirror
  of the exception in §3: the guard reads the **post-save** `rrule`, so an item that gains a
  recurrence *and* a new date is skipped by the guard and the grid does not follow it. This is the
  original defect, surviving in a narrower case. Accepted rather than fixed — there is no correct
  navigation target for a newly-created series, which is the same reason the guard exists — but it
  should be stated rather than discovered.
- **R3 — a future create affordance on the calendar.** §2 records that no create path exists today.
  If one is added, creating an item in another month reproduces this defect and this decision must
  be revisited.

## 7. Done conditions

- `npm run typecheck` clean; `npm run lint` at the 0-errors/2-known-warnings baseline.
- `npm test` green. The **30 pre-existing `CalendarView.test.tsx` tests pass unmodified** — name any
  that cannot and stop.
- `npm run build` succeeds.
- **`npm run test:e2e` green** — this branch touches `web/src/**`, so it is mandatory for QA
  (`CLAUDE.md:54-59`). Quote the pass count in the report.
- N4's sabotage check performed and its output recorded, **and** N1 confirmed red before the fix
  and green after — this is a bug fix, so reproduction must be demonstrated, not assumed.
- **A manual browser check**, because the defect is perceptual: move an item to another month from
  the calendar, save, and confirm the grid follows and the item is visible. Then do the same on a
  **recurring** item and confirm the grid does *not* jump. jsdom cannot judge either.
- Application diff confined to `CalendarView.tsx`'s `onSaved` handler.
- `docs/backlog.md`'s navigation entry marked resolved.
