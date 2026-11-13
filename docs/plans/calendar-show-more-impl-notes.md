# Implementation notes: `calendar-show-more`

Coder implementation of `docs/plans/calendar-show-more.md`. Base commit at start of this task:
`a3aa8e7` (clean tree, `main`). No feature branch was created — work happened directly on `main`
per the orchestrator's instruction, and is left uncommitted in the working tree per instruction.

Implemented in four passes, each after pass 1 triggered by the coordinator's own independent
re-verification finding a real gap in the previous pass's test coverage:
- **Pass 1**, against plan v4 (verdict `APPROVE`, round 4, in
  `docs/reviews/calendar-show-more-review.md`): §4's five steps against
  `web/src/components/CalendarView.tsx`, then §5's nine tests against
  `web/src/components/CalendarView.test.tsx`, running `npm run typecheck` and `npm run lint`
  after each meaningful edit.
- **Pass 2**, after the coordinator's own re-verification found a real defect in pass 1's output
  and updated the plan to v5 (§4 step 3 and Decision 3 now name `toggleText` explicitly, and a
  new test 10 asserts it): the `toggleLabel`/`toggleText` split and test 10, per the
  coordinator's explicit instructions.
- **Pass 3**, after the coordinator's round-5 review found test 9 asserted only a subset of
  Decision 4's `className` string and updated the plan to v6: rewrote test 9 to assert the whole
  literal. Test-file-only change; `CalendarView.tsx` was not touched in this pass.
- **Pass 4**, after the coordinator's round-6 review found test 2 asserted computed role rather
  than element type and updated the plan to v7: rewrote test 2 to assert `tagName` and the
  `type` attribute alongside `aria-expanded`. Test-file-only change; `CalendarView.tsx` was not
  touched in this pass either.

See §7 below for all three defects, why the suite from the preceding pass missed each one, and
how each fix was verified as load-bearing.

## 1. Files changed

- `web/src/components/CalendarView.tsx` — added `expandedDays: Set<string>` state (Decision 1),
  the copy-on-write `toggleDay` helper (step 2), the per-day `dayKey`/`isExpanded`/`visibleOccs`/
  `hiddenCount`/`toggleLabel`/`toggleText` derivations inside the day-cell map (step 3), changed
  the chip map from `dayOccs.slice(0, 3).map(...)` to `visibleOccs.map(...)` (step 4), and
  replaced the inert `<div>+{n} more</div>` with a real `<button type="button"
  aria-expanded={isExpanded} aria-label={toggleLabel} onClick={() => toggleDay(dayKey)}>` whose
  visible children are `{toggleText}`, carrying the Decision 4 `className` string verbatim
  (step 5). The `aria-label`/text-content split was added in pass 2; the test file was
  tightened further in passes 3 and 4 without further changes to this component — see §7.
- `web/src/components/CalendarView.test.tsx` — added one new `describe("CalendarView — +N more
  expand/collapse", ...)` block with its own `beforeEach` (does not touch the file-level
  `beforeEach` at `:78-82`), a fixture covering four days across two months (current-month day 15
  with 5 occurrences, day 5 with 4, day 20 with exactly 3; next-month day 15 with 5), and the ten
  tests required by §5.3 (nine in pass 1, test 10 added in pass 2, test 9 rewritten in pass 3,
  test 2 rewritten in pass 4 — see §7). Added `waitFor` to
  the existing `@testing-library/react` import.
- `docs/backlog.md` — converted the "Calendar '+N more' becomes a functional dead end" entry
  (line 122) to the `✅ RESOLVED (2026-08-22)` form used by every other shipped item in that file,
  per §6's explicit `docs/**` carve-out.

No other file was touched. `git status --porcelain` at the end of this task shows exactly these
three files modified, nothing else.

## 2. Commands to run the feature locally

```
npm install
npm run dev            # wrangler dev, serves Worker + PWA
```

Then in the app: switch to Calendar view, find (or create, via a new event/task) a day with 4+
items, and click the "+N more items — <Month> <day>" button under the three visible chips. It
expands in place to show all of them and the button relabels to "Show less — <Month> <day>";
clicking it again collapses back to 3. Expansion is per-day (expanding one busy day does not
affect another) and survives month navigation only insofar as the *same* day-of-month in the
*same* month stays expanded — paging away and back within the session preserves it; a different
month's same day number starts collapsed.

