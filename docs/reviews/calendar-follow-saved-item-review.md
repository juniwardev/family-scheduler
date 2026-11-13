# Review — `docs/plans/calendar-follow-saved-item.md`

Round 1 — 2026-09-19. Reviewer: plan-reviewer (did not write the plan).

Read in full: `web/src/components/CalendarView.tsx`, `web/src/components/CalendarView.test.tsx`,
`web/src/components/ItemModal.tsx`, `web/src/components/ItemEditor.tsx`,
`src/worker/recurrence.ts`, `docs/plans/view-edit-save-return.md` §1.1.3 + §1.2,
`docs/reviews/view-edit-save-return-review.md` (R2.1 and the round-3 sweep),
`docs/plans/calendar-show-more.md` §5.2, `docs/backlog.md:170`, `CLAUDE.md`.

**No self-check manifest is attached to this plan** (it was written directly by the orchestrating
session, not the Architect). Everything below is independently derived from the code; nothing was
taken on trust from the plan or from the D-OQ2 review. Where I inherited a conclusion, I say so.

---

## What I verified and found correct

These are stated here so the next round does not re-derive them.

- **§1's mechanism.** All three citations hold: window from `currentMonth`
  (`CalendarView.tsx:57-58`), effect re-runs on `reloadToken` (`:72`), render filters to the
  displayed year/month (`:82-89`), `onSaved` closes onto that grid (`:287-290`). The defect is
  real.
- **§3's premise, re-derived rather than inherited.** The sole `openView` call site on the
  calendar is the chip (`CalendarView.tsx:247`); the only other opener is `openEdit` from view
  mode (`:286`); there is no `openCreate` anywhere in the file. Chips render only from `byDay`,
  which filters to the displayed month (`:82-89`) — and note this holds even though `occurrences`
  state is *not* cleared on nav, because the render filter, not the fetch, decides what is
  clickable. For a non-recurring item `expandOccurrences` returns `[q.startAt]`
  (`recurrence.ts:37-39`), and `GET /occurrences` sets `occurrence_at` from exactly that
  (`src/worker/routes/items.ts:66-81`). So for an item that was non-recurring *when opened*,
  `startOfMonth(saved.start_at)` is the displayed month before the edit. The premise holds — with
  one exception the plan does not name (R3 below).
- **The device-local question (R2), including the case the prior review did not test.** An all-day
  item stored at 00:00 UTC buckets device-local (`:83-88`) and is *fetched* device-local
  (`:57-58`) — both sides use the same local arithmetic, so fetch window and render filter agree
  by construction in every timezone I tried (UTC−7 and UTC+9, item on a month boundary). Routing
  through `item.timezone` would indeed be the bug. §3/R2 is right.
- **The guard's predicate matches the server's.** `!saved.rrule` is the same truthiness test the
  Worker branches on (`recurrence.ts:37`), so an empty-string rrule is classified identically on
  both sides. Not stated in the plan; no action needed, but it is a genuine strengthener.
- **N4's fixture does discriminate.** `RECURRING_ITEM.start_at = OCCURRENCE_AT − 21 days` with
  `OCCURRENCE_AT` on day 15 (`CalendarView.test.tsx:46,58`). Day 15 − 21 days lands on
  `lastDayOfPrevMonth − 6` — 25th, 24th or 22nd depending on the month — which is in the
  **previous month for every month of the year**, DST shifts included (they move the hour, never
  the day). The unguarded one-liner would change the heading; N4 goes red on it. The orchestrator's
  concern here is unfounded: N4 is a real guard.
- **The "30 existing tests pass unmodified" claim.** Counted: 3 + 1 + 1 + 10 + 15 = 30. No existing
  test in the file reaches a save — the closest, C13 (`:727-750`), opens and Escapes. `onSaved`'s
  prop type is already `(saved: Item) => void` (`ItemModal.tsx:78`, `ItemEditor.tsx:50`), so adding
  the parameter is type-neutral. `App.test.tsx:125-135` renders `CalendarView` but only checks the
  month-nav chrome. No e2e spec performs a save (`e2e/` has no PATCH mock and no Save click), so
  the `test:e2e` gate is unaffected. The claim holds.
