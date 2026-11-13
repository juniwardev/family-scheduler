# Review — `docs/plans/item-archive.md` (v1)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-20 · **Round:** 1

---

## 0. Scope changed twice during this review — read this first

The plan under review was written for a three-capability feature. While I was reading it the owner
made three decisions that the document does not reflect:

1. **Capability (b), auto-archive, is CUT.** Banked, not discarded: the 30-day rule is confirmed
   correct *if it ever returns*.
2. **Archived items are hidden from the list AND the calendar grid.** The plan's Decision 4
   (`item-archive.md:318-346`) and its OQ2 are overruled.
3. **Unarchive is IN**, as a **Restore** action. `archived_at` is reversible. Owner decision 3
   ("duplicate, not unarchive") and everything argued from irreversibility are void. Duplicate
   stays, with an explicit constraint to reuse existing code.

I have graded the plan **as written, against the new scope**. I did not spend further effort on the
auto-archive rule or on whether (b) earns its cost; findings that applied only to (b) are recorded
as *dissolved* below so a future reader of the banked section knows they were raised.

Two findings I was about to file, I am **explicitly retracting** because restore dissolves them.
They are listed in §7 so the record is not silently shorter than it was.

---

## 1. What I sampled from the self-check manifest, and what I took on trust

The manifest (§8, `item-archive.md:829-900`) is honest and it aimed my effort well. I sampled the
load-bearing entries rather than re-deriving all of them.

**Independently confirmed (I opened the file and checked the line):**

- Every `file:line` in §5.4's `db.ts` table: `mapItem` `:63`, `getItems` `:568`/`:585`,
  `getItemForUser` `:608`, `createItem`'s `NULL` bind `:651`, `updateItem` `:682`/`:695`,
  `completeItem` `:1026`/`:1043-1049`/`:1077`/`:1081`, `getActiveItemsWithReminders`
  `:1234`/`:1242`, `getDueDispatch` `:1306-1312`, `deletePendingDispatchForItem` `:1343`. All
  correct.
- **The manifest's correction of the task brief's own citations is itself correct.** `db.ts:469`
  and `:786` are the *comments*; the calls are `db.ts:473` (`deletePendingDispatchForList`) and
  `db.ts:788` (`deletePendingDispatchForItem`). Good catch by the author, verified.
- **The `end_at < start_at` reachability claim** (`item-archive.md:232-236`). Confirmed:
  `routes/items.ts:179-183` gates the check on `b.end_at !== undefined`, and `updateItem` writes
  `end_at = CASE WHEN ? THEN ? ELSE end_at END` (`db.ts:711`), so a PATCH carrying only a later
  `start_at` leaves a stale earlier `end_at`. T6 is well-founded and not a hypothetical.
- **P2-N1 reasoning.** Correct in both halves. `reminder_dispatch` has no FK to `items`
  (`0001_init.sql:44-46`), so the explicitness rationale carries; archiving performs no cascade and
  no delete, so the *ordering* half is genuinely vacuous. The plan is right to refuse to claim it.
- `config.ts:8-9` (LOOKAHEAD 60 / GRACE 30), `send.ts:223-224` (48 h), `index.ts:78`,
  `types.ts:84-85` (aged-out rows never re-selected), migration ordinal **0007** (highest existing
  is `0006_attachments.sql`).
- `App.tsx` — `items` is consumed only by `ItemListView` (`:238`). "No change expected" is correct.
- `ItemDetails.tsx` renders the read-only `AttachmentsView` (`:136-140`), so §5.5's claim that the
  attachment routes are unreachable from the archive UI is true of the UI.
- **`ItemModal.tsx:158`.** Confirmed the `key` is
  `effective.mode === "edit" ? effective.item.id : "create"`. The plan's required change to
  `"create:" + sourceId` for the duplicate arm is a real defect it caught, not a precaution:
  `ItemEditor`'s draft is an initialiser-only `useState` (`ItemEditor.tsx:58-71`), so two
  consecutive Duplicates inside Radix's close window would reuse the first item's values. Good
  catch; keep it.
- **The §5.6 digest proof — re-derived from scratch. It HOLDS**, and it survives all three scope
  changes (see §3.4).

**Taken on trust, not re-derived** (all three are declared by the manifest as unverified, which is
the right way to hand them over):

- `SUITE_BASE` 312 / 35 / 6 — quoted, not measured. Coder must re-measure on branch.
- The §5.7 fixture-literal list — a grep, superseded by `npm run typecheck`.
- `wrangler dev --test-scheduled` on wrangler v4 — moot now that the cron change is cut.

---

## 2. BLOCKERS

### B1 — REQUIRED/BLOCKER. The all-day anchor is the start of a day, not the end of an event. Archive is offered on an item that is happening right now.

This is the sharpest defect in the surviving material, and the cut of (b) makes it **worse**, not
better: with no 30-day sweep, the only consumer of `ANCHOR_AT` is the manual precondition, which has
**zero delay** by design (Decision 5, `item-archive.md:369-371`).

The editor parses all-day dates as **local midnight**, for both ends:

- `ItemEditor.tsx:252-254` — `start_at` = `new Date(value + "T00:00:00").getTime()`
- `ItemEditor.tsx:272-275` — `end_at` = the same, and `end_at` defaults to `null` (`:65`)

Therefore:

| Item | `ANCHOR_AT` per §0 | Archive offered from |
|---|---|---|
| All-day event, one day, no `end_at` (the common shape) | `start_at` = 00:00 **on its own day** | 00:00:00.001 that morning |
| All-day event Fri–Sun (`end_at` = Sun 00:00) | Sun 00:00 | the first second of its final day |

So §6.2's row *"Multi-day / all-day event still in progress → not archivable — `ANCHOR_AT` is its
`end_at`"* (`item-archive.md:655`) is **false for exactly the case it names**. And Decision 5's
argument 1 — *"archived ⇒ its time has passed"* — is falsified for all-day items.

This is the "true fact attached to the wrong referent" shape: the anchor is a correct quantity
measuring the *start instant of the end date*, not the *end of the event*. For timed items it is
right. For all-day items it is off by up to a day.

**Why it now matters more than it looks.** With restore in scope, Decision 5's argument 2 (the
"permanent-hide button" / approximates-data-loss argument) is void — so **argument 1 is carrying the
whole decision alone**, and argument 1 is precisely what this breaks. Argument 1 is also what three
separate downstream arguments rest on: the digest proof (§3.4 below), the guard-ness of the
`materialize` clause (§3.2), and the bound on which dispatch rows can still be live (§3.1). State it
that way in v2 — it is the strongest form of the argument and it makes the precondition obviously
worth keeping.

**Fix.** Make the anchor `all_day`-aware: end of the local day of `COALESCE(end_at, start_at)`. The
cheap form is `+ 86 400 000` when `all_day = 1`, DST-inexact by ≤ 1 h, which is irrelevant at this
scale. Record it in §0's `ANCHOR_AT` row and in §5.2, and add two criteria to the T5/T6 family:
an all-day item on its own day, and a multi-day all-day item on its last day — both must be
**refused**. Today no criterion in §7.1 would go red.

### B2 — BLOCKER. Restore has no design, no guards, no route, no criteria, and — most importantly — no stated answer on `reminder_dispatch`.

Treated in full in §3 below, because the coordinator named it the primary target. Summarised here so
the blocker list is complete: the plan contains nothing for the capability the branch must now ship.

### B3 — BLOCKER. Three decisions, two goals and one risk in the plan still argue from premises the owner has voided. Leaving them is how a one-way argument gets resurrected later.

Every one of these reaches a future reader as an assertion:

| Location | What it asserts | Status |
|---|---|---|
| G4 (`:130`) | "append-only… **no unarchive**, and archived items cannot be edited or completed" | half void — restore is the path back |
| NG1 (`:139`) | "**Unarchive.** Excluded by owner decision 3" | void — now a goal |
| Decision 5 arg 2 (`:374-376`) | "Combined with no-unarchive (NG1)… the one way this feature could approximate data loss" | void — see B1 |
| Decision 6 arg 2 (`:398`) | "Archiving is one-way (NG1). Requiring the user to open the item first makes it a considered action" | premise void; the *conclusion* (placement) still stands on arg 1 |
| Decision 7 framing | "duplicate rather than unarchive", inherited from `backlog.md:162-165` ("the archive… never changes") | void |
| R2 (`:622-624`) | "**No undo.**" | void — invert or delete |
| §1.4 (`:98-108`) | the whole "bounding the damage" argument, premised on irreversibility **on a schedule** | doubly void |

**Duplicate's justification does not need inventing — the plan already contains the replacement.**
§1.3 (`:66-72`) says Duplicate "does not depend on archiving at all" and traces it to the backlog's
actual request, *"take an old item and use it to create a new one"* (`backlog.md:149-150`). Promote
that to the sole justification and Decision 7 survives the change untouched.

**§1.4 is banked-deferred material.** If the auto-archive section is banked rather than deleted, it
**must** carry a header saying it was written under two assumptions that no longer hold (no restore;
a sweep exists). A banked section that reads as current is how this repo's worst defects propagate —
see `backlog.md:216`'s correction of the "~1 line" estimate for exactly this reason.

---

## 3. Reminders — the primary target, re-derived with restore in scope

### 3.1 Purge-on-archive (Decision 3(i)) — **necessary**, and the plan's window derivation is right

I verified the pieces: `offset_minutes` is validated non-negative (`routes/items.ts:508`), so
`fire_at = occurrence_at − offset ≤ start_at ≤ ANCHOR_AT`; `getDueDispatch` selects
`fire_at ≤ now AND fire_at > now − GRACE_MINUTES` (`db.ts:1306-1312`). A pending row is still live
at archive time iff `ANCHOR_AT − fire_at < 30 min` **and** the archive happens inside the remainder.
For a task (anchor = `start_at`) that reduces exactly to the plan's stated condition:
`offset_minutes < 30` and archive within `(30 − offset)` minutes of the anchor. Correct.

It is also realistically reachable: "this is overdue, I'm not doing it, archive it" the morning
after. And **B1 compounds it** — an all-day item with an offset-0 reminder has `fire_at` = the very
midnight at which B1 makes it archivable, so the dispatch row is one second inside the grace window.

**T2 discriminates it properly** (the unrelated-item control catches an unscoped
`DELETE FROM reminder_dispatch`). Keep both halves.

**One text fix (REQUIRED).** Decision 3(i) justifies set-then-purge over purge-then-set with *"a
window in which a concurrent `materialize` re-inserts the row before the flag lands"*
(`item-archive.md:279-282`). That race is **unreachable** — see §3.2; `materialize` would not
re-insert regardless. Set-then-purge is still the right order (it mirrors `completeItem`,
`db.ts:1077` then `:1081`), but the stated reason is a race that cannot occur. Restate it as
consistency with the existing precedent, not as a fix for a live race.

### 3.2 The `materialize` SQL skip (Decision 3(ii)) — **a GUARD, not a correctness mechanism**, and the `completeItem` rationale does not transfer

The plan says (`:298-300`): *"(ii) prevents new dispatch rows… This is the identical rationale
`completeItem` already documents (`db.ts:1080`)."* It is **not** identical, and this is the second
"right mechanism, wrong referent" in the plan.

`completeItem` can be called on a **future-dated** task — you tick something off early — so
`materialize` genuinely would re-insert, and the clause genuinely earns its place. Archiving cannot
reach that state:

- archived ⇒ non-recurring (owner decision 2)
- ⇒ `start_at ≤ ANCHOR_AT < now_archive` (Decision 5's precondition)
- `materialize` expands over `[now, now + 60 d]` (`materialize.ts:38`, `config.ts:8`) and
  `expandOccurrences` returns **`[]`** for a non-recurring item outside that window
  (`recurrence.ts:37-39`)
- `updateItem` CONFLICTs on archived items (§5.4), so `start_at` cannot move back into the window
  while archived

So there is **no reachable state** in which `materialize` inserts a dispatch row for an archived
item. Keep the clause — one line, and it localises the predicate next to its `completed_at` sibling
— but label it **GUARD** beside T14, and label **T11** with it. The plan's own §8 sweep lists
exactly three GUARDs and presents this as a live mechanism; by the plan's own standard it is the
fourth. (Dropping T12 was right; the reasoning holds.)

**Restore does not change this**, which is worth writing down because it is the obvious worry:
restore sets `archived_at = NULL`, at which point the item is live and (ii) no longer applies to it
at all. (ii) only ever governs currently-archived items, and those all still have past `start_at`.

**The one thing that WOULD make (ii) live** — and this is the most important coupling in the
branch — is relaxing the `updateItem` CONFLICT guard so archived items can be edited directly. With
restore in scope that relaxation is now tempting ("why can't I just fix it in place?"). If it lands,
(ii) becomes a real correctness mechanism, T11 becomes a real test, **and the digest exclusion
becomes reachable so §5.6's omitted digest test must come back**. My recommendation: **keep the
guard.** Restore-then-edit is the right two-step, it keeps three separate arguments trivial, and it
costs the user one click.

### 3.3 Restore — the dispatch answer is "do nothing", and that must be written down with its derivation

Both failure modes the coordinator named are real questions; they resolve in opposite directions and
**neither requires new code**.

*"Restore resurrects a dispatch that then fires late"* — **unreachable.** The rows were deleted at
archive time by (i). `INSERT OR IGNORE` only runs from `materialize`, which returns `[]` for the
item (§3.2). Nothing exists to resurrect.

*"Restore silently leaves reminders dead"* — **true, and correct.** `deletePendingDispatchForItem`
touches only `reminder_dispatch` (`db.ts:1347-1353`); the reminder **definitions** in
`item_reminders` are untouched by archive. So restore returns an item with its full reminder set and
no pending dispatch for its single **past** occurrence. A reminder for a past occurrence *should
not* fire. Nothing that ought to be alive is dead.

**Reminders come back to life through machinery that already exists.** Restore → edit the date to
the future → `updateItem` detects `timingChanged` and purges pending dispatch
(`db.ts:698-701`, `:735-738`) → the next `*/5` tick materialises fresh rows at the correct
`fire_at`. No new code, no new purge, no re-materialize hook.

**So `restoreItem` must be a single `UPDATE items SET archived_at = NULL` and must not touch
`reminder_dispatch` at all.** Write that down explicitly with the derivation above, because
"helpfully" adding a purge (harmless but pointless) or a re-materialize (actively wrong — it either
no-ops or, if someone widens the window backwards to make it "work", fires a stale reminder) is the
natural thing for a Coder to do in the absence of a stated decision.

**Cite the precedent the repo already has:** `completeItem`'s un-complete arm takes *no* dispatch
action and says so in two places — *"No dispatch purge — materialize self-heals"* (`db.ts:1071`,
`db.ts:1087`). Restore is structurally the same operation: clearing a state flag that suppressed the
item. Same answer, same comment.

### 3.4 Sufficiency of (i) + (ii), and the digest

I enumerated every path that could produce a live dispatch row for an archived item:

| Path | Outcome |
|---|---|
| `materialize` | blocked by (ii); unreachable anyway (§3.2) |
| rows already pending at archive time | purged by (i) |
| `replaceReminders` — **not gated** (§5.5) | purges first (`db.ts:1110`) then upserts *definitions*; inserts no dispatch. Cannot resurrect. ✓ |
| `completeItem` un-complete | blocked by the new CONFLICT guard; inserts no dispatch either way |
| `deleteItem` | purges first (`db.ts:788`) |
| list visibility flip | `deletePendingDispatchForList` |
| restore | touches nothing (§3.3) |

**(i) + (ii) are sufficient.** The decision to leave `PUT /items/:id/reminders` ungated is safe, and
for a better reason than §5.5 gives ("unreachable from the archive UI") — it is safe because the
route *itself* purges and cannot insert. Use the stronger reason.

**Digest (item 5, one line as requested, plus the caveat).** With no cron change, `index.ts` is
untouched. `sendDailyDigest`'s *output* is also unchanged: it includes a non-recurring item only on
`item.start_at >= windowStart` (`send.ts:238`), and every archive path forces
`start_at ≤ ANCHOR_AT < now_archive ≤ windowStart`. **The §5.6 proof holds, it survives restore and
it survives B1** (B1 moves the anchor *later*, never earlier). Omitting the digest test is correct.
The one caveat to carry into v2: **the proof rests entirely on the `updateItem` CONFLICT guard** —
see the coupling in §3.2.

---

## 4. Hiding archived items from the calendar (item 3, decided against the plan)

### 4.1 Do it in SQL, not in the render. Three reasons, one of them structural.

1. **`CalendarView`'s derived structures would fall out of sync.** `occurrences` feeds a group-by-day
   (`CalendarView.tsx:81-89`) whose `dayOccs` drives **four** things at once: the `slice(0, 3)` cap
   (`:108`), `hiddenCount`/`toggleLabel`/`toggleText` (`:111-121`), the render, and the
   roving-tabindex focus geometry `ids` (`:126-130`). Filtering at render means choosing exactly one
   of those places; choosing wrong produces a `+N more` that counts invisible items, or a focus ring
   that lands on nothing. Filtering in SQL means `occurrences` never contains them and all four are
   consistent by construction.
2. **The cross-list merge the backlog flagged is an argument *for* SQL, not against it.**
   `CalendarView` fetches per list and merges (`:64-68`), but every fetch hits the same endpoint
   (`GET /lists/:id/items?from&to`). One server-side change covers all lists at once; there is no
   per-list divergence to handle. Render-side filtering would have to be right once and stay right
   across a merge.
3. **Restore comes back for free.** `CalendarView`'s fetch is keyed on
   `[currentMonth, lists, reloadToken]` (`:72`) and it owns a **separate** `useItemModal` instance
   from `ItemListView`'s (`:45-49`), so a restore performed in the list view does not bump the
   calendar's token. With the filter in SQL the next month fetch simply includes the row; with it in
   the render the restored item depends on a refetch that may not have happened.

**Mechanically this is a simplification, not a cost.** The plan's §3.2 design invariant — `getItems`
defaults to `scope: "active"`, so a forgotten call site under-shows rather than leaks — becomes
**uniformly** true with **zero** exceptions, because the `?from&to` branch stops being the one call
site that opts out (`item-archive.md:193-198`, `:335-337`).

### 4.2 The plan's Decision 4 argument was good, and the owner's two decisions together answer it

Decision 4's objection was: *"page back to June and the school concert is simply gone, and the
calendar has quietly lied about what happened"* (`:331-332`). That argument was calibrated against
**auto-archive** — against a machine removing things without asking. With (b) cut and Restore in, an
item leaves the grid only because a human deliberately put it away, and one click brings it back.
The objection is substantially answered by the *other* two decisions, not overridden. Record that
reasoning in v2 so the next reader does not re-litigate it; do not just delete Decision 4.

Residual cost, worth one honest line: a past month's grid now loses whatever the family archived, so
the calendar is no longer a complete record of what happened. With restore that is recoverable, and
the archived tab is the complete record.

### 4.3 The reversal is cheap in code and expensive in criteria — the plan's estimate misses this

Decision 4 priced its own reversal at *"one line… and delete the chip attribute/styling and its two
tests"* (`:344-346`). The code estimate is right. The criteria estimate is wrong: **T20 and T27 are
not deletions, they are inversions**, and an inverted absence-assertion is the easiest test in this
repo to write vacuously.

- **T20** becomes: `?from&to` **excludes** an archived item's occurrence. A build returning
  `{ occurrences: [] }` for everything passes. **It needs a live sibling item in the same window
  whose occurrence IS returned** — the window-aware anti-vacuity control
  `calendar-follow-saved-item.md` already established as the idiom for this file.
- **T27** becomes: an archived occurrence renders **no chip**; a live one in the same month renders
  one. Same anti-vacuity requirement. `data-archived` and the muted classes are deleted, and with
  them the M4 contrast check.
- **M2** must flip from *"still appears on the calendar (muted)"* to *"gone from the calendar, and a
  live sibling is still there."*

---

## 5. REQUIRED (blocking, but localised)

### R1 — R9 understates the deploy-order failure, in the direction that reaches an operator

R9 (`:642-644`) says code-before-migration *"produces 'no such column' on the first archive"*, leaning
on `deploy.md:13-16`'s *"reads tolerate a missing column"*.

But §5.4 adds `AND archived_at IS NULL` to **`getItems`' WHERE clause** (`db.ts:585`) — the query
behind the list view, the calendar occurrence path **and** `sendDailyDigest` (`send.ts:232`). With
code live before the migration, **every list load and every calendar month errors**, and the digest
sends nothing. `deploy.md:13`'s guarantee covers `SELECT *` with no predicate on the new column;
**this feature is the first in the repo to break that precondition.** Rollback (`deploy.md:80`) is
unaffected and stays safe.

Two consequences for v2: state the real severity in R9, and annotate the deploy step / PR
description accordingly. Also specify `mapItem` as `archived_at: row.archived_at ?? null`, not
`archived_at: row.archived_at` (§5.4) — on an unmigrated row the key is absent, so the mapped value
is `undefined`, and §5.7's `item.archived_at === null` gates would then read **every** item as
archived.

### R2 — `buildDuplicateDraft` and T23 silently drop `all_day`, `location_kind`, and the null→"" convention

`ItemDraft` has 12 fields (`web/src/types.ts:67-81`). T23 (`:785`) enumerates
title/location/notes/type/timezone/`list_id`/reminders, plus `rrule: null` and the date handling.
Missing:

- **`all_day`** — dropping it turns a duplicated all-day item into a timed item at 00:00. It also
  interacts with Decision 7's shift rule: an all-day item's wall-clock H:M *is* 00:00, which has
  always passed, so an all-day duplicate always lands on **tomorrow**. Probably right; currently
  unstated.
- **`location_kind`** — dropping it silently discards an explicit "Tap to join" / "open in maps"
  override, which is the entire point of migration 0004.
- **The empty-string convention** — `ItemDraft.location`/`notes` are `string`
  (`web/src/types.ts:71-72`) while `Item.location`/`notes` are `string | null` (`:38-39`).
  `buildDuplicateDraft` must do `item.location ?? ""`, mirroring `ItemEditor.tsx:62-63`.

None of the three is caught by any criterion. Add all three to Decision 7's table and to T23.

### R3 — `ItemListView` has two fetch sites; §5.7 names one, and restore makes it three mutations

The mount effect (`ItemListView.tsx:66-74`) and `refresh()` (`:94-99`) both call `getItems(listId)`.
§5.7 specifies only *"refetch keyed on `[listId, scope]`"*.

If `refresh()` stays scope-blind, then after any mutation performed from the Archived tab —
**restore**, or duplicate-and-save (`onSaved` → `refresh()`, `:181-183`) — the Archived tab
repopulates with **active** items. T24 tests the toggle's fetch, not the post-mutation refresh, so
it stays green. Name both sites in §7's step list and add the assertion to T24.

Related (REQUIRED): **Restore must use the `refresh()` / `reloadToken` path, not `onSaved`.**
`CalendarView`'s `onSaved` navigates to `startOfMonth(saved.start_at)` for non-recurring items
(shipped in `2afce988`, `backlog.md:217`). Restore is not an editor save; wiring it into `onSaved`
for convenience would yank the grid to a past month. Blast radius is small because Restore lives in
`ItemListView`'s modal, but say it.

### R4 — Restore's criteria, which do not exist. Minimum set, each with its falsification statement.

| # | Assertion | What a wrong build would still pass |
|---|---|---|
| T-R1 | After `restoreItem`: id **present** in `getItems(…, "active")` **and absent** from `getItems(…, "archived")`. By id, never by count | Inverts T1. Here the **presence** half is the one that bites — a build that clears the flag but leaves a stale cached row passes the absence half alone |
| T-R2 | Restore on a **non**-archived item → `CONFLICT`, and `archived_at` still `NULL` | A code-only assertion passes on a build that writes then errors; a build that silently 200s passes any "no crash" test |
| T-R3 | `reminder_dispatch` is **unchanged** by restore: an unrelated live item's pending row survives, **and** the restored item still has **zero** dispatch rows | Without "still zero", a build that re-materializes on restore passes. Without the unrelated row, an unscoped delete passes |
| T-R4 | **Restore → PATCH `start_at` to the future → `materialize` → exactly one dispatch row at the new `fire_at`** | **The mechanism test for §3.3.** This is the *only* criterion that goes red on a build that leaves a restored item permanently reminder-dead (e.g. one that purged `item_reminders` instead of `reminder_dispatch` on archive). Every other restore criterion passes on that build |
| T-R5 | `POST /api/items/:id/restore` on a non-archived item → **409**, not 400 | The copy-pasted ladder (`routes/items.ts:42`, `:138`, `:208`, `:220`, `:252`) maps `CONFLICT` to 400. T17's problem is now **four** ladders, not three |
| T-R6 | Archive → restore → **archive again** produces a **new, later** `archived_at` | T7 pins "already-archived → CONFLICT, timestamp unchanged". A build that implements restore as a flag elsewhere, or that `COALESCE`s the old value back, passes T7 and fails only here |
| T-R7 (web) | Restore button present in the archived view, asserted by accessible name **and** `tagName === "BUTTON"`; after restore the item leaves the Archived list while a live sibling stays put | `getByRole("button")` matches `<div role="button">` — `calendar-show-more.md` §5.2. Without the sibling the list-emptied-entirely build passes |
| E1 (e2e) | Round trip becomes: archive → gone from Active → present in Archived → **Restore → back in Active AND back on the calendar** | The calendar leg is what proves the owner's stated requirement, and it is the leg a SQL-layer implementation gets for free and a render-layer one does not — so it also discriminates §4.1 |

**Design points v2 must state, because the symmetric wrong answer is tempting:**

- **Restore has NO precondition.** Not the archive precondition mirrored, not an anchor check.
  Mirroring it would make some archived items permanently unrestorable.
- **No `rrule` guard on restore** — an archived item is non-recurring by construction. Adding one
  would be an unreachable guard, the exact shape `backlog.md:215` records as the thing to avoid.
- Guard order: NOT_FOUND → FORBIDDEN (`canWriteList`) → CONFLICT (not archived) → write. Matches
  `archiveItem` and `updateItem:695`.
- `updated_at` untouched, mirroring `archiveItem` and `completeItem` (`db.ts:1077`). Fold into R6.
- Route shape: prefer `POST /api/items/:id/restore` over `DELETE /api/items/:id/archive` — it
  matches the existing state-transition precedent (`routes/items.ts:227`) and keeps
  `DELETE /items/:id` unambiguous.

### R5 — Four buttons in the archived view modal, at 390 px

With Restore **and** Duplicate **and** Close (and Archive on the live side), `ItemDetails`' action row
(`ItemDetails.tsx:146-155`) goes from 2 buttons to 3–4 inside a mobile Sheet. This repo has already
shipped a width-overflow bug in a narrow container and only caught it at 390 px
(`backlog.md:212`), and the owner's device is an iPhone. M5 must check the archived modal's action
row at **390 px**, and the e2e density spec already knows how to measure it. Small, concrete,
previously-shipped failure mode.

### R6 — Criteria that must be inverted, relabelled or retired, in one place

So the delete/invert pass does not lose one:

- **Invert:** T20, T27, M2 (see §4.3) — each with an anti-vacuity control.
- **Relabel GUARD:** Decision 3(ii) and **T11** (see §3.2).
- **Retire with (b):** T13, T14, **T15**, M3, M4, R1 (the preview query), R3, R8, OQ1, OQ4,
  `ARCHIVE_AFTER_DAYS`, `autoArchiveDueItems`, §5.6's cron block, and §6.2's four sweep rows.
- **Retire with (b), and note *why* in the banked section:** **R5 / T15 dissolve entirely.** With no
  SQL sweep there is no SQL expression of `ANCHOR_AT` — the anchor has exactly **one**
  implementation (`src/shared/archive.ts`), so the TS↔SQL drift risk R5 exists for does not exist.
  That is a genuine simplification and worth stating; it also means T5/T6 now guard the *only* anchor
  implementation, which is why B1's missing all-day rows matter so much.
- **Add a T25 row:** an **incomplete past task must still show Archive** (Decision 5's "Task nuance",
  `:380-383`). T25's table is over `canWrite`/archived/`rrule`/anchor and has no completion
  dimension, so a build that quietly required `completed_at` — the natural mistake once `isArchivable`
  is the only predicate left — would pass every criterion in §7.1.
- **§0 must keep a row for `N_ARCHIVE`** marked *banked, not used*. Deleting the row while the
  banked section still says "30" is exactly the orphaned-referent failure §0 was built to prevent.

---

## 6. NITs (non-blocking)

- **N1.** With (b) cut, §5.4's `autoArchiveDueItems` step 1 (`SELECT id, title` for a log line that
  only prints a count) goes away with it. No action; noted only so the banked section is not read as
  finished work.