To run just this file's tests: `npx vitest run web/src/components/CalendarView.test.tsx
--project web`.

## 3. Points where the plan required interpretation

The plan is close to fully literal; the two places judgment was needed were both flagged as
non-blocking by the round-4 review itself:

1. **The `onClick` wiring (round-4 review's own "non-blocking observation").** §4 step 2 defines
   `toggleDay`, step 3 defines `dayKey`, and step 5 only says "the button per Decisions 2-5" — the
   literal `onClick={() => toggleDay(dayKey)}` line is never spelled out. Wrote it the only way
   that makes sense given the two pieces the plan does give literally. Self-catching: tests 3 and
   4 would fail immediately if this were wrong or missing.
2. **Test numbering/naming inside §5.3.** The plan numbers its nine required tests in prose (1-9)
   but does not give literal `it(...)` titles. Chose titles that restate each test's numbered
   description from §5.3 verbatim-ish (e.g. "1. collapsed by default: shows the first 3, not the
   4th or 5th") so the mapping from plan requirement to test is unambiguous on sight, matching the
   convention of the plan's own R1/R4/R5 cross-references pointing at "tests 8/9/6".

Everything else — the `Set<string>` key format, the copy-on-write toggle body, the singular/plural
label branch, the exact `className` string (Decision 4), the query rules in §5.2 (assert by title,
never a literal month name, grab the toggle handle once while collapsed and reuse it across the
flip, await the `Loading…` settle signal rather than a chip after `›`), and the fixture's four rows
across two months — were taken literally from the plan text with no departure.

## 4. Anything the plan got wrong

**Update after pass 2: the plan (v1-v4) did get one thing wrong, and it survived four review
rounds — see §7.** Decision 3 gave a single `toggleLabel` string and said it was "the accessible
name," but never said explicitly, ahead of pass 2's v5 correction, that a *second*, shorter string
had to be the visible text. Read literally, v4's §4 step 3 defines only `toggleLabel` and step 5
says "the button per Decisions 2-5" with no second string named anywhere — the natural (if
wrong) reading is that `toggleLabel` is both the `aria-label` and the children. None of the nine
v4 tests catch this because an element's accessible name falls back to its text content when
there is no explicit `aria-label`, so `getByRole("button", { name: /.../ })` resolves identically
either way. This was not something I invented after the fact to excuse a mistake — it is the
literal defect the coordinator found by re-running the suite against the rendered output and
looking at what a user would actually see, not just at whether queries resolved. Full account in
§7.

Independent of that: this is the fourth review round of a plan that the review file itself
describes as "in materially better shape than most that reach implementation in this repo" —
every literal string, query, and regex in v4 (other than the one gap above) matched the actual
component and test harness on first implementation, with no compile error, no test failure, and
no need to deviate. The one place earlier drafts of the plan were wrong (test 8's await
instruction, per rounds 1-3 of the review) was already fixed by v4 before this task started;
§5.3 test 8 as written in v4 is internally consistent with §5.2 and needed no correction.

One thing worth flagging for the next reader rather than as a plan defect: the plan's fixture
table (§5.1) specifies occurrence counts per day but not concrete titles/ids/timestamps. I chose
`D{day}-{n}` ids, `D{day} Item {n}` / `N{day} Item {n}` titles (D = current month, N = next month),
and ascending same-day hour-of-day timestamps (1, 2, 3, ... ) so "Item 1..3" are deterministically
the visible three per the plan's own "order the timestamps ascending" instruction. This is a
concrete instantiation of an under-specified-by-design table, not a deviation.

## 5. Verification (final state, after all four passes)

`npm run typecheck`:
```
> family-scheduler-pwa@0.1.0 typecheck
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json
```
(no output — clean, both projects)

`npm run lint`:
```
> family-scheduler-pwa@0.1.0 lint
> eslint src web/src

/Users/juniorwarner/Projects/React/family-scheduler-pwa/src/worker/channels/push.ts
  150:3  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-explicit-any')

/Users/juniorwarner/Projects/React/family-scheduler-pwa/web/src/components/ItemListView.tsx
  74:6  warning  React Hook useEffect has a missing dependency: 'onItemsChange'. Either include it or remove the dependency array. If 'onItemsChange' changes too often, find the parent component that defines it and wrap that definition in useCallback  react-hooks/exhaustive-deps

