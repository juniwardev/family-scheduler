# Impl notes: `calendar-roving-tabindex` (v4, APPROVE)

Plan: `docs/plans/calendar-roving-tabindex.md`
Review: `docs/reviews/calendar-roving-tabindex-review.md` (verdict `APPROVE`)
Base commit: `a3aa8e7` (main, clean tree at start)

## Files changed

- `web/src/lib/calendarFocus.ts` (new) — pure geometry module: `DayFocusables`, `nextFocusId`,
  `resolveRovingId`. No React, no DOM. Implements Decision 2's navigation table with `day ± 7`
  scans for the vertical axis and `day ± 1` scans for the horizontal axis, both by day-number
  lookup (`Array.find`) rather than index arithmetic, per §7 step 2.
- `web/src/lib/calendarFocus.test.ts` (new) — 19 pure unit tests (P1–P15 including P5b, P5c,
  P12b, P14b), matching §8.2 exactly, including the local two-day fixture for P12b and the
  shared 30-day synthetic month for everything else.
- `web/src/components/CalendarView.tsx` (modified) —
  - Step 4: precomputed `dayCells` array (built once, before `return`) replacing the inline
    `Array.from(...)` map; render now destructures from `dayCells` instead of recomputing
    `isToday`/`dayOccs`/`isExpanded`/`visibleOccs`/`toggleLabel`/`toggleText` inline.
  - Step 5 (same commit/edit set as step 4, per the plan's explicit requirement): one state cell
    (`rememberedId`), `dayFocusables`/`rovingId` derived every render, `handleGridFocus` (delegated
    `onFocus` on the `Card`) and `handleGridKeyDown` (delegated `onKeyDown` on the `Card`), plus
    `data-cal-id` + `tabIndex` on every chip and the `+N more` toggle. No `useEffect` added. No
    ARIA added (no `role`, no `aria-label` on the `Card`). The stale comment at the toggle
    (former `:202-207`) was updated to describe the `ArrowUp`-reaches-revealed-chips fix instead
    of the old "not fixed" clause.
- `web/src/components/CalendarView.test.tsx` (modified) — appended one new `describe` block
  (`CalendarView — roving tabindex (calendar-roving-tabindex plan)`) with its own `beforeEach`
  and fixture, containing `enterGrid` and C1–C15, matching §8.3. **The 15 pre-existing tests in
  this file were not touched** — verified by running the file before touching `CalendarView.tsx`
  (all 15 green) and again after (all 30 green, same 15 assertions unchanged).

**Not touched, as the plan requires:** `App.tsx`, `ItemModal.tsx`, `ItemDetails.tsx`,
`ItemListView.tsx`, `ItemEditor.tsx`, `web/src/components/ui/*`, anything under `src/` (Worker),
`migrations/`, `wrangler.toml`.

**`docs/backlog.md:159` was deliberately left open.** §7 step 9 says to close it "after QA
passes" — that is a post-QA action, not a Coder action, and this plan's own manual checks (R2 in
particular) can still invalidate the feature after a green suite. Left for whoever runs the
manual checklist.

## Commands to run the feature locally

```
npm run dev            # wrangler dev; open the app, switch to Calendar view
```

Tab to the `›` button, then Tab once more to enter the month grid (one tab stop). Arrow keys move
between chips/the `+N more` toggle; Enter/Space activate; Tab/Shift+Tab leave the grid from
anywhere inside it. See the plan's §9 manual checklist (focus ring visibility, Home/End
disclosure, VoiceOver, iOS Full Keyboard Access) — none of that is verifiable from jsdom and is
QA's job, not something I could confirm here.

## Verification output

`npm run typecheck` — clean (both `tsconfig.worker.json` and `tsconfig.web.json`), no output.

`npm run lint` — 0 errors, 2 warnings (both pre-existing: `src/worker/channels/push.ts:150`
unused eslint-disable, `web/src/components/ItemListView.tsx:74` exhaustive-deps). No new errors,
no new warnings, confirmed by running lint before writing any component code and after.

