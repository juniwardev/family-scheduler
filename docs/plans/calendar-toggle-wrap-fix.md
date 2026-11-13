# Plan: `+N more` toggle wraps to two lines at mobile width

Slug: `calendar-toggle-wrap-fix`
Type: frontend-only, three Tailwind classes on one element. No Worker, no API, no schema.
Source: `docs/backlog.md` — the dated NEW entry filed by the e2e bootstrap (PR #22) when
`e2e/calendar-density.spec.ts` failed on its first run against unmodified `main`.
Written directly by the orchestrating session (fully-specified; see the standing plan-edit
authorization). Deliberately short — the fix is three classes and the acceptance test already
exists and already fails.

**v2 (2026-09-19)** — four fold-ins from `docs/reviews/calendar-toggle-wrap-fix-review.md`. The substantive one: the e2e acceptance criterion cannot distinguish this fix from a `whitespace-nowrap`-only one, so test 9's literal is a load-bearing guard, not a chore.

## 1. Problem

`CalendarView.tsx:270` (the `+N more` toggle) omits the wrap-prevention its sibling chip carries
at `:250`:

```
:250  chip    … block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-sm …
:270  toggle  … block w-full                                            rounded-sm …
```

At the 390px mobile viewport the day cell gives the toggle roughly 34px of content box
(390 − `main`'s `p-4` − 6×1px grid gaps, ÷7 columns, − the cell's `p-1` − the toggle's `px-1`).
`+2 more` at `text-[10px]` does not fit, so it wraps to two lines and grows the row. Measured:
`box.height=30.0px` against a `line-height` of `15px`.

**This is live in production** (version `72f7c698`) and visible on the owner's iPhone.

### Why it took this long to find

It came from `calendar-show-more`'s Decision 4, which specified the toggle's `className` as a
verbatim literal — and the literal was written by reading the chip's classes for the *focus* and
*layout* properties while silently dropping the three wrap-prevention ones. That plan went through
seven review rounds; a QA browser pass and the owner checked it on two devices. Every one of those
measured at desktop width, where it genuinely does fit on one line.

The 390px case had never been measured until `e2e/calendar-density.spec.ts` existed. Its risk R8
predicted this exact failure before the spec was written.

## 2. Non-goals

- **No change to the test.** `e2e/calendar-density.spec.ts`'s mobile case already asserts the right
  thing and already fails; it goes green when the app is fixed. Touching it would be the exact
  "weaken the assertion carrying the value" move the e2e plan's R8 warns against.
- No change to the visible string (`+2 more` stays; no shortened mobile variant).
- No change to the accessible name, `aria-expanded`, `type`, or the click handler.
- No change to day-cell width, grid columns, or `CalendarView`'s layout.
- No change to the chip at `:250` — it is already correct and is the reference.

## 3. Decision — match the sibling, do not invent a mobile variant

Add exactly `overflow-hidden text-ellipsis whitespace-nowrap` to the toggle, in the same position
the chip carries them (immediately after `block w-full`).

Two alternatives considered and rejected:

- **A shorter mobile string** (`+2` below `md:`). Rejected — but **not** for the WCAG reason an
  earlier draft of this plan gave. That draft claimed the accessible name would have to branch on
  viewport; it would not. The name is already `+2 more items — <Month> 15`
  (`calendar-show-more.md:135-137`) and `+2` is a literal prefix of it, so 2.5.3 holds unchanged.
  The real costs are a second visible span to maintain and a break in
  `CalendarView.test.tsx:417`. Still more surface than the defect warrants, so the rejection
  stands on those grounds.
- **A wider mobile day cell.** Rejected: changes the month grid's geometry for every cell to fix one
  string, and `calendar-roving-tabindex`'s `day ± 7` arithmetic depends on the grid staying exactly
  7 equal columns.

`whitespace-nowrap` alone would stop the wrap but let the text overflow the cell;
`overflow-hidden` + `text-ellipsis` are what turn the overflow into a truncation. All three are
needed, which is why the chip has all three.

## 4. Implementation

One edit in `web/src/components/CalendarView.tsx:270`:

```diff
-className="mb-0.5 block w-full rounded-sm px-1 text-left text-[10px] …"
+className="mb-0.5 block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-sm px-1 text-left text-[10px] …"
```

Nothing else changes.

## 5. Tests

**No new test.** The acceptance criterion already exists and already fails:

```
[chromium] › e2e/calendar-density.spec.ts:135 › mobile (390x844) ›
  collapsed and expanded day cell stay contained, un-wrapped, and ellipsized
```

Baseline confirmed on `main` at `cde66c3`: `1 failed, 5 passed`.

**But one existing unit test must be updated, and this is the one thing to get right.**
`CalendarView.test.tsx`'s test 9 asserts the toggle's **complete** class string with `toBe`
(added in `calendar-show-more` v6 precisely so a subset could not pass). Adding three classes will
fail it. That failure is **correct and expected** — update the literal to the new complete string.

This is the one permitted test edit, and it is a *literal update*, not a weakening: the assertion
stays `toBe` against the whole string. Do not relax it to `toContain`.

**And it is not bookkeeping — it is the only guard for two of the three classes.** Apply
`calendar-show-more` §5.2's question to the e2e acceptance criterion and it fails:

- `assertNoUnintendedWrap` (`e2e/calendar-density.spec.ts:27-49`) measures **box height only**.
- `assertChipsEllipsized` (`:51-65`) is scoped to `[data-cal-id^="c-12-"]` and never inspects the
  toggle.
- Beat 1's containment loop is chips-only, and would pass regardless because `w-full` keeps the
  toggle's *box* inside the cell while its *text* spills over the neighbour.

So **a `whitespace-nowrap`-only fix passes the entire e2e suite** while painting text across the
adjacent day cell. The Card's `overflow-hidden` (`CalendarView.tsx:200`) clips only at the grid's
outer edge, so an interior column gets no protection from it.

Test 9's `toBe` against the complete literal is therefore the **only** thing in the repo pinning
`overflow-hidden` and `text-ellipsis`. Relaxing it to `toContain` — or updating it by adding just
the classes that happen to be needed — would leave two-thirds of this fix unguarded.

## 6. Done conditions

- `npm run typecheck` clean; `npm run lint` at the 0-errors/2-known-warnings baseline.
- `npm test` green, with `CalendarView.test.tsx` test 9's literal updated and still `toBe`.
- `npm run build` succeeds.
- **`npm run test:e2e` goes 6 passed / 0 failed** — this is the acceptance criterion.
- Verify the fix is load-bearing: revert the three classes, confirm the mobile e2e case fails again,
  restore. (Trivially true here since the test failed first, but the transition should be observed
  in both directions rather than assumed.)
- **A 390px visual confirmation**, recorded rather than assumed: open the app at 390px wide, and
  write down what the toggle actually reads in both the collapsed and expanded states (e.g.
  `+2 more` in full, or `+2 mo…`). The e2e case bounds height and proves the wrap is gone; it says
  nothing about legibility. If the collapsed state truncates so hard the count is lost, that is a
  finding for R1, not something to discover later on a phone.
- `docs/backlog.md:163`'s NEW entry marked **✅ RESOLVED**, and its "no test change needed" clause
  corrected — that clause is true of the e2e spec and false of `CalendarView.test.tsx` test 9.
- Application diff confined to `CalendarView.tsx:270` and test 9's literal.

## 7. Risks

- **R1 — truncation instead of wrapping is a visual compromise, but a mild one.** At 390px `+2 more` may render ellipsized rather than complete. LTR ellipsis clips the **tail**, so `+2` — the only information the control actually carries — survives; and CSS truncation does not touch the accessibility tree, so the full `+2 more items — <Month> 15` is still announced. That is strictly better than wrapping (which grew the row
  and misaligned the week), and it is what the sibling chips already do with their titles. If the
  ellipsis proves ugly in QA, the answer is a follow-up on day-cell density, **not** reverting to a
  wrap.
- **R2 — test 9's literal is easy to update wrongly**, e.g. by pasting the class list in a different
  order. Tailwind does not care about order but `toBe` does. Copy the final `className` verbatim
  from the component.