✖ 2 problems (0 errors, 2 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```
Both warnings are the pre-existing baseline (per `docs/backlog.md` and prior impl-notes files);
no new warning was introduced and no new hook was added, so no `exhaustive-deps` surface was
created.

`npm test` (full suite, tail):
```
 ✓ |web| web/src/components/CalendarView.test.tsx  (15 tests) 1032ms
...
 Test Files  33 passed (33)
      Tests  266 passed (266)
```
`CalendarView.test.tsx` went from 5 tests (all pre-existing, unmodified) to 15 (5 + the 10 tests
required by v7's §5.3: nine from pass 1, test 10 added in pass 2, test 9 rewritten in pass 3,
and test 2 rewritten in pass 4 (neither pass 3 nor pass 4 added a new test — both tightened an
existing one). All four pre-existing tests, including the month-nav test at `:145-156`, pass
unmodified.

`npm run build`:
```
> family-scheduler-pwa@0.1.0 build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 1888 modules transformed.
rendering chunks...
computing gzip size...
../dist/assets/manifest-CiWbszge.webmanifest    0.60 kB
../dist/index.html                              0.92 kB │ gzip:   0.43 kB
../dist/assets/main-Di6Omc3Q.css               28.74 kB │ gzip:   6.33 kB
../dist/sw.js                                   0.91 kB │ gzip:   0.51 kB
../dist/assets/main-Cv-j_CL5.js               319.71 kB │ gzip: 101.18 kB
✓ built in 938ms
```

All four commands pass. Application-code diff is confined to `CalendarView.tsx` and
`CalendarView.test.tsx`, with `docs/backlog.md` as the explicitly carved-out bookkeeping change.

## 6. Out-of-scope observations

None found. No pre-existing bug was encountered in the touched code beyond what the plan already
named and budgeted for (Decision 5's accepted post-expand keyboard-focus cost, Decision 6's
accepted week-row growth, Decision 1's accepted dormant-flag-after-`reloadToken` behavior).

## 7. Defects found during coordinator re-verification, and the fixes (passes 2, 3, and 4)

### Pass 2 — accessible name rendered as visible text

**The defect.** Pass 1's `CalendarView.tsx` rendered `{toggleLabel}` — the full accessible-name
string, e.g. `+2 more items — August 15` — as the toggle button's *visible text content*, with
no `aria-label` at all. Decision 3 intends `toggleLabel` to be the accessible name only; the
visible text was meant to be the terse `+2 more` / `Show less`. As built, the day cell visibly
rendered the month name and day number at `text-[10px]` inside a cell one-seventh of the grid
wide, where it wraps to roughly three lines — a real, user-visible defect, not a cosmetic nit.

**Why the nine-test suite from pass 1 missed it, verified directly rather than taken on faith.**
An element's accessible name falls back to its text content when there is no explicit
`aria-label` (standard accname computation). So `getByRole("button", { name:
/\+\d+ more items? — .+ 15$/ })` — the query every one of pass 1's nine tests used to find the
toggle — resolved identically whether the button carried an explicit `aria-label` with terse
text content, or (the actual pass-1 bug) had no `aria-label` and the full label string as its
text content. None of the nine tests asserted what the *visible* text actually was; they only
ever asserted on the computed accessible name. I confirmed this directly rather than trusting
the report: I temporarily reverted `CalendarView.tsx` to the exact pass-1 shape (dropped the
`aria-label`, rendered `{toggleLabel}` as the children) and reran
`npx vitest run web/src/components/CalendarView.test.tsx --project web`. Result: **14 of 15
pass, only the new test 10 fails** —
```
 × CalendarView — +N more expand/collapse > 10. visible text is NOT the accessible name — both halves asserted on the same element
   → expect(element).toHaveTextContent()
 Expected element to have text content: /^\+2 more$/
 Received: +2 more items — August 15
```
— then restored the fix and reran the full suite (§5 above shows the green result). This is the
single most direct confirmation available that test 10 is the one that closes the gap.

**The fix**, exactly as the coordinator specified in the updated plan (v5, Decision 3 / §4 step
3 / §5.3 test 10):
1. Added `const toggleText = isExpanded ? "Show less" : `+${hiddenCount} more`;` alongside the
   existing `toggleLabel` derivation.
2. The toggle button now carries `aria-label={toggleLabel}` and renders `{toggleText}` as its
   children; `type`, `aria-expanded`, `onClick`, and the Decision-4 `className` string are
   unchanged.
3. Added test 10 to the new `describe` block: asserts `toHaveTextContent(/^\+2 more$/)` and
   `toHaveAccessibleName(/^\+2 more items — .+ 15$/)` on the same element while collapsed, then
   expands it and asserts the same pair for `Show less` / `Show less — .+ 15$`.

WCAG 2.5.3 (Label in Name) still holds: visible `+2 more` is a literal prefix of `+2 more items —
August 15`, and `Show less` of `Show less — August 15` — unchanged from Decision 3's original
reasoning, since only the *rendering split* changed, not either string's content.

**Did not edit `docs/plans/calendar-show-more.md`** — the coordinator owns that file and explicitly
said not to. `docs/backlog.md`'s resolved-entry summary and this impl-notes file were the only
docs touched in pass 2, plus the two application files. (Passes 3 and 4 touched only the test
file, as noted in each subsection below.)

### Pass 3 — round 5: test 9 asserted a subset of Decision 4's class string, not the whole thing

**The defect (found by the coordinator, not by me).** Test 9 asserted only two of the fourteen
classes in Decision 4's verbatim `className` string:
```tsx
expect(toggle.className).toContain("ring-offset-background");
expect(toggle.className).toContain("focus-visible:ring-2");
```
An implementation carrying only those two classes — and dropping, among others, `text-[10px]` —
passes all ten tests. Under Tailwind preflight, `<button>` inherits `font-size: 100%`, so without
`text-[10px]` the toggle's `+N more` / `Show less` text renders at the inherited base size (16px),
next to chips at 11px and a day number at `text-xs`. That is a worse visual defect than the one
pass 2 fixed, and — same blind spot — invisible to every other test in the file, because
`toContain` checks a subset of a string rather than the whole claim Decision 4 makes.

**The fix**, per the plan's v6 update to §5.3 test 9 (component code untouched — verified byte-for-
byte against Decision 4's literal before making any test change):
- Renamed test 9 from "dark-mode focus ring: the toggle's className carries the offset AND the
  visible ring" to "the toggle carries Decision 4's complete class string, not just the focus
  classes" — the coordinator's instruction to rename it "to match its new claim" was correct
  wording to keep, since the test is no longer only about the focus ring.
- Replaced both `toContain` probes with a single `expect(toggle.className).toBe("<Decision 4's
  literal, verbatim>")`.

**Verified load-bearing the same way as test 10 (pass 2).** Temporarily edited `CalendarView.tsx`
to drop `text-[10px]` from the toggle's `className` (leaving all thirteen other classes, including
both focus classes, intact) and reran `npx vitest run web/src/components/CalendarView.test.tsx
--project web`. Result: **14 of 15 pass, only test 9 fails** —
```
 × CalendarView — +N more expand/collapse > 9. the toggle carries Decision 4's complete class string, not just the focus classes
AssertionError: expected 'mb-0.5 block w-full rounded-sm px-1 t…' to be 'mb-0.5 block w-full rounded-sm px-1 t…' // Object.is equality

Expected: "mb-0.5 block w-full rounded-sm px-1 text-left text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
Received: "mb-0.5 block w-full rounded-sm px-1 text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
```
— then restored the exact original `className` string and reran the full suite (§5 above shows the
final green result, 15/15 in `CalendarView.test.tsx`, 266/266 overall).

**Only the test file changed in this pass.** `CalendarView.tsx`'s toggle `className` was never
edited in the final state — it already matched Decision 4 character for character before this
pass started, and the coordinator independently confirmed that before asking for the test change.
The only touch to `CalendarView.tsx` in this pass was the temporary sabotage-and-restore used to
prove test 9 is load-bearing, described above.

### Pass 4 — round 6: test 2 asserted computed role, not element type

**The defect (found by the coordinator, not by me).** Test 2 resolved the toggle via
`getByRole("button", { name: ... })` and asserted only `aria-expanded="false"`. The plan had
described that query as "proving it is genuinely a button," but `getByRole` matches **computed**
role, which `<div role="button" tabIndex={0}>` produces identically to a real `<button>`. Such a
div renders indistinguishably, passes `userEvent.click()` (a mouse event any element handles),
and is **completely dead to the keyboard** — a div fires on neither Enter nor Space, so a
keyboard-only user could never open it. Every one of the ten tests in this describe block would
stay green while the control was unusable without a mouse — the same failure mode `chip.tagName`
already guards against for the chips at `CalendarView.test.tsx:88` (a pre-existing test, untouched
here, that exists for exactly this reason).

**The fix**, per the plan's v7 update to §5.3 test 2 (component code untouched — it already
renders a real `<button type="button">`):
- Renamed test 2 from "the control is a real button, with day context and aria-expanded=false
  initially" to "the control is a real `<button>` (not a role-mimicking div), with day context
  and aria-expanded=false initially", to name the specific thing it now rules out.