- **N2.** `isArchivable(item, Date.now())` inline in a render (`:588`) makes T25's anchor dimension
  clock-dependent. Fixtures far from `now` in both directions make it deterministic — say so, as
  T23 already does for its own injected `now`.
- **N3.** Timezone: the anchor comparison is pure UTC-instant arithmetic, so `items.timezone` is
  correctly irrelevant — **except** through B1's local-midnight parsing, which is the only place the
  local zone enters. Once B1 is fixed, state that explicitly; it is a question a future reader will
  ask again.
- **N4.** §5.5's justification for leaving the reminders route ungated ("unreachable from the archive
  UI") is weaker than the truth. Use §3.4's reason instead: the route purges and cannot insert.

---

## 7. Findings I am retracting, and why (so the record is not silently shorter)

Both were written against the one-way archive and are dissolved by Restore. Recorded because a
future reader of the banked auto-archive section will hit them again.

1. **"Archived items are undeletable from the UI."** §5.5 justifies leaving `DELETE` open with
   *"forbidding it would make archived rows unremovable forever"*, while §5.7 gives archived rows
   *"View only (no checkbox, no Edit, no Delete)"* — as written, the justification was false and
   archived rows had no exit. **With Restore the exit exists** (Restore → the row's existing Delete),
   so the justification is now true as built. v2 should add the one sentence that says so, because
   the connection is not obvious from §5.5 alone. **Dissolved, but it returns if Restore is ever
   removed** — and it returns immediately for the banked auto-archive section, where NG8 (never
   purge) plus a machine that archives on a schedule would make the archive grow with no app-level
   pruning at all.
2. **"Auto-archive permanently removes the ability to edit an item."** My strongest objection to
   capability (b): G4 + NG1 meant every non-recurring item older than 30 days became permanently
   read-only, on a schedule, without a human decision — and §1.4's damage bound ("one tab switch,
   not data") listed only *read* affordances and missed this entirely. **Dissolved twice over** ((b)
   cut, and Restore restores editability). **If (b) ever returns, this objection returns with it**,
   and §1.4 must answer it rather than omitting it. With Restore in place the answer is easy — which
   is itself a reason the banked section should assume Restore exists.

I also drop, unpromoted, a finding about adding a `confirm()` to Archive to match the Delete idiom
(`ItemListView.tsx:102`). With Restore, a mis-tap is one click to undo; a confirm would be friction
without a hazard.

---

## 8. Judgement

The engineering in this plan is good and I want to say so plainly rather than bury it under a long
list. The referent table (§0) is the right instrument and it caught the `30 minutes` / `30 days`
collision before it could do damage. The falsification column in §7.1 is used honestly, including
where it produces an uncomfortable answer (two criteria removed, three labelled GUARD and explicitly
protected from being "upgraded"). The `ItemModal.tsx:158` key hazard and the reachable
`end_at < start_at` row are both real defects found by reading, and I confirmed both. The manifest's
declared gaps are exactly where the gaps were, and its correction of the brief's own citations was
correct.

The defects I found in the surviving material cluster in one place and one pattern: **a correct
mechanism pointed at a slightly wrong referent** — the anchor measuring the start of a day instead of
the end of an event (B1), and `completeItem`'s dispatch rationale transferred to a case where its
precondition does not hold (§3.2). Both are the failure class the plan itself set out to prevent,
which is the strongest evidence that §0 and §7.1 are the right instruments and need one more pass
with them.

The verdict below is **not** a judgement on the author's craft. It is that the document now describes
a different feature than the one being built: it contains a capability that is cut, is missing a
capability that is in (Restore — no design, no route, no guards, no criteria, and no answer on the
question that matters most), and inverts a visibility decision that two of its criteria are built
around. A Coder cannot proceed from this text. That is a v2, and the v2 needs another round.

---

## Required changes

1. **B1** — Make `ANCHOR_AT` all-day-aware (end of the local day of `COALESCE(end_at, start_at)`).
   Correct §0's referent row, §5.2, and the false §6.2 row at `:655`. Add the two refusal criteria
   (all-day on its own day; multi-day all-day on its last day). State that Decision 5's argument 1
   now carries the decision alone and that the digest proof, §3.2's guard-ness and §3.1's window
   bound all rest on it.
2. **B2/R4** — Specify Restore in full: guard order, route (`POST /api/items/:id/restore`), no
   precondition, no `rrule` guard, `updated_at` untouched, and — with the §3.3 derivation written
   out — **no `reminder_dispatch` action at all**, citing `db.ts:1071`/`:1087`. Add criteria T-R1
   through T-R7 and extend E1. T-R4 is the load-bearing one.
3. **B3** — Purge every argument from irreversibility: G4, NG1, Decision 5 arg 2, Decision 6 arg 2,
   Decision 7's inherited framing, R2, and §1.4. Promote §1.3's independent justification for
   Duplicate to the sole one. Head the banked auto-archive section with the two assumptions it was
   written under.
4. **§3.1** — Restate set-then-purge as consistency with `completeItem`, not as a fix for a
   `materialize` race that cannot occur.
5. **§3.2 / R6** — Relabel Decision 3(ii) and T11 as **GUARD**. State the coupling explicitly: if the
   `updateItem` CONFLICT guard is ever relaxed, (ii) becomes live and the omitted digest test must
   return. Recommend keeping the guard.
6. **§4** — Replace Decision 4 with hiding archived items from the calendar **in SQL**, with the
   three reasons in §4.1. Invert T20, T27 and M2, each with an anti-vacuity control. Record the
   §4.2 reasoning (why the owner's other two decisions answer Decision 4's objection) rather than
   deleting the argument.
7. **R1** — Correct R9's severity: this is the first change in the repo where reads do **not**
   tolerate a missing column. Specify `mapItem` as `row.archived_at ?? null`.
8. **R2** — Add `all_day`, `location_kind` and the null→`""` convention to Decision 7's table and to
   T23.
9. **R3** — Name both `ItemListView` fetch sites; make `refresh()` scope-aware; route Restore through
   `refresh()`/`reloadToken`, never `onSaved`. Extend T24.
10. **R5** — Add a 390 px check of the archived modal's action row to M5.
11. **R6** — Execute the invert/relabel/retire list in one pass. Keep a `N_ARCHIVE` row in §0 marked
    *banked, not used*. Note that R5 and T15 dissolve with the sweep (one anchor implementation, no
    drift surface). Add the incomplete-past-task row to T25.

REJECT

---
---

# Review — `docs/plans/item-archive.md` (v2)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-20 · **Round:** 2

> The `REJECT` above is round 1's verdict and is preserved as written. The operative verdict for v2
> is on the last line of this file.

---

## R2.0 What I sampled from the manifest, and what I took on trust

The v2 manifest (§8, `item-archive.md:1310-1410`) is again honest, and its declared-gaps list aimed
me correctly — two of my three sharpest findings sit exactly where it said it had not looked
(M1b's unverified failure mode; the all-day storage convention it "did not verify beyond reading
the editor's two parse sites").

**Independently re-derived (I opened the file and checked the line):**

- `db.ts:585` — `SELECT * FROM items WHERE list_id = ? ORDER BY start_at`, no predicate. Confirmed;
  R9's whole argument turns on this and it is correct.
- `db.ts:1242` — `WHERE (i.rrule IS NOT NULL OR i.completed_at IS NULL)`. Confirmed, including that
  the new clause must sit *outside* that disjunction.
- `db.ts:1071` and `db.ts:1087` — both read `// No dispatch purge — materialize self-heals`, on the
  recurring and non-recurring un-complete arms respectively. Confirmed; `:1077`/`:1081` are the
  set-then-purge pair. The citation Decision 3 and §5.4 rest on is accurate. (Its *rationale* is
  not what v2 says it is — see R2.5c.)
- `recurrence.ts:37-39` — `return q.startAt >= windowStart && q.startAt <= windowEnd ? [q.startAt] : []`,
  with no `allDay` term. Decision 8's Consequence A is sound. `computeFireAt` at `:116-118`
  confirmed.
- `index.ts:73-77` — `await materialize(...)` then `await sendDue(...)` **in the same branch, in
  sequence**. So R9's "the `*/5` cron throws and reminders stop firing" is literally true, not a
  loose overstatement: a throw in `getActiveItemsWithReminders` takes `sendDue` down with it.
- `routes/items.ts:26-93` — the `?from&to` path calls plain `getItems` (`:40`) and pushes the whole
  `item` object into each occurrence (`:82`). Decision 4 reason 4 ("bytes leave the Worker") is
  correct, and T20's placement at the HTTP layer is right.
- `deploy.md:13-16`, `:54`, `:80-81` — R9's reading is exact. `:13` says the guarantee holds because
  "every read uses `SELECT *` and maps tolerantly", which is precisely the precondition this branch
  breaks. `send.ts:222-224` (48 h) and `send.ts:232` (digest calls `getItems`) confirmed.
- `CalendarView.tsx:103-131` — `dayOccs` really does drive `visibleOccs`, `hiddenCount`,
  `toggleLabel`/`toggleText` and the `ids` focus geometry from one array, with a comment at `:100-102`
  saying so. Decision 4 reason 1 is the strongest argument in the plan and it is correctly sourced.
- `ItemEditor.tsx:249`, `:251-256`, `:265-269`, `:270-276` — all-day parse/format sites confirmed,
  including the `.toISOString().slice(0,10)` UTC read-back that OQ6 names.
- `calendar-show-more.md:333-352` — §5.2's falsification rule and the accessible-name / computed-role
  / `toBeVisible` worked examples. Confirmed, and it is the standard I applied in R2.6 and R2.9d.
- `getItems` today takes three parameters (`db.ts:568-571`), so §5.4's "new **4th** parameter" is
  right, and `send.ts:232` / `routes/items.ts:40` both call it positionally with three — the default
  genuinely covers them.

**Taken on trust, not re-derived:** `SUITE_BASE` 312 / 35 / 6 (declared as quoted, and the Coder is
told to re-measure); the §5.7 fixture-literal list (declared as a grep superseded by `typecheck`);
the `ItemDetails.tsx` / `ItemModal.tsx` / `ItemListView.tsx` line numbers I confirmed in round 1 and
did not re-open; `Intl.DateTimeFormat.formatToParts` behaviour under workerd (declared unverified —
and see R2.2d, which makes that gap larger than the manifest thinks).

---

## R2.1 Status of round 1's eleven required changes

| # | Round-1 requirement | v2 status |
|---|---|---|
| 1 | All-day-aware gate + two refusal criteria + Decision 5 arg 1 carries alone | **Done**, by a different mechanism than suggested. See R2.2 — the mechanism works but its rejection of the suggested one is aimed at a third thing |
| 2 | Restore specified in full + T-R1…T-R7 | **Done.** Route shape diverges (one `{archived}` endpoint, not `/restore`) with a stated argument I accept. Two sub-items dropped — see R2.5b and R2.9d |
| 3 | Purge irreversibility arguments; head the banked section | **Done**, and well. The declared term sweep (`:1351-1362`) is the right instrument; Appendix A is re-derived *assuming* Restore exists, which is better than the header I asked for |
| 4 | Restate set-then-purge as precedent, not a race fix | **NOT done, and now self-contradictory.** R2.9a |
| 5 | GUARD-label Decision 3(ii) and T11 + record the coupling | **Done, in all four places.** R2.8 |
| 6 | SQL-side calendar exclusion; invert T20/T27/M2 with controls | **Done** for T20/T27; **M2 has no control.** R2.6 |
| 7 | R9 severity + `mapItem` as `row.archived_at ?? null` | **Half done.** Severity is excellent; the `mapItem` half was dropped silently. R2.9b |
| 8 | `all_day`, `location_kind`, null→`""` in Decision 7 and T23 | **Done**, thoroughly — §5.7.1 enumerates all twelve fields |
| 9 | Both fetch sites; scope-aware `refresh()`; Restore never via `onSaved` | **Half done.** Fetch sites and T24(d) are in; the `onSaved` hazard is absent — grep for `onSaved` in the plan returns nothing. R2.9c |
| 10 | 390 px check on the archived modal's action row in M5 | **NOT done.** `390` does not appear in the plan. R2.9e |
| 11 | Invert/relabel/retire sweep; `N_ARCHIVE` row kept; incomplete-past-task row | **Done.** The T25 sub-item landed in T22 instead, which is fine — T22 is now a real test and both call sites use the same predicate |

Nine of eleven fully or substantially folded in, three of them re-derived rather than patched. That
is the trajectory I want to see and I am not going to pretend otherwise. What follows is what is
left.

---

## R2.2 The all-day gate, re-derived from scratch (the coordinator's primary target)

I rebuilt the comparison rather than checking the author's arithmetic. **The mechanism is correct in
the case it was designed for, and it is correct across DST. It is wrong in one reachable case, and
the reason it was chosen does not rule out the alternative it was chosen over.**

### a. Chronological soundness and DST — **correct, confirm**

`dayKey(t, tz)` renders an instant into a calendar date in a fixed zone; day boundaries in a fixed
zone are monotone in the instant, so `dayKey(now) > dayKey(ANCHOR_AT)` ⟹ `now > ANCHOR_AT`.
Decision 8's Lemma 1 all-day branch (`:659-661`) is therefore sound, and *stronger* than the timed
branch as it claims.

**DST is a genuine non-issue here and the plan deserves credit for picking a form where it is.**
`Intl` resolves the offset at the instant, so no offset arithmetic exists to be wrong. I also
checked the write side: `new Date("2026-03-08T00:00:00")` in a zone whose DST transition lands at
midnight resolves forward (V8) and in an ambiguous fall-back hour resolves to the earlier offset —
either way the *calendar date* is unchanged, so the convention survives both transitions. No finding.

### b. Multi-day all-day — **correct**

Fri→Sun with `end_at` = Sun 00:00 local gives `ANCHOR_AT` = Sun 00:00, `dayKey` = Sunday, archivable
from Monday 00:00. §6.2's rows at `:1078-1079` are right, and T6a is the criterion that separates
this from a build reading `end_at` as the *end* of the last day. Two-sided: red on that build, green
on a correct one. No finding.

### c. **REQUIRED (does not block a build) — the cross-zone limitation is recorded against the wrong source and in the wrong direction, and it is far more routine than "a different zone from the one it stores" suggests.**

D1.2's limitation note (`:319-326`) says the two agree "for this single-zone family (every item
defaults to `America/Los_Angeles`, `config.ts:13`)". Two problems, both of the exact
right-fact-wrong-referent shape §0 was built to prevent:

1. **Wrong artifact.** `config.ts:13` is the **Worker's** `DEFAULT_TIMEZONE`, and it is not what
   fills the field. New drafts get their timezone from a **second, independent hardcoded copy** in
   the client: `web/src/components/ItemEditor.tsx:18` (`const DEFAULT_TIMEZONE = "America/Los_Angeles";`)
   consumed at `:68`. §5.7.1 repeats the same citation. The mechanism described is right; the source
   cited is not the one that produces it.
2. **Wrong scope, and wrong direction.** The agreement condition is not "single-zone family" — it is
   "**the creating device was in `America/Los_Angeles`**", because `item.timezone` is *always* that
   constant regardless of where the device is. Let `t` = local midnight on date D in the writing zone
   B; rendered in zone Z the wall time is `D 00:00 + (offset_Z − offset_B)`. So:
   - Z east of B → same day D → gate correct.
   - **Z west of B → lands on D−1 → the gate fires a full day early**, i.e. Archive is offered *on
     the morning of the event* — the v1 blocker, verbatim, in this case.

   Since Z is pinned to LA, the failing condition is simply "the item was created on a device east of
   Pacific time". The family travelling to Denver, New York or Europe for a week and adding an
   all-day item is enough. The plan says "a day early **or late**" (`:322`); it can only ever be
   **early**, which is the unsafe direction and the only one worth writing down.

This changes no code in the branch, but R10 and D1.2 are risk-register text a human reads, so it is
REQUIRED rather than a NIT. Fix: cite `ItemEditor.tsx:18`/`:68`, state the condition as "created on
a device east of `America/Los_Angeles`", and state that the error is one-directional and re-creates
the v1 blocker.

### d. **REQUIRED (does not block) — `isArchivable` can throw, and nothing in the plan stops it. The repo has already solved this exact problem next door.**

`dayKey` calls `Intl.DateTimeFormat(..., { timeZone: tz })`. That **throws `RangeError` on an
unrecognised IANA zone**, and `item.timezone` is unvalidated free text:

- `routes/items.ts:132` and `:201` accept it as `typeof b.timezone === "string" ? b.timezone : undefined`
  — no zone check on create or on PATCH.
- `ItemEditor.tsx:284-289` renders it as a plain `<Input type="text">` with a placeholder. A user can
  type `PST`.
- `recurrence.ts:121` exports `isValidTimezone` "(used in validation)" — I grepped the whole repo:
  **it has zero call sites.** It is dead code, and it depends on luxon, so `src/shared/archive.ts`
  cannot use it anyway.

The plan's `tz = item.timezone || DEFAULT_TIMEZONE` (`:268`) handles empty/null, not invalid.
Consequences of a throw, both reachable for an all-day item with a bad zone:

- Server: `setItemArchived` → `isArchivable` throws → not a `Result`, so a 500 instead of a
  `VALIDATION` — through `db.ts`, the layer `CLAUDE.md:82` makes responsible for returning errors.
- Client: §5.7 puts `isArchivable(item, Date.now())` **inside `ItemDetails`' render** (`:918`). A
  throw during render takes out the view modal for that item.

`src/shared/itemLabels.ts:33-38` documents a three-rung fallback for precisely this ("If falsy or
Intl throws (unknown IANA zone) → retry with the schema default … If that also throws → fall back to
UTC"), in the sibling shared module the plan cites as its Intl-only precedent. Inherit it, or make
`isArchivable` total by catching and returning `false` (the conservative direction — refuse to
archive). Either way, say which, and add one T22 row: *all-day item with an unparseable `timezone` →
does not throw*, whose falsification note is that every other T22 row passes on a build that throws
here because no other row supplies a bad zone.

**Related, same fix site (REQUIRED, one sentence):** §5.2 (`:778-783`) offers `en-CA` "or
`formatToParts` assembled explicitly" and then says "**Use `formatToParts`**" without naming the
locale argument. `formatToParts` defends against separator/ordering conventions; it does **not**
defend against the ambient locale's **calendar** (`Intl.DateTimeFormat(undefined, …)` under a
`-u-ca-buddhist` or `-u-ca-islamic` locale yields a non-Gregorian year) or against the year not
being zero-padded. Pin it: `Intl.DateTimeFormat("en-CA", { timeZone: tz, calendar: "gregory", … })`
and compare the numeric `{y, m, d}` triple rather than a concatenated string. The plan already cites
`calendar-show-more.md` §5.2's "never assert a literal month name" lesson — this is the same lesson
one layer down.

### e. **REQUIRED (does not block) — D1.2 rejects an approach it did not consider, by refuting a third one.**