`npm test` — 34 test files, 300 tests, all passing, including:
- `web/src/lib/calendarFocus.test.ts` — 19/19
- `web/src/components/CalendarView.test.tsx` — 30/30 (15 pre-existing + 15 new: C1–C15)

`npm run build` — succeeds:
```
../dist/assets/manifest-CiWbszge.webmanifest    0.60 kB
../dist/index.html                              0.92 kB │ gzip:   0.43 kB
../dist/assets/main-DKOuuaMu.css               28.43 kB │ gzip:   6.31 kB
../dist/sw.js                                   0.91 kB │ gzip:   0.51 kB
../dist/assets/main-DS5h0_P1.js               321.53 kB │ gzip: 101.88 kB
✓ built in ~1s
```

## Sabotage verification (as required by the task)

All three sabotages were applied, tests run, failures inspected, then the file was restored
**exactly** to its pre-sabotage state (confirmed with a full green re-run of typecheck/lint/
test/build after each restoration, and a final green run at the end — see the transcript above).

### 1. C3 — froze `handleGridFocus` (never calls `setRememberedId`)

```tsx
const handleGridFocus = (e: React.FocusEvent<HTMLDivElement>) => {
  void e; // never updates rememberedId
};
```

Result: **4 failures out of 30** — `C3`, plus `C2`, `C13`, `C15`.

- `C3` fails at the `tabindex` transfer assertion (`expect(a1).toHaveAttribute("tabindex", "-1")`
  — actual `"0"`, since `rovingId` is frozen at `c-8-0`/A1 forever).
- `C2` fails exactly as the plan predicts (round-2 review §2.1/N3): Shift+Tab from F1 lands on
  A1 (the only tabbable element), not on `›`.
- `C13` and `C15` also fail. The plan's own falsification analysis (§8.4, and round-2 review
  §2.1) only walks C1/C2/C3/C11 against this exact sabotage; it doesn't explicitly say whether
  C13/C15 survive it. They don't, for a straightforward reason: `rovingId` never leaves `c-8-0`
  (A1) under a **fully** frozen handler, so any test whose second half depends on `tabIndex`
  having moved to a *different* element (C13's `e1` tabindex check, C15's toggle-focus check)
  fails too — not because those tests target this specific bug, but because "the tab stop never
  moves at all" is a strictly worse implementation than the "stale-but-sometimes-moves" ones the
  plan analyzed test-by-test. This is consistent with, not contradictory to, the plan's map: §8.4
  already labels C13's second half "confirmatory, not falsifiable" *given a working restore path*
  — a fully-frozen `rememberedId` breaks that precondition, which is exactly why it shows up here
  as a bonus failure rather than evidence the plan under-tested C13/C15's normal case.

Restored `handleGridFocus` verbatim; re-ran the file — 30/30 green.

### 2. C15 — moved `setRememberedId` into `handleGridKeyDown`, delegated `onFocus` a no-op

```tsx
const handleGridFocus = (_e: React.FocusEvent<HTMLDivElement>) => {};
const handleGridKeyDown = (e) => {
  ...
  next.focus();
  setRememberedId(nextId); // moved here from onFocus
};
```

Result: **1 failure out of 30** — `C15` only, at its load-bearing final assertion
(`expect(toggle).toHaveFocus()` after Shift+Tab — actual focus lands on A1, because clicking the
toggle with the mouse never runs through the keydown handler, so `rememberedId` never updates and
`rovingId` stays at A1). All other 29 tests, including C1–C13, pass — matching the plan's
prediction in §8.4/round-3 review §3.1 exactly ("nothing else does").

Restored both handlers verbatim; re-ran the file — 30/30 green.

### 3. C11 — removed the stale-id fallback from `resolveRovingId`

```ts
export function resolveRovingId(days, rememberedId) {
  return rememberedId ?? firstIdOverall(days); // no membership check
}
```

