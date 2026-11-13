# Impl notes: `calendar-follow-saved-item` (APPROVE after 3 rounds)

Plan: `docs/plans/calendar-follow-saved-item.md`
Review: `docs/reviews/calendar-follow-saved-item-review.md` (3 rounds, verdict `APPROVE`)
Base commit: `22f7d44` (main, clean tree at start — "docs(plan): calendar follows a
rescheduled item, APPROVE after 3 rounds")

This is a real bug fix (~2 lines of application code) with an extensive test spec. Followed
the plan's §3 (implementation) and §5 (tests) verbatim; both directions of falsification (bug
reproduction, guard sabotage) were demonstrated per §5.3/§7 and are reproduced below.

## Files changed

### Modified

- `web/src/components/CalendarView.tsx` — the ONLY application-code change, confined to the
  `onSaved` prop as the plan required (§3, §7's last-but-one done condition). `onSaved` now
  takes the `saved: Item` parameter it previously ignored and navigates
  `setCurrentMonth(startOfMonth(new Date(saved.start_at)))` before closing the modal and
  bumping `reloadToken`, guarded by `if (!saved.rrule)` exactly as plan §3 specifies verbatim.
  Nothing else in the file changed.

- `web/src/components/CalendarView.test.tsx` — two changes:
  1. The module-level `vi.mock("../apiClient", ...)` factory (`:14-24`) gained
     `updateItem: vi.fn()` and `replaceReminders: vi.fn()`, alongside the existing
     `getOccurrences`/`listAttachments` overrides. **This is required, not optional** — see
     "Where the plan needed a call" below; without it, `vi.mocked(apiClient.updateItem)` in the
     new describe's tests would be calling a real (non-mock) function, and `.mockImplementation`
     would throw at runtime. The shared `beforeEach` at `:78-87` (now shifted down 6 lines by the
     factory addition) was **not** touched, so the 30 pre-existing tests' fixture is unchanged.
  2. A new `describe("CalendarView — follows a saved item onto its new month …")` block appended
     at the end of the file, with its own `beforeEach` seeding a stateful, window-aware `rows`
     array (plan §5.1(b)) and five tests (N1-N5, plan §5.3).

### New

- `docs/plans/calendar-follow-saved-item-impl-notes.md` — this file.

- `docs/backlog.md` — the "Calendar does not follow a rescheduled non-recurring item…" entry
  (was line 170, `**NEW**`) marked `✅ RESOLVED (2026-09-19)`, per plan §7's last done condition.
  Original entry text retained for history, following the file's own convention (see the
  `push-enable-persistence` and `calendar-toggle-wrap` entries a few lines above it for the same
  pattern).

## Commands to run the feature locally