- **Batching / double fetch (§3).** React 18.3.1 with `createRoot` (`package.json:55`,
  `main.tsx:23`) — automatic batching covers the promise continuation `onSave` is called from
  (`ItemEditor.tsx:104`), so `setCurrentMonth` + `close()` + `setReloadToken` produce one render
  and one effect run (`CalendarView.tsx:72`). No double fetch. **But the conclusion is right for a
  reason the plan gets wrong — see R1/R2 below.**
- **Scope (§2).** No create path on the calendar: confirmed, no `openCreate` call site.
  `ItemDetails` has **no delete affordance** (its only props of that kind are `onEdit`/`onClose`),
  so there is no delete path from the calendar modal to consider. The `?item=` deep link is
  resolved in `App.tsx` and handed to `ItemListView` only (`App.tsx:234-241`), and
  `CalendarView`/`ItemListView` render in mutually exclusive branches (`App.tsx:229-244`), so
  "edit from the list while the calendar is mounted" cannot occur. §2 is complete on these three.
- **R1's citation.** `ItemListView.test.tsx:211-233` does pin detached-trigger fallback as correct
  behavior, and `ItemModal.tsx:121-127` is the mechanism. Accurate.
- **`CLAUDE.md:54-59`** does say `test:e2e` is mandatory for QA on branches touching `web/src/**`.
  Citation correct.

---

## Findings

### B1 — BLOCKER. §5's fixture spec is self-contradictory: N1 and N2 cannot both pass against it.

§5 instructs: seed "a non-recurring item in the **current** month" and assert "against a
`mockImplementation` that filters by the `from`/`to` it is given" (plan §5:107-109).

Against that fixture:

- **N2** (plan §5:114) asserts the mock returns `[]` for a next-month window. True, by
  construction — the item is seeded in the current month.
- **N1** (plan §5:113) asserts that after a save the heading shows the new month **and the chip is
  present**. After navigation the component fetches the *next-month* window, which the very same
  fixture returns `[]` for. **No chip. N1 fails on the correct implementation.**

The only resolution is a **stateful** fixture: the mocked save mutates the seed's `start_at` (or a
`let startAt` the `mockImplementation` closes over), so a next-month window returns the row *after*
the save and not before. The plan never says this, and it is not a detail a coder can safely
improvise, because it also decides what N2 means: N2's `[]` assertion must be scoped to the
**pre-save** state, and the plan must say so, or N2 becomes an assertion that is simply false at
the moment it runs.

This is the one thing §5 exists to specify, and it is the thing §5 leaves out.

**Blocks a build:** yes. The spec as written cannot be implemented as written.

### B2 — REQUIRED. §5 names the wrong obstacle. The save path is unmocked, and N3/N4 pass vacuously when it fails.

§5:101 calls the window-blind mock "the obstacle". There is a second one, and it is upstream of
the first: `CalendarView.test.tsx:14-21` mocks **only** `getOccurrences` and `listAttachments`,
spreading `...actual` for everything else. Saving in `ItemEditor` calls the **real** `updateItem`
and `replaceReminders` (`ItemEditor.tsx:86-104`) — a live `fetch` against a relative URL in jsdom.
That rejects, `ItemEditor`'s `catch` swallows it into `setError` (`:119-121`), and **`onSave` is
never called**.

Consequences, which differ per test and that is the problem:

- N1 and N5 fail loudly → the coder discovers it. Self-revealing.
- **N3 and N4 pass silently**, because both assert "the heading is unchanged" and the heading is
  trivially unchanged when nothing happened at all. N4 is the load-bearing guard.

The plan's sabotage step (§5:119-120) is what saves N4 — remove the guard, N4 must go red — and it
deserves credit for existing. **N3 has no such backstop** (see NIT-1). The spec must name the
mock explicitly: add `updateItem` and `replaceReminders` to the `vi.mock` factory at
`CalendarView.test.tsx:14-21` — which is a *different* thing from the shared `beforeEach` at
`:78-82` the plan (rightly) forbids editing, and the plan should say that too, so the coder does
not read "never edit the shared one" as forbidding the factory change and invent a workaround.