Result: **2 failures** — `C11` (component) and, additionally, `P15` (the pure unit test for
`resolveRovingId` itself, run in the same pass). C11 fails at
`expect(n1).toHaveFocus()` after `Tab` post-nav: with `rememberedId` still `"c-8-0"` and no
element in the new month carrying that id, `rovingId` resolves to `"c-8-0"` unconditionally, no
element in the grid has `tabIndex={0}`, and Tab from `›` skips straight to `document.body` — RTL's
diff output confirms no button in the grid has focus. P15 fails at the "remembered absent ->
first id" assertion, which is the same defect observed one layer down.

Restored `resolveRovingId` verbatim; re-ran both files — 49/49 (19 pure + 30 component) green.

## Deviations from the plan / points requiring interpretation

None that changed behavior or test coverage. Two purely mechanical notes:

1. **A pre-existing-pattern lint error, not present in the plan's literal code.** After step 4's
   `dayCells` refactor, the render loop's destructure `const dayOccs = ...` from `dayCells` (kept
   only because step 4's snippet in the plan returns `dayOccs` in the object) was unused in the
   JSX — `hasToggle` already carries what the render used to compute from `dayOccs.length > 3`.
   ESLint's `@typescript-eslint/no-unused-vars` flagged it as a new error (baseline is 0
   errors). I dropped `dayOccs` from the render-loop destructure (it stays in the `dayCells`
   object itself, since other code — none, currently — could still want it, and the plan doesn't
   forbid carrying it in the object). This is the literal reading of §7 step 4's own permission
   ("Move `isToday`, `toggleLabel` and `toggleText` into this object too, or leave them in the
   JSX — either is fine"): the same latitude applies to what the render loop destructures back
   out, and the "no new lint errors" done-condition is unambiguous, so I fixed it rather than
   flagging it as a plan defect.
2. **Fixture titles.** §8.3 refers to chips by names like `A1`, `B1`, `E1..E5`, `F1`, `N1`, `N2`
   without spelling out `item_id`s or full `makeOccurrence` signatures (those are given in prose,
   not as literal code, unlike `calendarFocus.ts`'s exported surface). I followed the existing
   `+N more` `describe` block's `makeItem`/`makeOccurrence` helpers verbatim (same shape, same
   field defaults) and invented item ids (`a1`, `b1`, `e1`..`e5`, `f1`, `n1`, `n2`) and hours
   (ascending within each day, per §8.3's explicit requirement) since the plan does not pin these
   literally. This is exactly the kind of gap the plan leaves to the Coder (contrast with
   `calendarFocus.ts`'s function signatures, which are given as literal code and were used
   verbatim).

No test needed editing. No existing test's assertions changed. No ARIA was added. No `useEffect`
was added. No `className` changed on the chip or the toggle (`C14` pins the chip's, the existing
toggle test at `:398-400`, now further down the file, still pins the toggle's — both still pass
unmodified).

## Out-of-scope observations

None found. The diff is confined to exactly the files §4 names (plus the two new files it
predicts), and `docs/backlog.md:159` was left open per §7 step 9's explicit "after QA passes"
gating.

## What I did NOT do (left for QA / the owner, per the plan)

- §9's manual checklist (8 items) — focus-ring visibility (R2, the single item that "can
  invalidate the whole feature while the suite is green"), Home/End page-jump disclosure, iPhone
  regression sweep, VoiceOver best-effort, iOS Full Keyboard Access best-effort. None of this is
  observable from jsdom; the plan is explicit that a green suite alone is not a done condition.
- Closing `docs/backlog.md:159` — explicitly a post-QA step (§7 step 9).

## State of the working tree

Left dirty, as instructed. `git status --short`:

```
 M web/src/components/CalendarView.test.tsx
 M web/src/components/CalendarView.tsx
?? web/src/lib/calendarFocus.test.ts
?? web/src/lib/calendarFocus.ts
```

No commit was made.