D1.2 (`:302-308`) argues: materialising "midnight at the end of day D in zone Z" needs the
wall-clock→instant direction `Intl` lacks, which means offset probing, which D11
(`family-scheduler-design.md:571`) rejected. **That refutation is correct, and it is aimed at a
candidate nobody proposed.** Round 1's suggestion was `ANCHOR_AT + 86 400 000` when `all_day = 1` —
pure millisecond arithmetic, no zone, no `Intl`, no wall-clock→instant conversion at all. D11 does
not touch it and the stated objection does not reach it.

I re-derived that candidate against the same four axes:

| | day-key in `item.timezone` | `ANCHOR_AT + 24 h` |
|---|---|---|
| Single-day all-day, device in LA | correct (Thu 00:00) | correct (Thu 00:00) |
| Multi-day Fri→Sun | correct (Mon 00:00) | correct (Mon 00:00) |
| DST | exact | off by ≤ 1 h (button appears at 23:00 or 01:00) |
| **Device east of LA (R2.2c)** | **wrong by a full day, in the unsafe direction** | **correct** — never re-interprets the instant in a foreign zone |
| Invalid `item.timezone` (R2.2d) | **throws** | cannot throw |
| Locale/calendar risk | present, needs pinning | none |
| Server/client agreement | yes | yes |
| Survives an OQ6 storage fix | yes | yes |

The `+24 h` form is more robust on every axis except a ≤ 1 h DST inexactness that is irrelevant at
this scale, and it deletes both R2.2c and R2.2d outright. I am **not** demanding the change — day-key
is defensible and more principled, and the architect owns the call. What I am demanding is that
D1.2 compare the two honestly rather than dispose of the alternative with an argument against
something else. If day-key is kept, say plainly that it is kept for principle and costs the cross-zone
error and the Intl-throw surface.

**Criteria consequence, worth stating:** T5a/T6a **cannot distinguish the two** — both implementations
are green on both fixtures. So nothing in §7.1 forces the chosen mechanism; a Coder could ship `+24 h`
and pass the whole suite. That is acceptable (both are correct on those fixtures) but §8's claim that
T5a/T6a are "mechanism" tests is true only against the *naive* comparison, which is what it says.
No finding there; noting it so the choice is understood to be unenforced.

---

## R2.3 The new anchor expression and the non-export — **both correct, confirm**

- `ANCHOR_AT = MAX(start_at, COALESCE(end_at, start_at))` is type-agnostic and contains no
  `completed_at` term (`:264`, `:61`, `:346-353`). The v1 `MAX(start_at, completed_at)`-over-`NULL`
  ambiguity for an incomplete task is gone, and the per-type split survives only in Appendix A
  (`:1434-1435`) where completion is a precondition and the ambiguity cannot arise. §0's second
  reading note (`:82-87`) states the non-interchangeability explicitly. Correct.
- The outer `MAX` earns its place: `routes/items.ts:179-183` still gates the `end_at >= start_at`
  check on `end_at` being present in the same body (re-confirmed in round 1), so a stale
  `end_at < start_at` row is reachable, and T6 is the only criterion that separates
  `MAX(a, COALESCE(b,a))` from `COALESCE(b,a)`. Correct.
- **The non-export does prevent the named misuse.** `itemAnchorAt` module-private means
  `import { itemAnchorAt }` fails at `tsc`, and the pre-PR gate runs `typecheck`. It does not prevent
  a Coder re-deriving `Math.max(start_at, end_at ?? start_at) < now` inline — nothing could — but the
  plan claims only that exporting it "invites a call site to write `itemAnchorAt(item) < now`"
  (`:774-776`), and that specific invitation is mechanically withdrawn. Claim holds.

---

## R2.4 R11 and T6a — **REQUIRED (does not block). T6a does not pin what R11 says it pins.**

R11 (`:1022-1027`): "*T5a/T6a pin the convention in tests so a change to the editor's parsing goes
red here rather than silently.*"

It does not, and the reason is structural. T5a and T6a are `archive-db` tests that construct their
own fixture rows (`end_at` = Sun 00:00 local, per T6a's own wording at `:1185`). They exercise the
**reader** of the convention. The **writer** is `ItemEditor.tsx:251-256` / `:270-276`, which no
archive criterion touches. Change `:253` to emit UTC midnight (`Date.parse(value + "T00:00:00Z")`) —
a plausible move when someone finally fixes the `.toISOString().slice(0,10)` round-trip bug OQ6
names, in the same file, on the adjacent line — and T5a/T6a stay **green** while every all-day gate
in a non-UTC zone goes wrong. The criterion is green on exactly the build R11 says it catches. That
is the "stated failure condition is unreachable" shape, applied to a mitigation rather than a test.

**Also, R11 understates reachability.** It says a violating row needs "a direct `INSERT`, a future
editor change". It does not: `ItemEditor.tsx:231-236`'s all-day checkbox calls
`setField("all_day", e.target.checked)` and nothing else — **no normalisation of `start_at`/`end_at`
to midnight** — and `handleSubmit` (`:85-97`) forwards `draft.start_at` raw. So toggling *All day* on
an existing 14:00 event today, through the UI, with no code change, stores `all_day = 1` with a
14:00 `start_at`. (The resulting gate behaviour is *conservative* — `dayKey` is still that day, so
archive opens at midnight — so this is a correctness-safe case, but R11's reachability sentence is
wrong and a maintainer will act on it.)

Fix, pick one and say which: (a) accept R11 as **unmitigated**, delete the T5a/T6a claim, and note
the failure direction; (b) add a round-trip criterion in `ItemEditor.test.tsx` — entering
`2026-06-10` with `all_day` produces a `start_at` whose browser-zone day key is `2026-06-10` — which
is the only thing that would actually go red; (c) move the all-day parse into `src/shared/` beside
`dayKey` so one module owns both directions. (b) is one test and is the honest minimum if the claim
is to stay.

---

## R2.5 Decision 8, its executable proof, and the restore criteria

### a. The proof is sound, and it does cover the "passed further" case — **confirm**

Lemma 1 holds under both branches (R2.2a). Lemma 2 rests on the `updateItem` CONFLICT guard, which
T9 tests with a state re-read, and the guard is labelled load-bearing rather than tidy (`:1189`).
Consequence A is exactly `recurrence.ts:37-39`, which I re-read and which does return `[]` with no
`allDay` special-casing. T13r converts it into a criterion with a positive control, which is the
right shape.

**On "an item whose date has passed further since archiving": covered, and by construction rather
than by a criterion — which is correct here.** `expandOccurrences` has one comparison,
`startAt >= windowStart`; "further past" does not reach a second branch, so a separate fixture would
test the same line twice. §6.2 `:1089` and §8.4 `:704-719` carry the user-visible consequences
(lands at the top of the ascending list; no visible change in the current month). No finding — I
looked for one and there is nothing there.

### b. **REQUIRED (does not block) — T15r's stated falsification is wrong, and Decision 3's "failure mode" for the asymmetry does not exist.**

Three places assert that symmetrising restore reintroduces a hazard:

- `:435-437`: "a maintainer will 'restore symmetry' and **reintroduce a failure mode**".
- `:832`: "The asymmetry at step 7-vs-5 is the single thing most likely to be **tidied into a bug**."
- T15r `:1196`: "Guards the asymmetry from Decision 3: a 'symmetrised' build that purges on restore
  too would pass a flag-only assertion. Assert dispatch state explicitly."

Enumerate what a symmetrised restore could do. Adding a **scoped** `deletePendingDispatchForItem` on
restore deletes nothing, because by Decision 8's own proof an archived item has no pending rows —
and T15r's stated assertions (flag is `NULL`, item moves scopes, **an unrelated item's** rows
survive) are **all green on that build**. T15r does not discriminate the thing its falsification
column says it discriminates. Only an *unscoped* delete is caught, which is T2's job.

The half that *is* dangerous is the other one Decision 8 names — restore "does not schedule"
(`:629-630`). A build that calls `materialize` on restore, or widens the window backwards to make it
"work", produces rows; **T13r catches that** ("zero rows", with a control). So the plan's criteria
cover the real hazard and its prose points the reader at the harmless one.

Fix: downgrade the purge half from "reintroduces a failure mode" / "tidied into a bug" to "would be
redundant work implying a hazard that does not exist"; promote the *scheduling* half to the thing the
`WHY` comment defends; and rewrite T15r's falsification column to claim only what it catches (an
unscoped delete on the restore path, and a flag written as `0` rather than `NULL`).

### c. **NIT — the `completeItem` precedent is cited for a rationale that does not transfer.**

`:436-438` and `:832-834` tell the Coder to cite `db.ts:1071`/`:1087` "for the same class of reason".
I re-read both: the comment there is *"No dispatch purge — **materialize self-heals**"* — i.e. the
rows will be **rebuilt**. For restore, materialize self-heals to **zero** rows, and that is the
correct outcome for a different reason (Consequence C, `:681-683`). Same shape, different reason.
This is a milder instance of the v1 defect the plan fixed in Decision 3(ii). The plan is careful to
add "The proof is Decision 8", so nothing downstream is wrong; the `WHY` comment just needs to say
"no dispatch work in either direction, for **different** reasons: `completeItem` because materialize
rebuilds, restore because there is nothing left to rebuild (Decision 8)". Conservative direction, no
decision changes — NIT.

### d. Dropped round-1 restore criteria — one defensible, one not

- **T-R6** (archive → restore → archive again yields a *new, later* `archived_at`) is absent. I am
  **not** re-raising it: T15r now asserts `archived_at` is literally `NULL` after restore, which
  kills the `COALESCE`-the-old-value build T-R6 existed to catch, and `:1088` carries the behaviour
  as an edge-case row. Defensible drop.
- **T-R7's element-identity half** is absent, and that one matters — see R2.9d.

---

## R2.6 The inverted criteria — two of three got a real control

- **T20** (`:1209`) — absence assertion (archived occurrence excluded) plus a presence control (a
  live occurrence in the same response). Real control, correctly placed, and T20b adds the
  state-not-latched dimension. It is also the criterion that discriminates SQL-side from render-side
  exclusion, which is the decision under test. **Correct.**
- **T27** (`:1230`) — the framing is right and the criterion is two-sided (red exactly when someone
  adds a second filter to `CalendarView`, green on the shipped component). **NIT on the control:**
  T27's assertion is that the archived chip **renders** — a *presence* assertion, which cannot pass
  vacuously. The "live chip alongside" control it carries therefore defends against nothing, and §8's
  sweep (`:1369-1371`) lists it beside T20's control as if they did the same work. Harmless and
  conservative, so NIT — but the plan claims a property it does not have, and T27's real limitation
  (it says nothing about what users see; T20 does) is already stated correctly one sentence later.
- **M2** (`:1265-1267`) — **REQUIRED (does not block).** This is the one that missed. M2's inverted
  half is *"disappears from the calendar grid"*, a pure absence check performed by a human, with no
  live-sibling control. A QA pass on the wrong month, a failed fetch, or a grid that renders nothing
  all read as "it disappeared" and tick the box. E1 carries exactly this control (`:1240-1243`) and
  M2 needs the same clause: **"…and a live item in the same month is still on the grid."** One
  sentence. It is REQUIRED rather than NIT because manual QA text reaches a human and this repo's
  own history (`docs/plans/fix-dev-stale-dist.md`, cited in `CLAUDE.md:30-32`) is a false QA result
  from exactly this shape of unfalsifiable manual check.

---

## R2.7 R9 and M1b

### a. R9's two halves — **both correct, and the second is exactly right. Confirm.**

Half one (`:1033-1035`, §5.1 `:742-745`): `ADD COLUMN INTEGER` with no `NOT NULL`/`DEFAULT` gives
every existing row `NULL`, `NULL` means not-archived, no backfill. Correct, and consistent with
`deploy.md:54`.

Half two (`:1036-1044`) is the part I most wanted to check and it holds precisely.
`deploy.md:13` grants read-tolerance **because** "every read uses `SELECT *` and maps tolerantly" —
I confirmed `getItems` is literally `SELECT * FROM items WHERE list_id = ? ORDER BY start_at`
(`db.ts:585`). Putting `archived_at` in that `WHERE` removes the guarantee's stated precondition;
SQLite fails to prepare the statement, so no default value can rescue it. The blast radius is
correctly enumerated and I verified the worst item: `index.ts:73-77` awaits `materialize` **before**
`sendDue` in the same branch, so a throw in `getActiveItemsWithReminders` stops sending too, not just
materialising. The one-way asymmetry and the "rollback needs no down-migration" conclusion both
follow from `deploy.md:80-81` and are correct. **§7.3 is a numbered, three-step prerequisite with
"no exceptions" (`:1288-1306`), which is what was asked for.** This section is the strongest work in
v2.

### b. **REQUIRED (does not block the build; it blocks the claim) — M1b as written cannot rehearse R9. It is accidental theatre.**

M1b (`:1259-1264`) says: "*On a scratch local D1 (`rm -rf .wrangler/state` or a copy), run the new
code **without** applying `0007` and confirm the list view fails with `no such column: archived_at`*".

`rm -rf .wrangler/state` destroys **all** local D1 state, including migrations `0001`–`0006`. Running
the new code against it does not produce `no such column: archived_at` — it produces **`no such
table: items`**. A QA engineer follows the instruction, sees a loud failure, and ticks the box having
rehearsed an empty database, not a partially-migrated one. The only check the manifest offers in
place of the empirical verification it declares it could not do (`:1397-1399`) does not exercise the
mechanism.

There is no wrangler flag for "apply all but the last", so the procedure has to be explicit. Either:

1. Move `migrations/0007_item_archived.sql` out of `migrations/` temporarily → `wrangler d1
   migrations apply --local` (gets `0001`–`0006`) → move it back → run the new code; or
2. Apply everything, then `wrangler d1 execute --local --command "ALTER TABLE items DROP COLUMN
   archived_at; DELETE FROM d1_migrations WHERE name LIKE '0007%';"`.

And M1b must state its own two-sided test, because that is what makes it a rehearsal rather than a
ritual: **the expected error is `no such column: archived_at`; an error naming `no such table` means
the setup is wrong and R9 is unconfirmed, not confirmed.** Also worth one line: `.wrangler/state` is
the dev-server directory, distinct from `.wrangler/e2e-state` (`CLAUDE.md:25-26`), and neither holds
the real family data — those backups are remote-only.

---

## R2.8 The GUARD re-labelling — **correct in all four places. Confirm.**

- Decision 3(ii) (`:406-419`) states the transfer failure explicitly: `completeItem` can run on a
  **future-dated** task so its skip is live; archiving cannot (Lemma 1) and
  `expandOccurrences` returns `[]`, so "even with the clause removed, `materialize` would create no
  rows". Derivation re-checked against `recurrence.ts:37-39` — correct.
- The coupling block (`:421-427`) names **both** consequences — the skip becomes live **and** the
  digest test must return — and says they are not local to the line being changed.
- T11 (`:1191`) carries the GUARD label, the anti-vacuity second half, and the "revisit this label
  if T9's guard is relaxed" pointer.
- §5.6 (`:907-909`) carries the mirrored conditional, and §7.1's `—` row (`:1198`) records the
  omitted digest test as conditional rather than absent.

I looked for a fifth place where the old rationale might have survived the edit and did not find one.
This is clean.

---

## R2.9 Remaining REQUIRED items

### a. **Decision 3(i)'s set-then-purge justification is now self-contradictory** (round-1 item 4, not folded in)

`:379-382` still justifies the order by "*purge-then-set leaves a window in which a concurrent
`materialize` re-inserts the row before the flag lands*". Three paragraphs later, Decision 3(ii)
proves `materialize` inserts nothing for an item whose `start_at` is past — and at archive time it is
past, by Lemma 1, whether or not the flag has landed yet. **The race (i) asserts is refuted by (ii)
inside the same decision.** v2 added the correct justification ("mirroring `completeItem` exactly",
`:377-378`) but kept the wrong one beside it. Delete the race sentence, or restate it as "the order
that stays correct if the Lemma-1 invariant is ever relaxed" — which is true, useful, and consistent
with the coupling note.

### b. **`mapItem` is still specified as `archived_at: row.archived_at`** (round-1 item 7, half folded)

§5.4 `:794`. R9's own derivation says "`mapItem` reads `undefined` where it expected `null`"
(`:1040`), so the plan knows the failure mode and then does not defend against it. Under the R9
ordering hazard, `getItems` errors outright — but `getItemForUser` (`:796`) and
`getItemByIdUnchecked` (`:797`) are **deliberately left unfiltered**, so they are exactly the reads
that keep working and return a row with no `archived_at` key. §5.7's client gates are written
`item.archived_at === null` / `!== null` (`:918`), and `undefined !== null` is **true**, so
`canRestore` fails *open*: a Restore button on a live item on the deep-link path. Low severity (the
server 409s), trivial cost. Specify `row.archived_at ?? null`, and prefer `== null` / `!= null` in
the client gates. If the author consciously rejected this in favour of matching `completed_at`'s
plain mapping (`db.ts:76`), say so — a silently dropped review item is worse than a declined one.

### c. **Restore/Archive and `onSaved` — the coupling is unstated and the code it collides with shipped last week** (round-1 item 9, half folded)

The plan contains no occurrence of `onSaved` or `reloadToken`. Two gaps:

1. `setItemArchived` returns `{ item }` — the same shape as a save — so wiring Restore/Archive
   through the modal's existing `onSaved` is the path of least resistance. `CalendarView`'s `onSaved`
   navigates the grid to `startOfMonth(saved.start_at)` for non-recurring items (shipped as
   `2afce988`, `backlog.md:217`, merged five days ago). Archiving from the calendar's modal through
   `onSaved` would yank the grid to the archived item's month at the instant it vanishes from it.
2. §5.7 says `CalendarView` gets **no change** (`:921`) while `ItemModal` gets `onArchive` /
   `onRestore` / `onDuplicate` threaded (`:919`) — and `CalendarView` owns its **own**
   `useItemModal()` instance (Decision 4 reason 3, `:461-465`). The plan never says whether Archive
   appears in the calendar's view modal. Both answers are defensible; the ambiguity is not.

Add one line to §5.7: Archive/Restore refresh via `refresh()`/the reload token, **never** `onSaved`;
and state explicitly whether `ItemDetails` offers Archive when rendered inside `CalendarView`'s modal.

### d. **T26 asserts Restore by computed role only** (round-1 T-R7, half folded)

T25 (`:1227`) correctly requires "accessible name **and** `tagName === "BUTTON"`". T26 (`:1228`)
asserts Restore and Duplicate are merely "present". `getByRole("button")` matches
`<div role="button">`, dead to Enter and Space — `calendar-show-more.md:340-341`, and
`memory/MEMORY.md`'s "Assert the thing, not the derived property" records this repo failing it
**three times**. Restore is the recovery affordance for the only destructive-feeling action this
branch adds; it is the last control that should be keyboard-dead. Extend T26 (and T26b's click
target) with the same `tagName` assertion T25 already has.

### e. **M5 still has no 390 px check** (round-1 item 10, not folded)

M5 (`:1280-1281`) checks tappability on an iPhone but not the thing that was asked for: the archived
modal's action row goes from 2 buttons to 3–4 (`ItemDetails.tsx:146-155`) inside a mobile Sheet, and
this repo has already shipped a width-overflow bug in a narrow container that only showed at 390 px
(`backlog.md:212`). "Comfortably tappable" is a judgement; "no horizontal overflow at 390 px" is a
measurement, and the e2e density spec already knows how to take it. One clause.

### f. **Decision 7's date-shift rationale does not hold for the all-day arm it specifies** (new)

Decision 7 (`:610-614`) rejects copying the source date because it "create[s] an item whose
reminders' `fire_at` are already gone — a reminder that silently never fires, which is this app's
core promise broken invisibly", and adopts shifting because "if they don't change it, nothing is
silently broken".

§5.7.1's all-day arm (`:963-966`) then targets **today at local midnight** — an instant that is
already past for every duplicate made after 00:30. `computeFireAt` is
`occurrence_at − offset_minutes × 60000` (`recurrence.ts:116-118`) with `offset_minutes` validated
non-negative, so `fire_at ≤ start_at` always; and `getDueDispatch` only reaches back
`GRACE_MINUTES` = 30 min (`config.ts:9`). **So every all-day duplicate created after 00:30 today
lands with all of its copied reminders already dead** — precisely the outcome the shift rule exists
to prevent, produced by the shift rule. T23 (`:1225`) then *pins* that behaviour ("all-day → today").

