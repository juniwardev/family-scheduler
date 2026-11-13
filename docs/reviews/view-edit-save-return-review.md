# Review — `docs/plans/view-edit-save-return.md` (round 1)

Reviewer: Plan-Reviewer (adversarial pass). Date: 2026-09-19.
Plan reviewed at commit `0c6b048` (clean tree, branch `main`).

---

## 0. What I independently re-derived, and what I took on trust

The plan ships a self-check manifest (§10). Per the review protocol I sampled the load-bearing
entries rather than re-deriving all of them, and reviewed in full what the manifest says it did
**not** check.

**Re-derived independently (manifest entries I did not take on trust):**

| Manifest claim | Verdict | How |
| --- | --- | --- |
| B1..B5 = `start_at`/`end_at`/`rrule`/`timezone`/`all_day`, "derived twice, independently" | **Partly wrong — see F3** | Read `src/worker/routes/items.ts:65-85`, `src/worker/db.ts:698-701`, **and `src/worker/recurrence.ts:30-109`, which the manifest does not list** |
| N_CAL = 30 | **Correct** | Counted `it(` in `CalendarView.test.tsx`: 30 (`:85, 92, 104, 129, 145, 244, 254, 273, 293, 309, 318, 337, 351, 385, 403, 527, 553, 568, 589, 602, 617, 628, 643, 670, 685, 695, 714, 727, 752, 762`) |
| N_LIST = 10 | **Correct** | Counted `it(` in `ItemListView.test.tsx`: `:95, 108, 122, 137, 157, 167, 175, 184, 197, 211` |
| N_DESK = 2 | **Correct** | `ItemModal.desktop.test.tsx:74, 92`; file read in full |
| "no test constructs `mode: "edit"`" | **Correct** | Repo-wide grep: only `web/src/components/ItemModal.tsx:24` (type arm) and `:60` (construction); every other hit is in `docs/` |
| "every existing focus-restore test closes from **view** mode" | **Correct** | `ItemListView.test.tsx:197-209` and `:211-233` both open via `openView` (title click); `CalendarView.test.tsx:727-750` (C13) opens via `{Enter}` on a chip → `openView` (`CalendarView.tsx:247`) |
| `vitest.workspace.ts:46` collects `web/**/*.test.ts` | **Correct, and worth flagging as a good catch** | `vitest.workspace.ts:39-48`. Note this contradicts `docs/plans/item-view-mode.md:665` (R3), which is now stale. The plan is right and the old plan is wrong |
| `e2e/fixtures/api-mocks.ts:202` throws; no write routes | **Correct** | `api-mocks.ts:180-203` — only two GET matchers before the throw |
| LINT_BASE 0/2 `[quoted]` from `docs/backlog.md:154` | **Correct quote**, and correctly refused as a pin | `backlog.md:154` |
| E2E_PASS = 6 `[quoted]` from `docs/backlog.md:164` | **Correct quote** | `backlog.md:164` ("went 1 failed/5 passed → **6 passed**") |
| EST_BACKLOG "about one line once decided" | **Correct quote** | `backlog.md:168` |

**Taken on trust (not re-run, not re-derived):** that `npm run lint`/`npm test`/`npm run build`
currently pass; the *content* of `docs/qa/item-view-mode-report.md:248-254` and `:75`; the
`docs/plans/item-view-mode.md:957-962` focus-scope reasoning. The plan is honest that it ran
nothing (manifest "What I did NOT check" item 1), and steps 0/6/7 are the right catch.

**Reviewed in full because the manifest says it did not check them:**

- **Manifest item 2 — Radix in-jsdom unmount timing for R6.** This is the single highest-value
  omission and it produced **F4** below: the omitted uncertainty is not the deciding factor at all.
- **Manifest item 3 — `App.deeplink.test.tsx` / `App.test.tsx` not read.** I did not read them
  either, but I traced the reasoning: the plan changes no `App.tsx` line, does not touch
  `openView`, and does not touch the deep-link effect (`ItemListView.tsx:76-84`). `openView`'s
  signature and body at `ItemModal.tsx:51-57` are untouched by §3-§5. I consider the claim sound.
- **Manifest item 4 — no layout/pixel/timing quantity.** Confirmed; this change has none.

---

## 1. Findings

Each finding is graded **BLOCKER** (must be resolved before the Coder starts), **REQUIRED**
(fold in, does not by itself stop a build), or **NIT**.

### F1 — BLOCKER. The one sentence the PROCEED verdict rests on is asserted, not argued, and the alternative it waves away is ~1 line inside `web/src`.

The premise itself is **real — I traced it and it holds.** `CalendarView.tsx:57-58` windows the
fetch to `[startOfMonth(currentMonth), end-of-month]`, the effect re-runs on `reloadToken`
(`:72`), and the render filters occurrences to the displayed year/month (`:82-89`). A save that
moves an item out of the displayed month therefore refetches a grid in which the item appears
**nowhere**, and `onSaved` (`:287-290`) closes the modal onto exactly that. §1.1's "returning"
point 1 is not theoretical. Good.

What does not hold is §1.2:69-70:

> "no cheaper fix exists inside `web/src` (navigating the grid to follow the item is a larger
> feature — §2)."

That is the whole load-bearing step from "the gap is real" to "build *this*", and it is one
parenthetical with no argument behind it. The alternative is:

```tsx
// CalendarView.tsx, in onSaved
setCurrentMonth(startOfMonth(new Date(saved.start_at)));
```

`startOfMonth` already exists (`CalendarView.tsx:18-20`) and `setCurrentMonth` is already the
month-nav idiom (`:91-92`). That is inside `web/src`, needs no new module, no state-shape change,
no type change, and — unlike this plan — it **actually closes the hole**. The plan concedes twice
that its own fix does not: §2 item 3 ("the grid behind the modal will not show it") and R10 ("a
*reduction* of today's harm"). So the deciding argument of §1.1/§1.2 ("the modal closes onto a
grid where the thing the user just saved is not visible at all") describes a condition that is
still true after this feature ships — it is merely deferred by one Esc press. Stated precisely,
the benefit this plan delivers on the calendar is **one screen of post-save confirmation**, which
is the same benefit §1.1 point 2 of the *closing* case dismisses as not worth a dismissal on the
list. It is a genuine delta on the calendar (the information is not otherwise on screen) but it is
materially narrower than §1.2 claims.

I am not asserting the cheap alternative wins. There are real counterarguments the plan never
makes, and it should make them:

1. **`saved.start_at` is the series seed, not the occurrence you were looking at.** With the
   repo's own fixture (`CalendarView.test.tsx:51-69`) the seed is three weeks before the clicked
   occurrence. Navigating by it can land the user in a *more* surprising month than staying put.
2. Navigating is an unrequested side effect of a save on the surface the user is browsing.
3. It interacts with `rovingId` (a remembered `c-<day>-<i>` may not exist in the new month —
   `CalendarView.tsx:249`, `lib/calendarFocus.ts`) and with `expandedDays`' month-scoped keys
   (`:43`, `:106`).
4. It buys the **list** side nothing, and the plan already concedes the list side buys little.

**Required:** argue the alternative down on its merits (points 1-4 are a fair start), or fold it
in, or accept that it obsoletes most of the value and take the WONTFIX branch §1.2:72-77 already
drafts. Until that is settled, the plan's PROCEED is not earned and the Coder should not start.
If the conclusion changes, bring the plan back for a round rather than proceeding.

### F2 — BLOCKER. Including `all_day` in the comparison set ships a known-wrong render in a reachable case, and §7.1 case 6 pins it green.

§3.4's closing note calls the `all_day` over-drop "the safe direction (a correct item-level render
instead of a possibly-correct occurrence render)", and §6 edge case 5 repeats it. **Both describe
the harm backwards**, and this is exactly the wrong-referent class: the thing rendered after a
drop is not "the item level", it is **a different occurrence** — `item.start_at` is the series'
first occurrence (`ItemDetails.tsx:42`, and `ItemModal.tsx:19-20` says so in as many words).

Concretely, with the repo's own fixture semantics: recurring item, user opens occurrence #4 from a
chip, ticks "All day", saves.

- `all_day` is the only B-field that changed — I verified the toggle does **not** normalize
  `start_at`: `ItemEditor.tsx:229-237` sets only `all_day`; `start_at` is re-*rendered* as a date
  input (`:247-256`) but `draft.start_at` is untouched. So the case is reachable, not theoretical.
- Per Decision 3, the context is dropped → the returned view shows a date **three weeks earlier**
  than the one the user was reading, and the series hint disappears (`ItemDetails.tsx:51`).
- That is *precisely* the harm §3.4 uses to reject option **3B**: "would silently jump the
  displayed date back to the series' first occurrence and drop the series hint, immediately after
  a save — a visible, unexplained change, and precisely the stale-referent failure mode this plan
  exists to avoid."