```
npm run dev
```
Open the app, switch to Calendar view, click a chip, click Edit, change the Start date into
another month, click Save. The grid should follow the item into the new month (no manual
navigation needed to find it). Editing a **recurring** item's date should leave the grid on the
month you were viewing (guarded — see plan §3's rationale).

To run just the new/changed tests:
```
npm test -- CalendarView
```

## Verification output (all commands run from repo root)

### `npm run typecheck` — clean

```
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.e2e.json
```
No output, exit 0.

### `npm run lint` — 0 errors, 2 warnings (unchanged baseline)

```
src/worker/channels/push.ts
  150:3  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-explicit-any')
web/src/components/ItemListView.tsx
  74:6  warning  React Hook useEffect has a missing dependency: 'onItemsChange' (...)

✖ 2 problems (0 errors, 2 warnings)
```
Same two pre-existing warnings named in `docs/backlog.md`'s "Lint follow-ups" entry; nothing new
introduced by this branch.

### `npm test -- CalendarView` — 35/35 (30 pre-existing unmodified + 5 new)

```
 ✓ |web| web/src/components/CalendarView.test.tsx (35 tests) 867ms

 Test Files  1 passed (1)
      Tests  35 passed (35)
```

### `npm test` (full suite) — 312/312 across 35 files

```
 Test Files  35 passed (35)
      Tests  312 passed (312)
```
(35 files, unchanged from before this branch — `CalendarView.test.tsx` grew from 30 to 35 tests,
no other file's test count changed.)

### `npm run build` — succeeds

```
../dist/assets/manifest-CiWbszge.webmanifest    0.60 kB
../dist/index.html                              0.92 kB │ gzip:   0.43 kB
../dist/assets/main-DKOuuaMu.css               28.43 kB │ gzip:   6.31 kB
../dist/sw.js                                   0.91 kB │ gzip:   0.51 kB
../dist/assets/main-Q_9C7O3m.js               321.61 kB │ gzip: 101.89 kB
✓ built in 853ms
```

### `npm run test:e2e` — mandatory (this branch touches `web/src/**`) — **6 passed**

```
Running 6 tests using 1 worker

  ✓ 1 [chromium] › e2e/boot.spec.ts:39:7 › boot (E3) › beat 1: the built bundle boots to the primary nav (a smoke check, not coverage) (415ms)
  ✓ 2 [chromium] › e2e/boot.spec.ts:56:7 › boot (E3) › beat 2: sw.js is served at the root, and is actually the service worker (208ms)
  ✓ 3 [chromium] › e2e/calendar-density.spec.ts:118:9 › calendar density / wrapping (E2) › desktop (1280x800) › collapsed and expanded day cell stay contained, un-wrapped, and ellipsized (403ms)
  ✓ 4 [chromium] › e2e/calendar-density.spec.ts:140:9 › calendar density / wrapping (E2) › mobile (390x844) › collapsed and expanded day cell stay contained, un-wrapped, and ellipsized (283ms)
  ✓ 5 [chromium] › e2e/calendar-keyboard.spec.ts:41:7 › calendar keyboard navigation, focus rings, and activation (E1) › roving tabindex, :focus-visible under programmatic focus, ring rendering, and real Enter/Space activation (677ms)
  ✓ 6 [chromium-dark] › e2e/calendar-keyboard.spec.ts:41:7 › calendar keyboard navigation, focus rings, and activation (E1) › roving tabindex, :focus-visible under programmatic focus, ring rendering, and real Enter/Space activation (702ms)

  6 passed (5.3s)
```
Consistent with the plan's own claim (§?, review's verified finding) that no e2e spec performs a
save, so this branch's application change is exercised only by the new jsdom tests, not by e2e.

## Reproduction — N1 red before the fix, green after (plan §5.3/§7 requirement)

`git stash push -- web/src/components/CalendarView.tsx` reverted **only** the application file to
its pre-fix state (test file changes stayed staged in the working tree), then re-ran the new
describe block:

```
 ❯ |web| web/src/components/CalendarView.test.tsx (35 tests | 1 failed) 883ms
   × CalendarView — follows a saved item onto its new month (calendar-follow-saved-item plan) > N1: a moved non-recurring item is followed onto its new month
     → expected 'September 2026' not to be 'September 2026' // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 34 passed (35)
```
N1 is RED against unmodified `CalendarView.tsx` (heading never changed — no navigation
happened), and the other 34 tests (including N2-N5) are unaffected. `git stash pop` restored the
fix exactly (`git diff` afterward matched the pre-stash diff byte-for-byte), and:

```
 ✓ |web| web/src/components/CalendarView.test.tsx (35 tests) 880ms

 Test Files  1 passed (1)
      Tests  35 passed (35)
```
N1 is GREEN after the fix. Reproduction demonstrated in both directions.

## Guard sabotage — N4 red, others unaffected (plan §5.3/§7 requirement)

Temporarily removed the `if (!saved.rrule)` guard, leaving the unconditional
`setCurrentMonth(startOfMonth(new Date(saved.start_at)))`:

```diff
-          if (!saved.rrule) {
-            setCurrentMonth(startOfMonth(new Date(saved.start_at)));
-          }
+          setCurrentMonth(startOfMonth(new Date(saved.start_at)));
```

Result:

```
 ❯ |web| web/src/components/CalendarView.test.tsx (35 tests | 1 failed) 896ms
   × CalendarView — follows a saved item onto its new month (calendar-follow-saved-item plan) > N4: a recurring item's save does not navigate — the rrule guard
     → expected 'August 2026' to be 'September 2026' // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 34 passed (35)
```
N4 goes RED exactly as predicted (the unguarded save yanks the grid to `RECURRING_ITEM`'s series
seed month — August — one month before the September occurrence the test opened), and N1/N2/N3/N5
stay green. Restored the guard verbatim afterward; `git diff web/src/components/CalendarView.tsx`
confirmed the restored file is byte-identical to the intended fix, and the full `CalendarView`
suite re-ran green (35/35) — reproduced above under "Verification output."

## Deviations from the plan / points requiring interpretation

1. **The plan's §5.1 sketch says "mock both [`updateItem`, `replaceReminders`] in the new
   describe's `beforeEach`" but does not spell out that the module-level `vi.mock` factory
   (`:14-21` in the plan's line numbering) must ALSO be extended to declare them as `vi.fn()`.**
   Without that, `vi.mocked(apiClient.updateItem)` at runtime is just the real (`...actual`)
   function, and `.mockImplementation(...)`/`.mockResolvedValue(...)` throws immediately (real
   functions have no such method). This is exactly the shape the review's B2/R2-3 findings
   describe and mark "Closed" against — I read those findings as confirming the factory change
   is expected, not merely the `beforeEach` configuration, and implemented it that way (mirroring
   the identical pattern already used in `ItemEditor.test.tsx:26-32`). I did **not** touch the
   shared `beforeEach` at the original `:78-82` (now `:84-87` after the factory grew two lines),
   consistent with the plan's explicit prohibition.
2. **The exact test bodies (N1-N5) are my construction, not lifted from the plan**, since §5 gives
   a design (stateful fixture shape, mock return shapes, the settle-signal/no-literal-month rules,
   and a table of what each test must catch) rather than literal test code. I built:
   - A non-recurring `MOVEABLE_ITEM` fixture (day 10 of the current month) for N1/N2/N3, kept
     separate from the file's existing `RECURRING_ITEM`/`OCCURRENCE` (module scope) which I reused
     as-is for N4/N5 — this means N4/N5 exercise the identical R9 fixture the file's very first
     describe block already relies on, rather than a duplicate.
   - A shared `openEditor(user, title)` / `save(user, dialog)` helper pair per plan §5.1's note
     that the mocked `updateItem` return, not the form input, is what varies `start_at`/`rrule`
     across tests — so no test types into the `datetime-local` input; each just clicks through
     Edit → Save with a per-test `mockImplementation` on `updateItem` supplying the "saved" shape
     under test.
   - N1 asserts both the plan-mandated capture-and-compare heading idiom (§5.2, no literal month
     name) AND an exact `expectedLabel` built from the same `toLocaleString("default", {month:
     "long", year: "numeric"})` expression the component uses (`CalendarView.tsx:184`) — stronger
     than the plan's minimum bar (which only requires "changed"), added because "moved to *a*
     different month" is weaker than "moved to the *correct* month" and costs nothing extra.
3. **No other deviations.** The application diff is exactly the plan's §3 verbatim block; the
   fixture is stateful and window-aware per §5.1(b) with new-object construction (never mutating
   `rows` entries in place, per the plan's explicit warning); the settle-signal citation used is
   `CalendarView.tsx:190` (`Loading…`), matching the plan's corrected citation, not the stale `:103`
   the plan's own round-2 review caught and fixed.

## What the plan got wrong, or where it needed a call

- Nothing substantive. The plan went through 3 review rounds specifically to close the gaps a
  Coder would otherwise have had to improvise around (the stateful-fixture requirement, the
  correct mock return shapes, the N5-must-be-on-the-recurring-save correction, the no-literal-month
  rule). The one place I had to make a call — extending the `vi.mock` factory, not just the
  `beforeEach` — is described above under "Deviations" rather than here, because it is implied by
  the review's own closed findings (B2/R2-3) even though the plan's prose (written for a coder to
  follow, distilled from the review) states it slightly less explicitly than the review discussion
  that produced it.

## Out-of-scope observations

- None found. No pre-existing bug was encountered while implementing this change.

## Manual browser check (plan §7, not performed by the Coder)

The plan's §7 done conditions include "A manual browser check… move an item to another month from
the calendar, save, and confirm the grid follows… Then do the same on a recurring item and confirm
the grid does not jump. jsdom cannot judge either." Per this project's role boundaries (the Coder
does not start a dev server; live verification belongs to QA) and `CLAUDE.md`'s dev-auth-shim
setup (`.dev.vars`'s `DEV_AUTH_IDENTITY="owner"` is already present, no additional setup needed),
this check is left for QA to perform against `npm run dev`, using the same steps as the plan's
bug description and §7. Everything a jsdom/e2e run **can** verify (typecheck, lint, unit tests
including reproduction and sabotage, build, e2e) is done and green above.

## State of the working tree

Left dirty, as instructed. `git status --short`:

```
 M docs/backlog.md
 M web/src/components/CalendarView.test.tsx
 M web/src/components/CalendarView.tsx
?? docs/plans/calendar-follow-saved-item-impl-notes.md
```

`git diff --stat` shows the application change confined to `CalendarView.tsx`'s `onSaved` prop (9
lines), the test file growing by 219 lines (all additive — the new describe block plus the two-line
mock-factory extension), and one line changed in `docs/backlog.md`. No commit was made.
