# Impl notes — `docs/plans/item-archive.md` (v6)

**Status:** implemented per plan §7's 15-step checklist, on branch `feat/item-archive` off
`main` (base commit `d1746b1`, "docs(backlog): 2afce988 confirmed on iPhone"). Working tree is
left dirty for review — nothing committed.

**Review verdict consulted:** `docs/reviews/item-archive-review.md`, APPROVE (round 6).

## Scope actually shipped

Manual archive, restore, an archived view (Active/Archived toggle on `ItemListView`), and
Duplicate. Auto-archive (Appendix A) was **not** built — no cron change, no `wrangler.toml`
change, no `ARCHIVE_AFTER_DAYS` constant, confirmed by grep (zero hits outside Appendix A's own
prose).

## Files changed

**Migration**
- `migrations/0007_item_archived.sql` (new) — `ALTER TABLE items ADD COLUMN archived_at
  INTEGER`, with the house `-- NULL = …` documentation convention (0004/0005 precedent).

**Shared**
- `src/shared/archive.ts` (new) — `isArchivable(item, now)`, `archiveBlockedReason(item, now)`,
  `ALL_DAY_GRACE_MS = 25h`. Zero dependencies, no timezone read (D1.2). `itemAnchorAt` is
  module-private, not exported (§5.2's stated hazard).

**Worker**
- `src/worker/types.ts` — `Item.archived_at`, `ItemRow.archived_at`, new `ItemScope` (two
  members).
- `src/worker/db.ts` — `mapItem` maps `row.archived_at ?? null` (R9's defence-in-depth);
  `getItems` gained a 4th `scope: ItemScope = "active"` parameter with the SQL exclusion;
  `getActiveItemsWithReminders` gained `AND i.archived_at IS NULL` (GUARD, Decision 3(ii));
  `updateItem`/`completeItem` gained the archived-item CONFLICT guard (G6); new
  `setItemArchived(db, email, id, archived, now)` — one function, both directions, mirroring
  `completeItem`'s shape.
- `src/worker/routes/items.ts` — `GET /lists/:id/items` gained `?archived=1` and the
  `archived+from/to` 400 rejection; new `POST /items/:id/archive`; `CONFLICT → 409` added to the
  PATCH, complete, and archive status ladders.

**Frontend**
- `web/src/types.ts` — `Item.archived_at`.
- `web/src/apiClient.ts` — `getItems(listId, { archived? })`; new `setItemArchived(id, archived)`.
- `web/src/lib/duplicateItem.ts` (new) — `buildDuplicateDraft(item, now)`, all twelve `ItemDraft`
  fields set explicitly, one uniform date-shift rule (§5.7.1).
- `web/src/components/ItemEditor.tsx` — new optional `initialDraft?: ItemDraft`, used as the
  `useState` initialiser in create mode.
- `web/src/components/ItemModal.tsx` — create arm's state gained `draft?`/`sourceId?`; new
  `openDuplicate(item)` on `useItemModal`; new **required** `onArchiveChanged` and
  `onDuplicateRequested` props; `ItemModal` now owns the `setItemArchived()` call (local
  `actionError` state renders failures); `ItemEditor`'s `key` is `"create:" + sourceId` for the
  duplicate arm.
- `web/src/components/ItemDetails.tsx` — new **required** `onArchive`/`onRestore`/`onDuplicate`;
  `canEdit`/`canArchive`/`canRestore`/`canDuplicate` gates; Archive/Restore/Duplicate buttons;
  Archived `Badge`.
- `web/src/components/ItemListView.tsx` — `scope` state; Active/Archived toggle
  (`aria-pressed`); **both** fetch sites (mount effect + `refresh()`) scope-aware; archived rows
  render View-only via a new `archivedView` prop on `ItemRow`; `ItemModal` wired with
  `onDuplicateRequested`/`onArchiveChanged` (the latter routes through `refresh()`, never
  `onSaved`).
- `web/src/components/CalendarView.tsx` — **one** production change: `onArchiveChanged` wired to
  `itemModal.close()` + `setReloadToken()`, deliberately **not** `setCurrentMonth` and
  deliberately **not** reusing `onSaved`. No `archived_at` reference anywhere in the file
  (confirmed by grep).

**Tests (new)**
- `tests/unit/archive-rule.test.ts` — T22 (§6.2 edge-case table) + pure-level T5a/T5b/T6a.
- `tests/unit/archive-db.test.ts` — T1–T11, T13r–T16r, plus T5/T5a/T5b/T6/T6a against real D1.
- `tests/unit/items-archive-http.test.ts` — T16–T21 (T16b, T20b included).
- `web/src/lib/duplicateItem.test.ts` — T23.
- `e2e/archive.spec.ts` — E1, full round trip.

**Tests (extended)**
- `web/src/components/ItemListView.test.tsx` — T24(a–d).
- `web/src/components/ItemDetails.test.tsx` — T25, T26, T26b (+ 18 existing render sites given
  the three new required props).
- `web/src/components/CalendarView.test.tsx` — T27, T28, T30 (+ 2 existing render sites given
  `onArchiveChanged`).
- `web/src/components/ItemEditor.test.tsx` — T29.
- `web/src/components/ItemModal.desktop.test.tsx` — 2 sites given `onArchiveChanged`.

**Mechanical fallout (required-prop compile errors, §5.7's table)**
- `tests/unit/notification-content.test.ts` — 1 `Item` fixture, `archived_at: null`.
- `web/src/App.deeplink.test.tsx`, `ItemDetails.test.tsx`, `ItemEditor.test.tsx`,
  `ItemListView.test.tsx`, `ItemModal.desktop.test.tsx`, `CalendarView.test.tsx` (4 sites) —
  `archived_at: null` added to base `Item` fixtures.
- `e2e/fixtures/api-mocks.ts` — `buildItem`'s `Item` fixture gained `archived_at`; also extended
  with `InstallArchiveApiMocksOptions`/`installArchiveApiMocks` (a **stateful** mock, additive,
  `installApiMocks` untouched) for E1's round trip, and `ItemFixtureOptions.archivedAt`.

**Mechanical fallout (schema parity — not named by the plan's checklist, found by running
the suite; see "Plan gaps" below)**
- `tests/unit/db.test.ts`, `attachments-cascade.test.ts`, `attachments-routes.test.ts`,
  `attachments-validation.test.ts`, `items-get-by-id.test.ts`, `items-validation.test.ts`,
  `list-isolation-http.test.ts` — each carries its own inline D1 schema (independent of
  `migrations/`); added `archived_at INTEGER` (or the `db.test.ts` `ALTER TABLE` equivalent) so
  `getItems`/`updateItem`/`completeItem`'s new SQL/guard don't 500 or false-positive-CONFLICT
  against a schema that predates this branch.

**Config**
- `vitest.workspace.ts` — pinned `TZ: "America/Los_Angeles"` on the web project (step 12,
  required by T29).

## Commands to run the feature locally

```
npx wrangler d1 migrations apply family-scheduler --local   # applies 0007
npm run dev
```
Create a list, add a past (non-recurring, non-all-day) item, open it, click **Archive**. Toggle
to **Archived** on the list view to see it; **Restore** and **Duplicate** are in the same view
modal.

## Verification — real output

**Baseline, measured on `main` before branching** (matches the task brief's stated numbers):
```
Test Files  35 passed (35)
     Tests  312 passed (312)
```
e2e: `6 passed (6.0s)`.

**Final, on `feat/item-archive`:**
```
npm run typecheck   → clean, 0 errors (all three tsconfig projects)
npm run lint        → 0 errors, 2 warnings (both pre-existing: push.ts unused-disable,
                       ItemListView.tsx exhaustive-deps — unchanged from baseline)
npm test             → Test Files  39 passed (39)
                        Tests  379 passed (379)
                        (312 baseline + 67 new: 16 archive-rule + 18 archive-db +
                        8 items-archive-http + 6 duplicateItem + 4 ItemListView T24 +
                        11 ItemDetails T25/T26/T26b + 3 CalendarView T27/T28/T30 + 1 ItemEditor T29)
npm run build         → succeeds, dist/ produced
npm run test:e2e      → 7 passed (6 baseline + e2e/archive.spec.ts's E1)
```

## Sabotage verification (all three required by the task, real output captured live)

**1. Remove `archived_at IS NULL` from `getItems`'s SQL.**
`tests/unit/archive-db.test.ts` and `tests/unit/items-archive-http.test.ts` went red on
exactly the archived-hidden criteria:
```
× T1 — after archiving, id is absent from active scope and present in archived scope, by id
× T15r — restore flips the flag and moves the scope: leaves archived, returns to active
× T18 — plain GET omits the archived id and includes a live one; ?archived=1 returns only the archived one
× T20 — ?from&to EXCLUDES an archived item's occurrence and INCLUDES a live item's occurrence
```
4 failed / 22 passed across the two files. Restored; suite back to green.

**2. Change `ALL_DAY_GRACE_MS` from 25h to 24h.**
```
× T5b — ALL_DAY_GRACE_MS is 25h, not 24h: at exactly +24.5h the gate is still false
  → expected 86400000 to be 90000000
```
Exactly **1** test failed (T5b), out of 16 in `archive-rule.test.ts`. T5a, T6a, and every T22
row stayed green — they sample at +9h/+27h, well clear of the boundary, confirming the plan's
claim that T5b is the *only* criterion separating 25h from 24h. Restored.

**3. Wire Archive to `close()` alone, without the refresh/reload call.**
Done at both hosts (the plan's instruction names `setReloadToken`, which is `CalendarView`'s
mechanism; `ItemListView`'s equivalent is `refresh()` — both tested):
- `ItemListView` (`onArchiveChanged={() => { itemModal.close(); }}`, `refresh()` dropped):
  `ItemListView.test.tsx`'s T24(d) went red — `calls.length` did not grow past
  `callsBeforeRestore`.
- `CalendarView` (`onArchiveChanged={() => { itemModal.close(); }}`, `setReloadToken` dropped):
  `CalendarView.test.tsx`'s T30 went red — the archived chip's `waitFor(...not.toBeVisible())`
  timed out (the grid never refetched).
Both restored; suites back to green.

## M1b — the deploy-order rehearsal (the task's explicitly named highest-value check)

Followed the plan's corrected M1b exactly, not the `rm -rf .wrangler/state` shortcut that earlier
plan revisions used (that destroys 0001–0006 too and produces a different error):

1. `rm -rf .wrangler/state` (fresh).
2. Moved `migrations/0007_item_archived.sql` out of `migrations/`.
3. `npm run migrate:local` — applied 0001–0006 only.
4. Moved `0007` back into `migrations/` **without** applying it (confirms the plan's claim that
   wrangler tracks applied migrations in a DB table, not by file presence — re-running
   `migrate:local` later correctly saw only `0007` as pending).
5. `npm run dev`, opened the app in a real browser (Playwright MCP), created a list, selected it.

**Result — confirms the plan's central unverified claim, for the first time across all six
revisions:**
- **Browser:** a red error banner reading `ApiError: HTTP 500` appeared, rendered **alongside**
  "No items in this list yet." (both together, exactly as the plan's corrected step 4 says — the
  failed fetch never calls `onItemsChange`, so `items` stays `[]`). Switching to Calendar
  produced a second console error (same `getItems` query, same missing column).
- **Terminal (`wrangler dev` worker output), not the browser:**
  ```
  ✘ [ERROR] Error: D1_ERROR: no such column: archived_at at offset 42: SQLITE_ERROR
      [cause]: Error: no such column: archived_at at offset 42: SQLITE_ERROR
  ```
  Confirms R9's stated mechanism exactly, and confirms the plan's claim that this text is
  console-only (no `app.onError` registered) — the browser never saw it.
6. `npm run migrate:local` applied `0007`; reloaded the page: 0 console errors, list view and
   calendar both rendered cleanly. Full recovery, no other change needed.

Dev server and browser both cleanly stopped afterward; `.wrangler/state` left as this rehearsal
produced it (a fully-migrated local D1 with one empty test list) — harmless, and consistent with
what any local `npm run dev` session leaves behind.

## Deviations from the plan, and why

1. **`ItemModal` gained a second new prop, `onDuplicateRequested`, not just `onArchiveChanged`.**
   §5.7's N5.3 ownership table states "each host gains exactly one new prop (`onArchiveChanged`)"
   and separately says Duplicate's modal transition happens "via `useItemModal`'s
   `openDuplicate`" — but `useItemModal()` is called by the **host** (`ItemListView`/
   `CalendarView`), never by `ItemModal` itself (HC1's per-instance-hook invariant). `ItemModal`
   has no way to invoke a hook it does not own, so triggering `openDuplicate` from inside
   `ItemModal` requires a callback the host supplies — exactly the shape `onEditRequested`
   already has. I added `onDuplicateRequested: (item: Item) => void`, mirroring
   `onEditRequested` exactly, and wired it in both hosts. I read this as the plan's "exactly one
   new prop" being scoped to the specific Decision-9 argument (the archive/`onSaved` collision),
   not a global cap — but flagging it explicitly since the text can be read either way, and this
   is the one place I did not follow the letter of §5.7 as written.

2. **`ItemDetails`' `canDuplicate` gate.** The plan states Duplicate is offered "for an archived
   one" (Decision 6) and OQ3 recommends restricting it to archived items for this branch
   ("yes eventually, no in this branch"), but never states the gate as a formula the way
   `canArchive`/`canRestore` are given. I implemented `canDuplicate = canWrite && item.archived_at
   !== null`, matching Decision 6's prose and OQ3's recommendation. `buildDuplicateDraft` itself
   has no such restriction, so widening this later (OQ3, "yes eventually") is a one-line change
   at this one gate, as the plan anticipated.

3. **`ItemModal` surfaces archive/restore failures via a local `actionError` banner.** The plan
   specifies the *success* path (`onArchiveChanged`) in detail but does not say where a failed
   `setItemArchived()` call (network error, a raced CONFLICT) should surface, since `ItemModal`
   now owns that call. I added a minimal local error-banner `useState`, cleared on every `state`
   change, rendered above the body — the same shape `ItemEditor` already uses one level up.

4. **`ItemListView`'s "+ New Item" button stays visible in both Active and Archived scope.** Not
   addressed by the plan. Creating from the Archived tab makes a live item that then does not
   appear in the tab you're looking at until you switch back to Active — mildly surprising, not
   incorrect. Left as-is rather than inventing a hide-in-Archived rule the plan does not ask for.

5. **Empty-state copy differs by scope** ("No items in this list yet." vs "No archived items.").
   Not specified by the plan; a one-line addition needed to make the Archived view legible when
   empty.

## Out-of-scope observations (not fixed, per the Coder's guardrails)

- **`ItemListView`'s pre-existing `useEffect` (`ItemListView.tsx`) is missing `onItemsChange` in
  its dependency array** — this is the second of the two baseline lint warnings, pre-dates this
  branch, and is unrelated to archiving. Left untouched (fixing it risks changing the
  create-token/deep-link effect ordering this component's other comments describe as
  load-bearing).
- **OQ6 (all-day storage convention, local time + a stored IANA `timezone` that is never
  consulted)** — the plan explicitly defers this (its own OQ6) and this branch is careful to
  work correctly *under* the existing convention rather than depend on it changing. Not touched.
- **`recurrence.ts`'s `isValidTimezone` remains dead code** (zero call sites) — the plan names
  this explicitly (D1.2) as a genuine small improvement that is out of scope here. Not touched.

## Plan gaps found during implementation (the most useful section, per the harness instructions)

1. **The schema-parity hazard across the ~10 test files with independent inline D1 DDL is real
   and was not named by the plan.** §7 step 9 says "Follow `tests/unit/db.test.ts`'s
   `applyMigrations` pattern... its inline DDL needs `archived_at INTEGER` adding" — but that
   instruction is scoped to the *new* `archive-db.test.ts` file the Coder is about to write. It
   does not mention that **seven pre-existing test files** (`db.test.ts`,
   `attachments-cascade.test.ts`, `attachments-routes.test.ts`, `attachments-validation.test.ts`,
   `items-get-by-id.test.ts`, `items-validation.test.ts`, `list-isolation-http.test.ts`) each
   carry their **own independent copy** of the `items` table DDL (a pattern the repo already
   uses for `location_kind`, visible in each file's history), and that `getItems`'s new
   `archived_at IS NULL` clause and `updateItem`/`completeItem`'s new `archived_at !== null`
   guard will break tests in those files that exercise those code paths against a schema that
   lacks the column — either as a hard SQL error (`getItems`, `list-isolation-http.test.ts`: two
   tests went from 200 to 500) or, more subtly, as a **false CONFLICT** (`updateItem`/
   `completeItem` reading `undefined` from a missing column and treating `undefined !== null` as
   "archived" — `items-validation.test.ts`: three happy-path PATCH tests went from 200 to 409,
   the exact `undefined`-vs-`null` failure mode R9 already names for `mapItem`, just one layer
   over). I found this only by running `npm test` after wiring the guards, not by reading the
   plan. §8's self-check manifest does not flag this gap either. Fixed by adding
   `archived_at INTEGER` to each file's inline schema, matching the existing `location_kind`
   precedent in the same files. This should be folded into a future revision's §7 step 9 or its
   §8 manifest as a named risk, not left for the next Coder to discover the same way.

2. **T24's "URL string" wording doesn't fit this file's testing idiom, and the plan doesn't say
   so.** T24(b) in §7.1 reads "switching to Archived issues a fetch whose **URL string** contains
   `archived=1`" — but `ItemListView.test.tsx` (like every other component test in this repo,
   including `CalendarView.test.tsx`'s own N5) mocks `apiClient.getItems` itself, not the
   underlying `fetch`, so no literal URL string is ever observable at this layer. I implemented
   the equivalent check at the level this file actually operates at (asserting the mocked
   `getItems` call's second argument is `{ archived: true }`), with a comment explaining the
   substitution, and left the literal URL-string claim to the HTTP-layer tests
   (`items-archive-http.test.ts` T18–T20, which do go through the real route and can observe the
   real querystring). Not a defect in the plan's design, just imprecise wording against this
   repo's established test-idiom — worth tightening in a future revision the way T24(b) is
   phrased.

3. **The plan's "confirmed hazard" for `ItemModal`'s `key` change cites the initializer-only
   `useState`, but doesn't name what the fresh key needs to be keyed on.** §5.7 says the key
   "must become `"create:" + sourceId`" without ever defining `sourceId` as a concrete value. I
   inferred (and the plan's own hazard description supports) that it must be a value that
   changes on **every** `openDuplicate()` call — including two consecutive duplicates of the
   *same* source item — not the source item's own `id` (which would be identical across two
   duplicates of the same item and would reproduce the exact bug the key change exists to
   prevent). I generate a fresh `crypto.randomUUID()` per `openDuplicate()` call and store it as
   `sourceId` in modal state. Functionally correct per the hazard's own reasoning, but the plan
   never states this explicitly — worth adding one sentence to Decision 9/§5.7 in a future
   revision.

## Bug fix verification approach

N/A — this is a feature implementation (slug does not start with `fix-`), not a bug fix.

---

# §9 amendment (v10) — post-QA nits 1 and 2

**Status:** implemented per plan §9's two decisions (A9.1 scope switch, A9.2 confirmation) and
§9.4's manual-check amendments, on branch `feat/item-archive`, current tip `7bba724`
("docs(plan): item-archive §9 amendment, APPROVE after 4 more rounds") at the start of this pass.
Working tree left dirty for review — nothing committed. §§1–8 are untouched; this section is
purely additive to the impl notes above.

**Review verdict consulted:** `docs/reviews/item-archive-review.md`, APPROVE (round 10, byte-exact
on the last line, per the task brief).

## Files changed

- `web/src/components/ItemModal.tsx` — `handleSetArchived` now calls `confirm(` `${verb} "` +
  `item.title` + `"?` `)` before `setItemArchived`, `verb` being `"Archive"`/`"Restore"`. This is
  the **only** call site outside `apiClient` (N5.3), which is why T33/T34 (the confirm criteria)
  are written where this component is rendered, not in `ItemDetails.test.tsx`.
- `web/src/components/ItemListView.tsx` — the `<ItemModal>`'s `onSaved` handler (was `itemModal
  .close(); refresh();`) now branches: `if (scope !== "active") setScope("active"); else
  refresh();`. This is the single convergence point for all three create entry points (list "+
  New Item" `:150`, mobile top-bar via `createRequestToken` `:90-93`, and Duplicate `:219`) —
  `ItemEditor`'s `onSave` prop is this same function regardless of which door opened it, so the
  fix lives at the place the plan requires (§9.1's boxed instruction) rather than per-handler.
- `web/src/components/ItemListView.test.tsx` — added `PAST_LIVE_ITEM` fixture (a live, past-dated
  item, since the pre-existing `TIMED_ITEM` is future-dated and never offers Archive); added
  `createItem: vi.fn()` to the mocked `apiClient` module; added a module-scope `TokenHarness`
  component (a stateful wrapper that also threads `createRequestToken` through, so T31 can drive
  door 2 by `rerender()` without clicking "+ New Item"); added a file-level `vi.spyOn(window,
  "confirm").mockReturnValue(true)` to the existing `beforeEach` (default-accept, since most
  flows in this file are not testing the cancel path); added six tests (T31–T36) in a new
  `describe` block.
- `web/src/components/CalendarView.test.tsx` — added the same `vi.spyOn(window, "confirm")
  .mockReturnValue(true)` to the `"CalendarView — archive"` describe block's own `beforeEach`
  (scoped there, not file-wide, since only that block's T30 clicks Archive).
- `e2e/archive.spec.ts` — added `page.on("dialog", (dialog) => void dialog.accept())`, registered
  once before `page.goto("/")`. This is the first `page.on("dialog")` handler in the repo's e2e
  suite (verified: `grep -rn "page.on(\"dialog\"" e2e/` had zero hits before this change).
- `docs/plans/item-archive.md` — §7.2's M2/M2b/M2c edited in place per §9.4's explicit
  instruction to add "…and accept the confirmation"; added a new M2d step (the cancel-path focus
  check, stated so it can fail: `document.activeElement` must be the Archive/Restore button that
  opened the confirm, with both the Radix dialog container and `<body>` as named failures, not
  just "somewhere sensible").
- `docs/plans/item-archive-impl-notes.md` (this file) — this section, appended.

## Where each §9 criterion landed

| # | Test file | What it does |
|---|---|---|
| T31 | `ItemListView.test.tsx` | Door 2 (bumped `createRequestToken` via `rerender`, not the "+ New Item" click) from Archived scope → scope reads Active, new item listed |
| T32 | `ItemListView.test.tsx` | Restore from Archived scope → scope **stays** Archived (guards "switch on every write") |
| T33 | `ItemListView.test.tsx` | Archive, `confirm` stubbed `false` → `setItemArchived` not called, item still in Active |
| T34 | `ItemListView.test.tsx` | Restore, `confirm` stubbed `false` → `setItemArchived` not called, item still in Archived |
| T35 | `ItemListView.test.tsx` | Archive, `confirm` stubbed `true` (the default) → happy path still works end to end |
| T36 | `ItemListView.test.tsx` | Duplicate-save from Archived scope → scope reads Active, new item listed, source still findable under Archived |

All six are in `ItemListView.test.tsx` because that is where `<ItemModal>` is rendered for the
list surface, and it is also where the `onSaved` scope-switch logic lives — one file exercises
both §9.1 and §9.2 against the real convergence points rather than against `ItemDetails`' bare
intent-raising props.

## Verification — commands run, real output

Baseline stated in the task brief: 379 tests / 39 files. This branch's own tip before this pass
(`7bba724`) was docs-only (the plan's v10 approval), so 379/39 is also this pass's starting point
— confirmed by running the suite once with the six new `ItemListView.test.tsx` tests skipped (via
`-t` exclusion is awkward for a "everything except six" filter, so instead I diffed the final
count: 385 total = 379 + 6 new (T31–T36); no other file's test count moved, confirming none of the
three "fixed in place" sites (`ItemListView.test.tsx:339/342`, `CalendarView.test.tsx:1106`,
`e2e/archive.spec.ts:73/101/117`) were deleted and rewritten as replacements — they were edited to
stub/handle the new confirm, in place, as the task required).

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.e2e.json
(no output — clean)

$ npm run lint
✖ 2 problems (0 errors, 2 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
(warnings: src/worker/channels/push.ts:150 unused eslint-disable; ItemListView.tsx:77 missing
onItemsChange dep — BOTH pre-existing, present before this pass, unrelated to §9)

$ npm test
 Test Files  39 passed (39)
      Tests  385 passed (385)

$ npm run build
✓ 1891 modules transformed.
✓ built in 857ms

$ npm run test:e2e
  7 passed (8.7s)
```

385/39 (was 379/39), all 39 files green, 0 lint errors / 2 pre-existing warnings, clean build,
7/7 e2e.

**The three sites §9.2.1 named were independently confirmed to break without their fix**, by
reverting just the stub/handler in each (leaving the `confirm()` call itself in place) and
re-running:

```
$ npx vitest run web/src/components/ItemListView.test.tsx   # confirm-stub beforeEach removed
 × T24: Active/Archived toggle > (d) after Restore (...), the NEXT fetch still carries the archived scope
 × T32 — Restore from the Archived scope leaves the scope on Archived (...)
 × T35 — Archive with confirm stubbed true: the archive path still works end to end
 Tests  3 failed | 17 passed (20)

$ npx vitest run web/src/components/CalendarView.test.tsx -t "T30"   # confirm-stub beforeEach removed
 × T30 — archiving from the calendar refreshes the grid: (...)
 Tests  1 failed | 2 passed | 35 skipped (38)

$ npx playwright test e2e/archive.spec.ts   # page.on("dialog") handler removed
 ✘ beat 2: Archive from the view modal
   Error: expect(locator).not.toBeVisible() failed
   Locator:  getByRole('dialog')
   Expected: not visible
   Received: visible
 1 failed
```

`ItemListView.test.tsx:339/342` is exactly the pre-existing "(d)" test named above; T32/T35 are the
new §9 tests that happen to share the same click path and so break for the same reason. The e2e
failure is the exact misdiagnosis §9.2.1 predicts — Playwright auto-dismissed the confirm, so the
dialog never closed, which is indistinguishable from "the feature does not work" without knowing
to look for a dialog handler. All three were then restored to their fixed-in-place state (verified
by `git diff --stat` on each returning to the same shape shown under "Files changed" above), and
the full suite above was re-run clean as the final state.

## Sabotage verification — real output for each

**1. Scope switch moved to the `:150` ("+ New Item") handler instead of `onSaved`.**
Added `setScope("active")` inside the `+ New Item` button's `onClick`, and removed the switch from
`onSaved` (leaving `itemModal.close(); refresh();`, matching the pre-§9 code).

```
$ npx vitest run web/src/components/ItemListView.test.tsx -t "T31|T32|T33|T34|T35|T36"
 × T31 — creating via door 2 (...) from the Archived scope switches to Active and shows the new item
 × T36 — Duplicate-save from the Archived scope switches to Active and shows the new item (...)
 Tests  2 failed | 4 passed | 14 skipped (20)
```

T36 goes red, as the task expected. **T31 also goes red**, because door 2 (the mobile
`createRequestToken` path) never touches the `:150` handler either — both doors, and Duplicate,
converge only at the shared `onSaved`, and a patch that puts the switch anywhere else leaves that
shared convergence point broken for every entry point except the one literally clicked. This is
the intended proof that T31, "entering by door 2," does not accidentally validate a door-1-only
fix — it fails right alongside T36. Reverted immediately after; `git diff --stat` on
`ItemListView.tsx` returned to the same 30 insertions / 1 deletion as before the sabotage,
confirming a clean revert, and the full file (20/20) was re-run green before proceeding.

**2. `confirm` stubbed to return `false`, with the guard removed from `ItemModal.tsx`.**
Deleted the `if (!confirm(...)) return;` line from `handleSetArchived`, leaving the confirm call
made by the test's stub simply unread.

```
$ npx vitest run web/src/components/ItemListView.test.tsx -t "T33|T34"
 × T33 — Archive with confirm stubbed false: setItemArchived is NOT called and the item is still listed
   AssertionError: expected "spy" to not be called at all, but actually been called 1 times
   1st spy call: Array ["item-5", true]
 × T34 — Restore with confirm stubbed false: setItemArchived is NOT called and the item is still listed
   AssertionError: expected "spy" to not be called at all, but actually been called 1 times
   1st spy call: Array ["item-4", false]
 Tests  2 failed | 4 passed | 14 skipped (20)
```

Both go red, as required. Reverted; `ItemModal.tsx` diff returned to exactly the confirm-guard
change described above.

**3. Scope switch removed entirely** (no `setScope("active")` anywhere — `onSaved` reverted to
`itemModal.close(); refresh();` and nothing added to `:150`).

```
$ npx vitest run web/src/components/ItemListView.test.tsx -t "T31"
 × T31 — creating via door 2 (...) from the Archived scope switches to Active and shows the new item
 × T36 — Duplicate-save from the Archived scope switches to Active and shows the new item (...)
 Tests  2 failed | 4 passed | 14 skipped (20)
```

T31 goes red, as required (T36 goes red alongside it for the same reason — both assert the same
missing behavior against the same shared handler). Reverted; confirmed no `SABOTAGE` markers
remain (`git diff ... | grep -c SABOTAGE` → `0`) and re-ran the full verification suite one more
time after all three reverts (results above, under "Verification") to confirm the final state is
the one actually being handed off.

## Deviations from the plan / things I interpreted

1. **T32 is a new, explicit test rather than a repurposing of the pre-existing T24(d).** §9.1's
   table describes T32 as "From the Archived scope, Restore an item; assert the scope is still
   Archived," and the pre-existing `ItemListView.test.tsx` T24(d) test already exercises almost
   exactly this path (Restore from Archived, asserting the *next fetch* still carries `{archived:
   true}`), because it was written for §7.1's T24(d) sub-criterion before §9 existed. Rather than
   read T24(d) as silently satisfying T32, I wrote a separate, explicitly-labeled T32 test
   (asserting `aria-pressed` on both toggle buttons directly, rather than inspecting mock-call
   arguments) so the traceability from the plan's criterion IDs to the test suite is direct and a
   future reader doesn't have to infer that T24(d) is "secretly" also T32. Both tests now exist
   and both pass; this is redundant coverage of the same guarantee from two angles, not a
   conflict.

2. **T31's "door 2" harness (`TokenHarness`) is new, not an extension of the existing
   `renderWithLiveState` helper.** `renderWithLiveState` (built for T24) does not thread
   `createRequestToken` through as a prop, and T31 specifically needs to *change* that token via
   `rerender()` after the component has already mounted and had its scope switched to Archived —
   a fresh per-call render helper can't do that (rerendering with a brand-new inline component
   function remounts rather than reconciles, discarding the state T31 needs to survive the bump).
   I added `TokenHarness` as a second, module-scope harness rather than overloading
   `renderWithLiveState` with an optional token parameter, to avoid changing the signature (and
   therefore every existing call site) of a helper T24's four sub-tests already depend on.

3. **§9's table doesn't specify how T31's fixture data should be pre-mocked for `getItems`/
   `createItem`, since v7-v10's focus was the mechanism, not the fixture shape.** I used mutable
   `activeItems`/`archivedItems` arrays closed over by the `getItems` mock, with `createItem`'s
   mock implementation pushing into `activeItems` before resolving — mirroring the pattern already
   established in `CalendarView.test.tsx`'s T27-T30 block (a mutable `rows` array) rather than
   inventing a new one. Not a plan gap so much as an implementation choice the plan correctly left
   to the Coder.

4. **`PAST_LIVE_ITEM` is a new fixture, not a reuse of `ARCHIVED_ITEM` or `TIMED_ITEM`.** Neither
   existing fixture offers Archive: `TIMED_ITEM.start_at` is roughly 2027 (future — `isArchivable`
   is false) and `ARCHIVED_ITEM` is already archived (`ItemDetails` offers Restore instead).
   T33/T35 need a **live, past-dated** item to exercise the Archive confirm at all, so I added
   `PAST_LIVE_ITEM` (a `TIMED_ITEM` spread with `start_at: Date.now() - 3h`), matching the shape
   `CalendarView.test.tsx`'s own `PAST_ITEM` fixture already uses for the identical reason (its
   comment there says as much for T27/T28/T30).

5. **§9.4's cancel-path focus check is recorded as a new manual step, M2d, rather than folded into
   the existing M2/M2b/M2c prose.** §9.4 says "add a focus check on the cancel path" without
   naming a step letter, and the check applies to Archive-from-the-list, Archive-from-the-
   calendar, and Restore alike (it's about the confirm dialog's cancel path generically, not
   specific to any one of M2/M2b/M2c). Rather than triple the same paragraph into all three, or
   awkwardly pick just one to own it, I gave it its own step (M2d) placed immediately after the
   three it's a corollary of, and cross-referenced §9.4 in its text the same way M2/M2b/M2c now
   do. This is an interpretation of "add," not a deviation from what §9.4 asks the check to
   *verify* — the content (activeElement must be the triggering button, container-focus and
   `<body>` both fail) is transcribed as specified.

6. **`docs/backlog.md` was already modified (uncommitted) at the start of this pass** — two NEW
   entries dated 2026-09-21 (the Duplicate-attachments split named in plan §9.3, and a
   "~10 test files carry inline D1 schema" observation), left over from the §§1–8 Coder pass and
   never committed. This predates my work, is out of §9's scope, and I left it untouched.

## Out-of-scope observations

None newly found in this pass beyond the pre-existing `docs/backlog.md` dirty state noted above
(which was already flagged as a backlog candidate by the prior pass, not something I am newly
reporting).