The UX argument for "today" is real ("duplicate this all-day event" at 3 pm plausibly means today),
and I am not asserting the answer. I am asserting that Decision 7 must not justify the timed arm with
an argument its own all-day arm violates. Either state the cost explicitly ("an all-day duplicate
dated today carries reminders that will not fire; the user is expected to re-date or re-add them"),
or make the all-day arm tomorrow-when-reminders-exist, or drop the reminder-death argument and keep
shifting on the simpler "a past-dated new item is nonsense" ground.

### g. **T25 is the one criterion that cannot inject `now`, and §8's boundary claim skips it** (new, small)

§5.7 puts `isArchivable(item, Date.now())` inside `ItemDetails`' render (`:918`), so T25's all-day
rows ("on its own day → absent; next day → present") must be built against the ambient clock. §8's
two-sided sweep (`:1383-1386`) lists "T5a/T6a and T23 inject `now` … so they cannot fail at a
midnight or DST boundary" and does not mention T25, which is the only one that *can*. Round 1 raised
this as N2 and v2 did not answer it. One sentence in T25: use `vi.setSystemTime`, or pass `now` as a
prop, so the all-day rows cannot flip at a local midnight.

---

## R2.10 NITs (non-blocking, no decision changes)

- **N1.** Decision 3(i)'s live-window derivation (`:393-398`) — "a timed item becomes archivable at
  `ANCHOR_AT + ε`, so a pending row is still live exactly when `offset_minutes < GRACE_MINUTES`" —
  is derived for `ANCHOR_AT = start_at`. For a multi-day **timed** event `ANCHOR_AT = end_at` and
  `fire_at = start_at − offset` can be days earlier, so the window is narrower or empty. Conservative
  direction; T2's fixture is unaffected. Say "a timed item whose anchor is its `start_at`".
- **N2.** T22 (`:1213`) says it covers "every row of §6.2's edge-case table", but several §6.2 rows
  are not predicate questions at all (list deletion, deep links, concurrent archive, restore
  ordering). The Coder will work it out; "every row of §6.2 that is a question about `isArchivable`"
  is what is meant.
- **N3.** `src/shared/archive.ts` exports `archiveBlockedReason` for the server's message (`:766`).
  Nothing says whether its strings are user-facing copy or developer text, and nothing tests them.
  Fine to leave untested; worth one word saying which.
- **N4.** §0's `SUITE_BASE` row is correctly marked `[quoted from the task brief]` and §7 tells the
  Coder to re-measure. No action — flagging only that it remains unmeasured going into implementation.

---

## R2.11 Judgement

v2 is a genuine reshape, not a patch, and the three re-derivations it advertises are real. The
all-day blocker is fixed with a mechanism that is correct across DST, correct for multi-day events,
and paired with two criteria that go red on the v1 build and green on a correct one. Restore arrives
with a proof rather than prose, and the proof's load-bearing step (`recurrence.ts:37-39`) is the line
I checked first and the one it actually rests on. The GUARD re-labelling is complete in all four
places it needed to reach, including the two conditional "this test must come back" pointers. R9 is
the best section in the document: it identifies that this branch is the first to break
`deploy.md:13`'s stated precondition, proves why no default value can rescue it, and converts the
runbook's generic advice into a numbered prerequisite. Round 1 found two defects of the
right-mechanism-wrong-referent class; v2 found and fixed a third (`completed_at` in the live anchor)
without being told to.

My findings this round are smaller and more scattered than round 1's, which is the trajectory I
expect from a plan that is converging. None of them requires a rewrite; all are localised edits to
sections that are otherwise sound. Three clusters account for most of them:

1. **The all-day gate's blast radius is understated and its alternative was dismissed with the wrong
   argument.** The cross-zone error is one-directional (always early, always re-creating the v1
   blocker), the citation for why it is rare points at the Worker's constant instead of the client's,
   and `isArchivable` can throw on data the API accepts today — in a function the plan puts inside a
   React render.
2. **Two mitigations do not mitigate.** T6a does not pin the storage convention R11 hangs on it
   (it tests the reader, not the writer), and M1b's stated procedure produces `no such table` rather
   than the `no such column` it is written to demonstrate. Both are the "stated failure condition is
   unreachable" shape, and both sit on the manifest's own declared-gaps list — the author flagged the
   neighbourhood correctly and then mis-specified the check.
3. **Four round-1 items were dropped without comment** (`mapItem ?? null`, the `onSaved` hazard, the
   390 px check, T-R7's `tagName`), and one was kept in a form that now contradicts a later section
   (set-then-purge). A declined review item is fine; a silently dropped one is how the next round
   re-litigates settled ground.

None of that blocks a Coder. A Coder can build from this document today; they would ship a latent
`RangeError`, a manual-QA step that proves nothing, and a risk register that reads a little safer
than reality. All three are paragraph-sized fixes.

---

## Required changes

1. **R2.2c** — Correct D1.2's and §5.7.1's citation from `config.ts:13` to
   `web/src/components/ItemEditor.tsx:18`/`:68` (the client's own hardcoded default is what fills the
   field). Restate the limitation's condition as "the item was created on a device **east of**
   `America/Los_Angeles`" and its direction as **always early** — never "early or late" — because
   early is the direction that re-creates the v1 blocker. Update R10 to match.
2. **R2.2d** — Make `isArchivable` total. `item.timezone` is unvalidated (`routes/items.ts:132`,
   `:201`; free-text input at `ItemEditor.tsx:284-289`; `recurrence.ts:121`'s validator has zero call
   sites), so `Intl.DateTimeFormat` can throw a `RangeError` on the server (500 from `db.ts`) and
   inside `ItemDetails`' render. Specify the fallback — inherit `itemLabels.ts:33-38`'s chain or
   catch-and-return-`false` — and add one T22 row (bad zone → does not throw) whose falsification
   note records that no other row supplies an invalid zone. In the same edit, pin §5.2's formatter
   locale and calendar explicitly (`"en-CA"`, `calendar: "gregory"`) and compare the numeric
   `{y, m, d}` triple, not a concatenated string.
3. **R2.2e** — Rewrite D1.2's rejection so it addresses `ANCHOR_AT + 86 400 000`, which needs no
   wall-clock→instant conversion and is therefore untouched by the D11 argument currently deployed
   against it. Compare the two on the four axes that differ (DST ≤ 1 h vs cross-zone full day, throw
   surface, locale surface). Keeping day-key is fine — say it is kept for principle and name what it
   costs.
4. **R2.4** — Withdraw R11's claim that T5a/T6a pin the storage convention: both build their own
   fixtures and exercise the reader, so an `ItemEditor` parsing change stays green. Either accept
   R11 as unmitigated, or add the one criterion that would go red (an `ItemEditor` round-trip:
   entering `2026-06-10` with `all_day` yields a `start_at` whose browser-zone day key is
   `2026-06-10`). Also correct R11's reachability sentence: `ItemEditor.tsx:231-236`'s all-day
   checkbox does not normalise `start_at`/`end_at`, so a violating row is reachable through the UI
   today, with no code change (the resulting gate error is conservative — say that too).
5. **R2.5b** — Decision 3, §5.4 and T15r: a scoped purge on restore is *redundant*, not a
   reintroduced failure mode, and T15r's stated assertions are green on that build. Downgrade the
   prose, move the `WHY` comment's emphasis to the half that is genuinely dangerous (restore must not
   **schedule** — the half T13r actually catches), and rewrite T15r's falsification column to claim
   only what it discriminates.
6. **R2.6** — Add M2's missing anti-vacuity control: "…and a live item in the same month is still on
   the grid." E1 already carries it; the manual check is the one a human runs alone.
7. **R2.7b** — Rewrite M1b's procedure. `rm -rf .wrangler/state` yields `no such table: items`, not
   `no such column: archived_at`. Specify moving `0007` out of `migrations/` before applying (or
   apply-then-`DROP COLUMN` plus the `d1_migrations` row), and state the two-sided test: the expected
   error names **`no such column: archived_at`**, and an error naming `no such table` means the setup
   is wrong and R9 is unconfirmed.
8. **R2.9a** — Delete or restate Decision 3(i)'s `materialize` race (`:379-382`). Decision 3(ii)
   refutes it three paragraphs later, so the decision currently argues against itself. "The order
   that stays correct if the Lemma-1 invariant is relaxed" is the true version.
9. **R2.9b** — Specify `mapItem` as `archived_at: row.archived_at ?? null` and the client gates as
   `== null` / `!= null`. `getItemForUser` and `getItemByIdUnchecked` are deliberately unfiltered, so
   they are exactly the reads that survive an unmigrated DB and return `undefined`, which makes
   `canRestore` fail open. If this is a considered rejection of round 1's request, say so instead.
10. **R2.9c** — State in §5.7 that Archive/Restore refresh via `refresh()` / the reload token and
    **never** via `onSaved` (`CalendarView`'s `onSaved` navigates to the saved item's month —
    `2afce988`), and state explicitly whether `ItemDetails` offers Archive when rendered inside
    `CalendarView`'s own `useItemModal` instance.
11. **R2.9d** — Extend T26 (and T26b's click target) with `tagName === "BUTTON"` alongside the
    accessible name, matching T25. `memory/MEMORY.md` records this repo passing tests on broken UI
    three times for exactly this reason.
12. **R2.9e** — Add the 390 px no-overflow measurement of the archived modal's 3–4-button action row
    to M5 (`backlog.md:212` is the precedent).
13. **R2.9f** — Reconcile Decision 7's date-shift rationale with §5.7.1's all-day arm: an all-day
    duplicate dated **today** carries reminders whose `fire_at` is already past
    (`recurrence.ts:116-118` + `GRACE_MINUTES` 30 min), which is the failure the shift rule was
    adopted to prevent. Either state the cost explicitly, change the arm, or drop the
    reminder-death argument.
14. **R2.9g** — Note in T25 that `ItemDetails` reads the ambient clock, so its all-day rows need
    `vi.setSystemTime` (or an injected `now`) to avoid a midnight-boundary flake. §8's "both
    directions" sweep currently lists every clock-dependent criterion except this one.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v3)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-20 · **Round:** 3

> The verdicts above (`REJECT`, round 1; `APPROVE WITH CHANGES`, round 2) are preserved as written.
> The operative verdict for v3 is on the last line of this file.

---

## R3.0 What I sampled from the manifest, and what I took on trust

The author's disclosure — that they drafted §8's sweep declaration, then ran the grep and found five
survivors it did not cover — was the right thing to disclose and it aimed me correctly. **I treated
every sweep-style declaration in v3 as unverified and grepped it myself.** That found two more
survivors the corrected declaration still does not cover (R3.2, R3.3). The manifest is honest about
what it did not check; it is not reliable about what it claims to have finished.

**Independently re-derived this round (opened the file, checked the line):**

- `CalendarView.tsx:287-297` — `onSaved` is exactly as Decision 9 quotes it, guard `!saved.rrule` at
  `:292-294`, `setCurrentMonth(startOfMonth(new Date(saved.start_at)))` at `:293`. `reloadToken` is
  declared at `:33` and is a dep of the fetch effect at `:72`. Quotation and citations correct.
- `CalendarView.tsx:247` — the **only** call to `itemModal.openView` in the component, from a chip.
- `CalendarView.tsx:84` — chips are filtered to the displayed month
  (`d.getFullYear() === year && d.getMonth() === month`). This is the line Decision 9 and T30 turn
  on and it is the one the plan does not cite. See R3.1.
- `App.tsx:55-63` — the `?item=` deep link point-reads the item and forces `setActiveView("list")`
  before handing it to `ItemListView`. So `CalendarView`'s modal has exactly one entry point.
  **Decision 9's "Restore is unreachable from `CalendarView`" is TRUE**, and I confirmed it by the
  route the plan does not name rather than the one it does.
- `recurrence.ts:37-39` — `return q.startAt >= windowStart && q.startAt <= windowEnd ? [q.startAt] : []`,
  no `allDay` term; `materialize.ts:61` passes `now` as `windowStart`. **The deleted all-day
  duplicate arm's justification holds exactly as stated**: an all-day copy dated today's local
  midnight has `startAt < now`, so it gets no occurrence in the materialise window at all, not merely
  dead reminders. §5.7.1 `:1084-1085` is correct.
- `ItemEditor.tsx:18` (client `DEFAULT_TIMEZONE`), `:231-236` (the all-day checkbox that sets
  `all_day` and nothing else), `:251-256` / `:270-276` (local-midnight parse), `:249`/`:267` (the UTC
  `.toISOString().slice(0,10)` read-back). R10's re-attribution and R11's corrected reachability
  claim are both right, and T29 is writable against `:251-256` as specified.
- `index.ts:73-77` (materialize→sendDue in sequence) and — new this round — **`index.ts` registers no
  `app.onError`**, which bears on M1b (R3.5).
- `package.json:15` — `migrate:local` exists, so M1b's commands are real.
- `vitest.workspace.ts:14-50` — two projects, neither pinning `TZ`. Bears on T29 (R3.7).
- The 25 h arithmetic, re-derived rather than checked: the ideal gate is local midnight at the start
  of day D+1, i.e. `ANCHOR_AT + (length of day D)` ∈ {23, 24, 25} h. `ANCHOR_AT + 25 h` is therefore
  **≥ ideal always** — never early, ≤2 h late. Correct, and correct for the same reason on a
  multi-day all-day item, whose `end_at` is the start of the last day. `90_000_000` ms = 25 h ✓.

**Taken on trust, not re-derived:** `SUITE_BASE` 312/35/6 (still declared as quoted); the §5.7
fixture-literal list (declared as a grep, superseded by `typecheck`); `db.ts` line numbers I
confirmed in rounds 1 and 2 and did not re-open (`:585`, `:1242`, `:1071`/`:1087`, `:1306-1312`);
`ItemDetails.tsx:146-155`; the three items the manifest declares unverified (`no such column`
empirically, wrangler's applied-set under a moved file, `ALL_DAY_GRACE_MS` against a real DST
transition) — all three are correctly declared and two of them are QA's job, not mine.

---

## R3.1 Decision 9 — **REQUIRED (does not block a build). The harm it describes cannot happen, and T30 is green on the build it names.**

This is the round's sharpest finding and it sits on one of the two decisions v3 changed.

Decision 9 (`:810-815`) says: *"if Archive reuses `onSaved`, it takes that branch every time and
**navigates the grid to the archived item's month** — where the item is not… The user presses Archive
and is thrown into a past month showing everything except the thing they acted on."*

**The user cannot be thrown into another month, because they are already in it.** Three verified
facts compose:

1. `CalendarView`'s modal has exactly one entry point — a chip (`CalendarView.tsx:247`). The deep
   link is not a second one: `App.tsx:62` forces `setActiveView("list")` first.
2. A chip renders only if its `occurrence_at` falls in the **displayed** month
   (`CalendarView.tsx:84`).
3. For a non-recurring item — and every archivable item is non-recurring — `occurrence_at ===
   item.start_at` (`recurrence.ts:39`).

So at the moment Archive fires from the calendar, `startOfMonth(saved.start_at)` **already equals**
`currentMonth`. The `onSaved` build calls `setCurrentMonth` with a fresh `Date` of the same month:
new object identity → one re-render → the `[currentMonth, lists, reloadToken]` effect (`:72`) refires
→ a refetch. That is *the same observable behaviour* as the proposed `onArchiveChanged`
(`close()` + `setReloadToken`). There is no month change, no user-visible difference, and no bug.

**Consequences, in order of how much they matter:**

- **T30 cannot go red on the build it names.** Its two halves are "the rendered month heading is the
  same before and after" and "the grid did refetch". The `onSaved` build satisfies both. This is the
  coordinator's sharpest question answered in the wrong direction: **T30 cannot distinguish the
  approach the plan chose from the one it rejected.** The plan's own §7.1 contract — "what a wrong
  implementation would still pass" — is violated by the row's own falsification text, which asserts
  the wrong build "jumps the grid to a past month".
- **M2c (`:1438-1439`) is unfalsifiable manual QA.** "The grid must **stay on the current month**…
  A jump to a past month is the shipped-`onSaved` collision" — the jump is impossible on both builds,
  so a human ticks the box either way. This repo's own history (`fix-dev-stale-dist`, cited at
  `CLAUDE.md:30-32`) is a false QA pass of exactly this shape, and round 2's M2 finding was the same
  class.
- **The decision itself survives, on different grounds.** A separate `onArchiveChanged` is still the
  right shape — not because `onSaved` misbehaves, but because `onSaved`'s correctness for Archive
  would rest on the silent coincidence that the chip's month equals the item's month, which is an
  invariant of `CalendarView.tsx:84` that nothing states and nothing tests. That is a defensible
  hygiene argument. It is not the argument the plan makes.

**What would actually discriminate, if T30 is to be kept.** Only a fixture production can never
produce: mock an occurrence whose `occurrence_at` is in the displayed month while its
`item.start_at` is in a different one. That is precisely T27's shape ("given a mocked occurrences
response that contains an archived item, **which production never sends**"), and it should be framed
the same honest way — a mechanism test on an impossible input, not a user-facing regression. The
alternative is to delete T30's navigation half, keep the refetch half, and say plainly that Decision
9 is a coupling-hygiene decision with no reachable failure today — which is what §7.1's **GUARD**
label exists for, and the plan has used it well five times already.

**One more thing Decision 9 should say.** `:831-837` states the unreachability of Restore from the
grid and names one breaking condition ("if a future change ever surfaces archived items on the
grid"). There is a second, equally load-bearing one: `App.tsx:62`'s deep-link handler routes to the
list view. If a deep link ever opened in the calendar's modal, Restore becomes reachable there and
`CalendarView`'s handler *does* need a restore branch. Cite `App.tsx:55-63` and name it.

---

## R3.2 §6.2's all-day rows are still day-key semantics — **REQUIRED (does not block). T22 is built from this table, so a Coder writing it gets a criterion that is red on correct code.**

`:1225`: *"| **All-day single-day event, next day** | archivable from **local midnight** |"*

Under `ANCHOR_AT + 25 h` it is **not** archivable from local midnight — it becomes archivable at
~01:00 the next day. "From local midnight" is exactly the day-key answer, and it contradicts three
other places in the same document that have the new mechanism right: D1.1's table (`:315` — "Thu
~01:00"), T5a (`:1335` — "Use 02:00, not 00:30… a 00:30 success assertion would fail on correct
code") and T5b (`:1337`).

**Why this is not cosmetic.** T22 (`:1365-1366`) is specified as *"the predicate's own table over
`isArchivable`, **covering every row of §6.2's edge-case table**, with `now` injected."* A Coder
enumerating §6.2 writes `expect(isArchivable(allDayYesterday, nextDayLocalMidnight)).toBe(true)` —
**false on a correct implementation**. The plan then contains two criteria that cannot both pass. The
second-order risk is worse than the flake: a Coder who trusts the edge table over T5b "fixes"
`ALL_DAY_GRACE_MS` to 24 h, and the failure direction is the one D1.2 chose 25 h to avoid.

`:1227` ("All-day Fri→Sun, on Monday | archivable") has the same imprecision, softened by the row
above it stating "the gate opens Monday ~01:00". Fix both while you are in there.

**And it is a sweep miss inside the sweep's own stated hit.** §8 `:1552` records fixing "§6.2 edge
table, **two rows**" — the two containing the literal token `dayKey(...)`. The adjacent row that
expresses the same semantics in prose was not covered, because the term list (`:1540-1542`) is a list
of *identifiers*, not of *claims*. That is the generalisable lesson: a term sweep finds the mechanism's
name, not the mechanism's answers.

---

## R3.3 §8's own criteria sweep still names the deleted mechanism — **REQUIRED (does not block; it is a declaration a reader will rely on).**

`:1607-1609`: *"**Mechanism vs output — three criteria test the chosen mechanism:** T5a/T6a separate
the all-day **day-key branch** from the naive instant comparison…"*

There is no day-key branch. The declaration four paragraphs earlier (`:1558-1560`) says
`dayKey`/`Intl`/`formatToParts` "survive **only** inside D1.2's comparison table and its 'if a future
version needs a zone' note, plus §5.2's and step 2's prohibitions". `:1608` is a sixth survivor, in
§8 — inside the sweep's own declared range ("the entire file, §0 through §8 plus Appendix A",
`:1539`). The hyphenated form *was* searched (`:1563-1565` records fixing two other instances of
"day-key branch"), so this is a missed hit, not a missed term.

Two substantive knock-ons, not just the wording:

- **T5b is missing from that list**, and T5b is the only criterion that pins the chosen mechanism's
  constant. The list as written credits the two criteria that *cannot* separate 24 h from 25 h.
- `:1611-1613` ("the ones most at risk of failing on **correct** code… T5a/T6a and T23 inject `now`")
  still omits both T5b **and** T25 — see R3.4 and R3.6.

---

## R3.4 T25's clock was round 2's item 14 and it was dropped silently — **REQUIRED (does not block). The 25 h constant makes it materially worse than when I raised it.**

Round-2 required change 14 (R2.9g) asked for one sentence in T25: `ItemDetails` evaluates
`isArchivable(item, Date.now())` in render (`:1035`), so T25's all-day rows need `vi.setSystemTime`
or an injected `now`. I grepped v3: `setSystemTime` appears nowhere, T25 (`:1379`) says nothing about
the clock, and §8's "at risk of failing on correct code" list (`:1612`) still names T5a/T6a and T23
only. Thirteen of fourteen items landed; this one was neither folded in nor declined, and the
revision history (`:20-44`) does not mention it.

**Under the new mechanism the omission is no longer cosmetic.** T25's positive all-day row is "an
all-day item on its own day (absent) and **the next day (present)**". The natural fixture for "next
day" is yesterday's local midnight. Its gate opens at `ANCHOR_AT + 25 h` = **01:00 today**. So the
suite is red on correct code for any run between 00:00 and 01:00 local — a one-hour window every day
that did not exist under v2's day-key rule, where "yesterday" was archivable from midnight. The
mechanism change moved a criterion from zero flake to a daily flake window, in the one criterion that
cannot inject its own clock.

Same arithmetic, same fix, one line each: **M3** (`:1444-1447`) tells the owner to "create an all-day
event for **yesterday**; confirm Archive is present" — false between midnight and 01:00. Add "(after
about 01:00 — the gate is `+25 h`, D1.2)".

---

## R3.5 M1b — **REQUIRED (does not block the build; it blocks the claim). The procedure is now right and the observation step is not.**

The rewrite fixes what round 2 found: withholding only `0007` genuinely reproduces a complete `items`
table without `archived_at`, `npm run migrate:local` exists (`package.json:15`), and the two-sided
test is stated (`:1430-1431` — an error naming `no such table` means the setup is wrong and R9 is
**unconfirmed**). That is a real rehearsal where v2 had theatre. Confirmed.

**What it still does not say is where the error appears, and the whole check turns on reading it.**
Step 4 (`:1426-1428`) says "open the list. Expect a failure naming **`no such column: archived_at`** —
confirm the message, not merely that something broke." `src/worker/index.ts` registers **no
`app.onError`** (I read the whole file), so Hono's default handler returns a bare 500 to the browser
and logs the exception. The SQLite message therefore surfaces in the **`wrangler dev` terminal**, not
in the UI or the network response body. A QA engineer following step 4 literally sees a generic
failure in the app, cannot distinguish `no such column` from `no such table`, and the two-sided test
silently degrades into "something broke" — the exact failure mode the rewrite exists to remove. One
clause: *"the message appears in the `npm run dev` worker console, not in the browser; the browser
shows a bare 500."*

Minor, same step: "let a `0 14 * * *` tick pass" is not a thing a QA session can do. The "or reason
from §7.3 about the digest" escape hatch makes it harmless — consider deleting the first half.

---

## R3.6 NITs

- **N1 — T5a/T6a's 02:00 sample has zero margin on one fixture date.** For a single-day all-day
  fixture, local 02:00 on D+1 is `ANCHOR_AT + 26 h` on a normal day, but `+25 h` exactly if day D is
  a spring-forward day. The gate is strict (`ANCHOR_AT + 25 h < now`), so on that one date the
  success half is **red on correct code**. Injecting `now` protects against the ambient clock, not
  against choosing a transition date as the fixture — so §8's "they cannot fail at a midnight or DST
  boundary" (`:1612`) is slightly stronger than the criteria support. Either sample at 03:00 or say
  "pick a date that is not a DST transition". Conservative direction, unlikely to be hit, cheap to
  close.
- **N2 — T29's "different numbers" assertion is environment-dependent and nothing pins `TZ`.**
  `vitest.workspace.ts:14-50` sets no `TZ` for either project, so in a UTC-offset-zero environment
  local midnight **is** UTC midnight and T29's own guard clause (`:1384`) fails rather than skips.
  Failing loudly is the defensible choice, but pinning the zone for that spec (`test.env = { TZ:
  "America/Los_Angeles" }` on the web project, or the equivalent in the file) makes the criterion
  mean the same thing everywhere. Worth one line because the plan raises the hazard and then leaves
  it to the runner.
- **N3 — `onArchiveChanged`'s optionality is unstated.** §5.7 (`:1036`) adds it to `ItemModal`; if it
  is optional and a host forgets it, Archive succeeds server-side and the modal just sits there. The
  plan's own §3.2 house style is "make the forgetful case safe by construction" — a **required**
  prop makes `typecheck` the enforcement. Say which.
- **N4 — round 2's R2.9b half-item is resolved better than it was asked for**, and I want that on the
  record rather than re-raised: `mapItem` is now `row.archived_at ?? null` (`:911`), and because
  `mapItem` is the single mapping function every read path flows through, the client gates can stay
  `=== null` / `!== null` (`:1035`) without failing open. No change needed.

---

## R3.7 What I checked and found clean (so a fourth round does not re-litigate it)

- **The 25 h gate, end to end.** Multi-day all-day (anchor = `end_at` = start of the last day →
  ~01:00 the day after) ✓; `end_at` that is itself a local midnight ✓ (that *is* the convention, and
  the timed arm is untouched for a timed event ending at 00:00) ✓; non-all-day items do not touch the
  grace at all ✓; `end_at < start_at` still handled by the outer `MAX` ✓; an `all_day` row with a
  14:30 anchor (reachable via `ItemEditor.tsx:231-236`) opens late, never early ✓ (`:1171-1172`).
  The "uniformly conservative" claim is correct as derived, and the manifest's caveat about zones
  with >1 h DST shifts is the honest bound.
- **Does T5b pin the constant?** Yes, and two-sided: at `ANCHOR_AT + 24.5 h` a 24 h build archives
  (red) and a 25 h build refuses (green). Paired with T5a's 02:00 (`+26 h`) success it brackets the
  constant to (24.5, 26] h, so an over-large constant is caught too. The "state it as a boundary
  probe, not a DST test" note is the right framing.
- **The deleted duplicate all-day arm.** Verified at `recurrence.ts:37-39` + `materialize.ts:61`:
  an all-day copy dated today has no occurrence in the window at all, so the author's reason is
  stronger than round 2's, as claimed. The now-uniform rule has no gap — an all-day source's
  wall-clock is 00:00, which has always passed, so it falls into the "already passed → tomorrow"
  branch deterministically (`:1089-1091`). ✓
- **"Restore is unreachable from the calendar."** True, verified by the two routes that could
  falsify it (chip-only modal entry, deep link forced to the list view). Only the citation is
  missing (R3.1).
- **Decision 3, §5.6, the GUARD labels, R9 and §7.3** are unchanged from v2 where I confirmed them,
  and the four round-2 corrections to them (set-then-purge race deleted, T15r's falsification
  rewritten, R10 re-attributed, R11's reachability corrected) all landed in the text I re-read.
- **T20/T20b, T27, T28, T29, E1, M2** — re-read against §5.2's falsification question. Each is red on
  the build it names and green on a correct one, and each absence assertion carries a live-item
  control. T27's control remains decorative (round-2 NIT, not re-raised). **T30 is the only criterion
  in §7.1 that fails the two-sided test** (R3.1).

---

## R3.8 Judgement

The trajectory is right and I want to say so before the list. Both decisions that changed in v3
changed for good reasons, and the all-day one is now the strongest part of the plan: replacing the
day-key with `ANCHOR_AT + 25 h` deletes a throw surface and a cross-zone day error rather than
mitigating them, the constant is derived rather than chosen, the direction of its error is argued,
and T5b pins it with a genuine two-sided boundary probe. The author also caught, unprompted, that
T5a/T6a's `00:30` success assertion would have gone red on correct code — a criterion failing on a
*correct* build is the defect class hardest to see from the inside, and they found it in their own
work. M1b is a real rehearsal now. The `onSaved` collision was worth finding even though the harm
turns out to be unreachable: nothing in v2 acknowledged that `CalendarView` had been rewritten five
days earlier.

My findings this round are fewer and smaller than round 2's, and two of the five are one-clause text
fixes. But two of them are the failure classes this project keeps producing:

1. **A criterion whose stated failure condition is unreachable** — T30 and M2c, guarding a decision
   whose described harm cannot occur, because the chip a user clicks is always in the month the grid
   is already showing (`CalendarView.tsx:84`). The decision survives on hygiene grounds; the
   justification and the criterion do not.
2. **Residue of a deleted mechanism, inside a sweep that declared itself clean** — §6.2's "archivable
   from local midnight" and §8's "day-key branch". The author's disclosure that the first sweep
   declaration was wrong was exactly the right instinct, and the corrected declaration is still
   wrong in two places. The lesson worth writing down: the term list caught every occurrence of the
   mechanism's *name* and no occurrence of its *answers*, and §6.2's row is load-bearing because T22
   is generated from that table.

None of this blocks a Coder. Everything in §§1–5 is buildable today and the implementation checklist
is accurate. What is at stake is whether the criteria can be trusted to gate the build — and for
T30, T22's all-day row and T25, they currently cannot.

---

## Required changes

1. **R3.1** — Correct Decision 9's premise. Archiving from a chip cannot move the grid, because
   `CalendarView.tsx:84` renders only occurrences in the displayed month and `occurrence_at ===
   start_at` for the non-recurring items that are archivable; `App.tsx:62` forces the deep link to
   the list view, so the chip is the only entry point. Keep the separate `onArchiveChanged` — but
   justify it as refusing to depend on that unstated coincidence, not as preventing a month jump.
2. **R3.1** — Make T30 discriminate or relabel it. Either give it the T27 treatment (a mocked
   occurrence whose `item.start_at` is in a different month from `occurrence_at` — an input
   production never produces — stated as such), or drop the navigation half, keep "the grid
   refetched", and label the row **GUARD**. Apply the same correction to **M2c**, whose current
   instruction passes on both builds.
3. **R3.1** — Add `App.tsx:55-63` to Decision 9's unreachability note as the *second* assumption
   Restore-from-the-calendar rests on.
4. **R3.2** — Fix §6.2 `:1225` ("archivable from local midnight" → "from `ANCHOR_AT + 25 h`, i.e.
   ~01:00 the next day") and tighten `:1227` the same way. It contradicts D1.1 `:315`, T5a and T5b,
   and T22 is specified as covering every row of this table — so as written it instructs the Coder to
   assert something false on correct code.
5. **R3.3** — Delete "day-key branch" from §8 `:1608`; add **T5b** to the mechanism list (it is the
   only criterion that separates 25 h from 24 h) and to `:1612`'s at-risk list. Correct the
   declaration at `:1558-1560`, which now has two known survivors.
6. **R3.4** — Fold in round-2 item 14 or decline it in writing: T25 evaluates `isArchivable(item,
   Date.now())` in render, and under `+25 h` its "next day → present" row is red on correct code
   between 00:00 and 01:00 local. Specify `vi.setSystemTime` or an injected `now`. Add the same
   caveat to **M3**'s "create an all-day event for yesterday" step.
7. **R3.5** — M1b step 4: say where the error appears. `src/worker/index.ts` registers no
   `app.onError`, so the browser gets a bare 500 and `no such column: archived_at` is visible only in
   the `npm run dev` worker console — which is what the step's own two-sided test depends on reading.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v4)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-20 · **Round:** 4

> The verdicts above (`REJECT`, round 1; `APPROVE WITH CHANGES`, rounds 2 and 3) are preserved as
> written. The operative verdict for v4 is on the last line of this file.

---

## R4.0 What I sampled from the manifest, and what I took on trust

The coordinator told me items 5–7 and the four NITs had one pass rather than two. I weighted
accordingly: **I re-derived every one of those seven from the code**, and spot-sampled items 1–4.

**Independently re-derived this round (opened the file, checked the line):**

- **`App.tsx:55-63`** — `setActiveView("list")` is at `:62`, inside the `if (deepId)` success branch.
  The plan's citation is accurate. **But the consequence attached to it is not** — see R4.1, which
  turns on `App.tsx:229-244`, a line range the plan does not cite.
- **`App.tsx:229-244`** — `activeView === "calendar" ? <CalendarView lists user /> : <ItemListView …
  initialOpenItem={initialOpenItem} …/>`. `CalendarView` is handed **no** `initialOpenItem`, and
  `ItemListView` is unmounted while the calendar is showing.
- **M1b's terminal half — confirmed, and it is right.** `src/worker/index.ts` registers no
  `app.onError` (grepped the file: `new Hono` at `:23`, `app.use("/api/*", requireAuth)` at `:28`,
  no error handler). `getItems` (`db.ts:568-596`) wraps the `.all()` in **no** try/catch, and the
  list route (`routes/items.ts:40`) does not either, so a D1 failure propagates to Hono's default
  handler → a bare 500 whose body is text, not JSON. `apiClient.request` (`:39-51`) attempts
  `resp.json()`, catches the parse failure, and throws `ApiError("UNKNOWN", "HTTP 500")`. Every link
  in the chain the plan describes is real.
- **M1b's browser half — confirmed, and it is wrong in one clause.** `ItemListView.tsx:66-74`'s
  effect `.catch((err) => setError(String(err)))` and the banner at `:148-152` are exactly as cited.
  But `onItemsChange` is never called on the failure path, so `items` stays `[]` and `:154-155`
  renders **"No items in this list yet."** underneath the banner. See R4.2.
- **`vitest.workspace.ts`** — read in full. Two projects; the "web" project is the inline object at
  `:30-49`; **neither sets `env`/`TZ`**. T29's citation is correct and the fix is implementable
  (`env: { TZ: … }` inside the `test` block at `:39-48`). Caveats in N4.2.
- **`CalendarView.tsx:82-88`** — the month filter is at `:84`, and `dayCells`/`dayOccs` at
  `:103-131` really do derive `visibleOccs`, `hiddenCount`, the toggle strings and the focus `ids`
  from one array. Decision 9's composition and Decision 4 reason 1 are both correctly sourced.
- **`ItemDetails.tsx:16-37`** — `onEdit: () => void` is **required** in the same props interface
  where §5.7 adds three optional siblings. N4.3.
- **`vi.useFakeTimers()` has in-repo precedent with RTL** (`NotificationSetup.test.tsx:157`, plus
  `docs/qa/push-enable-persistence-report.md:40`), so T25's clock pin is writable as specified. I
  went looking for a fake-timers/RTL hazard and there is none worth a finding.
- **The 03:00 arithmetic, re-derived across all four DST combinations** — see R4.4a. The move
  restores margin in every case, including the one the coordinator named.
- **The scoped sweep claim — verified independently, and it holds.** See R4.6.

**Taken on trust, not re-derived:** `SUITE_BASE` 312/35/6 (still declared as quoted, Coder
re-measures); the §5.7 fixture-literal list (declared as a grep superseded by `typecheck`); `db.ts`
line numbers confirmed in rounds 1–3 and not re-opened (`:585`, `:1242`, `:1071`/`:1087`,
`:1306-1312`, `:1343`); `recurrence.ts:37-39` and `materialize.ts:61` (re-derived in round 3);
`ItemEditor.tsx`'s parse sites (round 3); the three items the manifest still declares unverified
(the `no such column` failure empirically, wrangler's applied-set under a moved migration file,
`ALL_DAY_GRACE_MS` against a real transition) — all correctly declared, and the first is M1b's job.

---

## R4.1 Decision 9's "second assumption" names the wrong mechanism — **REQUIRED (does not block a build). It is a stated failure condition that cannot fire, and I asked for this citation in round 3, so the imprecision is partly mine.**

The plan now says, twice:

- `:852-854`: *"(`App.tsx:62` closes the remaining route: a `?item=` deep link forces `activeView`
  to `"list"`, so an archived item's modal never opens over the calendar.)"*
- `:891-895`: *"**A deep link cannot open one over the calendar.** `App.tsx:55-63` … unconditionally
  sets `activeView` to `"list"` (`:62`) … **Without this, a push notification for a since-archived
  item would open its modal on whatever view was active**…"*

The first sentence is true. **The consequence in the second is not reachable in today's code.**
`App.tsx:229-244` renders `<CalendarView lists={lists} user={user} />` — **`CalendarView` is never
handed `initialOpenItem`** — and `ItemListView`, which is the only component that consumes it
(`:240`, effect at `ItemListView.tsx:76-84`), is **unmounted** while the calendar is showing. So
delete `setActiveView("list")` and a deep link arriving on the calendar does not open a modal over
the grid; it opens nothing until the user switches to the list, at which point it opens there.

Why this matters more than a wording quibble: `:898-900` turns the pair into a **trigger condition**
— *"If either assumption is ever relaxed, this is what breaks."* A maintainer who relaxes the named
assumption (removing `:62` so a deep link opens in place) would, per the plan, believe they had just
made Restore reachable from `CalendarView` and add a restore branch. They would not have. The fact
that actually carries the conclusion is the **prop wiring** at `App.tsx:232` vs `:240`, and the real
trigger is "if `CalendarView` is ever given `initialOpenItem`". This is failure class 2 applied to a
coupling note: a correct mechanism pointed at the wrong target, with a failure condition that cannot
fire.

The conclusion — *Restore is unreachable from `CalendarView`* — **survives, and is stronger than the
plan claims**: it rests on two independent facts (chip-only `openView` at `CalendarView.tsx:247`,
and no deep-link prop at `App.tsx:232`), with `:62` as a third, redundant layer. Say it that way.

Round 3 (me) wrote *"Cite `App.tsx:55-63` and name it"* and called it equally load-bearing. That
instruction was itself imprecise, and the author executed it faithfully. The fix is one clause, not
a re-derivation.

---

## R4.2 M1b step 4's browser observation describes a screen that cannot occur — **REQUIRED (does not block the build; it blocks the claim). Third revision of this step.**

Step 4 (`:1491-1495`): *"**In the browser:** the list must render an **error state**, not an empty
list… 'Empty list' would mean a *different* bug and must not be accepted as a pass."*

The two are not alternatives — **both render at once**. On the failure path
`ItemListView.tsx:70-73` calls `setError(...)` and never calls `onItemsChange`, so `items` stays
`[]`, and `:154-155` renders the placeholder **"No items in this list yet."** directly beneath the
destructive-styled banner at `:148-152`. A QA engineer following the instruction literally sees an
empty list, is told an empty list means a different bug, and has to guess.

The discriminator QA actually needs is **presence of the banner** (text "ApiError: HTTP 500" via
`String(err)`), not absence of the placeholder. One clause: *"the placeholder 'No items in this list
yet.' renders too, because the failed fetch leaves `items` empty — the observation is the red error
banner above it; a placeholder with **no** banner is the different bug."*

Graded REQUIRED rather than NIT for the reason round 2 gave M2: this is manual-QA text reaching a
human, it is the one step the manifest says it most wants run (`:1776-1779`), and this repo's worst
QA outcome on record was a false read of exactly this shape (`CLAUDE.md:30-32`). The terminal half
(R3.5's fix) is correct and is what confirms the mechanism — that half I verified end to end and it
is right.

---

## R4.3 GUARD bookkeeping — **REQUIRED (does not block). An enumeration invalidated by the same revision's own edit, one paragraph from the standing note that warns about it, plus a label that contradicts its own definition.**

Two halves, same root.

**(a) §8 `:1741`** — *"**Five criteria labelled GUARD**… : T8 (…), T10 (…), and **T11**…"*. It
claims five, names three, and §7.1 now carries **four** (T8 `:1403`, T10 `:1405`, T11 `:1406`,
**T30 `:1448`**). v4 added a GUARD label and did not touch the paragraph that counts them. This is
precisely the failure the sharpened rule was written for — *"enumerate, **and scope the enumeration
to a region that will not churn**"* (`:1818-1823`) — recurring inside the revision that sharpened
it, in a declaration a reader relies on. (If "five" was meant to include Appendix A's deferred T14
`:1936`, say so; the paragraph is headed "Criteria sweep (**§7.1**)", so as scoped it is four.)

**(b) T30's label contradicts §7.1's definition of the label.** `:1385`: *"Items explicitly labelled
**GUARD** have no reachable failure state and are kept for hygiene or localisation, **not as proof
of anything**."* T30's own cell then says: *"What **is** reachable, and what this row now tests, is
a build that wires Archive to `itemModal.close()` alone and never refreshes."* I checked that build:
it is reachable (§5.7's `CalendarView` row hands the Coder a two-statement body; dropping the second
is an ordinary slip), and T30 goes red on it and green on the correct one. **T30 is a real,
two-sided criterion wearing a label that tells the next reader it proves nothing and must not be
upgraded** — the one criterion covering a stale-chip defect is the one flagged as hygiene.

Round 3 offered this label as one of two acceptable outs, so I am not treating it as a regression —
but round 3's version was *"drop the navigation half, keep the refetch half, and label GUARD"*, and
the navigation half ("the month heading is unchanged") is still an assertion in the row. Keeping it
is conservative (green on both builds, never red on correct code), so that part is a NIT. The label
is the part worth one sentence: scope it — *"GUARD **as to the navigation choice only**, which is
unobservable; the refresh assertion is a live criterion"* — or drop it and add a line to `:1741`.

**Answering the coordinator's question directly:** this is a test that was *fixed*, not one retired
under a convenient label. The observable part is genuinely reachable and the row discriminates on
it. The defect is the bookkeeping around it, not the criterion.

---

## R4.4 N1's 03:00 fix, and the one place the boundary hazard survives

### a. The move restores margin in every case — **confirmed, including the spring-forward case the coordinator named.**

Re-derived rather than checked. For T5a (`ANCHOR_AT` = local midnight of day D, gate opens at
`ANCHOR_AT + 25 h`, strict `<`), elapsed real time from `ANCHOR_AT` to local 03:00 on D+1:

| Fixture | Elapsed to 03:00 on D+1 | Gate (25 h) |
|---|---|---|
| Normal | 24 + 3 = **27 h** | open ✓ (2 h margin) |
| D is spring-forward (23 h day) | 23 + 3 = **26 h** | open ✓ (1 h margin) |
| D is fall-back (25 h day) | 25 + 3 = **28 h** | open ✓ |
| **D+1 is spring-forward** (the 02:00-does-not-exist case) | 24 + 2 = **26 h** | open ✓ |

Minimum margin across every combination is **1 h**, so 03:00 is safe on every fixture date in any
zone with a ≤1 h shift. The same table for T6a with `ANCHOR_AT` = Sunday 00:00 and the sample at
Monday 03:00 gives the same minimum. The rejection halves (09:00 on D; 12:00 Sunday) are 9–13 h,
nowhere near the gate. **Both criteria are two-sided and neither can go red on correct code.**

On the coordinator's sub-question about 02:00 not existing: with the sample at 02:00 and **D+1** the
spring-forward day, `new Date(y, m, d+1, 2, 0)` resolves forward to 03:00 local (26 h) — so that was
never the failing case. The failing case was **D** being spring-forward, where 02:00 on D+1 exists
and is exactly `+25 h`. The plan states it correctly at T5a (`:1398`). N1 is properly closed.

The fixture-date caveat is **in the criteria rows**, not in prose (T5a `:1398`, T6a `:1399`), which
is where the coordinator asked it to be. With the 03:00 sample it is now belt-and-braces rather than
load-bearing — harmless, and I would leave it.

*(Recorded, not a finding: the move loosens the bracket T5b+T5a put on `ALL_DAY_GRACE_MS` from
(24.5, 26] h to (24.5, 27] h, so a build with a 26.5 h constant passes everything. Conservative
direction — a too-late gate — and no claim in the plan asserts an upper bound.)*

### b. **REQUIRED (does not block) — T22 inherits the boundary hazard from §6.2, and it is the one criterion that did not get the caveat.**

R3.2's fix landed: `:1288` now reads *"archivable from **~01:00** (`ANCHOR_AT + 25 h`), not from
local midnight"* and `:1289` gives the Fri→Sun row "Monday ~01:00". The false statement is gone.

But **T22 (`:1428-1434`) is still specified as *"covering every row of §6.2's edge-case table, with
`now` injected"*** and carries no instruction to sample away from the gate. At exactly
`ANCHOR_AT + 25 h` the predicate is **false** — the gate is strict — so a Coder enumerating the
table and writing `expect(isArchivable(allDayYesterday, oneAmLocal)).toBe(true)` gets a test that is
**red on correct code**. The `~` is doing all the work, and T5a, T6a and T25 each now carry an
explicit sampling caveat precisely because the `~` was not enough three times running.

The second-order risk is the one R3.2 named and it is unchanged: a Coder who trusts the edge table
over T5b "fixes" `ALL_DAY_GRACE_MS` to 24 h, and that is the failure direction D1.2 chose 25 h to
avoid. One clause in T22: *"sample the all-day rows at least an hour clear of the gate (03:00 on the
following day, as T5a does); **T5b owns the boundary**."*

---

## R4.5 Front matter — **REQUIRED (does not block). Line 3 still says `Status: v2, in review`.**

`item-archive.md:3` reads **"**Status:** v2, in review (2026-09-20)"** on a document whose revision
history opens with v4. Two revisions stale, in the first five lines, in a plan whose entire risk
narrative is about stale text being quoted onward. A Coder or QA engineer who opens this to check
which version they are holding is told the wrong one. One word.

---

## R4.6 The scoped sweep claim — **verified independently. It holds, and the three-for-three run is broken.**

The coordinator asked me to verify rather than accept `:1638-1642`: *"outside the revision history
and §8's own correction records … `day-key` / `day key` survives in exactly two places, D1.2's
comparison of the rejected candidate B and R10's note … `from local midnight` survives once, in
§6.2's corrected row."*

I grepped case-insensitively for `[Dd]ay[- ][Kk]ey` and `dayKey` across the whole file. Occurrences
outside the excluded regions: `:355` and `:362` (both inside D1.2's three-candidate comparison —
`:362` is the table header "**B. Day-key** in `item.timezone` (v2)", which a case-sensitive grep for
`day-key` would have missed, and which sits inside the allowed region anyway) and `:1210` (R10).
That is **two passages**, exactly as claimed, and both name the mechanism as rejected. For
`from local midnight`: one hit, `:1288`, where it is the explicitly negated wrong answer. Every
other `local midnight` in the file (`:129`, `:335`, `:386`, `:1131`, `:1228-1229`) describes the
**storage convention**, which is still true and is not the deleted mechanism's answer.

**The claim is accurate as scoped.** Two notes for the record: the scoping device works — it is what
makes the claim checkable at all — and it is the first sweep declaration in this plan that survived
an independent grep. The remaining enumeration defect this round (R4.3a) is in a *different*
paragraph, one the sweep discipline was not applied to.

I also re-ran the 02:00→03:00 sweep the same way: no stale `02:00` survives as a live criterion
sample. The two remaining hits (`:397`, `:1727`) are D1.2's late-window range and v3's superseded
record, both correct.

---

## R4.7 NITs

- **N4.1 — M3's hour-window warning is one hour short on one day a year.** `:1522` says *"Do not run
  the 'yesterday' half between 00:00 and 01:00 local."* On the day **after** a spring-forward, day D
  is 23 h long, so `ANCHOR_AT + 25 h` lands at **02:00** local, and Archive is correctly absent at
  01:30. D1.2 `:397` states this itself — *"archivable from roughly 01:00–02:00 the following day"* —
  so the plan contradicts its own range by one hour, in the direction of a false bug report. NIT and
  not REQUIRED because the exposure is ~1 h on ~1 day a year, against T25's old 1 h **every** day
  (which was REQUIRED). Fix is a parenthesis: *"(02:00 on the day after a spring-forward — D1.2)"*.
  `:1527-1528`'s "set the clock forward past 01:00" wants the same parenthesis.
- **N4.2 — T29's `TZ` pin: right action, shaky stated reason, unstated blast radius, and not in the
  checklist.** (i) The justification *"Node caches the zone once `Date` has been used"* is
  questionable on modern Node, which re-reads the zone when `process.env.TZ` is assigned — and if it
  *were* true, vitest's own startup uses `Date` long before `test.env` is applied, so the same
  objection would defeat the chosen fix. The chosen fix is still the better one; the reason given is
  not why. `TZ=America/Los_Angeles` on the `test` npm script is the fallback worth naming.
  (ii) `test.env` on the web project applies to **every** web spec (`CalendarView.test.tsx`,
  `App.deeplink.test.tsx`, `ItemDetails.test.tsx` …), not just T29's — the direction is toward
  determinism and the owner's machine is already Pacific, so this is safe, but it is a repo-wide
  environment change introduced inside a test row. (iii) §7's checklist never says to edit
  `vitest.workspace.ts`; step 12 is just "Web tests. T23–T30."
- **N4.3 — N3's own argument is not applied one level down.** §5.7 `:1098` adds *"new **optional**
  `onArchive` / `onRestore` / `onDuplicate`"* to `ItemDetails`, whose existing sibling `onEdit` is
  **required** (`ItemDetails.tsx:26`), and `canArchive` is specified as `canWrite && archived_at ===
  null && isArchivable(...)` with **no handler term** — so an omitted handler renders a live-looking,
  dead Archive button. That is the same silent-divergence shape Decision 9 refused for
  `onArchiveChanged` ten lines earlier, and the same shape `memory/MEMORY.md`'s "assert the thing,
  not the derived property" is about. Only `ItemModal` renders `ItemDetails` in the app, so nothing
  reachable breaks; T25/T26 render it directly and would pass on the dead-button build. One word
  (drop the `?`) or one clause in `canArchive`.
- **N4.4 — T30 keeps the non-discriminating half.** "the month heading is unchanged" is true of both
  builds by Decision 8.5's own proof. Harmless and never red on correct code, so leave it if you
  like — but it is the assertion round 3 suggested dropping, and its presence is part of why the
  GUARD label reads ambiguously (R4.3b).

---

## R4.8 What I checked and found clean (so a fifth round does not re-litigate it)

- **Items 1–4, spot-sampled.** R3.1's withdrawal of Decision 9's harm is correctly derived and
  correctly limited — the three composing facts are all verified (`CalendarView.tsx:247`, `:84`,
  `recurrence.ts:37-39`), the withdrawal is flagged for anyone who quoted the old claim (`:26-28`),
  and M2c is now an observation with the reason stated (`:1511-1514`). R3.2/R3.3 landed in full:
  §6.2's rows carry `ANCHOR_AT + 25 h`, §8 `:1749` says "all-day `+25 h` branch", **T5b is in the
  mechanism list** and in the at-risk list (`:1756`), and v3's wrong declaration is left standing
  with its correction attached (`:1673-1678`) — which is the right call and I want it on the record
  as such.
- **T25's clock pin** (`:1442`): `vi.setSystemTime` plus "build every fixture relative to it" makes
  the all-day rows deterministic; the negative rows and the `tagName` assertion are intact; the row
  states why the pin is not hygiene. Two-sided and no longer red on correct code for an hour a day.
  In-repo precedent for fake timers with RTL exists (`NotificationSetup.test.tsx:157`).
- **M3's manual twin** carries the warning R3.4 asked for, with the right reasoning ("T25 can pin, a
  human cannot"). Only the hour is off (N4.1).
- **N3 (`onArchiveChanged` required)** — the argument is correct and the `triggerRef` precedent is
  refused for the right reason (degraded focus restore vs. persisted state desynchronised from the
  UI). Two hosts, `typecheck` enforces it.
- **Every §7.1 row re-read against §5.2's falsification question.** T1–T11, T13r–T16r, T16–T21,
  T23–T29 and E1 are each red on the build they name and green on a correct one, and every absence
  assertion carries a live-item control. T20 still discriminates SQL-side from render-side
  exclusion; T27's control is still decorative (round-2 NIT, not re-raised); T5b still brackets the
  constant from below. **T22 is the only row with a way to be written red on correct code** (R4.4b),
  and T30 is the only row whose label misdescribes it (R4.3b).
- **Decision 3, §5.5, §5.6, R9, §7.3, Appendix A** — unchanged from where I confirmed them in rounds
  2 and 3, and I re-read R9's blast-radius chain end to end this round because M1b turns on it.
  `getItems` has no try/catch, the route has none, `index.ts` has no `app.onError`: the outage R9
  describes is exactly what the code would do.

---

## R4.9 Judgement

The trajectory is unambiguous and I want to say so before the list: REJECT with blockers, then 14
items, then 7, now 5 — **none of which blocks a Coder, and every one of which is a clause or a
word.** Nothing in §§1–5 changed this round, the design has been settled since v3, and I found no
defect in the mechanism, the proofs, the schema, the deploy story or the implementation checklist. A
Coder can build this today and the criteria will gate the build honestly, with one exception (T22).

Two things earn particular credit. The 03:00 move is correct in every DST combination including the
one that looked most dangerous, and the author's own reasoning for *why* T6a is the sharper case
(Sunday-anchored fixtures collide with Sunday transitions) is a better argument than the one I
raised. And the scoped sweep declaration is the first in this document to survive an independent
grep — the scoping device is what made it checkable, which is exactly what the standing note claimed
it would do.

What keeps this off a clean `APPROVE` is small but real, and it clusters in the same place it has
clustered every round: **text that describes the artifact slightly wrong.**

1. A trigger condition that cannot fire (R4.1) — `App.tsx:62` is named as the thing whose removal
   makes Restore reachable from the calendar, when the thing that actually prevents it is the prop
   wiring at `App.tsx:232`. True fact, wrong referent, in a note written for a future maintainer.
   Partly my own round-3 wording, and corrected here.
2. A QA observation describing a screen that cannot occur (R4.2) — banner and empty-list placeholder
   render together, and the step tells a human they are alternatives. Third revision of this step.
3. A criterion that can be written red on correct code (R4.4b) — T22 is generated from a table that
   now names the gate boundary to the hour, and T22 is the one criterion that did not get the
   sampling caveat its three siblings got.
4. An enumeration invalidated by the same revision that wrote it (R4.3a), one paragraph from the
   note warning about that exact thing.
5. A stale version in the front matter (R4.5).

**None of these needs another architectural pass.** I do not need to see a v6 for the NITs, and a
fifth review round should be a spot-check of the five numbered items below — nothing else in this
document is in question.

---

## Required changes

1. **R4.1** — Correct Decision 9's second assumption in both places (`:852-854`, `:891-895`). The
   fact that makes a deep-linked archived item unreachable from `CalendarView`'s modal is
   `App.tsx:232` — `CalendarView` receives no `initialOpenItem`, and `ItemListView` (its only
   consumer, `:240`) is unmounted while the calendar shows. `App.tsx:62` is a redundant third layer,
   not the guarantee. Restate the trigger at `:898-900` as *"if `CalendarView` is ever wired to
   `initialOpenItem`"*; the conclusion is unchanged and stronger.
2. **R4.2** — M1b step 4: the placeholder "No items in this list yet." renders **alongside** the
   error banner, because the failed fetch never calls `onItemsChange` (`ItemListView.tsx:70-73`,
   `:148-155`). State the discriminator as the presence of the red banner, and "a placeholder with
   no banner" as the different bug.
3. **R4.3** — Fix the GUARD bookkeeping: update §8 `:1741` ("Five … T8, T10, and T11") to the actual
   §7.1 count and name **T30**; and scope T30's label so it does not contradict §7.1 `:1385` —
   GUARD as to the unobservable navigation choice, live criterion as to the refresh.
4. **R4.4b** — Add a sampling caveat to T22, which is specified as covering every §6.2 row and now
   inherits "archivable from ~01:00" from the corrected table. At exactly `ANCHOR_AT + 25 h` the
   predicate is **false** (strict `<`), so an enumerating Coder can write an assertion that is red on
   correct code — and the natural "fix" is to reduce the constant to 24 h, the direction D1.2 chose
   25 h to avoid. Sample the all-day rows at 03:00 on the following day, as T5a does; T5b owns the
   boundary.
5. **R4.5** — `item-archive.md:3` still reads `Status: v2, in review`. The document is v4.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v5)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-20 · **Round:** 5

> The verdicts above (`REJECT`, round 1; `APPROVE WITH CHANGES`, rounds 2–4) are preserved as
> written. The operative verdict for v5 is on the last line of this file.

---

## R5.0 What I sampled, and what I took on trust

All five required changes and all four NITs from round 4 landed, and I confirmed each one in the
text. Because this round is about accuracy, I spent the budget re-deriving the **code** the v5 edits
newly lean on, rather than re-reading the prose.

**Independently re-derived this round (opened the file, checked the line):**

- **`App.tsx:229-244`** — the three-way ternary is `admin` / `calendar` / else. `:232` is
  `<CalendarView lists={lists} user={user} />` **verbatim**, with no `initialOpenItem`; `:240` is
  `initialOpenItem={initialOpenItem}` on `ItemListView`. R4.1's fix at `:876-877`, `:908-921` and
  the parenthetical at `:922-925` are all exactly right. *(Pedantic, not a finding: `:917` calls
  them "two mutually exclusive branches of the same ternary" — it is a nested ternary with three
  branches and `ItemListView` is the final else. The conclusion is unaffected.)*
- **`ItemListView.tsx:66-74`** — `.catch((err) => setError(String(err)))` at `:72`, and
  `onItemsChange` is called **only** in `.then` at `:71`. R4.2's fix (banner and placeholder render
  together; the banner is the discriminator, `:1554-1559`) is correct as written.
- **`ItemDetails.tsx:16-28`** — the props interface. `onEdit: () => void` is required at `:26`, so
  N4.3's "required is also the local convention" is sound. **This is where I found R5.3.**
- **`ItemDetails.test.tsx`** — **sixteen** direct `<ItemDetails>` render sites (`:67`, `:83`, `:111`,
  `:138`, `:153`, `:164`, `:173`, `:181`, `:189`, `:197`, `:217`, `:222`, `:230`, `:236`, `:246`,
  `:258`), none behind a helper, none passing the three new handlers. `:51` is `completed_at: null`
  in `BASE_ITEM`, matching §5.7's fixture list.
- **`ItemModal.desktop.test.tsx:77`, `:97`** — two direct `<ItemModal>` renders, passing
  `state`/`lists`/`user`/`onClose`/`onEditRequested`/`onSaved` and nothing else.
- **`package.json:10` + `tsconfig.web.json:17`** — `typecheck` is
  `tsc --noEmit -p tsconfig.worker.json && … web … && … e2e`, and the web project includes
  `web/src/**/*`. **So `npm run typecheck` does cover web components *and their test files*, and
  N3/N4.3's "typecheck is in charge" argument holds.** Worth recording because `CLAUDE.md:8` still
  describes `typecheck` as "tsc --noEmit for worker code" — which is stale, and which would make
  the plan's argument look false to anyone who checked only there. The plan is right; `CLAUDE.md` is
  the out-of-date artifact, and that is outside this plan's scope.
- **The §7.1 GUARD population, counted by hand:** T8 `:1453`, T10 `:1455`, T11 `:1456`, T30 `:1507`.
  **Four.** `:1812`'s corrected count and its scoping to §7.1 (with Appendix A's T14 `:2014`
  explicitly set aside at `:1821`) are accurate.