Also worth pinning in the spec: `updateItem`'s mocked return is what carries `start_at` and
`rrule` into `onSaved` (`ItemEditor.tsx:104` merges `replaceReminders`' result over it), so it —
not the form input — is what each of N1/N3/N4 actually varies. That sidesteps typing into a
`datetime-local` input under jsdom entirely.

### R1 — REQUIRED. N5's stated failure condition is wrong. It is green on exactly the implementation it names.

N5 (plan §5:117) claims it "catches an implementation that replaced `setReloadToken` with
navigation instead of adding to it", tested via a **same-month** save.

`startOfMonth` returns `new Date(...)` (`CalendarView.tsx:18-20`) — a **fresh object every time**.
`setCurrentMonth` therefore never bails out (`Object.is` on two distinct `Date`s is false), the
effect's dep `currentMonth` changes by reference, and the effect re-runs (`:72`) — **even when the
month is identical**. So a navigate-only implementation with `setReloadToken` deleted still
refetches on a same-month save. N5 is green on the build it names, and red on nothing.

The prior review had this exactly right and the plan dropped it:
`docs/reviews/view-edit-save-return-review.md:489-491` — "`startOfMonth` always returns a **new**
`Date`, so the identity check on `currentMonth` always fires."

**The version of N5 that is two-sided is the recurring one.** On the `rrule` branch
`setCurrentMonth` is never called, `itemModal.close()` changes no effect dep, and `reloadToken` is
the **only** thing that can trigger a refetch. So: *save a recurring item; assert `getOccurrences`
was called again.* That is red on the delete-`setReloadToken` implementation and green on the
correct one. As a bonus it is the only test in the set that pins the refetch on the path where it
is load-bearing.

### R2 — REQUIRED. §3's rationale for keeping `reloadToken` is wrong, in a direction that invites a coder to delete it.

§3:85-88: "the `reloadToken` bump covers a same-month edit, where the month value does not change."
The month *value* does not change; the dep does, by reference (R1). So on the non-recurring path
`reloadToken` is genuinely redundant — and a coder or a future reader who checks this sentence
against the code will find it false and may conclude the bump is dead weight.

The true reason to keep it is the **recurring** path, where the guard skips `setCurrentMonth`
entirely and `reloadToken` is the sole refetch trigger. Correct the paragraph; it is the difference
between "keep this, here is why" and "this looks removable."

(The *conclusion* — one effect run, no double fetch — is unaffected and correct. Re-derived
independently above.)

### R3 — REQUIRED. The "provably a no-op unless the user changed the date" proof has an unnamed exception: removing the `rrule`.

The guard inspects `saved.rrule` — the **post-save** value. The proof (§3:71-81) requires that
before the edit `startOfMonth(saved.start_at)` was the displayed month, which only follows for an
item that was non-recurring **when it was opened**.

Take a recurring item seeded in August, browsed in December, opened from its December occurrence.
The user clears the recurrence and changes nothing else. `saved.rrule` is now `null` → the guard
passes → the grid jumps to **August**. No date was edited, and the grid moved.

I judge the *behavior* defensible — the item now has exactly one occurrence, in August, and the
December occurrence the user was reading no longer exists, so following it is arguably the best
available answer. But §3's proof, as written, is false, and it is the sentence the whole "this is
not the grid moving under you" section rests on. Scope it explicitly ("for an item that was
non-recurring when opened") and record the rrule-removal case as a named, accepted exception.

The mirror case belongs in §2 as an accepted residual: **adding** an rrule while also moving the
date leaves the vanish defect unfixed (guard suppresses navigation, chip disappears). Narrow and
acceptable — but §1/§2 currently read as though the vanish case is closed outright, and it is
closed for non-recurring-in and non-recurring-out only.

### R4 — REQUIRED. §5 drops two standing rules from `calendar-show-more.md` §5.2 that apply directly to these tests.

Both were learned the hard way in this exact file, and N1/N3/N4 walk into both:

1. **Never assert a literal month name** (`calendar-show-more.md:308-313`). `monthLabel` and the
   heading come from `toLocaleString("default", …)` against a `new Date()` fixture
   (`CalendarView.tsx:98,184`). "Asserting the heading shows the new month" must be done by
   capturing the heading text before the save and comparing, or by computing the expected label the
   same way the component does — never by a literal. Note the December→January case also rolls the
   **year**, which `new Date(YEAR, MONTH + 1, 1)` handles and a hand-written literal does not.
2. **After a navigation, await the settle signal, not a chip**
   (`calendar-show-more.md:314-331`): `await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument())`.
   This matters more here than it did for test 8: `occurrences` is not cleared on nav, so N1's
   "chip is present" half can resolve off **stale state** on its first attempt — and with the
   stateful fixture B1 requires, whether it does depends on whether the mock mutates a shared
   object or rebuilds entries per call. That is precisely a test that "usually passes."

Cheap, mechanical, and the plan has the precedent one file away.

### R5 — REQUIRED. §7 has no reproduction-confirmation, and the fix's own two-sided check is missing.

§7 requires the sabotage check on N4 (good) but never asks anyone to confirm the bug existed or
that it is gone. Add both:

- **N1 red against unmodified `CalendarView.tsx:287-290`, green after the change** — the two-sided
  check on the fix itself, and a stronger anti-vacuity control for N1 than N2 is (see NIT-2). One
  `git stash` apart.
- **One manual browser check**, because the defect is perceptual ("reads as a failed save") and no
  automated assertion sees what the user sees: open a chip, edit the date into the next month,
  save, confirm the grid lands on the new month with the item visible. `calendar-show-more.md` has
  a §6 manual-checks section for exactly this reason; this plan has none.

---

## Non-blocking

- **NIT-1 — N3 discriminates nothing; the plan half-admits it and should finish the sentence.**
  "Same-month edit does not navigate → heading unchanged" is green on: the correct implementation,
  the never-navigates implementation, the unguarded implementation (same month either way), and —
  per B2 — the save-never-fired implementation. "It is paired with N1" does not make it
  discriminate; N1 discriminates on its own. Keep it if you like as a regression tripwire, but
  label it one rather than listing it as a test of the decision.
- **NIT-2 — N2's justification overstates.** "Without this, N1 is unfalsifiable: a mock that
  ignores its window makes N1 green under every implementation" (plan §5:114) is false: N1's
  *heading* half is red under any implementation that does not navigate, window-blind mock or not.
  What N2 actually is, and is worth being, is a **fixture tripwire** against someone later
  reverting the mock to `mockResolvedValue`. Say that instead. And consider the control that tests
  the component rather than the fixture: assert inside N1 that `getOccurrences` was last called
  with a `from`/`to` spanning the **new** month — that is red on a navigate-but-fetch-the-old-window
  implementation and survives any fixture change.
- **NIT-3 — citation imprecision.** §4:94 says "`setCurrentMonth` (`:91-92`) already exists".
  `:91-92` are `prevMonth`/`nextMonth`, i.e. existing *call sites*; the declaration is
  `CalendarView.tsx:27`. Inherited verbatim from `backlog.md:170`. Conservative direction, changes
  nothing.
- **NIT-4 — one sentence missing from R1 that would save QA a filed defect.** After navigating,
  `rememberedId` (`CalendarView.tsx:150`) can name a chip that no longer exists in the new month;
  `resolveRovingId` (`:152`) falls back, and C11 (`CalendarView.test.tsx:695-712`) already pins
  that path. Worth naming alongside the `<body>` focus note so the observer knows the roving state
  is handled, not merely unexamined. `expandedDays` is immune by its month-scoped key (`:34-43`) —
  also worth half a sentence.

---

## Trajectory

This is a small plan for a real defect, and the reasoning it inherits from D-OQ2 survives
re-derivation — the premise, the guard, the timezone choice and the batching conclusion are all
correct, and §2's scope claims (no create path, no delete path, no cross-view case) each check out
against the code. The defects are concentrated in §5, which is where the plan itself predicted
problems would be, and in two inherited-then-degraded sentences about `reloadToken` (R1/R2) where
the prior review was more precise than this plan is. None of this is a rewrite.

## Required changes

1. **(B1)** Specify the fixture as **stateful**: the mocked save mutates the seed's `start_at` so
   a next-month window returns the row after the save and not before; scope N2's `[]` assertion
   explicitly to the pre-save state. As written, N1 and N2 cannot both pass.
2. **(B2)** Add `updateItem` and `replaceReminders` to the `vi.mock` factory
   (`CalendarView.test.tsx:14-21`) and say so — distinguishing the factory from the shared
   `beforeEach` at `:78-82`, which stays untouched. Note that the mocked `updateItem` return, not
   the form input, is what varies `start_at`/`rrule` across N1/N3/N4.
3. **(R1)** Replace N5 with the **recurring**-item version (save a recurring item; assert
   `getOccurrences` was called again). The same-month version is green on the implementation it
   claims to catch, because `startOfMonth` returns a new `Date` and the effect dep always changes.
4. **(R2)** Correct §3's reason for keeping `reloadToken`: it is load-bearing on the `rrule`
   branch, not on the same-month branch.
5. **(R3)** Scope §3's no-op proof to items that were non-recurring **when opened**, and record
   rrule-removal (navigates without a date edit) and rrule-addition-plus-move (vanish case stays
   open) as named, accepted exceptions in §2/§6.
6. **(R4)** Carry `calendar-show-more.md` §5.2's two applicable rules into §5: no literal month
   names in heading assertions, and await the `Loading…` settle signal after the navigation before
   asserting the chip.
7. **(R5)** Add to §7: N1 red on unmodified `CalendarView.tsx` and green after, plus one manual
   browser reproduction of the defect and its absence.

APPROVE WITH CHANGES

---

# Round 2 — 2026-09-19

Re-read the revised plan in full, plus `CalendarView.tsx:186-193`, `ItemEditor.tsx:99-123`, and
`calendar-show-more.md:314-331` (the source of the inherited settle-signal rule).

## The two re-derivations the coordinator asked for

**1. Does the stateful mock in §5.1 satisfy N1 and N2 simultaneously? Yes — traced, and it works
for a reason worth writing down.**

- **N2, pre-save:** `rows` is seeded in the current month; the next-month window filter yields `[]`.
  Green.
- **N1, post-save:** the mocked `updateItem` reassigns `rows` to a row at the new `start_at`; the
  guarded navigation then fetches the *next-month* window, which now matches. Green.
- The predicate `occurrence_at >= from && <= to` (plan §5.1:138) matches the component's window
  (`CalendarView.tsx:57-58`) and the server's own inclusive test (`recurrence.ts:39`) on both ends.
- **The non-obvious part that makes it sound:** `rows = [ … ]` builds a **new** entry object, so the
  component's stale `occurrences` state still holds the *old* `occurrence_at` and is filtered out of
  the new month's render (`:82-89`). The chip therefore appears **only** after the refetch settles —
  which is exactly why §5.2's settle-signal rule is load-bearing here and not ceremony. Mock and
  await rule cohere. Had the sketch mutated a shared object in place instead, N1's chip half would
  have resolved off stale state and gone green without any refetch. The plan picked the right shape.

**2. Is N5-on-the-recurring-save genuinely two-sided? Yes.**

- Correct implementation: guard skips `setCurrentMonth`; `itemModal.close()` touches no effect dep;
  `setReloadToken` bumps → effect at `:72` re-runs → second `getOccurrences`. Green.
- The implementation it names (navigation substituted for `setReloadToken`): guard skips
  `setCurrentMonth`, nothing else changes `currentMonth`/`lists`/`reloadToken` → **no refetch**. Red.

It is the only one of the five that can distinguish those two builds, and the recurring path is the
only place `reloadToken` is load-bearing. The rewrite is correct, and §3:93-103 now carries the
right reason. Both round-1 findings R1 and R2 are properly closed.

## Round-1 findings: disposition

| # | Round-1 finding | Status |
|---|---|---|
| B1 | §5 fixture self-contradiction | **Closed** — verified above |
| B2 | Unmocked save path | **Closed** — §5.1(a); see R2-3 for one gap in the sketch |
| R1 | N5's failure condition backwards | **Closed** — verified above |
| R2 | §3's `reloadToken` rationale | **Closed** (§3:93-103) |
| R3 | No-op proof exception | **Half closed** — rrule-removal is now stated (§3:84-89); the mirror residual is still missing (R2-4) |
| R4 | §5.2 rules | **Closed in substance, two defects introduced** — R2-1, R2-2 |
| R5 | Reproduction confirmation | **Closed** (§5.3:164-166, §7:190-194) — and §7 goes further than asked by adding the recurring negative to the manual check |
| NIT-1 | N3 is a tripwire | **Closed** — §5.3's N3 cell now says so plainly |
| NIT-2 | N2's overstated justification | Survives verbatim at §5.3:159 (see NIT below) |
| NIT-3 | `setCurrentMonth (:91-92)` | Survives; still acceptable |
| NIT-4 | `rememberedId` / `expandedDays` note for QA | Not added; still a NIT |

## Findings

### R2-1 — REQUIRED (does not block). §5.2's month-name rule offers an escape hatch that makes N1's heading half vacuous.

§5.2:146-148: "Derive the expected label the same way the component does, **or match on the year**."

The first option is right. The second is not an option for N1. N1's heading assertion has to
distinguish October from November; the **year is identical** for eleven of the twelve possible
month moves, so `expect(heading).toHaveTextContent(String(YEAR))` is green on a component that
never navigated. A rule written to prevent a brittle assertion has licensed a vacuous one, in the
fix's only positive test.

The file already contains the idiom that works, and it is locale-proof, rollover-proof and one
line: `CalendarView.test.tsx:145-156` captures `heading.textContent` before the action and asserts
it changed. Pair that with the expected label built from the same expression the component uses
(`CalendarView.tsx:184`) over `new Date(YEAR, MONTH + 1, 1)`. Delete the "or match on the year"
clause.

### R2-2 — REQUIRED (does not block). The `Loading…` citation is stale by 87 lines — inherited from the plan it was copied out of.

§5.2:149 cites the settle signal as `CalendarView.tsx:103`. In today's file `:103` is
`const dayCells = Array.from(…)`; the `Loading…` span is at **`:190`**. The source of the error is
visible: `calendar-show-more.md:324` says "`Loading…` (`CalendarView.tsx:103`)", which was true of
the pre-roving-tabindex file. The rule was carried across correctly; the line number came with it
and was not re-checked.

Low consequence — `queryByText("Loading…")` does not need a line number to work — but this is the
same failure the coordinator recorded from the backlog sweep, one document over and in the same
revision: a remembered string transplanted without re-derivation. Worth fixing precisely because
the round-1 fix list is where it entered.

### R2-3 — REQUIRED (does not block). §5.1's mock sketch has the wrong return shape and omits the mock whose absence reproduces finding 2.

The sketch at §5.1:135-140 is what a coder will copy. Two problems:

- `updateItem: (id, patch) => { … return saved; }` — the real signature resolves to
  **`{ item: Item }`** (`ItemEditor.tsx:86` destructures `const { item: saved }`). Returning a bare
  `Item` makes `saved` `undefined`; `{ ...undefined, reminders }` is legal, so nothing throws — it
  flows into `onSaved` as an object with no `start_at`, `new Date(undefined)` is Invalid Date, and
  N1 fails with an `Invalid Date` heading and a `NaN` fetch window rather than with a useful
  message.
- The sketch shows only `updateItem`, though §5.1(a) correctly names **both**. `replaceReminders`
  is destructured at `ItemEditor.tsx:103` (`const { reminders } = await …`), so a bare `vi.fn()`
  returning `undefined` **throws** — and it is caught by the *inner* handler at
  `ItemEditor.tsx:102-114`, which `return`s **without calling `onSave`**. That is finding 2's exact
  failure mode arriving through the back door: N1/N5 red, **N3 vacuously green**, N4 saved only by
  the sabotage check. Show `replaceReminders` resolving `{ reminders: [] }` in the sketch.

While there: §5.1:124 cites the swallowing `catch` as `:119-121`; the catch body is `:119-120` and
`:121` is the `finally`. More usefully, the handler that matters for the **edit** path these tests
exercise is the inner one at `:102-114`, not the outer one.

### R2-4 — REQUIRED (does not block). The mirror residual from round-1 R3 was not folded in.

Round 1 asked for both halves. The rrule-**removal** case is now stated well (§3:84-89). The
rrule-**addition** case is still absent from §2 and §6: add a recurrence *and* move the date in the
same save, and `saved.rrule` is non-null, so the guard suppresses navigation and the chip vanishes
from the displayed month exactly as it does today. Reachable (`RecurrenceEditor` and the Start
field are both in the same form), narrow, and reasonable to accept — but §1 and the backlog entry
will read as "the vanish case is closed", and the next person to hit it will file a regression
instead of finding it named. One bullet in §6.

## Non-blocking

- **NIT — N2's justification still overstates, verbatim from v1** (§5.3:159): "a window-ignoring
  mock makes N1 green under every implementation" is false; N1's *heading* half is red under any
  implementation that does not navigate, window-blind mock or not. N2 is a **fixture tripwire**
  against a future revert to `mockResolvedValue`, which is worth having under its true description.
  Raised as a NIT in round 1 and kept a NIT here for consistency.
- **NIT — no timing rule for the three non-navigating saves.** §5.2's settle rule is scoped to "a
  save that navigates", which excludes N3, N4 and N5. For N3/N4 an assertion that runs mid-flight
  sees an unchanged heading for the wrong reason — finding 2's shape caused by timing instead of by
  a missing mock. The risk is small (`await user.click` flushes the two resolved-promise awaits in
  practice, and N4's sabotage check is a genuine backstop for exactly this), and N5 fails in the
  safe direction. Cheapest fix: drop the "that navigates" qualifier — `Loading…` appears on every
  one of these saves, and the `waitFor` + `queryBy` form is idempotent, so the rule is safe to apply
  uniformly.
- **NIT — §3:81-82 still states the derivation unscoped** ("It changes only if the user moved the
  item"), two lines above the paragraph that corrects it. The adjacency means it cannot mislead;
  "for an item that was non-recurring when opened" would close it.
- **NIT — provenance.** The coordinator's message says §3 now notes the D-OQ2 review "had it right
  at `:489-491`". That citation is not in the plan text. Nothing load-bearing depends on it, but it
  is one more instance of the pattern the coordinator flagged: the recollection of an edit and the
  edit itself diverging. Flagging only because this round is where that pattern is being tracked.
- **On the coordinator's grep note**, since it is on the record: the shortest distinctive fragment
  is the right instinct, but the sharper rule is that the fragment must be chosen from the
  **mechanism**, not the prose. `no-op unless` worked because it names the behavior; "provably a
  no-op unless the user changed the date" failed because it is a sentence someone composed. Round 1
  found `startOfMonth`'s fresh-`Date` defect the same way — by asking what `:72` compares, not by
  searching for what the plan said about it.

## Trajectory

Round 1: 1 blocker, 6 required, 4 nits. Round 2: **0 blockers, 4 required, 4 nits** — and two of
the four required (R2-1, R2-2) were *introduced* by round 1's fixes rather than surviving them,
which is the normal cost of a correct large edit and not a sign of drift. The substance is settled:
the decision, the guard, the ordering argument, the no-op proof and the test set's discriminating
power have all now been derived independently and hold. Every remaining item is a one-to-three-line
edit inside §5 or a bullet in §6; none changes the implementation, the test set, or the done
conditions.

I am not asking for a round 4. If R2-1 through R2-4 are folded in, this is ready for the Coder.

## Required changes

1. **(R2-1)** Delete "or match on the year" from §5.2's month-name rule. Point N1/N3/N4 at the
   capture-the-heading-and-compare idiom already in the file (`CalendarView.test.tsx:145-156`),
   with the expected label built from `CalendarView.tsx:184`'s own expression.
2. **(R2-2)** Correct the settle-signal citation: `Loading…` is `CalendarView.tsx:190`, not `:103`
   (`:103` is stale, inherited from `calendar-show-more.md:324`).
3. **(R2-3)** Fix §5.1's sketch: `updateItem` must resolve **`{ item: saved }`**, and
   `replaceReminders` must appear resolving **`{ reminders: [] }`** — a bare `vi.fn()` there throws
   into `ItemEditor.tsx:102-114`, which returns without calling `onSave` and re-opens finding 2 for
   N3. Cite `:102-114` as the handler that matters for the edit path.
4. **(R2-4)** Add the mirror residual to §6: adding a recurrence *and* moving the date in one save
   leaves the vanish case open by design, because the guard reads the post-save `rrule`.

APPROVE WITH CHANGES

---

# Round 3 — 2026-09-19

Re-read the plan in full and re-derived every changed line against source. This is the round that
gates the Coder, so I re-checked the discrimination set from scratch rather than inheriting my own
round-2 conclusions.

## The four required items

- **R2-1 — closed.** §5.2:160-167. The year-match escape is gone, the reason it was wrong is stated
  so it is not re-offered, and it points at `CalendarView.test.tsx:145-156`. I read that span: it is
  `const initialText = initialHeading.textContent` … `expect(nextHeading.textContent).not.toBe(initialText)`
  — the capture-and-compare idiom, correctly cited.
- **R2-2 — closed.** §5.2:168 now says `CalendarView.tsx:190`. Confirmed: `:190` is the
  `{loading && <span …>Loading…</span>}` line. The provenance note is a good habit; it tells the
  next reader *why* a stale number was there, which is what stops it coming back.
- **R2-3 — closed.** §5.1:140-147. Both mocks present, both returning the destructured shape
  (`{ item: Item }`, `{ reminders: [] }`), with the inner-handler warning attached to the sketch
  rather than to prose the coder will skip. The `getOccurrences` arity matches the real call site
  (`CalendarView.tsx:64`).
  The addition I did not ask for is the best edit of this round: §5.1:150-154 promotes
  **"build a new entry object, never mutate in place"** from an aside in my report to a stated
  requirement, with the reason. That is the difference between the settle-signal rule being
  load-bearing and being ceremony, and a coder who mutates in place would have shipped a green N1
  that proves nothing.
- **R2-4 — closed.** §6 R2b. Correctly reasoned: accepted, not fixed, because a newly-created
  series has no correct navigation target — the same premise the guard rests on. Stated rather
  than discovered, which was the whole point.

## Re-derived independently: can the criteria distinguish the chosen approach from the rejected ones?

This is the question that decides whether the test set is worth running, so I re-ran it end to end
rather than trusting rounds 1-2.

| Rejected implementation | Caught by | Verified |
|---|---|---|
| No navigation (status quo / D-OQ2's return-to-view) | N1 | Heading half red without navigation; chip half red without a correctly-windowed refetch |
| Unguarded navigation | N4 | `RECURRING_ITEM.start_at` is 21 days before a day-15 occurrence → `lastDay − 6` of the **previous** month, for every month of the year |
| Navigation with `setReloadToken` deleted | N5 (recurring) | On the guard path nothing else touches `currentMonth`/`lists`/`reloadToken`, so no refetch |
| Navigation that fetches the wrong window | N1's chip half | Only reachable with the window-aware stateful mock, which §5.1 now specifies |

Complete, and §5.3:183-185 plus §7:215-216 force both directions to be *demonstrated* — sabotage
red, reproduction red-then-green — rather than asserted. N3 discriminates nothing and N2 tests the
fixture rather than the component; both are disclosed in their own cells, and neither is a
false-pass risk for the application.

## Surviving nits — all previously raised, none blocking, listed only so the record is complete

- §5.1:142's comment cites the `replaceReminders` destructure as `ItemEditor.tsx:102`; it is
  `:103` (`:102` is the `try {` that opens the same two-line construct). The span on the next
  line, `:102-114`, is exact. New this round, in a comment destined for the test file — landing one
  line early on the opening brace of the named construct misleads nobody.
- §5.1:124's `catch` at `:119-121` is `:119-120`; `:121` is the `finally`. Raised round 2.
- §5.2's settle rule is scoped to "a save that navigates", leaving N3/N4/N5 without a timing rule.
  Raised round 2; mitigated in practice and N4's sabotage check is a real backstop.
- §5.3:178's N2 cell still overstates ("green under every implementation"). Raised rounds 1 and 2.
- §3:81-82's derivation sentence is still unscoped, two lines above the paragraph that corrects it.
  Raised round 2.
- §4:109's `setCurrentMonth (:91-92)` points at the call sites, not the `:27` declaration. Raised
  round 1. The coordinator's sweep calling it correct is defensible under the "existing idiom"
  reading, which is what the sentence means.

None of these changes a line of application code, a test, or a done condition. I am not asking for
another round, and none of them should delay dispatch.

## Trajectory and verdict

Round 1: 1 blocker, 6 required, 4 nits. Round 2: 0 blockers, 4 required, 4 nits — two of them
introduced by round 1's own fixes. Round 3: **0 blockers, 0 required**, one new nit of a single
line's offset inside a comment.

The shape of round 2's defects was worth the round: both were corrections that overshot, and the
coordinator's own post-hoc sweep found the generalisable rule — the citations derived from source
were right, the one carried across from another document was wrong. That rule is now applied
rather than described.

What the Coder is getting: a two-line application change whose premise, guard, ordering argument
and residuals have each been independently derived; a five-test spec whose fixture is specified
precisely enough to be implementable and whose discrimination set covers every wrong
implementation identified across three rounds; and done conditions that require the fix to be
falsified in both directions before it ships. Ready to build.

APPROVE