The same mechanism is condemned in one row of the table and blessed four paragraphs later. And
carrying is never wrong here: `all_day` does not move the epochs (F3), so
`formatOccurrenceTime(occurrenceAt, tz, saved.all_day)` renders that occurrence's own date,
correctly, in the new format. Including B5 is a **pure loss** — its only justification is
matching `db.ts:698`, which exists for a different purpose (purging pending reminder dispatch).

Worse, §7.1 case 6 ("`all_day` differs → `false`") makes the wrong behavior a **green criterion**.
A Coder who implements the plan and then notices the problem has to argue with a test.

**Required:** pick one, before coding.
- (a) Drop `all_day`: the set becomes the four fields occurrence values actually derive from
  (`start_at`, `end_at`, `rrule`, `timezone`), §7.1 case 6 flips to `true` and is renamed, and one
  comment records *why* the client set deliberately differs from `db.ts:698`. This also dissolves
  R7 and Open question 1 (see §2 below). **My recommendation.**
- (b) Keep it, but replace the "safe direction" paragraph and edge case 5 with the true harm
  ("on a recurring item opened at a non-first occurrence, an all-day toggle moves the displayed
  date to the series start — accepted as rare"), so the cost is recorded honestly rather than
  inverted.

### F3 — REQUIRED. "`expandOccurrences` reads `allDay`" is a true statement about the call site attached to the wrong referent, and it is the basis of the "provable, not a judgment call" claim.

§1.3's B1..B5 row and §3.4 both say the expansion "reads `startAt`/`rrule`/`timezone`/`allDay`",
citing `src/worker/routes/items.ts:66-75`. Those lines are the **argument list at the call site**.
The function itself — `src/worker/recurrence.ts:30-109` — never references `q.allDay`: the
non-recurring branch returns `q.startAt` (`:39`), and the recurring branch uses only `tz`,
`q.startAt` and `q.rrule` (`:35-108`). `allDay` is accepted into `OccurrenceQuery` (`:23`) and
dropped on the floor.

So the true occurrence-derivation set is **four** fields, and the manifest's "derived twice,
independently" is not independent: both derivations land on the same five-name list for different
reasons (the call site passes `allDay`; `db.ts:698` purges on it), and neither establishes that
`allDay` affects an occurrence value. The manifest's file list (§10) confirms it — `recurrence.ts`
was never opened.

The *rule* survives: B1..B5 unchanged ⟹ identical occurrence pair is still true, because a
superset of the real dependency set is sufficient for that direction. But "provably what the
server would say" is doing work it has not earned, and it is what keeps B5 alive (F2).

**Required:** correct the two citations to point at `recurrence.ts:30-109` for what the expansion
depends on, state the ⟹-only direction explicitly (the converse fails for `all_day` always, and
for `timezone` on non-recurring items, where the drop happens to be harmless because
`occurrenceAt === item.start_at`), and drop or re-ground the "independently derived" manifest line.

### F4 — REQUIRED. The R6 test was reclassified as "a guard, not a test" for a reason that is not the operative mechanism. A non-vacuous jsdom test is writable.

§7.3 declines the dismiss-during-save test because "Radix in jsdom (no real animation) may unmount
`ItemEditor` on close *before* the promise resolves, in which case `onSave` never fires". The
manifest (item 2) correctly flags that this was not verified. It is the wrong mechanism:

`ItemEditor.handleSubmit` (`ItemEditor.tsx:80-124`) has **no cancellation guard** — no `cancelled`
flag, no `AbortController`, nothing (contrast `AttachmentsView.tsx:20-37`, which does have one).
The `await updateItem(...)` → `await replaceReminders(...)` → `onSave({ ...saved, reminders })`
chain holds the `onSave` prop in a closure. Unmounting the component does not cancel an in-flight
promise chain, so **`onSave` fires regardless of when Radix tears the portal down**. Whether the
editor survives the close is irrelevant to whether the callback runs.

And both parents stay mounted throughout — `finishSave` and `refresh()` both target
`ItemListView`'s state, not the modal's — so the whole path is live after the dismissal.

That makes the test both writable and falsifiable:

- deferred `updateItem`, resolved `replaceReminders`; click Save; `{Escape}`; await dialog gone;
  resolve the deferral; flush; assert **no** dialog.
- Red build: `finishSave` without the `prev === null` early return returns a view state and the
  dialog reappears (or throws on `prev.mode` — either way, red). That is the naive implementation,
  so it is highly reachable.
- **Anti-vacuity positive control** (this is the part §5.2 demands): assert
  `apiClient.getItems` has been called twice. The parent's `refresh()` runs from the same
  `onSaved`, so if `onSave` never fired the count stays at 1 and the test fails instead of passing
  hollowly. That is a direct answer to "what would this still pass on?"

R6 is currently the only named risk in the plan with no criterion at all. Fold the test in, or
re-state the reason for omitting it in terms of the actual mechanism.

### F5 — REQUIRED. R5's grep verification states counts that a correct build will not produce.

§3.2:222-224 says the grep "today returns one hit, `ItemModal.tsx:60`". It returns **two**:
`ItemModal.tsx:24` (`| { mode: "edit"; item: Item };`) matches the pattern as well.

After the change it returns **four**, not the "exactly two hits" of R5 and §9 step 4: the type arm
(which the plan's own §3.2 shape keeps on its own line, `mode: "edit";`), `openEdit`, and
`openEditFromView`'s **two** literal construction expressions — one per ternary branch (plan
:370 and :380). §9 step 3's "one hit at this point" is likewise off by one.

This is a checklist step whose stated pass condition is unreachable on a correct build. A Coder
who follows it literally stops and reports a defect that is not there — or, worse, learns to
ignore the step. The underlying mechanism (a required, no-default `returnToView` makes TypeScript
fail any new construction site) is sound and I have no complaint with it; only the stated numbers
are wrong. Either restate them (2 → 4) or switch to a grep that means what R5 means, e.g.
`grep -n 'returnToView:' web/src` → exactly two hits.

### F6 — REQUIRED. §1.4's focus goal and QA check (f) do not hold on the motivating path.

§1.4's last goal: "closing the returned-to view restores focus to the row/chip that opened the
modal in the first place." On the calendar's date-change path — the case that justifies the whole
feature — this is **false**. `finishSave` returns to view, the parent's `setReloadToken` refetches,
and the chip that opened the modal is unmounted (a different day cell, or out of the month
entirely). `handleCloseAutoFocus`'s `document.contains(trigger)` (`ItemModal.tsx:123`) is then
false, it does not `preventDefault()`, and focus lands on `<body>` — the ending §3.6 calls "a
worse ending than the feature's whole premise."

This is pre-existing, deliberate behavior (`ItemListView.test.tsx:211-233` pins it), so I am not
asking for a fix. I am asking that the plan stop promising the opposite:

- AC8/L4 cannot see it — `renderList` keeps `items` static and `onItemsChange` a no-op
  (`ItemListView.test.tsx:85`), and `getOccurrences` is mocked to return the same fixture forever
  (`CalendarView.test.tsx:80`), so the trigger never detaches in any planned test.
- QA (f) says "Repeat after (c) for the chip" — (c) is the *unchanged-timing* case. The gap sits
  precisely between (d) and (f), so a human reading §8 will not find it either.

**Required:** qualify §1.4's goal ("…when the originating row/chip is still rendered; a save that
moves the item off the grid detaches the trigger and focus falls back to Radix's default — see
`ItemListView.test.tsx:211`"), and add a one-line QA note after (d).

### F7 — REQUIRED (small). Decision 5b is the only decision with no pinning criterion.

The plan's own method is to pin decisions mechanically rather than state them: AC3 pins D1, AC11
pins D2 ("§7 AC11 is the test that fails on this rejected build, so the decision is mechanically
pinned rather than stated", §3.3:246), AC5/AC6 pin D3 and are each other's red build, AC4 pins D4,
AC8 pins D5a. **D5b — "Cancel / Esc / overlay / X still CLOSE, they do not return to view" — has
nothing.** A build where a view-originated edit's Cancel returns to view passes all 13 criteria.

Symmetry-with-Save is exactly the temptation 5b argues against, so this is not an idle worry. The
fix is one assertion appended to L1 (view → Edit → **Cancel** → `waitFor` dialog gone), or an
entry in §7.3's "considered and NOT included" list stating that the red build requires code the
plan nowhere specifies (`onCancel={onClose}` at `ItemModal.tsx:163` is untouched). Either is fine;
silence is not, given the plan's own standard.

### F8 — REQUIRED (small, but it reaches the owner). "Roughly 40× the estimate" understates the cost by about 5×.

§1.1:59-60 enumerates three deliverables — "one new pure module, ~35 lines across three existing
`web/src` files, and 13 new tests" — then concludes "Roughly 40×". The multiplier is `35 / 1`; it
silently excludes the module and the tests it just listed. With `occurrenceBasis.ts` (~25 lines
with the comments §9 step 1 makes mandatory) and 13 tests (L1-L4 and C-S1/C-S2 are multi-assertion
component tests; 7 helper cases), the honest figure is **150-250×**.

This is not pedantry: §1.2:73-74 hands the owner a WONTFIX option and names "40× an estimate" as
the reason it is defensible. The number is an input to a ship/close decision made by a human.
Correct it, or say plainly that the multiplier counts app-code lines only.

### F9 — NIT. `openEditFromView`'s defensive branch opens the modal with a stale `triggerRef`.

§3.5's fallback (`: { mode: "edit", item, returnToView: null }`) fires when `prev` is not a view
state — including `prev === null`, i.e. opening the modal from closed. Because Decision 5a has
this function deliberately not write `triggerRef`, that path would open a modal whose restore
target is whatever `triggerRef.current` was left holding by the *previous* open (`ItemModal.tsx:42`
is only written at `:48, 53, 59`). If that element is still attached, Esc focuses an unrelated
control.

Unreachable today — `onEditRequested` is only wired to `ItemDetails`' Edit button
(`ItemModal.tsx:149`), which renders only in view mode (`:141`) — so this is a NIT and it blocks
nothing. But the plan's house style is to make unreachable states not-silently-wrong. `if (prev
=== null) return prev;` is cheaper than the current fallback and cannot invent a focus bug.

### F10 — NIT. `web/src` file-count/describe-count inconsistency.

§4 row 6 says `ItemListView.test.tsx` gains "three new `describe` blocks"; §7.2 specifies four
tests (L1-L4) and §9 step 8 says "N_LIST + 4 passing". Not a contradiction (L1 and L4 could share
a describe) but it reads as one. Reconcile.

### F11 — NIT (documentation, but a good one). The invariant that actually makes R9 unreachable is not the one the plan states.

I tried hard to reach a partial carry through the specified flow and **could not** — the plan's
both-or-neither ternary pair is sound. But the reason is not the one §3.4/R1 give.

`ViewOrigin`'s two optional fields legitimately admit `{occurrenceAt: <number>, occurrenceEndAt:
undefined}`: `CalendarView.tsx:247` passes `occ.end_at ?? undefined`, and `occ.end_at` is `null`
exactly when `item.end_at` is `null` (`src/worker/routes/items.ts:77-81`). So a "partial" pair is
not merely possible, it is **normal** for an item with no end — and harmless, because
`ItemDetails.tsx:43` then falls through to a `null` `item.end_at` and renders a single time.

What makes R9's backwards range unreachable is the **coupling**: `occurrenceEndAt` is undefined
*iff* `item.end_at` is null, established at those two sites and **preserved across the save by
comparing `end_at` (B2)** — any transition between null and a number drops the whole context. That
is the load-bearing fact, and it is not written down. A future `openView` caller that supplied an
occurrence end independently of `item.end_at`'s nullity would reopen R9 without tripping AC5, AC6
or AC7. One sentence in the `ViewOrigin` doc comment closes it.

---

## 2. Direct answer on scope (your question 6): the B1..B5 mirror does **not** need a `tests/`-side parity test.

Open question 1 should be closed as "not at all", not deferred to the backlog.

1. **The parity target is wrong.** `db.ts:698`'s `timingFields` exists to decide when to purge
   pending reminder dispatch (`db.ts:735-738`). The client's set exists to decide when a captured
   occurrence pair is still valid. They coincide today by accident, not by construction. A parity
   test asserting `clientSet === db.ts:698` would encode the coincidence as a requirement and go
   red on a legitimate change to *either* side.
2. **It would pin a provably irrelevant field.** Per F3, `expandOccurrences` ignores `allDay`. A
   parity test would lock `all_day` into the client set — the exact field F2 argues should leave.
3. **Drift has no correctness or security consequence**, and the plan's R7 already says so
   correctly. This is categorically unlike `permissions.ts`/`authz-rule-parity.test.ts`, where the
   mirror gates a UI affordance over an authorization rule; `docs/backlog.md:167` is explicit that
   the parity test's purpose there is drift detection on a *security* rule.
4. **The real guard already exists and is in scope**: `occurrenceBasis.test.ts` case 7 (§7.1) is a
   `web/src` unit test that fails a deep-equality helper, and AC5/AC6 exercise the rule end-to-end.

If F2(a) is adopted, the client set stops being a mirror at all and this question disappears
along with R7. That is the cleanest outcome: one comment in `occurrenceBasis.ts` explaining why
the client's four fields deliberately differ from the Worker's five, and no cross-boundary test.

---

## 3. Things I attacked and could not break — stated so the next round does not re-litigate them

- **The calendar premise (your question 1, first half).** Real. Traced above in F1.
- **Decision 3's forward direction.** B1..B5 unchanged ⟹ the server would re-expand to the same
  `occurrence_at`/`end_at` pair. Holds — a superset of the true dependency set is sufficient.
  Nothing else feeds the expansion: `recurrence.ts:30-109` reads only seed/rule/zone, and
  `routes/items.ts:65-89` applies no completion/exception filtering.
- **Partial carry (your question 2).** Not reachable through the specified flow; see F11 for the
  reason, which differs from the plan's.
- **Re-editing after a return.** `openEditFromView` re-reads `prev.mode === "view"`, so a second
  round trip captures the *current* (possibly already-dropped) context and behaves correctly. The
  `<ItemEditor>` `key` (`ItemModal.tsx:158`) guarantees the second edit snapshots the **saved**
  item. §6 case 10 is right.
- **The `triggerRef` pre-existing bug (your question 3).** Real, and I reproduced it by reading:
  `openEdit` overwrites `triggerRef` with `document.activeElement` (`ItemModal.tsx:58-61`), which
  on the view→edit path is `ItemDetails`' Edit button (`ItemDetails.tsx:146-151`); that button is
  detached one render later when `effective.mode` flips (`ItemModal.tsx:141-153`); so
  `document.contains(trigger)` is false at `:123` and focus falls to `<body>`.
  **Not writing the ref is correct, not merely convenient**: `triggerRef` is semantically
  "what opened this modal", a mode swap is not an open (`state` never becomes `null`, `open` stays
  `true` at `:114`, `onCloseAutoFocus` never fires), and `openEdit`'s write remains correct because
  a row-Edit click *is* an open-from-closed. **Not scope creep either** — the new flow ends in a
  view-close, so the fix is load-bearing for AC8; the old flow's improvement is an unavoidable
  consequence of the same one-line choice, not a separate change that could have been deferred.
  The plan's rejected alternative (write the ref, accept `<body>`) is correctly rejected. Keep as
  is. (F6 qualifies what it delivers; F9 is a separate nit on the fallback branch.)
- **The mode discriminator.** "No `textbox` and no `/^save$/i` button" genuinely distinguishes
  view from edit here: the only input-bearing subtree in view mode would be `AttachmentsView`,
  which renders links and images only (`AttachmentsView.tsx:55-85`), and the submit label is
  `"Save"` for edit vs `"Create"` for create (`ItemEditor.tsx:307`) — so L3's `/^create$/i` is
  right and will not collide with L1/L2's `/^save$/i`.
- **AC4's expected count of 2.** Correct for both parents: `ItemListView.tsx:66-74` fires once on
  mount and `:94-99` once on refresh; `CalendarView.tsx:51-72` fires once per list per effect run
  and the fixtures use one list.
- **L4's focus assertion will not be flaky for the wrong reason.** `renderList` passes a no-op
  `onItemsChange` (`ItemListView.test.tsx:85`), so the post-save `refresh()` cannot re-render the
  row away; the title button node survives and `toHaveFocus()` means what it says.
- **AC5/AC6 really are each other's red build**, and together they discriminate Decision 3 from
  both rejected option 3B and the no-helper build. This is the sharpest thing in the test plan.
- **Dropping the "dialog not remounted" criterion (your question 4) was the right call.** A single
  functional `setState` cannot unmount the portal, and the only build that would (`close()` then
  `openView()` across two ticks) still ends with focus inside a dialog. Node-identity assertions
  are brittle and the user-visible property (no blink) is properly routed to manual QA (g).
- **"No existing test needs modification" (your question 5) holds.** Verified three ways: no test
  constructs `mode: "edit"` anywhere in the repo; `ItemModalProps` is unchanged, so
  `ItemModal.desktop.test.tsx`'s two direct `state={...}` constructions (`:75`, `:95`) are both
  `mode: "view"` and keep compiling; and both `vi.mock` factories spread `actual` and are only
  gaining keys no existing test invokes (`ItemListView.test.tsx:10-19`,
  `CalendarView.test.tsx:14-21`). The instruction to append the calendar tests as a **top-level**
  describe is also correct — the roving-tabindex block has its own `beforeEach` overriding
  `getOccurrences` (`CalendarView.test.tsx:427-429`) and nesting inside it would silently swap the
  fixture out from under C-S1/C-S2.
- **`e2e` deferral (§2 item 2).** Well-founded, not hand-waved. Verified at
  `api-mocks.ts:180-203`.
- **File/line citations.** I spot-checked 20+ and found no wrong line numbers other than the grep
  counts in F5. `ItemEditor.tsx:135` (list select create-only), `:86-104`, `:105-114`, `:306`,
  `ItemDetails.tsx:42-43`, `:51`, `:142-144`, `:147`, `ItemModal.tsx:48/53/59`, `:78`, `:101-104`,
  `:114`, `:121-127`, `:158`, `:170/179`, `db.ts:73`, `:698-701`, `types.ts:40-44`,
  `backlog.md:154/164/168`, `calendar-show-more.md:333-334`, `item-view-mode.md:513-515`, `:671`
  all check out. Citation hygiene in this plan is high.

---

## 4. Required changes

1. **(F1)** Argue down the ~1-line `setCurrentMonth(startOfMonth(new Date(saved.start_at)))`
   alternative in `CalendarView`'s `onSaved`, or fold it in, or take the WONTFIX branch. §1.2's
   "no cheaper fix exists inside `web/src`" cannot stand as a bare assertion when it is the sole
   bridge from "the gap is real" to "build this". While you are there, reconcile §1.2's "the item
   is not visible at all" framing with §2 item 3 / R10, which concede this plan does not fix that.
2. **(F2)** Resolve `all_day`: either drop it from the comparison set (recommended — flip and
   rename §7.1 case 6, add a comment on why the client set differs from `db.ts:698`), or keep it
   and rewrite §3.4's closing note and §6 edge case 5 to describe the real harm (the displayed date
   jumps to the series' first occurrence) instead of calling it "a correct item-level render".
3. **(F3)** Re-cite the occurrence-derivation set to `src/worker/recurrence.ts:30-109` rather than
   the call site's argument list, state the implication as one-directional, and withdraw or
   re-ground the manifest's "derived twice, independently".
4. **(F4)** Either add the R6 dismiss-during-save test (with the `getItems`-call-count positive
   control that makes vacuity fail rather than pass), or restate the reason for omitting it —
   `ItemEditor.tsx:80-124` has no cancellation guard, so `onSave` fires after unmount regardless of
   Radix's teardown timing, and the stated reason does not hold.
5. **(F5)** Fix the grep counts in §3.2, R5 and §9 steps 3-4 (2 today, 4 after), or switch to
   `grep -n 'returnToView:' web/src` → exactly two hits.
6. **(F6)** Qualify §1.4's focus goal for the detached-trigger case and add a QA note after check
   (d); AC8/L4 provably cannot cover it with static fixtures.
7. **(F7)** Pin Decision 5b with one assertion (view → Edit → Cancel → dialog gone) or record it
   in §7.3's "considered and NOT included" list with its reason.
8. **(F8)** Correct "Roughly 40×" or scope it explicitly to app-code lines; it is an input to the
   owner's WONTFIX decision.
9. **(F9, F10, F11 — nits, fold in if convenient)** `openEditFromView`'s `prev === null` fallback;
   the three-vs-four describe count in §4 row 6; and one sentence on `ViewOrigin` recording that
   `occurrenceEndAt` is undefined iff `item.end_at` is null, which is what actually makes R9
   unreachable.
10. **(§2 of this review)** Close Open question 1 as "no parity test", with the reasoning above,
    rather than deferring it to the backlog.

This is a strong, careful plan — the premise section argues against itself honestly, the criteria
sweep is real work, and AC5/AC6 are a model of pinning a decision rather than an output. Two of
the three things it got wrong (F2, F3) trace to a single root: a field list adopted from a
neighbouring rule without opening the function it claimed to mirror. The third (F1) is the
familiar one — the alternative that was never costed.

APPROVE WITH CHANGES

---

# Review — round 2 (v2, verdict reversed to WONTFIX)

Reviewed: `docs/plans/view-edit-save-return.md` v2, read in full (1276 lines). Date: 2026-09-19.

Round 1's verdict line above is preserved verbatim; it applied to v1. The last line of this file
is the round-2 verdict.

This pass is weighted, as instructed, toward **auditing the reversal rather than confirming it**.
A wrong "don't build" is the more expensive error because nobody revisits it. I therefore spent
this round trying to restore v1's premise — to show the guarded navigation does not work, or that
return-to-view is worth more than v2 prices it at — and report below both what I tried and where
it failed.

**Headline: I could not break the WONTFIX. The reasoning is sound and in one respect stronger
than the plan argues.** What I did find is that the two artifacts that will *outlive* this plan —
the closed backlog entry and the two spin-off entries in §9.1, which are the entire job under this
verdict — are specified with a missing safety valve, a wrong comparative figure, and a fix
description that invites a silent regression. Under a WONTFIX those documents *are* the
deliverable, so defects in them are not documentation polish.

## R2.0 — how I checked the v1 findings were folded in

Spot-checked, not re-derived wholesale. All eleven land:

| Finding | Checked | Verdict |
| --- | --- | --- |
| F1 | §1.1.1-§1.1.3, §1.2, §2 item 3, §9.1 | Folded in, and it reversed the verdict — audited in detail below |
| F2 | §3.4, §5, §6 edge case 5, §7.1 case 6, §7.3 AC7, §9.2 steps 1/2/10 | Correct. `all_day` gone from the set; edge case 5 inverted to **carried**; case 6 flipped to `true` with v1's five-field helper named as its red build; the sabotage list gained "add `all_day` back" |
| F3 | §1.3 B1..B4 row, §3.4, helper comment | Correct. Re-cited to `recurrence.ts:30-109`; "provably" retired; implication stated one-directional with **both** converse failures named (`all_day` always, `timezone` on non-recurring) |
| F4 | R6, §7.2 L5, §7.3 AC12, §9.2 step 10 | Correct, and the sabotage instruction "check it fails on assertion 1, not on the `getItems` control" is better than what I asked for |
| F5 | §3.2 block quote, R5, §9.2 step 4 | Correct, and the *right* fix: counts abandoned as a form in favour of a file-scoping property. I re-checked the property holds on a correct build — `returnToView` would appear in `ItemModal.tsx` only, since both parents call `finishSave`/`openEditFromView` and no planned test constructs state |
| F6 | §1.4 block quote, AC8 row, L4 scope limit, QA **(d2)** | Correct. (d2) is placed immediately after (d), which is where the gap sits, and tells QA not to "fix" it |
| F7 | §3.6 5b, L1 step 5, AC13 | Correct |
| F8 | §1.1.4 table, COST_TOTAL | Folded in — **but the same referent error recurs in the comparison that now carries the verdict. See R2.2** |
| F9 | §3.5 `if (prev === null) return prev;` | Correct |
| F10 | §4 row 6, §9.2 step 8 | Correct; N_NEW = 14 is internally consistent (7 + 5 + 2) |
| F11 | `ViewOrigin` doc comment, R1 | Correct, and more complete than I asked: it names the future `openView` caller that would reopen R9 without tripping AC5/AC6/AC7 |

On the manifest's struck entry (you asked whether it states the lesson usefully or
performatively): **usefully.** It generalises to a rule a future reader can apply — "a call site's
argument list is a derived property of the function's *signature*, not of its *behavior*" — ties it
to the repo's existing `assert-the-thing-not-the-derived-property` memory, says what it did
instead, and records that the `0|1`-vs-boolean check it *did* perform "carefully verified that a
field compared correctly, without checking whether it should be compared at all." That last
sentence is the whole failure mode in one line. Recording that it survived a second reader is
load-bearing evidence for the rule, not self-flagellation; keep it.

## R2.1 — Question 1: is the guarded navigation actually sufficient? I attacked it and it holds.

This is the load-bearing claim of the reversal and it is tagged `[estimate]`, unbuilt. If it fails,
v1's premise is restored. I tried five ways to break it:

1. **Double fetch.** `setCurrentMonth` + `setReloadToken` in the same handler. Both are state
   updates in the same async continuation; React 18 batches those into one render, so the effect
   (`CalendarView.tsx:72`, deps `[currentMonth, lists, reloadToken]`) runs once. The plan's claim
   at `:116-117` is right. Note `startOfMonth` always returns a **new** `Date`, so the identity
   check on `currentMonth` always fires — but since `reloadToken` fires too, the run count is one
   either way. No defect.
2. **Timezone mismatch.** `new Date(saved.start_at)` computes the month in the **device's** zone,
   not `item.timezone`. Could that target the wrong month? No — and this is the check that matters
   most: the grid itself buckets days in device-local time (`CalendarView.tsx:83-88` does
   `new Date(occ.occurrence_at).getFullYear()/.getMonth()/.getDate()`). Navigating device-local is
   therefore *exactly* consistent with how the grid decides what a month contains. A Coder who
   "improved" this by routing through `item.timezone` would introduce the bug. **Not stated
   anywhere in the plan — it belongs in the spin-off entry (R2.4).**
3. **Focus / roving-tabindex collateral.** A stale `rememberedId` after navigation is already
   handled: `resolveRovingId` (`CalendarView.tsx:152`) falls back, and C11
   (`CalendarView.test.tsx:695-712`) pins exactly that behavior on the month-nav path.
   `expandedDays` keys are month-scoped (`:106`) and the dormant-entry cost is already documented
   at `:38-42`. No defect.
4. **The guard's logic on rule changes.** Recurring → non-recurring (user removes the `rrule`):
   `saved.rrule === null`, so it navigates to `saved.start_at`'s month. Correct — the item now has
   exactly one occurrence and that is where it is. Non-recurring → recurring: no navigation, and
   there is genuinely no right target. The guard behaves correctly at both boundaries.
5. **Does the guard actually prevent the surprise navigation it exists to prevent?** Here the plan
   **undersells its own fix, and the missing argument makes it airtight.** On the calendar the only
   way to open the modal is a chip (`CalendarView.tsx:247` is the sole `openView` call site; the
   `?item=` deep link routes through `ItemListView.tsx:76-84`, not here), and chips only render for
   occurrences inside the displayed month (`:82-89`). For a **non-recurring** item,
   `expandOccurrences` returns `[q.startAt]` (`recurrence.ts:39`), so `occurrence_at === start_at`
   — meaning the pre-edit `start_at` is *necessarily* in the displayed month. Therefore:

   > **The guarded navigation is provably a no-op unless the user actually changed the date.**

   That answers, in advance, the premise question §9.1 step 2 says the spin-off "needs its own
   premise check" ("navigating the grid as a side effect of a save is itself a surprise"). It
   cannot be a surprise for the only items it acts on. The December→August yank the plan rightly
   warns about is reachable *only* through the recurring path, which the guard excludes by
   construction — so the guard is not a heuristic that happens to work, it is exactly the right
   predicate.

**Conclusion: the alternative works, and the reversal's factual basis is sound.** Manifest item 5's
reopen condition ("if it turns out not to work at all, reopen this plan") is correctly stated, and
on my reading it will not be triggered.

One citation note, aimed at the coordinator rather than the plan: the hand-off message cites
`startOfMonth` at `CalendarView.tsx:17-19` and `setCurrentMonth` at `:90-91`. Both are off by one.
`startOfMonth` is `:18-20` and the `prevMonth`/`nextMonth` idiom is `:91-92` — which is what **the
plan** says. The plan's line numbers are right and the independent verification is the one that
slipped. Harmless here, but worth saying out loud in a round whose subject is exactly this class of
error.

## R2.2 — BLOCKER. The "~100× cheaper" comparison repeats F8's referent error, inside the correction that fixed F8 — and it is written into the permanent backlog record.

§1.1.4 correctly rebuilt COST_TOTAL to include the module and the tests (F8). But the comparison
that now carries the verdict does not apply the same rule to the other side:

- Verdict banner (`:15`): "closes the motivating hole better and **~100× cheaper**".
- §1.1.3 table header (`:121`): "Guarded navigation (**~2 lines**)" vs "This plan (**~300 lines**)".
- §9.1 step 1 (`:1051-1053`): "**~100× more cheaply** served by guarded month navigation" —
  **this sentence goes into `docs/backlog.md` and becomes the permanent record.**

`~300` counts app code **plus ~270 test lines**. `~2` counts app code **only**. This repo does not
ship an untested behavior change to `CalendarView` — `calendar-show-more.md` §5.2 and the
falsification discipline in §9.2 step 10 are the plan's own evidence — and a test for the
navigation fix is not cheap here: `CalendarView.test.tsx:80` mocks `getOccurrences` to return one
fixture **regardless of the `from`/`to` window**, so proving "the grid navigated *and* the chip is
now visible" needs a window-aware `mockImplementation` plus a second fixture. Call it 40-60 lines.
Like-for-like the ratio is roughly **5-10×, not ~100×**.

**This does not change the verdict**, and I want to be explicit about why, because the distinction
matters for what to edit:

- Reason 1 (v1's deciding premise was false; navigation *closes* what this defers) is qualitative
  and untouched.
- Reason 2 (the residue is a nicety) is untouched.
- Reason 3 is `COST_TOTAL` vs `EST_BACKLOG` — 300 lines against "about one line" — a *different*
  comparison that stands on its own and is correctly computed.
- Reason 4 (derivation drift) is untouched.

So the fix is to correct the figure, not to reopen the decision. But it must be corrected **before
step 1 runs**, because step 1 writes it into `docs/backlog.md`, where it will be read by someone
who was not here and cannot recompute it. §1.1.4 says, correctly, that understating a multiplier
"biases the decision it exists to inform" — that applies with more force to the number that
justifies a permanent close. Suggested honest framing: *"~2 app lines plus a window-aware grid
test, against ~60 app lines plus ~270 test lines — an order of magnitude, and strictly closer to
the symptom."*

## R2.3 — BLOCKER. The condition that would invalidate this WONTFIX is not in the artifact that records the WONTFIX.

Manifest item 5 (`:1236-1241`) is the most important sentence in v2:

> "I did not implement or measure the §1.1.3 navigation alternative… if it turns out not to work
> at all, **reopen this plan**, because that would restore v1's premise."

That is exactly right. But §9.1 step 1's **Re-open if** list — the text that becomes the backlog
entry — contains only two conditions, both experiential ("the owner finds themselves reopening
items after a save…", "the calendar navigation ships and the recurring-timing-edit case still feels
blind"). **The condition that invalidates the reasoning is absent**, and so is the fact that the
verdict rests on an alternative that was never built or measured.

The failure mode is concrete: the navigation item is filed separately (§9.1 step 2), someone
attempts it in six months, discovers it is harder than two lines or does not work, closes *that*
item — and `backlog.md:168` still reads as a settled WONTFIX with no link back. The plan's own
framing ("nothing else in the codebase depends on it") makes it especially unlikely anyone
re-derives the chain.

**Required, before step 1 runs:**
1. Add to the entry's Re-open list: *"the guarded month-navigation fix (spun out below) is
   attempted and does not work, or costs materially more than estimated — that would restore the
   premise this closure rejected."*
2. State in the entry that the closure rests on an alternative that is **`[estimate]`, unbuilt**.
3. Make the two entries link **both ways**: the navigation entry should say that closing it
   without shipping reopens D-OQ2.

This is the one finding I would not let through. Under a WONTFIX the backlog entry is the entire
deliverable, and a don't-build decision without its own invalidation condition is exactly the
artifact nobody revisits.

## R2.4 — REQUIRED. The `view → edit → Esc` spin-off, as specified, points a Coder at a fix that silently regresses an untested path.

§9.1 step 2's second entry gives the symptom and the mechanism correctly (`openEdit` overwrites
`triggerRef` at `ItemModal.tsx:58-61`; the in-dialog button detaches; `:123`'s `contains` check
fails) and prices it at "~1 line". It does **not** say what the line is — and in this plan the fix
was "`openEditFromView` does not write `triggerRef`", which only exists because *this plan* creates
`openEditFromView`. Standalone, that fix is unavailable.

The obvious standalone reading of "openEdit overwrites triggerRef" is "so stop overwriting it" —
i.e. delete or unconditionalise the write at `:59`. That breaks the **row-Edit → Esc** restore, and
**no existing test would catch it**: `ItemListView.test.tsx`'s focus-restore describe
(`:196-233`) has two tests and both open via the **title button** (`openView`), never the row's
Edit button; the one test that clicks row Edit (`:108-118`) asserts only the displayed value.
`CalendarView.test.tsx` C13 likewise opens via a chip. So the row-Edit focus-restore path is
entirely unguarded, and a careless one-line fix regresses it in silence.

The correct shape is a **conditional** write — only capture `document.activeElement` when opening
from closed (`state === null`), because `triggerRef` means "what opened this modal" and a mode swap
is not an open. The entry should say that, and should say that any fix here needs a new test for
row-Edit → Esc restore since none exists. Two sentences; without them the "~1 line" estimate is a
trap.

## R2.5 — REQUIRED. §1.1.3 table row 3 undersells return-to-view on the calendar, and the table is the decision.

You asked whether "defers by one Esc press" is fair. **For the vanish case, yes** — I checked and
it is accurate, and §1.1.2 immediately balances it by conceding the confirmation *is* a genuine
delta on the calendar. No complaint there.

But row 3 ("Any item, timing unchanged → *Shows the same view the user already had*") is not
accurate, and it is the row that decides how much residue is left after navigation takes row 1:

- The calendar chip renders **the title and nothing else** (`CalendarView.tsx:252`). So on the
  calendar, an edit to notes, location, reminders or recurrence gets **zero** confirmation from the
  grid — today, and after the navigation fix, which only moves the month.
- The returned-to view renders all of them (`ItemDetails.tsx:76-133`).
- The list is the opposite case, and this is precisely why §1.1's closing-case point 2 is right
  *there*: `ItemRow` already renders location (`ItemListView.tsx:268`), notes (`:270`) and the
  reminder count (`:271-275`), so closing genuinely does confirm the save.

So the honest residual is "post-save confirmation of everything the calendar chip does not render,
which is everything except the title", not "the same view the user already had".

**It does not flip the verdict** — I pushed on it and it will not carry the weight: the user has
just typed those values, `ItemEditor` surfaces failures inline rather than silently
(`:119-120`, `:105-114`), and reason 3's cost argument is untouched. It is also partly offset in
the other direction: row 2's recurring-timing case is **narrower** than the table implies, since a
series only vanishes from the grid if the *whole series* leaves the displayed month (a weekly item
moved a few days is still on screen), which further thins the residue. But a deciding table should
be right in both directions, and this one is currently generous to the conclusion in one row and
harsh in another. Restate row 3.

## R2.6 — NITs

- **N1.** §1.3's COST_TOTAL row says "~60 app + **~240 test** ≈ 300"; §1.1.4's table rows sum to
  40 + 150 + 80 = **270** test and **330** total. The plan explicitly argues only at
  order-of-magnitude resolution, so nothing downstream moves — but the referent table exists to
  make every quantity checkable, and this one does not reconcile with the table it summarises.
- **N2.** §1.3's B1..B4 row cites `web/src/types.ts:40-44` as the artifact. That five-line span
  contains `all_day` at `:42`, which is now excluded. The cell says so explicitly, so this is
  cosmetic, but `:40-41, :43-44` would be exact.
- **N3.** R10 still reads in its v1 register ("Out of scope (§2 item 3)… a *reduction* of today's
  harm… QA check (d) makes it visible") while §2 item 3 has been promoted to the reason for the
  verdict. Retained-design section, so harmless; reconcile if touching it.
- **N4.** AC13 is folded into L1 as step 5, so L1 now carries five claims (AC1, AC2, AC4, AC8's
  prerequisite, AC13). §9.2 step 10 attributes sabotages correctly, so it works, but a failure in
  L1 no longer identifies which claim broke. Only relevant under an overrule.

## R2.7 — What else in the dead plan is worth preserving? (your question 3)

I went looking for knowledge that dies if §3-§7 are never built. Three candidates, two of which are
already safe:

- **The four-field derivation** (`recurrence.ts:23` accepts `allDay`; `:30-109` never reads it).
  This is a durable fact about the Worker, not about the feature, and it is now recorded in three
  places in the retained plan. Safe.
- **The F11 nullity coupling.** Not load-bearing in shipped code — nothing carries an occurrence
  pair across a save today — so parking it in the unbuilt design is correct. Safe.
- **QA check (d2)'s content is NOT safe.** It documents that a calendar date-change save detaches
  the originating chip and drops focus to `<body>`, that this is expected, pre-existing, pinned by
  `ItemListView.test.tsx:211-233`, and must not be "fixed". **The guarded navigation inherits that
  behavior exactly** — it also unmounts the originating chip, for the same reason. If this plan is
  WONTFIXed, (d2) dies inside a retained §8 marked "Moot", and whoever builds the navigation fix
  meets the `<body>` focus result cold and may file it as a regression. One sentence in the
  navigation spin-off entry preserves it.

The two spin-offs are otherwise **correctly scoped as separate items.** Navigation has its own
premise question (largely answered by R2.1 point 5), its own test shape, and touches only
`CalendarView`; the focus defect is pre-existing, one line, and independent of both. Neither should
have been smuggled into this plan, and the plan is right not to.

## R2.8 — Trajectory

Round 1: 2 blockers, 6 required, 3 nits, on a plan recommending a build. Round 2: the blockers are
gone at the root — not patched — and one of them reversed the verdict, which is the outcome an
adversarial review is for. Every one of the eleven findings is folded in, most of them better than
I specified (the count→property substitution in F5 and the sabotage-attribution instruction in F4
both improved on what I asked for). The v2 findings below are smaller in kind: two are wrong
numbers/omissions in documents that outlive the plan, one is a trap in a hand-off description, one
is a table row that overstates the conclusion it supports. None of them touches the reasoning.

I tried to restore v1's premise and could not. **The WONTFIX is correct** and I would say so
plainly even if the plan had recommended it in round 1.

## Required changes

1. **(R2.3, blocking)** Add the invalidation condition to §9.1 step 1's **Re-open if** list — the
   navigation fix failing or costing materially more restores v1's premise — and state in the
   backlog entry that the closure rests on an unbuilt `[estimate]`. Link the two new entries both
   ways. This must land in the backlog text, not only in §10's manifest.
2. **(R2.2, blocking)** Correct "~100× cheaper" in the verdict banner (`:15`), §1.1.3's table
   header (`:121`) and §9.1 step 1 (`:1051-1053`): the `~2` figure excludes the test lines that the
   `~300` includes, and a grid-navigation test here needs a window-aware `getOccurrences` mock
   (`CalendarView.test.tsx:80` returns one fixture for every window). Like-for-like it is ~5-10×,
   which is still decisive.
3. **(R2.4)** In the `view → edit → Esc` spin-off, state the standalone fix shape (write
   `triggerRef` only when opening from closed) and warn that the row-Edit → Esc restore path has
   **no test** (`ItemListView.test.tsx:196-233` and C13 all open from view), so the obvious "stop
   overwriting it" fix regresses it silently.
4. **(R2.5)** Restate §1.1.3 table row 3: on the calendar the chip renders only the title
   (`CalendarView.tsx:252`), so a notes/location/reminders/recurrence edit gets no confirmation
   from the grid either way — unlike the list, where `ItemRow` already renders all three
   (`ItemListView.tsx:268-275`).
5. **(R2.7)** Carry QA check (d2)'s content into the navigation spin-off entry: navigating also
   detaches the originating chip, so focus lands on `<body>` by design, pinned by
   `ItemListView.test.tsx:211-233`, and is not a regression to file.
6. **(R2.1, recommended, not blocking)** Add the sufficiency argument to the navigation spin-off,
   because it answers the premise check the entry says is still open: chips only render for the
   displayed month (`CalendarView.tsx:82-89`) and a non-recurring item's occurrence *is* its
   `start_at` (`recurrence.ts:39`), so the guarded navigation is a no-op unless the user changed
   the date. Also note that the month must be computed device-local (`new Date(saved.start_at)`),
   matching how the grid buckets days (`:83-88`) — not through `item.timezone`.
7. **(R2.6, nits)** COST_TOTAL's "~240 test" vs the table's 270; the `types.ts:40-44` span that
   includes the excluded `all_day`; R10's stale register.

APPROVE WITH CHANGES

---

# Review — round 3 (backlog entries committed at `9fab2f0`, unpushed)

Date: 2026-09-19. Round 2's verdict line above is preserved; the last line of this file is the
round-3 verdict.

I audited the committed artifact (`docs/backlog.md:168-170`) and the plan's changed sites, and
re-read the code behind every line-citation that changed. **Both blockers are genuinely fixed, in
the right artifact, and the reversal remains sound** — I have nothing new against it. But things
remain open, and since I was asked to say so plainly rather than clear the gate, I will.

The short version: **the shipped backlog entries are right; the plan section that specifies them
is stale, and the committed entry contains one self-contradictory number.**

## R3.1 — blockers: both cleared

**R2.3 (invalidation condition) — fixed, and correctly.** `backlog.md:168`'s **Re-open if** list
now carries three conditions, the third being the reasoning-level one, with the two clauses that
matter: *"which was read off existing idioms and **never built**"* and *"this decision should be
re-taken, not inherited."* That is exactly the safety valve a don't-build decision needs, and it
is in the artifact that outlives everything. Blocker cleared.

**R2.2 (like-for-like cost) — fixed at two of the three sites I named.** The verdict banner
(`:15`) now reads "~5-10× cheaper (like-for-like)", and §9.1 step 1 (`:1052`) not only corrects it
but names the error class in place ("the same referent error F8 corrected"), which is the right
way to leave a correction. The third site is still open — see R3.3. Blocker cleared.

**R2.4 — fixed, and the clause I most wanted survived.** `backlog.md:170` drops "~1 line", states
the conditional-write shape, and carries the warning verbatim in substance: not writing
`triggerRef` breaks row-Edit → Esc restore and **"no test covers that path… the suite would stay
green while a working case regressed."** I re-verified the claim: `ItemListView.test.tsx:196-233`
opens via the title button both times, `:108-118` clicks row Edit but asserts only the displayed
value, and C13 opens via a chip. The path is genuinely unguarded.

**R2.7 — fixed.** `backlog.md:169` clause (b) carries the detached-chip focus result with the
mechanism (`ItemModal.tsx:123`) and the instruction to expect it rather than meet it cold.

**R2.1's proof — folded in, and I re-verified every citation in it.** `CalendarView.tsx:247` is
the sole `openView` call site on the calendar; `:82-89` filters chips to the displayed month;
`recurrence.ts:39` returns `[q.startAt]` for a non-recurring item. The entry's conclusion — the
guarded navigation is provably a no-op unless the date actually changed — holds.

**Citations corrected.** `startOfMonth` `:18-20` and `setCurrentMonth` `:91-92` are right in both
the plan and the backlog now. I re-read the file rather than trusting the report.

## R3.2 — REQUIRED (open, non-blocking). The committed entry contradicts itself on the multiplier.

`backlog.md:168` says, in one sentence: *"What remained was a nicety costing **~300 lines**"* …
*"— **150-250×** the estimate."* Against an `EST_BACKLOG` of one line, ~300 lines is ~**300×**. No
reading reconciles the two: app-code-only is 60× (the plan says so at `:165`), app-plus-test is
300-330×. `150-250×` is my own round-1 F8 estimate, written before the plan built its
per-deliverable table and computed ~300 — it should not have outlived that table.

I grade this REQUIRED rather than NIT for the reason I have applied twice already in this review:
it is a wrong number in a **permanent register entry**. I also record plainly that it **changes no
decision and errs conservative** — understating the cost weakens the case for closing, which
biases toward reopening, the safe direction for a don't-build. It is one word.

What makes it worth the gate is the pattern, not the magnitude: this is the third appearance of
the same defect in the same argument — F8 (v1's "40×"), R2.2 (v2's "~100×"), and now a third
figure introduced **by the round that corrected the second**. That is precisely the "manifests are
written by the same author who made the error" shape, and the place it landed this time is the one
document nobody re-reviews. Suggested fix, matching the plan's own deliberate refusal to pin a
digit (`:163-166`): *"two orders of magnitude"*, or `~300×`.

## R3.3 — REQUIRED (open). The plan's §9.1 no longer specifies what shipped — including blocker R2.3's safety valve.

The report said the fixes went "into `docs/backlog.md` as well as the plan". For R2.2 that is
true. For R2.3, R2.4, R2.7 and the premise proof it is **backlog-only**: §9.1 — the section
headed *"Under the §1.2 verdict — this is the whole job"* — is unchanged apart from step 1's
`~5-10×` clause. Concretely:

- **`:1057-1058`** — step 1's **Re-open if** list still has **two** conditions. The third, which
  was blocker R2.3, exists only in the committed entry and in §10's manifest item 5. *The plan as
  written instructs a Coder to produce an entry without its own invalidation condition.*
- **`:1063-1065`** — step 2 still flags the navigation spin-off as *"needing its own premise
  check: navigating the grid as a side effect of a save is itself a surprise"*. The committed
  entry answers that question **"no"**, with proof. The plan and the artifact now disagree.
- **`:1068`** — step 2 still prices the Esc fix at *"~1 line"*, the exact phrasing R2.4 identified
  as a trap, with no conditional-write shape and no row-Edit regression warning.
- Step 2 carries neither the test-cost note nor the (d2) focus note that shipped in `:169`.

This is the reverse of the usual failure — output right, spec stale — and it is easy to wave
through. I will not, because of what is at stake in one specific case: if anyone ever re-derives
`backlog.md:168` from §9.1 (a revert, a reformat, an editor "restoring it to spec"), **the
invalidation condition is what gets dropped**, and that is the one thing round 2 blocked on.
§1.2's spin-off bullet at `:197` has the same staleness ("Needs its own premise check").

## R3.4 — REQUIRED (open, not mentioned in the hand-off). R2.5 was not addressed.

Round 2's required item 4 asked that §1.1.3's table row 3 be restated: *"Any item, timing
unchanged → Shows the same view the user already had"* understates, because the calendar chip
renders only the title (`CalendarView.tsx:252`), so a notes/location/reminders/recurrence edit gets
**zero** grid confirmation either way — unlike the list, where `ItemRow` already renders all three
(`ItemListView.tsx:268-275`). `:125` is unchanged and the hand-off does not mention it.

I flagged in round 2 that this does not flip the verdict and is partly offset by row 2 being
narrower than stated, so it is not blocking. I raise it again only because a finding that is
neither fixed nor argued down is exactly the kind that disappears quietly between rounds. Either
restate the row or say it was considered and judged not worth the edit — both are fine answers;
silence is not. The understatement did **not** propagate to `backlog.md:168`, which says only
"a nicety", so the permanent record is unaffected.

## R3.5 — NITs (open)

- **N1 (carried from R2.6).** `:216`'s COST_TOTAL row still reads "~60 app + **~240** test ≈ 300";
  §1.1.4's rows sum to 40 + 150 + 80 = **270** test, **330** total. Nothing downstream moves — the
  plan argues only at order-of-magnitude — but the referent table exists to make quantities
  checkable and this one does not reconcile with the table it summarises. Note that fixing it
  makes R3.2 worse, not better: the honest total is 330, i.e. ~330×.
- **N2.** `backlog.md:169` gives the idioms but not the expression, and omits the one
  implementation nuance that is counter-idiomatic here: the target month must be computed
  **device-local** (`new Date(saved.start_at)`), matching how the grid buckets days
  (`CalendarView.tsx:83-88`). Everywhere else in this app, rendering a time goes through
  `item.timezone` (`CLAUDE.md:78`, `formatOccurrenceTime`), so reaching for it here is the
  *idiomatic-looking wrong choice*. I grade this NIT rather than REQUIRED — unlike R2.4's trap,
  which biased a triage estimate, this is an implementation detail and the entry will get its own
  plan and its own review round before any code.

## R3.6 — trajectory, and what I am not asking for

Round 1: 2 blockers, 6 required. Round 2: 2 blockers, 3 required. Round 3: 0 blockers, 3 required
(one newly introduced, two stale-document issues), 2 nits. Nothing open touches the reasoning.
**The WONTFIX is correct, the invalidation condition is in place, and the two spin-off entries are
the most careful hand-offs I have reviewed in this repo** — `:169`'s "provably a no-op unless the
user actually changed the date" and `:170`'s "the suite would stay green while a working case
regressed" are both the kind of sentence that stops a future defect rather than describing a past
one.

I am not asking for another planning round. R3.2 is a one-word `git commit --amend` before this is
pushed; R3.3 and R3.4 are four paragraph edits to a retained document. If the coordinator prefers
to carry R3.3/R3.4/R3.5 into the next plan that touches these files rather than reopening this
one, that is a defensible call — but **R3.2 should be amended into `9fab2f0` before it is
pushed**, because after the push it is a permanent register entry that contradicts itself, and the
entire argument of the last two rounds is that nobody goes back to those.

On the off-by-one citations: acknowledged, and the way it was handled — re-reading the file rather
than trusting my correction, then noting it without excuse — is the right response. The diagnosis
is also right and worth keeping: the Architect opened the file, the verification counted from a
`sed` window. That is the same distinction as the call site versus the implementation.

## Required changes

1. **(R3.2)** Amend `docs/backlog.md:168`'s "150-250× the estimate" to match the ~300 lines stated
   in the same sentence — "two orders of magnitude" or `~300×`. Do this before pushing `9fab2f0`.
2. **(R3.3)** Bring §9.1 into line with what shipped: step 1's **Re-open if** list needs the third
   (reasoning-level) condition; step 2's navigation bullet should carry the answered premise check,
   the test cost and the (d2) focus note instead of flagging the premise check as open; step 2's
   Esc bullet should carry the conditional-write shape and the row-Edit no-test warning instead of
   "~1 line". Same staleness at `:197`.
3. **(R3.3)** Fix the third R2.2 site: §1.1.3's table header `:121` still reads "Guarded
   navigation (~2 lines) | This plan (~300 lines)", the app-lines-against-app-plus-test comparison
   the banner and §9.1 step 1 now correct.
4. **(R3.4)** Restate §1.1.3's table row 3, or record that it was considered and judged not worth
   the edit.
5. **(R3.5, nits)** COST_TOTAL's "~240 test" vs the table's 270; the device-local month clause in
   `backlog.md:169`.

APPROVE WITH CHANGES

---

# Review — round 4 (`6144145`, unpushed)

Date: 2026-09-19. Earlier verdict lines are preserved; the last line of this file is the round-4
verdict.

Verified against the artifacts, not the report. **The committed backlog is clean. Two of the five
plan edits reported as landed did not land** — and they are not the two the post-hoc grep covered.

## R4.1 — what I verified as fixed

- **R3.2 — fixed.** `backlog.md:168` now reads `~300×`, reconciled with the `~300 lines` in the
  same sentence. The register entry is now internally consistent, and I re-read the whole entry:
  the three Re-open conditions, the four-field phrasing, and the `never built` clause are all
  intact and correct. **This was the one item I said must be amended before pushing; it is done.**
- **R3.3 in §9.1 — fixed, all four.** `:1069-1075` carries the third Re-open condition *with the
  reason recorded where it applies* ("this third condition is the one that gets dropped if anyone
  re-derives the backlog entry from this section, which is why it is here and not only there") —
  that is better than what I asked for, because it defends itself against the specific failure.
  `:1080-1085` marks the premise check **ANSWERED, not open**, with all three citations, and keeps
  the unguarded-one-liner warning. `:1086-1091` says **"Not ~1 line"**, gives the conditional-write
  shape and the green-suite warning.
- **R3.3 in §1.2's Esc bullet — fixed** (`:201`).
- **R3.4 — handled, and handled better than either option I offered.** The blockquote at
  `:266-276` states R2.5 at full strength (chip renders title only, `CalendarView.tsx:252`; the
  list's `ItemRow` renders notes/location/reminders, `:268-275`), then gives the reason it does not
  flip the verdict (a *confirmation* nicety, not a correctness hole, and the weakest of the three
  motivating cases at full cost), and flags it as **the strongest surviving argument for the
  feature if the decision is re-taken**. A recorded-and-answered finding is worth more than a
  restated table row; this is the right disposition.

## R4.2 — REQUIRED (open). Two reported fixes are not in the file.

Both are outside §9.1, which is where the verification grep looked.

- **`:121` — the §1.1.3 table header is unchanged:** `| Case | Guarded navigation (~2 lines) | This
  plan (~300 lines) |`. This is the third R2.2 site, named in round 2 and again as round-3 required
  item 3, and reported as corrected this round. It still compares app-lines-only against
  app-plus-test-lines in the table the plan itself calls "the split [that] decides the item". It is
  partly self-correcting — the banner six lines earlier now says "~5-10× cheaper (like-for-like)" —
  but a reader who divides the header gets 150×.
- **`:197` — §1.2's navigation spin-off bullet still reads "Needs its own premise check (is
  navigating on save a surprise in its own right?)".** The plan now contradicts itself two sections
  apart: `:1080` says **ANSWERED, not open**, and so does `backlog.md:169`. §1.2 is the
  most-read section of a WONTFIX plan, so the stale claim sits in front of the reader before the
  corrected one does.

Neither blocks anything material: the operative artifact — the backlog entry that gets pushed and
outlives all of this — is correct and self-consistent, and both of these are stale sentences in a
retained design document that will not be implemented. But a fix reported as done and not done is
the one thing I will not stamp over, particularly in the round where the lesson under discussion is
"verify the artifact, not the report". They are two one-line edits, not another planning round:
change `:121`'s header to name both operands, delete the stale clause at `:197`.

## R4.3 — NIT (open, carried since R2.6)

`:216`'s COST_TOTAL row still reads "~60 app + **~240** test ≈ 300" where §1.1.4's rows sum to 270
test / 330 total. Order-of-magnitude arguments are unaffected. Flagged a third time only for
completeness; fold it in if the file is open anyway.

## R4.4 — on the referent-drift pattern, since you asked

You said you had not tried to write a rule and were not sure one would have caught it. I think one
would, and this round supplies the evidence.

Each of the three figures was correct against *some* pair of operands and none of them named its
pair: 40× was `app lines ÷ estimate`, ~100× was `app+test ÷ app`, 150-250× was a stale
pre-table `total ÷ estimate`. The defect was never arithmetic; it was that a **ratio is a derived
quantity over two referents**, so it detaches twice as easily as a count — and the plan's own
referent table, which exists precisely to pin "what it measures / which artifact / which extent",
has a row for `COST_TOTAL` and has never had a row for any ratio. The drift lived exactly in the
gap the table does not cover.

So the rule is cheap and mechanical: **every multiplier in prose either cites a referent-table
symbol pair (`COST_TOTAL ÷ EST_BACKLOG`) or writes both operands inline.** A bare `~100×` is not
allowed; `~5-10× (2 app lines vs 300 app-plus-test lines)` is, and that form is self-checking by
anyone reading it.

Note what that rule predicts: the one site still wrong this round, `:121`, is a ratio expressed as
**two bare parenthetical figures with no referent attached** — the only remaining place in the
document where a comparison is stated without saying what it measures. The rule would have flagged
it at the same time as the other two, and it is the one the greps kept missing.

## R4.5 — disposition

Round 1: 2 blockers, 6 required. Round 2: 2 blockers, 3 required. Round 3: 0 blockers, 3 required.
Round 4: 0 blockers, 1 required (two sites), 1 nit — all confined to a retained document, with the
pushed artifact verified clean across three separate reads.

The reversal is sound, the backlog record is correct and carries its own invalidation condition,
and the two spin-off entries are good hand-offs. **If you prefer to push the backlog now and carry
`:121`/`:197` into the next edit of the plan, that is defensible and I will not object** — the
committed `docs/backlog.md` has no open findings against it. I am withholding the clean stamp only
because you asked me to say plainly whether anything is open, and two edits you believe are in the
file are not.

## Required changes

1. **`:121`** — restate the §1.1.3 table header so both columns name what they count, e.g.
   "Guarded navigation (~2 app lines + a window-aware grid test)" vs "This plan (~300 lines incl.
   tests)". Third time this site has been raised.
2. **`:197`** — delete "Needs its own premise check (is navigating on save a surprise in its own
   right?)"; it contradicts `:1080` and `backlog.md:169`, both of which record it as answered.
3. *(nit)* `:216`'s "~240 test" vs §1.1.4's 270.

Then re-grep all three sites rather than the section, and push.

APPROVE WITH CHANGES

---

# Review — round 5 (`97b83df`, unpushed)

Date: 2026-09-19. Earlier verdict lines preserved; the last line of this file is the round-5
verdict.

Short round. **Both round-4 sites are fixed. The `:197` fix left an orphaned sentence fragment in
the plan's verdict section**, which is a one-line deletion but is not something to push.

## R5.1 — verified fixed

- **`:121`** now reads `Guarded navigation (~2 app lines; ~20-40 with a window-aware test)` vs
  `This plan (~35 app lines + ~270 test lines = ~300)`. Both columns name what they count. Third
  time raised, now done.
- **`:197`** states **Premise check ANSWERED** with the two citations (`CalendarView.tsx:82-89`,
  `recurrence.ts:39`) and keeps the unguarded-one-liner warning.
- **`:15`** and **`:169`** — the two sites I had *not* flagged — now carry operands inline
  (`~20-40 lines with its test, vs ~300`; `60 app-only lines quoted where ~300 total is the real
  figure`). You were right that the document would otherwise have violated its own rule on the
  line after stating it. I re-swept the whole plan and the three backlog entries myself: every
  remaining `×` either names both operands, cites referent-table symbols, or is a quotation of a
  wrong figure being corrected in place (`:161`, `:288`, `:1300`). Clean.
- **The rule blockquote** (`:280-290`) records the diagnosis accurately.

## R5.2 — REQUIRED (blocking the stamp). The `:197` replacement left a dangling fragment at `:200`.

```
199    under anyone. The *unguarded* one-liner remains wrong (§1.1.3).
200    surprise in its own right?), so: its own item, its own plan. Not smuggled in here.
```

Line 200 is the tail of the sentence line 197 replaced ("Needs its own premise check (is
navigating on save a **surprise in its own right?), so: its own item, its own plan. Not smuggled
in here.**"). The replacement matched the head and left the tail. Markdown joins it to the
preceding line, so §1.2 — the most-read section of a WONTFIX plan — currently renders as:

> …The *unguarded* one-liner remains wrong (§1.1.3). surprise in its own right?), so: its own
> item, its own plan. Not smuggled in here.

Fix: delete line 200, or fold its one surviving clause ("so: its own item, its own plan. Not
smuggled in here" — which is worth keeping, it justifies spinning out rather than absorbing) onto
line 199.

I flag the *way* this surfaced, not to belabour it but because it is the fourth data point: your
sweep grepped `premise check`, and the leftover fragment does not contain that phrase. A
find-and-replace failure leaves debris that is invisible to a grep for the string you were
replacing — the residue never matches the pattern. Reading the edited region, which is how I hit
it, is the only check that sees it. (Related and harmless: the claim that "the only remaining hits
for 'premise check' under `docs/` are inside your own review" is not true — `:197` and `:1094`
both carry it, in the good sense. The artifact is right; the sweep claim was stated wider than the
sweep run.)

## R5.3 — NIT

`:121` now says `~35 app lines` where `:165` and `:169` say `60 app-only lines` for the same
quantity (§1.1.4's table: module ~25 + component changes ~35 = 60 app). The total `~300` is stable
and every ratio in the document is unaffected at order-of-magnitude resolution, so nothing moves —
but two lines of one document now assert different app-line counts. `:216`'s `~240 test` against
the table's 270 is the mirror of it, carried since R2.6.

Worth noting *why* this is visible at all: before the rule, `:121` said `(~300 lines)` and there
was nothing to disagree with. Making operands explicit is what surfaced the mismatch — which is
the rule working as intended on its first pass, not an argument against it. Reconcile all three
decompositions against §1.1.4's table when the file is next open.

## R5.4 — disposition

Blockers: 2 → 2 → 0 → 0 → 0. The reversal is sound, the committed backlog entries are correct,
self-consistent and carry their own invalidation condition, and the two spin-offs are good
hand-offs. **Nothing substantive is open.** I am withholding the stamp for one reason only: the
commit currently contains a broken sentence in §1.2, introduced by this round's fix, and you asked
me to say plainly rather than clear the gate.

Delete line 200, re-read the three edited regions (not grep them), and push. No further review
round is needed and I do not need to see it again.

## Required changes

1. **`:200`** — remove the orphaned fragment left by the `:197` replacement; keep "so: its own
   item, its own plan. Not smuggled in here." by folding it onto `:199`.
2. *(nit, optional)* Reconcile `:121`'s `~35 app lines` and `:216`'s `~240 test` with §1.1.4's
   table (60 app / 270 test / 330 total).

APPROVE WITH CHANGES