- **The 25 h boundary arithmetic** behind the T22 caveat, re-derived rather than checked (R5.1).
- **A whole-file case-insensitive sweep** for `00:00` / `01:00` / `02:00` / `midnight` (R5.4).

**Taken on trust, not re-derived:** `SUITE_BASE` 312/35/6 (still declared as quoted; the Coder
re-measures); the §5.7 fixture-literal list (declared as a grep superseded by `typecheck`); the
`db.ts` / `recurrence.ts` / `send.ts` / `materialize.ts` / `CalendarView.tsx` citations confirmed in
rounds 1–4 and not re-opened; the three items §8 still declares unverified (the `no such column`
failure empirically, wrangler's applied-set under a moved migration file, `ALL_DAY_GRACE_MS` against
a real transition) — all three still correctly declared, and M1b is still the right place for the
first.

---

## R5.1 (coordinator's Q1) The T22 caveat does prevent the failure mode — confirmed, and T5b does own the boundary

**Placement: it is on the enumerating reader's path, not off it.** The caveat (`:1481-1493`) sits
*inside the T22 entry itself*, immediately after the sentence that creates the hazard ("covering
every row of §6.2's edge-case table", `:1478-1479`), and it is headed *"read before enumerating
§6.2"*. The only route to writing T22 is §7 step 4 (`:1397-1399`) → §7.1's T22 entry → §6.2. There
is no path that reaches §6.2 for this purpose without passing the caveat first. That is the right
placement; a note parked in §6.2 would have been weaker, because the Coder arrives at that table
already holding an intent.

**Arithmetic: two-sided and correct.** The gate is `ANCHOR_AT + ALL_DAY_GRACE_MS < now` (`:343`),
strict, so at exactly `+25 h` the predicate is `false` — the caveat's central claim (`:1483-1485`)
is right, and an assertion at `01:00` or at `+25 h` would indeed be red on correct code. Sampling at
03:00 on the following day gives `+27 h` normally and `+26 h` in the worst DST combination (round
4's table, re-confirmed), so every all-day *positive* row has ≥1 h of margin.

**T5b genuinely owns the boundary.** `:1450` samples at exactly `ANCHOR_AT + 24.5 h` and expects
refusal: a 24 h build returns `true` there and fails, a 25 h build returns `false` and passes. It is
the only row within an hour of the gate, and the caveat's instruction to keep every other all-day
row clear of it does not weaken it — T5b's own sample is fixed by the row, not inherited from §6.2.
(The bracket is still (24.5, 27] h, so a 26.5 h constant would pass everything; round 4 recorded
that as conservative and not a finding, and I am not re-raising it.)

One formatting NIT, below (N5.1) — the caveat's blockquote swallows the rest of the T22 entry.

---

## R5.2 (Q2) The split GUARD label resolves the contradiction — the checklist can act on it

The test I applied: can a reader answer the two questions the label exists to answer? **Yes, in both
places the label appears.**

- *"Must T30 pass?"* → yes. Both halves of the split require the criterion to exist and go green.
- *"Does T30 prove Decision 9's choice of a separate callback?"* → no, and `:1507` says so outright
  ("the navigation choice is **unobservable through the UI and has no criterion**"), with `:899-901`
  saying the same thing from the decision's side.

`:1812-1820`'s enumeration carries the same qualifier ("T30 — **partial label only**"), so the two
places that *name* T30 agree with each other and with the row. The category is actionable, not
empty.

The one residual is that §7.1's definition sentence (`:1435-1437`) is still blanket — *"Items
explicitly labelled **GUARD** have no reachable failure state and are kept for hygiene or
localisation, not as proof of anything"* — and T30 is explicitly labelled GUARD while having a
reachable failure state. A reader who takes the definition and then scans labels, without reading
the cell beside the one they are scanning, gets the wrong answer for exactly one row. Graded NIT
(N5.2) because every site that names T30 qualifies it; the only way to be misled is to read the
label without the sentence next to it.

Secondary observation, recorded rather than graded: now that N4.4 removed the heading assertion,
T30 has **no** navigation assertion at all, so "GUARD as to the navigation choice" is really "no
coverage of the navigation choice" — which the row then says in the next sentence. The label is
redundant with its own explanation rather than wrong.

---

## R5.3 (Q3) **REQUIRED (does not block a build)** — making the three handlers required has a compile blast radius the plan does not record, and two of the plan's own counts understate it

The decision is right and I am not asking for it to be reversed. `canArchive` (`:1129`) is
`canWrite && item.archived_at === null && isArchivable(item, Date.now())` with no handler term, so
under *optional* props an omitted `onArchive` renders a live-looking dead button; under required
props `tsc` refuses to compile it. **The dead button is genuinely closed.** What is missing is the
cost disclosure, and two sentences point the reader at a smaller number than the real one.

**(a) `ItemDetails`.** `:1142-1143` reads: *"Nothing reachable breaks today — `ItemModal` is the
only production renderer — but **T25 and T26 render `ItemDetails` directly**, so under optional
props both would pass on the dead-button build they exist to police."* The runtime claim is true.
But the enumeration of direct renderers names only the two *new* rows, when
**`ItemDetails.test.tsx` already contains sixteen direct render sites** (`:67` … `:258`, listed in
R5.0), none behind a helper. Every one of them fails `tsc --noEmit -p tsconfig.web.json` the moment
the `?` comes off, in a file this branch has no other reason to touch.

**(b) `ItemModal`.** Decision 9 `:894`: *"Making it required puts `npm run typecheck` in charge, and
there are **exactly two hosts** to satisfy."* Two is the right count of *production* hosts
(`CalendarView`, `ItemListView`). It is the wrong count for the purpose the sentence is cited
for — bounding the typecheck obligation — because `ItemModal.desktop.test.tsx:77` and `:97` render
`<ItemModal>` directly and are inside `tsconfig.web.json`'s include glob. **Four call sites, not
two.** This is failure class 1 in miniature: a true number measured over the production extent,
used to size an obligation that spans the typechecked tree.

**Why this is REQUIRED and not a NIT.** It cannot ship broken — `typecheck` is loud and it is in
the pre-PR gate. The harm is to the hand-off: §5.7's paragraph is literally headed *"Mechanical
fallout the Coder must not miss"* (`:1155`), it enumerates the `archived_at` fixture breakage in
detail, and it does not mention this one. A Coder who takes the plan at its word that the blast
radius is "two hosts" and "T25 and T26", then meets eighteen compile errors in two untouched test
files, has one obvious and wrong way out: put the `?` back. The plan spent two paragraphs
(`:1135-1146`) earning that `?`'s removal; one clause should protect it.

**Fold in:** a sentence in §5.7's mechanical-fallout paragraph — *"`ItemDetails.test.tsx` has 16
existing direct render sites and `ItemModal.desktop.test.tsx` 2; all of them will fail `typecheck`
and must gain the new handlers. That breakage is the intended cost of N4.3/N3 — do not resolve it
by restoring optionality"* — and a correction of `:894` from "two hosts" to the call-site count.

**Folded NIT, because v5's change is what made it consequential (N5.3):** the plan does not say
*which component performs the archive/restore API call*. `:1130`'s "thread
`onArchive`/`onRestore`/`onDuplicate`" reads as pass-through from the host, while Decision 9's table
(`:903-906`) — where the host's `onArchiveChanged` only closes and refreshes — implies `ItemModal`
performs the mutation itself and merely notifies. Under optional props the ambiguity was harmless.
Now it decides whether each host gains one required prop or four, and therefore how many call sites
break. The `onEditRequested` precedent (`ItemModal.desktop.test.tsx:82`) is the obvious shape for
`onDuplicate`, since the create state lives in `useItemModal` on the host; one clause naming the
split would close it.

---

## R5.4 (Q4) No third instance of the flat window — I swept the whole file and can say where the remaining "~01:00"s live

Both sites the author names are fixed: T25 `:1501` ("…or before **02:00** on the day after a
spring-forward, since day D is then only 23 h long") and M3 `:1586`/`:1591-1593`/`:1597`. I checked
the arithmetic in both rather than the wording: for a "yesterday, all-day" fixture, `ANCHOR_AT` is
local midnight of D, so when **D** is the spring-forward day (23 h) the gate opens at 02:00 on D+1
— which is what both now say, and the "day after a spring-forward" phrasing correctly identifies
the day on which the human is standing. Consistent with T5a `:1448`'s own derivation.

**Case-insensitive sweep of the whole file for `00:00` / `01:00` / `02:00` / `midnight`.** No third
*instruction-grade* instance exists. The remaining hits split cleanly:

- **Descriptive, with a tilde, and not the source of any criterion:** D1.1's table `:363-364`
  ("Thu ~01:00", "Mon ~01:00") and R11 `:1279` ("~01:00"). These sit one hour below D1.2's own
  stated range (`:419`, "roughly 01:00–02:00"), but the `~` carries it, nothing samples from them,
  and R11's point is the direction of the error rather than its hour.
- **Correct as written:** D1.2 `:419-420`, §6.2 `:1332-1333` (the row T22 *is* generated from — and
  it is the one that now carries the sampling caveat), M3's tail `:1597` ("note ~01:00–02:00, not
  midnight").
- **Storage-convention statements, which are a different referent and still true:** `:151-154`,
  `:357`, `:408`, `:1175`, `:1272-1273`.
- **Historical records:** `:1692`, `:1700-1701`, `:1744-1745`, `:1781`, `:1798`.

The one I would have graded had it fed a criterion is D1.1's table; it does not, and §6.2 — which
does — is correct and caveated. **Nothing to fix here.**

---

## R5.5 (Q5) The sweep's *results* hold — but **REQUIRED (does not block):** v5 declared no sweep, and §8 has no v5 record at all

**The two items the author reports catching are both genuinely fixed.** `:3` now reads
`Status: v5, in review` (R4.5 closed), and §8's M3 sentence at `:1778-1780` carries the
`*(v5: widened to 02:00 on the day after a spring-forward — N4.1…)*` parenthetical. I verified both
directly, and R5.4 is my independent re-run of the sweep those two came out of. **This is the second
scoped claim in a row that survived an independent check**, and I want that on the record as
plainly as round 4 put the first one.

What I cannot verify is the claim itself, because **it is not written down.** §8 carries
"Corrections sweep for v4", "for v3" and "for v2", each declaring range and terms before results —
and there is **no** v5 paragraph. Nor is there an "Additional files opened for v5" note, though v2
and v3 both have one (`:1660`, `:1670`). Nor a v5 criteria sweep, though v3 and v4 have one
(`:1767`, `:1791`). The entire v5 record is two inline parentheticals (`:1778`, `:1812`).

That matters in three concrete ways:

1. **§8's "Re-read before citing" list claims every `file:line` below it was opened this session
   (`:1639`), and the three citations v5 newly leans on are absent from it**: `App.tsx:229-244`
   (the list has `App.tsx:26, 127-131, 168, 254-274` at `:1651`, not `:232`/`:240`) — which is now
   the *entire* guarantee behind Decision 9's second assumption; `ItemDetails.tsx:16-28` (the list
   has `:30-68` at `:1653`) — the props interface N4.3's argument rests on; and
   `vitest.workspace.ts:30-49`, which appears nowhere in the re-read list at all despite T29 and
   the new step 12a both targeting it. **I opened all three and all three are correct** — so this
   is a gap in the record, not in the work. But a reviewer allocating effort from §8 would have
   been aimed away from the load-bearing new material.
2. The plan's own standing note (`:1879-1908`) argues that a sweep declaration is the *checkable
   artifact*, and rule 2 is "enumerate, **and scope** the enumeration". v5 ran the sweep and
   skipped the artifact, in the revision whose main job was fixing an enumeration defect (R4.3a).
3. A v6, if one ever happens, inherits no statement of what v5 swept.

**Fold in:** one §8 paragraph — range, terms (case-insensitive, per round 4's precedent), the two
survivors it caught — plus the three citations above added to the re-read list. Cheap, and it is
the same discipline the document already applies to itself three times.

---

## R5.6 (Q6) Drift between the settled design and §§6–8 — one item, and it is the one above

I re-read §§6–8 against §§1–5 looking for statements that the four rounds of §§1–5 work have left
behind. **The only substantive one is R5.5.** Specifically checked and found consistent:

- **§6.2's edge table** against Decision 1 and D1.2: every all-day row uses `ANCHOR_AT + 25 h`; the
  `completed_at`-free live rule is stated in three rows (`:1335-1337`) and none of them leaks
  Appendix A's `SWEEP_ANCHOR`; the deep-link row (`:1341`) still matches §5.4's deliberate
  non-filtering of `getItemForUser`.
- **§6.1 R10/R11** against D1.2: R10 `:1254-1257` correctly says the gate reads no zone and confines
  the residual to `buildDuplicateDraft` and display; R11 `:1278-1279` keeps the "conservative, not
  dangerous" direction. Neither has drifted back to day-key semantics.
- **§7's checklist** against §5: step 2's "no imports at all" matches §5.2; step 5's "exactly one
  new call site passes a non-default scope" matches §3.2's design invariant; step 7's three status
  ladders match §5.5; step 11 names the `key` change and the `onArchiveChanged` separation.
- **M2c `:1575-1578`** against Decision 8.5 and T30: all three now treat the navigation as an
  observation rather than a check, consistently.
- **§7.3 and R9** against §5.1/§5.4: unchanged from where rounds 2–4 confirmed them.
- **Appendix A** against §0 and §5.3: `SWEEP_ANCHOR` is still walled off from the live rule
  (`:1937-1939`), A.2's all-day note (`:1962-1964`) uses the `+90000000` arithmetic form rather
  than reintroducing a zone-aware SQL expression.

---

## R5.7 NITs (none blocks; each changes no decision)

- **N5.1 — the T22 caveat's blockquote swallows the rest of the T22 entry.** The `>` prefix stops at
  `:1488`, mid-sentence ("**Promoted from v1's"), and `:1489-1493` continue without it. Under
  CommonMark lazy continuation those lines stay inside the blockquote, so the promotion rationale
  *and* T22's falsification statement render inside a ⚠ warning about sampling. Content is intact;
  the rendering merges a caveat with the criterion it qualifies. Blank line before "Promoted", or
  `>` on the remaining lines.
- **N5.2 — §7.1's GUARD definition (`:1435-1437`) is still blanket** and is now contradicted by the
  one row carrying a split label. Every site that *names* T30 qualifies it, so this is only
  reachable by reading the definition and the bare label. One clause: "…except where a row states a
  split label."
- **N5.3 — ownership of the archive/restore call is unspecified.** Folded into R5.3 above.
- **N5.4 — step 12a is placed after the step that depends on it.** `:1421-1426` pins `TZ`; step 12
  (`:1420`) writes T23–T30 including T29, and the checklist says to run `npm test` after each
  numbered step. On the owner's Pacific machine T29 passes either way, so this is cosmetic — but
  the natural order is 12a before 12. (Also `12a.` is not a valid ordered-list marker and will
  render as a paragraph; the plan may not care.)
- **N5.5 — v4's revision-history bullet still names the withdrawn mechanism unmarked.** `:63-64`
  reads *"…the grid never shows an archived item, **and** `App.tsx:55-63` forces deep links to the
  list view"*, which is exactly what R4.1 withdrew. The v5 entry immediately above (`:22-27`)
  corrects it, and the plan's own sweep scoping explicitly excludes the revision history as a
  region where superseded statements may stand — so **the author may reasonably decline this.** I
  raise it only because everywhere *else* the plan attaches the correction to the wrong claim
  rather than relying on proximity (`:922-925`, `:1742-1747`, R10's attribution note), and this is
  the one place it does not.

---

## R5.8 Checked and found clean (so a sixth round does not re-litigate it)

- **All five round-4 required changes landed, in every place they were owed.** R4.1 in both
  locations plus the parenthetical recording the wrong mechanism (`:876-877`, `:908-931`); R4.2's
  discriminator restated as the banner's presence with "placeholder, no banner" named as the
  different bug (`:1554-1559`); R4.3 in both the row and the count (`:1507`, `:1812-1822`); R4.4's
  caveat (`:1481-1493`); R4.5 (`:3`).
- **All four NITs landed**, including N4.1's sibling in T25 that I had not listed — and the added
  point that pinning removes the ambient clock but not the *choice* of `now` (`:1501`) is a better
  statement of the hazard than the one I wrote.
- **The T22 caveat's instruction is scoped correctly by context** for the *negative* all-day rows:
  read literally, "sample the all-day rows at 03:00 on the following day" would be wrong for
  §6.2's "on the day itself → not archivable" row, but the two preceding sentences are about the
  *archivable-from* rows and "as T5a and T6a do" points at a model that samples its refusal half at
  09:00 on the day itself. Not a finding.
- **`canArchive` no longer permits a dead button** — required props make an omitted handler a
  compile error, so no handler term is needed in the gate (R5.3).
- **N4.2's three parts** are all in: the self-defeating `TZ` rationale is replaced with an
  ordering-and-uniformity argument that does not undercut its own fix, the repo-wide blast radius
  is stated in the row, and step 12a exists (`:1421-1426`).
- **T5a/T6a/T5b/T25/T29/T30 re-read against §5.2's falsification question** — each still goes red on
  the build it names and green on a correct one. **No row in §7.1 can now be written red on correct
  code**, which is the first round that has been true; T22 was the last one and the caveat closes
  it.
- **§0's referent table, Decision 1/D1.2, Decision 3, Decisions 4–8, §5.1–5.6, R9, §7.3 and
  Appendix A** — unchanged from where rounds 2–4 confirmed them, and I found nothing in v5 that
  disturbed any of them.

---

## R5.9 Judgement

REJECT, then 14, 7, 5, now **2 — neither of which blocks a build, and neither of which is
architectural.** The design has been settled since v3 and nothing in v5 touched it. Both findings
this round are in text about the artifact, which is where this plan's findings have clustered every
round, and both are a clause or a paragraph.

I want to be explicit about what I could and could not check, because it is the same distinction
that produced this round's two findings. **What v5 documented, I sampled and it held**: the status
line, the M3 window in §8, the GUARD count (I counted the labels myself: four), the T22 caveat's
arithmetic, and the sweep's two catches. **What v5 did not document, I reviewed in full** — the
code behind the three citations the revision newly leans on — and that is where both findings came
from. The `App.tsx:232`/`:240` reading is correct to the character, the `ItemDetails.tsx:26`
argument is correct, `typecheck` really does cover web test files; but nothing in §8 says any of
that was checked, and the consequence of the props change for sixteen existing render sites was
neither measured nor stated.

Neither finding needs an architectural pass, a re-derivation, or another review round. Fold in the
two changes below and the NITs you agree with; **I do not need to see a v6.** If the Coder starts
from v5 as it stands today, the worst outcome is eighteen compile errors and a tempting wrong fix —
which is precisely why the first change is worth the clause it costs.

---

## Required changes

1. **R5.3** — Record the compile blast radius of N4.3/N3, and correct the two counts that understate
   it. §5.7's "Mechanical fallout the Coder must not miss" paragraph (`:1155-1161`) must say that
   `ItemDetails.test.tsx`'s **sixteen** existing direct render sites (`:67`–`:258`) and
   `ItemModal.desktop.test.tsx`'s **two** (`:77`, `:97`) all fail `typecheck` once the `?` comes
   off, that this is the intended cost, and that it must **not** be resolved by restoring
   optionality. Correct Decision 9 `:894`'s "exactly two hosts to satisfy" — two is the production
   host count, not the typecheck obligation, and `tsconfig.web.json:17` includes the test files.
   While there, name which component owns the archive/restore API call and the duplicate state
   transition (N5.3): `:1130`'s "thread" and Decision 9's `onArchiveChanged` table imply different
   answers, and the answer decides how many props each host gains.
2. **R5.5** — Give §8 a v5 record. One paragraph declaring the sweep's range and terms
   (case-insensitive) before its two results, in the form v2/v3/v4 already use; and add the three
   citations this revision newly leans on to the "Re-read before citing" list, which currently
   claims every `file:line` beneath it was opened this session: `App.tsx:229-244` (`:232`/`:240` —
   now the whole of Decision 9's second assumption), `ItemDetails.tsx:16-28` (the props interface
   N4.3 rests on), and `vitest.workspace.ts:30-49` (T29 and step 12a's target). I verified all
   three and they are correct; it is the record that is missing, and §8 is what aims the next
   reader.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v6)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-20 · **Round:** 6 — verification only

> The verdicts above (`REJECT`, round 1; `APPROVE WITH CHANGES`, rounds 2–5) are preserved as
> written. The operative verdict for v6 is on the last line of this file.

This is not a review round. I checked only that round 5's two REQUIRED items landed, plus the five
NITs, and I re-read nothing else. **Both landed, in full, and accurately.**

## R6.1 R5.3 — landed, and the split-by-cause form is better than what I asked for

- **§5.7 `:1193-1208`** — "Mechanical fallout 1", with `tsconfig.web.json:17` stated as *why* test
  files are inside `typecheck`, and a two-row table: `ItemDetails`' handlers → **16** sites,
  `ItemDetails.test.tsx:67`–`:258`, "no shared helper, none currently passes any of the three";
  `ItemModal`'s `onArchiveChanged` → **2**, `ItemModal.desktop.test.tsx:77`, `:97`. Both counts and
  both locations match what I derived independently in round 5.
  **The split by cause is a real improvement on my wording**, which lumped 18 together: the two
  groups come from two different decisions and are fixed in two different files, and a Coder who
  cleared one would have read the group as closed.
- **`:1202-1208`** — restoring optionality named as the forbidden fix, with the reason stated
  (one character, 18 errors → 0, silently undoing N4.3 and N3 and leaving T25/T26 green on the
  broken build) and the right framing: *"the compile errors are the enforcement mechanism working."*
  The `renderDetails()` helper is offered as the Coder's judgement, not a requirement — correct.
- **Decision 9 `:914-915`** — now distinguishes the production host count (`ItemListView`,
  `CalendarView`) from the typecheck obligation, and names the two test sites. The wrong-extent
  count is gone.
- **Checklist `:1482-1483`** — step 13 tells the Coder to expect the 18 errors "if step 11 did not
  already fix them — they are the intended cost, not a regression". Belt-and-braces at the point of
  use; I did not ask for it and it is the place a Coder actually meets the problem.
- **N5.3 `:1161-1171`** — ownership table. `ItemModal` owns the `setItemArchived` call and the
  duplicate modal transition, `ItemDetails`' three handlers are `() => void` intent-raisers
  (justified from `ItemDetails.tsx:1-5`'s existing BARE-component note), `ItemEditor` keeps the
  duplicate `POST` per Decision 7, and `onArchiveChanged` fires **only on success**. The ambiguity
  between `:1130`'s "thread" and Decision 9's table is resolved in favour of the reading Decision
  9's table implied, and the prop counts now follow from it explicitly ("each host gains exactly one
  new prop; `ItemDetails` gains three").

## R6.2 R5.5 — landed, and the author drew the sharper conclusion

**`:1760-1770`** carries a v5 corrections sweep in the v2/v3/v4 form: range (entire file, no
exclusion), a term list derived from v5's own diff, the instruction to run it case-insensitively
*with the reason* (v4's case-sensitive pass would have missed `B. Day-key`), then results — the two
stale sites, plus T25's copy of the flat window recorded as a sibling the relay had not listed, and
the scoped `day-key` claim re-verified.

**`:1719-1730`** adds "Additional files opened for v5" with all three citations I named
(`App.tsx:229-244`, `ItemDetails.tsx:16-28`, `vitest.workspace.ts:30-49`), each with what it
establishes, plus the R5.3 counts recorded as verified directly.

The `⚠` note at `:1772-1778` goes further than I asked, and it is the right lesson: the sweep was
run but not written down, and *that* omission is what produced both round-5 findings — nothing
forced the question "what else does this touch?". **"The sweeps that were declared held; the one
that was not declared is the one that left a gap"** is an accurate summary of five rounds of
evidence.

## R6.3 The five NITs

All taken. N5.1 — `:1539-1552`, the blockquote closes and T22's promotion rationale and
falsification statement sit outside it. N5.2 — `:1492-1495`, the GUARD definition now opens "Except
where a row states a **split label** (T30 is the only one)". N5.4 — the `TZ` pin is now step **12**,
before step 13's web tests, with "Do this BEFORE step 13" stated inline, and the tail renumbered to
15 with no gap. N5.5 — `:80-83`, v4's withdrawn claim is struck through *in place* with the
correction attached in brackets, which is the convention the rest of the document uses; I had
offered the author an out on this one and they were right not to take it.

## R6.4 Two observations, neither a required change

- **`:1726` still says "step 12a"** inside §8's v5 record, after N5.4 renumbered it to step 12. A
  single stale token in a historical record paragraph, pointing at a step that exists under a
  neighbouring number. Not worth a round; fix it if the file is opened again.
- **On the status line at `:3`.** *"v6 — **APPROVED, ready for the Coder**"* was written **before
  the verdict it asserts existed.** An author cannot approve their own plan, and in a document whose
  entire review history has been about claims asserted ahead of verification, asserting the
  reviewer's conclusion is that same failure one level up. I am not requiring a change, because as
  of the last line of this file the sentence is **true** — but it is true because of the line below,
  not because of itself. If there is ever a v7, the status line should say "in review" until a
  verdict exists.

## R6.5 Verdict

Both REQUIRED items landed completely and accurately, all five NITs landed, and each fix is either
what I asked for or better. Nothing in v6 touches a decision, a proof, a criterion's meaning or the
deploy story. The trajectory closed properly: REJECT → 14 → 7 → 5 → 2 → 0.

The plan is ready for the Coder. The one thing I would say to whoever picks it up: the eighteen
compile errors in §5.7's table are not a defect in the plan and not a regression — they are the
mechanism two decisions were made to buy, and the plan tells you at three separate points not to
make them go away with a `?`.

APPROVE

---
---

# Review — `docs/plans/item-archive.md` (v7, §9 amendment)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-21 · **Round:** 7

> The verdicts above (`REJECT`, round 1; `APPROVE WITH CHANGES`, rounds 2–5; `APPROVE`, round 6 on
> v6 §§1–8) are preserved as written. **Round 6's `APPROVE` still stands for §§1–8, which v7 does
> not touch.** The operative verdict for the §9 amendment is on the last line of this file.

Scope of this round: **§9 only** (`:2134-2199`), read against the built branch. I checked §§1–8 for
invalidation (Q4) but did not re-review them. The branch is checked out, so unlike every previous
round I could read the *implementation*, and that is where all three findings came from.

---

## R7.0 What I verified in code

- **`ItemListView.tsx:67`** (`useState<"active"|"archived">("active")`), **`:73`** and **`:103`**
  (both fetches take `{ archived: scope === "archived" }`), **`:109`**
  (`confirm(\`Delete "${item.title}"?\`)`), **`ListSidebar.tsx:48`**. Every citation in §9.1/§9.2 is
  accurate, and the mechanism claim — "because the fetch is keyed on scope, the new item appears
  without any extra refresh call" — is correct: `:77`'s dep array is `[listId, scope]`.
- **`ItemModal.tsx:12`, `:181-188`** — `handleSetArchived` is where `await setItemArchived(...)`
  lives, with `onArchiveChanged()` fired only on success; **`ItemDetails.tsx:29-35`, `:177`,
  `:182`** — the three handlers are required and raise intent only. The v6 ownership table is
  implemented exactly as written. **This is what R7.1 turns on.**
- **`ItemListView.tsx:219-230`** — `onDuplicateRequested` → `openDuplicate`; `onSaved` → close +
  `refresh()`; `onArchiveChanged` → close + `refresh()`. Create, edit-save **and duplicate-save all
  share `onSaved`**. This is what R7.3 turns on.
- **`e2e/archive.spec.ts:73`, `:101`, `:117`** (three Archive/Restore clicks) and `:137-148`
  (beat 8). **`ItemListView.test.tsx:315-353`** (T24(d), Restore click at `:339`, call assertion at
  `:342`). **`CalendarView.test.tsx:1093-1112`** (T30, Archive click at `:1106`).
  **`ItemDetails.test.tsx:382-394`** (T26b, renders `ItemDetails` alone at `:387`).
- **Repo-wide greps:** `confirm` appears in `web/src` at exactly **two** sites, both production
  (`ItemListView.tsx:109`, `ListSidebar.tsx:48`) — **no test stubs it**. `e2e/` contains **no**
  `page.on("dialog")` handler and **no** Delete click. Both facts matter for R7.2.
- **§9.3's premise — confirmed.** `routes/items.ts:303-444` carries exactly four attachment routes
  (list `:310`, upload `:324`, download `:407`, delete `:444`). There is no R2 copy path, so
  "requires a new authorized server endpoint" is true, and splitting it out is the right call:
  duplicate's zero-server-surface property is load-bearing for Decision 7 and for what QA actually
  certified. **No finding on §9.3** — it is the best-supported paragraph in the amendment.

---

## R7.1 (Q2) **REQUIRED (does not block a build)** — §9.2 never says which component gets the `confirm`, and the component §9 names cannot make T33/T34 fail

This is the sharp one, and it is the failure class the brief puts first: a criterion whose stated
failure condition is unreachable.

**§9's preamble (`:2137`) says the amendment is "confined to `ItemListView` and `ItemDetails`."
Neither of those components calls `setItemArchived`.** `ItemModal.tsx:181-188` does — which is what
v6's own ownership table (§5.7, N5.3, added at round 5's request) specifies, and what the branch
implements. §9.2 does not mention that table and does not name a host for the guard.

Now apply T33's assertion (`:2182`): *"assert `setItemArchived` was **not called**"*. Follow §9's
scope sentence, put the `confirm` in `ItemDetails`, and write the test where its siblings live —
`ItemDetails.test.tsx`, which renders `ItemDetails` **alone** (`:387`, T26b's pattern). In that
render, `setItemArchived` is **never called on any build**, because `ItemDetails` does not call it.
The assertion is vacuously true. **T33 and T34 would then pass on a build with no confirm at all** —
precisely the build they exist to police, and precisely the defect §9.2 introduces them to prevent.

The falsification note (`:2182`) is right about the wrong thing: it correctly refuses "the item is
still listed" as the primary claim, then specifies a claim that cannot go red in the most natural
place to write it.

**Placement also decides whether an existing criterion breaks.** In `ItemModal`: `ItemDetails.test.tsx:382`
(T26b — "clicking Restore calls `onRestore` … intent only") is untouched. In `ItemDetails`: T26b
takes the cancel path and fails, and `ItemDetails` acquires a blocking native dialog inside a
component whose own header (`ItemDetails.tsx:1-5`) declares it bare and presentational.

**Fix (three clauses):** name `ItemModal.handleSetArchived` as the guard's home, immediately before
`await setItemArchived`; correct `:2137`'s scope sentence to include `ItemModal`; and state that
T33/T34 must render `ItemModal` or a host so the `apiClient` spy is reachable — adding, in the
falsification column, that rendering `ItemDetails` alone makes the assertion vacuous.

---

## R7.2 (Q3) **REQUIRED (does not block)** — the `confirm()` choice is right, but its blast radius over already-green tests is unrecorded and the QA note's reassurance is false in both harnesses

**On the choice itself: keep `confirm()`.** One dismissal idiom beats two, the precedent is real
(`ItemListView.tsx:109`, `ListSidebar.tsx:48`), and a non-blocking affordance (toast + undo) is a
bigger build than the nit deserves — it needs a toast primitive this app does not have, plus an
undo window, plus a decision about what happens if the undo is missed. I would not spend that here.
The plan's own retreat — *remove Restore's, keep Archive's* (`:2172-2173`) — is the right one and is
already recorded. **No change demanded on the decision.**

What is wrong is the surrounding text.

**(a) `:2187-2188` is false in both harnesses.** It says *"the existing Delete flow has the same
property, so the harness already has to cope with it."* It does not:

- **jsdom:** `confirm` appears in `web/src` at exactly two sites, both production code. **No spec
  stubs it**, because no spec clicks Delete. jsdom's `window.confirm` is a not-implemented stub
  returning `undefined` — falsy — so `if (!confirm(...)) return;` cancels every time.
- **e2e:** there is **no `page.on("dialog")` handler anywhere in `e2e/`** and no spec clicks Delete.
  E1 will be the first spec in this repo to meet a native dialog.

**(b) The stated Playwright failure mode is the wrong one, in the misdiagnosis direction.** With no
`dialog` listener registered, Playwright's documented default is to **dismiss** the dialog, not to
block. So the run does not hang — `confirm()` returns false, Archive silently does nothing, and E1
fails at beat 3 with *"the item is still in the Active list"*. A QA engineer told to expect a
blocked session will read that as a product regression in the feature they just passed. Given this
repo's record — `CLAUDE.md:30-32`'s false "bug still present" result — a note that aims QA at the
wrong symptom is worth correcting even though it is two sentences.

**(c) Three already-green sites change behaviour and none is named.** §5.7 now carries exactly the
right instrument for this (the "Mechanical fallout 1/2" tables), added at round 5's request; §9 does
not use it:

| Site | What breaks without a stub/handler |
|---|---|
| `ItemListView.test.tsx:315-353` (T24(d)) | Clicks Restore `:339`; asserts `setItemArchived` called `:342`. Cancel path → assertion fails |
| `CalendarView.test.tsx:1093-1112` (T30) | Clicks Archive `:1106`. Cancel path → chip never disappears → the *live* half of T30 fails |
| `e2e/archive.spec.ts:73`, `:101`, `:117` (E1) | Three Archive/Restore clicks, auto-dismissed → beat 3 fails |
| `ItemDetails.test.tsx:382` (T26b) | Only if the guard lands in `ItemDetails` — see R7.1 |

T30 is the one I care about: it is the live criterion for the grid refresh, and a Coder who meets it
red after a confirm-only change has an inviting wrong diagnosis available.

---

## R7.3 (Q1) **REQUIRED (does not block)** — T32 discriminates, but A9.1's enumeration is wrong at both ends: three of its four writes are unreachable, and the one reachable write it omits is the one that matters

**T32 works, and it picks the right write.** A build with `setScope("active")` in `refresh()` or
copied into `onArchiveChanged` switches on Restore, passes T31, and goes red on T32. Two-sided,
reachable, correctly aimed. **No change to the criterion.**

**But A9.1's prose (`:2153-2154`) justifies it with a case that cannot happen.** *"Switching on
Archive in particular would yank the user out of the view they were working in."* Archive is offered
only when `item.archived_at === null` (§5.7's `canArchive`), and the Archived scope contains only
archived rows — so **Archive is unreachable from the Archived scope.** It can only fire from Active,
where `setScope("active")` is a no-op, or from `CalendarView`, which has no scope at all. The same
holds for **Edit** and **Delete**: archived rows render View-only (§5.7; `ItemListView.test.tsx:329`
comments on exactly this). **Three of A9.1's four named writes cannot be observed to switch
anything.** This is the same shape as Decision 9's harm that rounds 3–4 withdrew — a true-sounding
protection against an unreachable state — recurring in the one section §§1–8's discipline did not
cover.

**And the list omits Duplicate-save, which is reachable from the Archived scope and is
create-shaped.** Duplicate is offered on archived items and QA exercised exactly this path (report
§4). It routes `openDuplicate` → create editor → **`onSaved`** (`ItemListView.tsx:219-223`) — the
*same* arm as "+ New Item". So:

- Implement the switch in `onSaved` (the obvious place): duplicate-save **switches**, silently.
- Implement it in the "+ New Item" handler: duplicate-save **does not**.
- **T31 only covers "+ New Item", so nothing distinguishes the two**, and QA's observed behaviour
  ("the Archived view still shows the original; the Active view shows the new item") changes under
  one and not the other.

I think switching is correct here — it is §9.1's own argument ("delivers what was asked and shows
the result"), and the duplicate *is* a new live item. But the plan has to say so, because A9.1 reads
as an exhaustive list of writes and this is the only one of them that can actually be observed from
the scope in question. **Fix:** cut or demote Archive/Edit/Delete to "unreachable from this scope,
listed for completeness", keep Restore as the live case T32 pins, and add one row — duplicate-save
from the Archived scope switches to Active, with the source still under Archived.

*(Checked and clean: E1's beat 8 survives the switch. `e2e/archive.spec.ts:144` clicks the Active
toggle before asserting, so an auto-switch makes that a no-op re-click rather than a conflict.)*

---

## R7.4 Q4 — what §9 invalidates in §§1–8, and what it does not

**Invalidated, all covered above:** §5.7's ownership table (R7.1); T24(d), T30, E1 and conditionally
T26b (R7.2). Nothing else. Specifically re-checked and **not** disturbed: §3.2's default-scope
invariant; Decision 4's SQL-side exclusion and T20/T27; Decision 7 and T23 (§9.3 protects them);
Decision 8's proofs; §5.5's status ladder; §6.2's deep-link row; R9/§7.3's deploy story; Decision
6/M5's 390 px action row (no new buttons).

**NITs:**

- **N7.1 — §7's checklist has no step for §9.** It ends at 15. This is an amendment to a built
  branch, so the Coder returning to it gets criteria but no ordered steps; steps 12–13's "run the
  gates after each step" framing is where the R7.2 fallout would otherwise be met. One step would do.
- **N7.2 — §7.2's manual checks are stale for the confirm.** M2, M2b and M2c all describe
  Archive/Restore as a single click. The §9.2 QA note covers the concept; the steps themselves do
  not.
- **N7.3 — the cancel path leaves a Radix dialog mounted, and nothing checks focus.** Archive fires
  from inside a programmatically-opened Radix modal; a native `confirm()` takes and returns focus
  across it, and cancel is a **new** state in which the modal stays open. `memory/MEMORY.md`'s
  "Radix focus restore needs explicit handling" is the repo's own scar here. A9.2 says cancelling
  must be a true no-op — worth adding "and focus returns to the Archive button" to the manual check,
  since no automated criterion covers focus.

---

## R7.5 Judgement

§9.3 is the strongest part of the amendment and I want to say so: the author verified the absence of
an R2 copy path before accepting an owner request, found that it would add authorization surface
this branch's review and QA both rest on *not* existing, and split it out. That is the right instinct
and it is correctly reasoned — I confirmed the four attachment routes myself.

The three findings are all in §9's prose, none blocks a build, and none touches a decision I would
argue with. Two of them are the same defect this document has produced at every stage and fixed at
every stage — **an enumeration that is wrong at both ends (R7.3), and a blast radius over existing
tests that is not written down (R7.2)** — reappearing in the one section that was written after the
§§1–8 discipline had done its work. The third (R7.1) is the more serious in kind: a criterion that
cannot fail in the place the plan points it, which would let a confirm-less build ship green.

None of this needs a design pass. All three fixes are clauses in §9, plus one small table. I do not
need to see a v8; fold them in and go.

---

## Required changes

1. **R7.1** — Name `ItemModal.handleSetArchived` (`ItemModal.tsx:181-188`) as where the `confirm`
   goes, correct `:2137`'s "confined to `ItemListView` and `ItemDetails`" (neither calls
   `setItemArchived`), and state that T33/T34 must render `ItemModal` or a host — noting in their
   falsification column that rendering `ItemDetails` alone makes "`setItemArchived` was not called"
   **vacuously true on every build**, including one with no confirm.
2. **R7.2** — Record §9.2's blast radius in §5.7's "Mechanical fallout" form: `ItemListView.test.tsx:339/342`
   (T24(d)), `CalendarView.test.tsx:1106` (T30), `e2e/archive.spec.ts:73/101/117` (E1), plus T26b if
   the guard lands in `ItemDetails`. Correct `:2187-2188`: **no** jsdom spec stubs `confirm` and
   **no** e2e spec registers a dialog handler or clicks Delete, so the harness has *not* had to cope
   — and Playwright **auto-dismisses** an unhandled dialog rather than blocking, so the symptom is a
   silent cancel presenting as "the item is still listed", not a hang.
3. **R7.3** — Fix A9.1's enumeration. Archive, Edit and Delete are **unreachable** from the Archived
   scope (`canArchive` requires `archived_at === null`; archived rows are View-only), so
   "switching on Archive would yank the user out of the view" cannot occur — mark them as listed for
   completeness and keep Restore as the live case T32 pins. Add the omitted write:
   **duplicate-save**, which is reachable from the Archived scope and shares `onSaved`
   (`ItemListView.tsx:219-223`) with "+ New Item", so it switches under the natural implementation
   and is pinned by no criterion. State the intended behaviour and cover it in T31.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v8, §9 amendment)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-21 · **Round:** 8

> Verdicts above are preserved as written. **Round 6's `APPROVE` still stands for §§1–8**, which v8
> again does not touch. The operative verdict for the §9 amendment is on the last line of this file.

All three round-7 items landed. I verified each against the plan text and re-derived the two things
the coordinator asked me to check rather than accept. **One new REQUIRED, one clause, no further
round needed.**

---

## R8.1 (asked) T36's falsification statement is sound, and T31/T36 are not two spellings of one criterion

The named wrong build is **reachable in the code as built**, not hypothetical:
`ItemListView.tsx:150-151` is a real explicit handler — `onClick={() => itemModal.openCreate()}` —
into which `setScope("active")` can be inserted. Duplicate does not pass through it: it goes via
`onDuplicateRequested` (`:219`) → `openDuplicate`. So a `:150`-only build gives **T31 green, T36
red**, exactly as `:2182` claims.

And the two criteria are genuinely different: they enter by different doors and converge **only if
the switch is placed at the convergence point** (`onSaved`, `:220-223`). That is what makes T36 a
criterion rather than a restatement — it tests the *placement*, which is the actual decision.

One refinement, recorded and **not** a finding: the named wrong build inserts the switch at
**open** time, so it also switches when the user *cancels* the create editor — a second defect that
§9.1's "on a **successful** create" forbids and that no criterion pins. It does not matter, because
T36 already goes red on that build; a criterion only has to fail, not to explain why. If the switch
lands in `onSaved`, cancel leaves the scope alone for free.

## R8.2 (asked) §9.2.1's three sites are complete — here is the method, so the absence half is checkable

Absence is the hard half and this document's sweep claims have failed on first writing before, so I
ran it myself rather than confirming the author's list.

**Method.** (a) `web/src`, all files, for role-queries naming archive/restore: **7 hits**, of which
exactly **3 are clicks** — `CalendarView.test.tsx:1106`, `ItemListView.test.tsx:339`,
`ItemDetails.test.tsx:390`. The other four (`ItemDetails.test.tsx:299`, `:307`, `:356`, `:367`) are
presence/absence queries that never fire a handler. (b) `e2e/`, every `click(` and
`getByRole("button"` across all four spec files: the only Archive/Restore clicks are
`archive.spec.ts:73`, `:101`, `:117`. No other spec touches them.

**No fourth site.** Two categories I checked and excluded explicitly, so the next reader does not
have to redo it:

- **`ItemDetails.test.tsx:390` (T26b)** clicks Restore, but renders `ItemDetails` **alone** — and
  with the confirm in `ItemModal` (v8's correction), it is unaffected. It is a *conditional* fourth
  site that v8's placement decision closes. Worth knowing: **if anyone ever moves the confirm down
  into `ItemDetails`, T26b becomes the fourth site** — and the vacuity trap in the `:2140-2146`
  blockquote returns with it.
- **Worker/D1 and HTTP specs** (`archive-db.test.ts`, `items-archive-http.test.ts`) have no DOM, so
  `confirm` never executes. Unaffected.

§9.2.1's table is accurate and complete, and I agree with ending it on the consequence rather than
the count — T30 is the live grid-refresh criterion, and a confirm added without updating it removes
a guard while looking like a passing change.

## R8.3 **REQUIRED (does not block a build)** — there are **three** create entry points, not two, and the criteria cannot distinguish the placement the plan chose from a sprinkled one

§9.1's Mechanism paragraph (`:2157-2160`) specifies the **behaviour** — "on a successful create, set
`scope` to `active`" — but never the **placement**. The placement appears only inside T36's
justification (`:2175-2176`, *"the shared `onSaved` means the two behaviours cannot silently
diverge"*), and that sentence says **two** behaviours when there are **three** create entry points:

| # | Entry point | Route |
|---|---|---|
| 1 | "+ New Item" button in the list | `ItemListView.tsx:150-151` → `openCreate()` |
| 2 | **Mobile top-bar "+ New"** | `App.tsx:144-147` `requestCreate()` → token → `ItemListView.tsx:90-93` effect → `openCreate()` |
| 3 | Duplicate | `ItemListView.tsx:219` → `openDuplicate()` |

All three converge on `onSaved` (`:220-223`) and **only** there.

**The reachable wrong build the criteria miss:** a Coder who reads T31 and T36 as two behaviours and
patches handler-by-handler — `setScope` in the "+ New Item" `onClick` **and** in the duplicate
path — makes **T31, T32 and T36 all green** while entry point 2 still does not switch. That leaves
QA's original nit unfixed on the mobile top-bar create button, which on the owner's primary device
(an iPhone — `memory/MEMORY.md`) is plausibly the *main* create affordance. `App.tsx:41-43`'s own
comment says that button exists precisely so mobile can reach the create flow.

This is the sharpest question I am asked to apply: **can the criteria distinguish the approach the
plan chose from the one it rejected?** Here, no — a sprinkled build passes everything written. The
plan chose a single convergence point and its criteria do not test that choice.

**Fix: one clause in the Mechanism paragraph**, naming the placement and the three doors —
*"set it in the `onSaved` host callback (`ItemListView.tsx:220-223`), the single point all three
create entry points converge on: the list's '+ New Item' (`:150`), App's `createRequestToken`
effect (`:90-93`, the mobile top-bar '+ New', `App.tsx:144-147`), and Duplicate (`:219`)."* With the
placement stated, **no criterion needs to change** — T36 keeps its falsification statement, which
remains correct, and the sprinkled build stops being a thing a careful reader can arrive at. Fixing
it by adding a fourth criterion for entry point 2 would be the worse answer.

## R8.4 The three round-7 items — confirmed landed

- **R7.1.** `:2137-2138` now names `ItemListView` and **`ItemModal`**. I re-confirmed the underlying
  fact independently: `setItemArchived` is called at `ItemModal.tsx:187` and nowhere else outside
  `apiClient`. The `:2140-2146` blockquote states the vacuity consequence in full — that a T33
  written in `ItemDetails.test.tsx` is *"vacuously true on every build, including one with no
  confirm at all"* — and routes T33/T34 to where `ItemModal` is rendered. That is the whole finding,
  and recording *why* the correction is load-bearing rather than silently fixing the component name
  is the right call: the next person to touch this will meet the same temptation.
- **R7.2.** §9.2.1 (`:2209-2231`). The false reassurance is deleted; all four verified facts are
  stated (two production sites, no spec stubs it, no `page.on("dialog")` anywhere in `e2e/`, no e2e
  Delete click); the misdiagnosis framing leads, with the `fix-dev-stale-dist.md` precedent cited.
  Leading with the symptom rather than the mechanism is the right ordering for text a QA engineer
  reads under time pressure.
- **R7.3.** A9.1 (`:2162-2176`) is rewritten at both ends: the three unreachable writes are removed
  with the reason (`:2167-2169`), **Restore** is named as the write the constraint actually binds,
  and duplicate-save is added **with a decision and a criterion** rather than a question. Noting
  that this was the second time the document described an unreachable harm — the same shape rounds
  3–4 withdrew from Decision 9 — is worth the sentence it costs.

## R8.5 Status of round 7's NITs, and one note for the record

N7.1 (no §7 checklist step for §9), N7.2 (M2/M2b/M2c still describe Archive/Restore as a single
click) and N7.3 (cancel leaves a Radix dialog mounted; no focus check) are **all still open**. They
were NITs and I am not upgrading them — but N7.2 and N7.3 are the two that reach QA, and they are
cheap to fold in alongside the R8.3 clause if the plan is being opened anyway.

**On §9.3, per the coordinator's note: agreed, and recorded here so the record is in the review file
and not only in a message.** Duplicate's zero-server-surface property is what Decision 7 is built on
and what this branch's QA actually certified. If a future plan proposes adding an attachment-copy
endpoint *here* rather than on its own branch, **the refusal must be re-argued against the code as
it stands then, not inherited from this paragraph.** The facts it rests on are checkable and I
checked them: `routes/items.ts:303-444` carries exactly four attachment routes and no copy path.
That is true today; it is exactly the kind of claim that stops being true quietly.

## R8.6 Judgement

Two rounds on a two-nit amendment have produced four real defects, and every one of them was a fact
about code that did not exist before the Coder wrote it: which component calls the API, which tests
click which buttons, what Playwright does with an unhandled dialog, and how many doors lead to the
create flow. The coordinator's read is right and worth carrying to the next feature — **a
post-implementation round is not a formality, and it cannot be simulated by reading the plan harder
before the code exists.**

The one item left is small and I want to be plain about its size: the plan already points at
`onSaved`, just not in the paragraph that tells the Coder what to build, and it counts two doors
where there are three. The fix is a clause. I do not need to see a v9 — fold it in, and the
amendment is done.

---

## Required changes

1. **R8.3** — State the *placement* in §9.1's Mechanism paragraph (`:2157-2160`), not only in T36's
   justification: the switch goes in the `onSaved` host callback (`ItemListView.tsx:220-223`), the
   single point at which **three** create entry points converge — the list's "+ New Item" (`:150`),
   App's `createRequestToken` effect (`:90-93`, driven by the mobile top-bar "+ New",
   `App.tsx:144-147`), and Duplicate (`:219`). Correct `:2175-2176`'s "the two behaviours" to three.
   Without this, a build with `setScope` sprinkled into the "+ New Item" and duplicate handlers
   passes **T31, T32 and T36** while leaving QA's original nit unfixed on the mobile create path.
   No criterion needs to change once the placement is stated.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v9, §9 amendment)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-21 · **Round:** 9

> Verdicts above are preserved as written. **Round 6's `APPROVE` still stands for §§1–8.** The
> operative verdict for the §9 amendment is on the last line of this file.

Round 8's REQUIRED is **properly closed**. Both findings below are in **§9.4**, which is text
written this round and which I have not reviewed before — one of them is exactly the risk the
coordinator asked me to test. Neither blocks a build, neither touches a decision, both are a
sentence.

---

## R9.1 (asked) Is naming `onSaved` sufficient on its own? **Yes as a requirement — and there is one cheap way to do better, which is not a fourth criterion**

The blockquote at `:2162-2176` is as strong as instructional guidance gets: it states the placement
as a **requirement** rather than a preference, tabulates all three doors with correct citations (I
re-verified `:150`, `App.tsx:144-147` → `:90-93`, `:219`, converging at `:220`), spells out the
consequence in the form that makes it matter — *entry point 2 broken on the owner's primary
device* — and records why a fourth criterion is the wrong fix. **That closes round 8's finding.**
Combined with T36, which already forces a Coder off a door-1-only build, the residual hole requires
ignoring an explicit written requirement.

**On "cheap and structural": nothing here can be made truly structural** — no mechanism prevents
someone *adding* a `setScope` call to a handler, and I would not invent a lint rule for it. But
there is a zero-cost improvement available, and it is the choice of **which door an existing
criterion enters**:

> Specify **T31 to drive entry point 2** (bump `createRequestToken` via rerender) rather than
> clicking "+ New Item" at `:150`.

`createRequestToken` is a prop, so in a jsdom spec this is *easier* than clicking the button, not
harder. The effect: T31 enters by door 2, T36 by door 3, and the only uncovered door is 1 — the one
a handler-patcher fixes **first** and the one most likely to be hit in manual QA anyway. Today the
uncovered door is 2, which is both the one nobody thinks to patch and the one that matters on an
iPhone. **No new criterion, no new door to check** — the same two criteria, pointed at the two doors
that are actually at risk.

Stated honestly so it is not oversold: this does not make the placement structural, it makes the
surviving gap the least dangerous of the three. Graded a **suggestion, not a finding** — the
requirement as written is sufficient, and the author may reasonably decline.

## R9.2 (asked) **REQUIRED (does not block)** — §9.4's focus check cannot fail, and the failure it names is not the one that will happen

The coordinator flagged this risk precisely, and it did materialise. `:2267-2268` reads: *"focus
must return **somewhere sensible** rather than falling to `<body>`."*

Two-sided test, applied: **the red condition is one specific outcome (`<body>`), and the green
condition is a judgement word.** Everything that is not `<body>` passes, including outcomes a
keyboard user would experience as broken. A QA engineer cannot run this and be wrong, which means it
cannot go red on a bad build.

**And `<body>` is not the realistic failure.** After a native `confirm()` is dismissed, the browser
generally restores focus to the element that had it — so the likely-correct outcome is "focus is
back on the Archive button". The realistic *failure* is focus landing on the **Radix dialog
container** rather than the button, because that is where Radix puts it on mount and it is what the
repo's own standing memory is about. Container-focus is "sensible" by the letter of this check and
passes it — while leaving a keyboard user having to re-tab to reach the control they just used.
So the check is simultaneously too narrow (one named failure) and too loose (a judgement word
covering the failure that will actually occur).

**Fix, one sentence:** *"After cancelling, `document.activeElement` is the **Archive** (or
**Restore**) button that opened the confirm, and the item modal is still open. Focus on the dialog
container, or on `<body>`, both fail."* That is checkable in a browser (`:focus` ring, or read
`document.activeElement` in the console) and it is two-sided.

Graded REQUIRED on this document's own standard: manual-QA text reaching a human, and a criterion
whose stated failure condition is wrong, which is the second of the two defect classes I am asked to
attack hardest.

## R9.3 **REQUIRED (does not block)** — §9.4's M2/M2b/M2c amendment never reaches a reader who enters at §7.2

The content is right: `:2263-2266` correctly identifies that a QA running those steps literally
reports the feature as broken, in the same misdiagnosis direction §9.2.1 warns about.

But **§9.4 describes an amendment rather than making one, and §7.2 carries no pointer to it.** I
grepped: `§9` appears at `:5`, `:2137-2138`, `:2265` and `:2271` — **nowhere in §7.2**, whose
M-checks sit around `:1635-1680`, roughly 600 lines earlier. A QA engineer's entry point for manual
testing is §7.2. They read "Archive a real past item… the archived one leaves the list", do it, hit
an unexpected native dialog, and are in exactly the state §9.4 exists to prevent — unless they
happened to read to the end of a 2,270-line document first.

The additive principle ("nothing in §§1–8 changes") is about **design**, not about forbidding a
cross-reference. The minimal fix that honours it is one line at the head of §7.2: *"§9.4 amends
M2/M2b/M2c — Archive and Restore now raise a native confirm."* Editing the three steps in place
would also be fine and is arguably what "Manual-check amendments" promises.

*(Same observation, lower stakes, applies to nothing else: T31–T36 are additive criteria the Coder
meets in §9's own tables, and §9.2.1's blast-radius table is read by whoever implements the confirm.
Only the manual checks have their reader entering somewhere else.)*

## R9.4 What landed, confirmed

- **R8.3** — `:2162-2176`, verified above. The "why a fourth criterion is the wrong fix" sentence is
  a better statement of the reasoning than my round-8 wording, because it names the property that
  does the work: the convergence point makes the three doors behave identically **by construction**,
  where a criterion only checks one more door.
- **N7.2** — `:2263-2266`, content correct (see R9.3 for the delivery problem).
- **N7.3** — `:2267-2270`, taken (see R9.2 for the specification problem). Crediting the right
  thing: *"a native dialog dismissal is a new focus-return path nothing else in the app exercises"*
  is an accurate and non-obvious observation, and it is why the check deserves to exist at all.
- **N7.1 declined, explicitly** (`:2271-2272`). **I agree with the decline and with declining it out
  loud.** §9's criteria tables are where a Coder picks this work up; a checklist step would restate
  them and add a second place to keep in sync. Recording the refusal is better than a silent drop —
  that is the convention this document settled on in v6 and it is being applied correctly.

## R9.5 NIT

- **N9.1 — the memory citation at `:2269` uses wiki-link syntax**
  (`[[radix-focus-restore-needs-explicit-handling]]`), which appears nowhere else in this plan and
  does not resolve for anyone reading the markdown. The house style is `:1586`'s form: *"a known
  hazard — `memory/MEMORY.md`, 'Radix focus restore needs explicit handling'"*. Cosmetic, changes
  nothing, but it is a citation in text a human follows.

## R9.6 Judgement

Nine rounds, and the shape of the last three is worth recording because it is the useful artefact
here: **rounds 1–6 could not have found rounds 7–9's defects at any level of care**, because every
one of them was a fact about code that did not exist until the Coder wrote it — which component
calls the API, which specs click which buttons, what Playwright does with an unhandled dialog, how
many doors lead to the create flow, and where focus goes when a native dialog closes. The
coordinator's conclusion is the right one to carry forward.

What is left is two sentences in the one section added this round, and both are in the same place
for the same reason: **§9.4 is the nit-fixing section, and it got less scrutiny than the sections it
was fixing.** That is an ordinary end-of-project pattern and not a criticism of the work — the
substance of both bullets is correct, and what needs changing is how one of them is worded and where
the other one is delivered.

No design change, no code change, no criterion change. Fold in the two sentences and the pointer;
**I do not need to see a v10.** The next thing this branch needs is a Coder, not a reviewer.

---

## Required changes

1. **R9.2** — Make §9.4's focus check falsifiable: *"After cancelling, `document.activeElement` is
   the **Archive** / **Restore** button that opened the confirm, and the item modal is still open.
   Focus on the dialog container, or on `<body>`, both fail."* As written, "somewhere sensible"
   cannot go red, and the outcome that will actually occur on a bad build — Radix restoring focus to
   the dialog container — **passes** the check as stated.
2. **R9.3** — Deliver §9.4's M2/M2b/M2c amendment where its reader is. §7.2 contains no reference to
   §9 (`§9` appears at `:5`, `:2137-2138`, `:2265`, `:2271` only), so a QA engineer entering at
   §7.2's M-checks — roughly 600 lines earlier — meets the unexpected confirm with no warning, which
   is the failure §9.4 exists to prevent. One line at the head of §7.2, or edit the three steps in
   place.

APPROVE WITH CHANGES

---
---

# Review — `docs/plans/item-archive.md` (v10, §9 amendment)

**Reviewer:** Plan-Reviewer · **Date:** 2026-09-21 · **Round:** 10 — verification only

> Verdicts above are preserved as written. **Round 6's `APPROVE` stands for §§1–8.** The operative
> verdict for the §9 amendment is on the last line of this file.

Not a review round. I checked only that round 9's four items landed, and re-read nothing else.
**All four landed.** One of them invalidated a sentence three lines above it — flagged below as a
NIT with replacement text, not as a gate.

## R10.1 The four items

- **Focus check (R9.2)** — `:2276-2286`. Now `document.activeElement` **must be the Archive/Restore
  button that opened the confirm**, modal still open, with **container-focus and `<body>` both
  failing**. Two-sided and runnable. Keeping the diagnosis in the text was the right call: the
  reason the old wording failed (one named red outcome, a judgement word for green, and the
  realistic failure passing it) is more useful to the next person writing a focus check than the
  assertion is.
- **§7.2 pointer (R9.3)** — `:1593-1597`, a `⚠` blockquote at the section head, where the reader
  actually enters. It carries the misdiagnosis warning too, which is the part that costs a wasted
  QA cycle. §9.4 `:2273-2275` now also states it is an instruction to edit in place, not a note.
- **T31 re-pointed at door 2 (R9.1's suggestion)** — `:2203`. Drives `createRequestToken` by
  rerender, with the trade recorded in the row so it is not "simplified" back to clicking the
  button. Correct, and the rationale is stated in the form that survives a future editor.
- **NIT (N9.1)** — `:2284-2286`. Wiki-link gone; now `docs/plans/item-view-mode.md` plus
  `ItemModal.tsx:123`'s `document.contains(trigger)` guard, in house form. The added clause — why
  this repo treats focus return as something to assert rather than assume — is better than the bare
  citation I asked for.

## R10.2 **NIT — the T31 change invalidated the sentence that justifies the placement requirement**

`:2181-2182`, inside the placement blockquote, still reads: *"No criterion catches it, because
**T31 enters by door 1** and T36 by door 3."* As of `:2203`, T31 enters by **door 2** — so a
handler-by-handler build that patches doors 1 and 3 **is** now caught, by T31. The sentence is false
as written and contradicts the criteria table three lines below it.

**Graded NIT, and I want to be explicit about why**, because I have graded the same shape REQUIRED
earlier in this review: it changes no decision, no criterion and no code; the placement requirement
it supports is stated correctly and separately in the same blockquote; and it errs in the
**conservative** direction — it overstates the gap, so it makes the requirement sound *more*
necessary rather than less. No reader is led to skip a safeguard. And the corrected T31 row sits
immediately below, so the contradiction is self-resolving for anyone who reaches the table.

**But fold it in before dispatch.** This document's own history is that stale justifications get
quoted onward — v4's withdrawn `App.tsx:55-63` claim and Decision 9's withdrawn harm are both in
this review file for that reason — and "no criterion catches it" is a claim about test coverage that
a future reader could repeat. Replacement text:

> *"No criterion caught it in v9, because T31 entered by door 1 and T36 by door 3. **v10 re-points
> T31 at door 2, so a door-1-and-3 patcher is now caught** — the requirement still stands, because
> the convergence point is what makes all three doors behave identically, rather than leaving
> whichever door happens to be uncovered to chance."*

That is a coordinator-verifiable edit. **I do not need to re-stamp it**, and it does not gate the
Coder.

## R10.3 On the status line

`:3` reads *"v9 — post-QA amendment, **in review**"*, with a parenthetical recording that the
premature "APPROVED" happened twice — once by the Architect at v6, once here — and was caught on
re-read. Verified, and worth saying plainly: **self-flagging a repeat of a correction you previously
received is the behaviour that makes a review record worth keeping.** The pull toward writing a
thing down as done is real, which is exactly why the rule is that an author cannot approve their own
plan. It is now recorded in the artifact rather than in a message, where the next person will see
it.

## R10.4 Verdict

Ten rounds: REJECT → 14 → 7 → 5 → 2 → APPROVE on §§1–8 → 3 → 1 → 2 → **0 blocking**. The amendment
is correct, its criteria are two-sided, its manual checks reach the human who runs them, and its one
remaining defect is a stale clause pointing the safe way with its own correction written three lines
below it.

The plan is ready. Dispatch the Coder.

APPROVE