- Added `expect(toggle.tagName).toBe("BUTTON")` and
  `expect(toggle).toHaveAttribute("type", "button")` ahead of the existing
  `aria-expanded="false"` assertion, mirroring the chip guard at `:88`.

**Verified load-bearing, with the specific shape the coordinator asked for.** Temporarily changed
the component's toggle from `<button type="button" aria-expanded={isExpanded}
aria-label={toggleLabel} onClick={...} className="...">{toggleText}</button>` to `<div
role="button" tabIndex={0} aria-expanded={isExpanded} aria-label={toggleLabel} onClick={...}
className="...">{toggleText}</div>` — every other attribute and the full `className` string left
exactly as-is — and reran `npx vitest run web/src/components/CalendarView.test.tsx --project
web`. Result: **14 of 15 pass, only test 2 fails** —
```
 × CalendarView — +N more expand/collapse > 2. the control is a real <button> (not a role-mimicking div), with day context and aria-expanded=false initially
AssertionError: expected 'DIV' to be 'BUTTON' // Object.is equality

Expected: "BUTTON"
Received: "DIV"
```
**What the other nine did, as asked.** None of the other nine tests in the new `describe` block
failed against the div — all nine, including tests 3/4/6/7 (which click the toggle via
`user.click`, a mouse-simulated event that a div's `onClick` handles just as well as a button's)
and test 8 (month-nav), passed unchanged. That is the concrete confirmation of the coordinator's
claim: nothing else in the suite was implicitly resting on element type, because nothing else
asserted it — the whole ten-test suite was one assertion away from shipping a keyboard-dead
control with every test green. Restored the exact original `<button type="button" ...>` markup
afterward (verified via `git diff --stat web/src/components/CalendarView.tsx`, unchanged from
before this pass) and reran the full suite (§5 above shows the final green result).

**Only the test file changed in this pass**, same as pass 3 — `CalendarView.tsx` needed no
correction; it already rendered a real `<button type="button">` the whole time.

**The pattern across all three defects, worth stating once.** Passes 2, 3, and 4 all found the
same shape of gap: an assertion that checks a value the DOM/accessibility tree *computes* from
the real thing (accessible name, which falls back to text content when there's no `aria-label`;
computed role, which a `div` can fake; a `toContain` substring match against a fourteen-class
string) rather than asserting the real thing directly (the literal visible text; the literal
element tag/type; the whole class string). In each case the computed-property assertion passed
identically on both the correct implementation and a plausible, materially worse wrong one.
Generalizes past this plan: whenever a test's query or matcher operates on a *computed* property
(role, accessible name, `className` substring, style, etc.) rather than the underlying markup
that produces it, treat that as a signal to also assert the underlying markup directly wherever a
cheap, direct assertion exists — computed properties often have more than one way to arrive at
the same value, and one of those ways can be broken.

## 8. What QA should pay particular attention to

- **The visible toggle text, in a real browser, on a busy day (§7's fix, closed by test 10 but
  worth eyeballing).** Confirm the "+N more" / "Show less" button reads exactly that — terse,
  one line, no month name or day number printed inside the day cell. This is precisely the
  defect test 10 exists to catch and jsdom already confirms it via `toHaveTextContent`, but a
  quick look at a real busy day in the actual grid is cheap insurance given this shipped wrong
  once already.
- **R4's dark-mode focus halo (test 9's only real proof-of-mitigation)** — jsdom cannot render
  colors, so a manual check remains valuable: Tab to a "+N more" button in dark mode and confirm
  no white halo around the focus ring (the same class, `ring-offset-background`, that fixed this
  for the shared `Button` primitive during `item-view-mode` re-QA).
- **Decision 5's accepted keyboard-focus cost** — after expanding a day, the next `Tab` moves to
  the *following* day's cell, not into the just-revealed chips; a keyboard user has to
  `Shift+Tab` back in. This is accepted and documented in the code comment, not a regression to
  file.
- **Decision 6's accepted week-row growth** — expanding a busy day grows its whole week row in
  the grid; this is intentional (no overflow clipping, no scroller), and reverses on collapse.
- **Decision 1's accepted dormant-flag behavior** — if a day is expanded, then a save drops it to
  ≤3 items, then a later save brings it back above 3, it will silently re-expand without the user
  re-clicking. This is accepted per the plan and documented in the code comment; not a bug to
  file if observed.
