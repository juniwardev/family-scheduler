# Plan: Calendar "+N more" becomes an expand/collapse control

Slug: `calendar-show-more`
Type: frontend-only (`web/src/components/CalendarView.tsx` + its test file). No Worker, no
API, no schema, no deploy prerequisites.
Source: `docs/backlog.md` — "Calendar '+N more' becomes a functional dead end", deferred from
`feat/item-view-mode` as D-OQ4.
Written directly by the orchestrating session (fully-specified change; see the standing
plan-edit authorization).

**Revision history**
- v1 (2026-08-22) — initial.
- v2 (2026-08-22) — all 14 required changes from `docs/reviews/calendar-show-more-review.md`
  (round 1, APPROVE WITH CHANGES) folded in. The substantive ones were in §5: the named
  regression guard was **vacuous** against the existing mock harness (it passed on the very
  implementation it claimed to catch), and a single shared boolean passed the whole suite.
- v3 (2026-08-22) — round-2 changes folded in (5 required + nits), all inside §4 step 3 and §5.
  The substantive one: the union fixture made §5.2's post-nav `await` a no-op, so test 8 could
  assert against a mid-flight component. Now awaits the `Loading…` settle signal instead.
- v7 (2026-08-22) — round-6 sweep, one real finding: test 2's `getByRole("button")` proves
  computed role, not element type, so a `<div role="button">` — dead to Enter and Space — passed
  all ten tests. The fix (`tagName`) was already in the pre-existing chip test at
  `CalendarView.test.tsx:88`; the new spec had not copied it. §5.2's rule rewritten around the
  falsification question so it is portable, plus the complete-value and manual-check rungs. §7's
  R4 no longer claims test 9 verifies the halo.
- v6 (2026-08-22) — round-5 sweep. Test 9 asserted 2 of 14 classes, so an implementation
  missing `text-[10px]` (16px text in the day cell under Tailwind preflight) passed everything —
  the same visible-vs-derived blind spot as v5, found by applying it as a lens rather than by
  reading test 10. Test 9 now asserts Decision 4's whole string; §5.2 carries the rule as a
  standing bullet; §6 gains manual checks, because a class assertion is only a proxy for
  appearance.
- v5 (2026-08-22) — post-implementation fix. The Coder rendered `toggleLabel` as the button's
  visible text with no `aria-label`, putting `— August 15` on screen in the day cell. All nine
  tests passed anyway, because accessible name falls back to text content — the spec never
  asserted what the user sees. Decision 3 and §4 step 3 now name `toggleText` explicitly, and
  test 10 asserts the two strings differ.
- v4 (2026-08-22) — round 3's single required change: v3 fixed the await rule in §5.2 but left
  §5.3 test 8 still instructing the coder to await the next month's chips, i.e. the exact thing
  §5.2 had just overruled. Test 8 has now been wrong in three consecutive revisions, for three
  different reasons; if it is edited again, re-read §5.2 first.

## 1. Problem statement

`CalendarView.tsx:145` renders only `dayOccs.slice(0, 3)` per day cell, and
`CalendarView.tsx:163-165` renders the remainder as a plain, inert `<div>`:

```tsx
{dayOccs.length > 3 && (
  <div className="text-[10px] text-muted-foreground">+{dayOccs.length - 3} more</div>
)}
```

Before `feat/item-view-mode` this was only a display truncation — calendar chips were not
interactive, so nothing was reachable from the grid anyway. Now that chips open the shared
view-mode modal (`CalendarView.tsx:157`), the 4th-and-later item on a busy day is **the only
visible-but-unopenable item in the app**. The truncation became a functional gap.

Goal: make the hidden items reachable, at the cost the backlog budgeted, without touching
anything outside this component.

## 2. Non-goals

- **No roving `tabindex`.** That is a separate parked backlog item covering the whole month
  grid (~93 chip tab stops). This change adds at most one tab stop per busy day and must not
  attempt the larger fix. Explicitly out of scope — see also Decision 5, which is where the
  pressure to do it will actually come from.
- No change to the chip markup, its `aria-label`, its `title`, or its click handler.
- No change to the occurrence fetch/merge/sort logic, the month-nav handlers, or `ItemModal`
  wiring.
- No "show all days" global toggle, **no popover** (see Decision 6), no scrollable day cell.
- No change to the `slice(0, 3)` default. Collapsed is still the default render.

## 3. Approach

Add per-day expansion state. When a day is expanded, render `dayOccs` in full instead of
`dayOccs.slice(0, 3)`; the `+N more` control becomes a real `<button>` that toggles it.

### Decision 1 — state is a `Set` keyed by year-month-day, not by day number

```tsx
const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
const dayKey = `${year}-${month}-${day}`;   // inside the day-cell map
```

**Why not `Set<number>` of bare day numbers** (the obvious cheap version): `year` and `month`
are recomputed on every month nav (`CalendarView.tsx:63-64`) but the state would not be.
Expanding day 15 in August and paging to September would render **September 15** expanded,
because the state says "15" and nothing scopes it to a month. That is a real bug, not a
cosmetic one, and it is exactly the shape of mistake the cheap version invites.

Scoping the key to `year-month-day` makes the state immune to navigation by construction —
no reset effect, no clearing inside `prevMonth`/`nextMonth` (which would silently miss any
future path that sets `currentMonth`, e.g. a "Today" button).

**Accepted tradeoff:** expansion *persists* when you navigate away and back within a session.
Judged correct — it preserves the user's stated intent rather than discarding it. The set
grows by one entry per day the user manually expands, which is bounded by hand and negligible.

**On `reloadToken` refetches** (the post-save path, `CalendarView.tsx:178-181`): do **not**
reset expansion. Be precise about why, because the obvious justification is wrong. If a save
drops a day below 4 items, that render is identical either way (`slice(0, 3)` of a ≤3 list is
that list, and the `dayOccs.length > 3` button disappears) — but the `true` **stays in the
Set**. It is *dormant*, not inert: if that day later climbs back above 3 because another save
moves an item onto it, the day re-expands without the user asking. That is acceptable — it is
rare, self-explanatory on screen, and one click to undo — but it must be said in the code
comment, or the next person to see a spontaneously-expanded day will file it as a bug.

*Cosmetic note, deliberately not fixed:* the key format is ambiguous only under a negative
`getFullYear()` (year ≤ 0 renders `"-1-11-15"`), which requires ~2027 clicks on `‹`. Recorded
so the next reader does not re-derive it.

### Decision 2 — the control collapses as well as expands

Once expanded, the button reads **"Show less"** and collapses that day. Without this the
control is a one-way door until the user pages the month away and back, which is worse than
the dead end it replaces.

Render condition stays `dayOccs.length > 3` in both states — when expanded, that is what keeps
the "Show less" affordance on screen.

### Decision 3 — the accessible name, with the visible text as its prefix

The control's accessible name must carry the day, matching the chips' reasoning at
`CalendarView.tsx:154-156`: the day number is a **sibling** `<div>`, so a screen reader moving
through the grid otherwise hears "+2 more" with no idea which day.

It must also **begin with the visible text**. WCAG 2.5.3 (Label in Name) requires the visible
label to appear in the accessible name; a visible `+2 more` under a name of `Show 2 more
items — August 15` fails it (`"2 more"` is present, `"+2 more"` is not), and speech-input users
saying "click plus two more" get nothing. The chips are compliant because their label *starts*
with the visible title; this control follows the same pattern.

```tsx
const hiddenCount = dayOccs.length - 3;
const toggleLabel = isExpanded
  ? `Show less — ${monthLabel} ${day}`
  : `+${hiddenCount} more item${hiddenCount === 1 ? "" : "s"} — ${monthLabel} ${day}`;
```

Note the singular branch: a 4-item day is the single most common busy day, and
`+1 more items` is exactly the string a naive template produces.

**`toggleLabel` is the `aria-label`, NOT the button's text content.** These are two different
strings and the button needs both:

```tsx
const toggleText = isExpanded ? "Show less" : `+${hiddenCount} more`;
// ...
<button aria-label={toggleLabel} ...>{toggleText}</button>
```

Rendering `toggleLabel` as the visible text instead — the natural shortcut, since it makes the
accessible name come out right for free — puts `— August 15` on screen inside a day cell that is
one-seventh of the grid wide at `text-[10px]`, where it wraps to three lines. The month and day
exist in the accessible name **because** they are not visible: the day number is a sibling
`<div>` a screen reader will not associate with the control. `monthLabel` is the existing const
at `CalendarView.tsx:87`.

Also required on the element: `type="button"` (consistent with the chips at
`CalendarView.tsx:147`, and the same defensive habit that `fix-item-save` exists because of)
and `aria-expanded={isExpanded}` — the state is the whole point of the control.

**No `aria-controls`.** It would require generating and threading ids for a list that has no
wrapping element today. `aria-expanded` plus the day-scoped name carries the meaning.

### Decision 4 — the button's complete `className`, given once

The element being replaced is a block-level, full-width `<div>` (`CalendarView.tsx:164`); a
`<button>` is `inline-block` under Tailwind preflight, so the layout classes are load-bearing
and not optional. A button with no hover feedback sitting next to chips that have
`hover:bg-accent/80` also reads as *still inert*, which is the exact impression this change
exists to remove. Use this string verbatim:

```
mb-0.5 block w-full rounded-sm px-1 text-left text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background
```

`ring-offset-background` is load-bearing: without it Tailwind's default
`--tw-ring-offset-color: #fff` paints a white halo in dark mode — the exact bug fixed in
`button.tsx:8` during `item-view-mode` re-QA. The five `focus-visible:` classes are copied
from the chips (`CalendarView.tsx:158`) so the two controls focus identically.

### Decision 5 — the post-expand keyboard flow is an accepted cost

The button sits **after** the chips in DOM order (it replaces the `<div>` at
`CalendarView.tsx:163-165`). So expanding inserts chips 4..N *above* the still-focused button,
and the next `Tab` moves to the following day — a keyboard user must `Shift+Tab` backwards
into the content they just revealed.

**Accepted, with a code comment saying so.** The alternative considered was a `ref` +
`.focus()` on the first revealed chip; rejected because moving focus on a non-navigational
toggle is its own surprise, and it adds a ref plus an effect (and an `exhaustive-deps` surface)
to a change budgeted at a few lines.

**The fix for this is explicitly NOT roving `tabindex`**, in either direction. That remains the
separate parked item.

### Decision 6 — the day cell grows; `relative` is off-limits

Day cells are `min-h-[80px]` (`CalendarView.tsx:136`), not fixed height, and the grid is
`grid-cols-7`. Expanding a day grows that cell and therefore its whole week row. Accepted and
intentional: self-evident to the user who just clicked, and it reverses on collapse.

Do **not** add `overflow` clipping, a `max-h`, or an internal scroller to avoid it — that
reintroduces hidden items, which is the bug being fixed.

**Named affordance to leave alone:** that same day cell already carries `relative`
(`CalendarView.tsx:136`), which makes an absolutely-positioned popover look like a two-line
change. It is not one — it is a new interaction surface with its own dismiss, focus-trap, and
positioning concerns. Out of scope.

## 4. Implementation steps

All in `web/src/components/CalendarView.tsx`.

1. Add the state next to the existing `useState` block (`CalendarView.tsx:26-32`), with a
   comment covering both the month-scoping reason and the dormant-flag behavior from Decision 1.
   ```tsx
   const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
   ```
2. Add a pure toggle helper above the `return` — copy-on-write, braced:
   ```tsx
   const toggleDay = (key: string) => {
     setExpandedDays((prev) => {
       const next = new Set(prev);
       if (next.has(key)) {
         next.delete(key);
       } else {
         next.add(key);
       }
       return next;
     });
   };
   ```
   Never mutate the `Set` in place: `prev.add(k); return prev;` returns the same reference,
   React bails out of the re-render, and the button looks dead.
3. Inside the day-cell map (`CalendarView.tsx:128-168`), after `const dayOccs = ...`, derive:
   ```tsx
   const dayKey = `${year}-${month}-${day}`;
   const isExpanded = expandedDays.has(dayKey);
   const visibleOccs = isExpanded ? dayOccs : dayOccs.slice(0, 3);
   const hiddenCount = dayOccs.length - 3;
   const toggleLabel = isExpanded
     ? `Show less — ${monthLabel} ${day}`
     : `+${hiddenCount} more item${hiddenCount === 1 ? "" : "s"} — ${monthLabel} ${day}`;
   const toggleText = isExpanded ? "Show less" : `+${hiddenCount} more`;
   ```
   Two strings, deliberately: `toggleLabel` is the `aria-label`, `toggleText` is the visible
   content. See Decision 3 — collapsing them into one renders the date inside the day cell.
   `hiddenCount` goes negative on quiet days; that is fine, because it is only ever read
   inside the `dayOccs.length > 3 &&` branch.
4. Change the chip map from `dayOccs.slice(0, 3).map(...)` to `visibleOccs.map(...)`. Nothing
   else in the chip changes. (Chip keys are `` `${occ.item_id}-${i}` `` — indices 0-2 keep the
   same keys when the list grows, so expanding does not remount already-rendered chips.)
   **Do not** add a second `dayOccs.slice(3).map(...)` block for the revealed items; that
   restarts the index at 0, producing duplicate keys and off-by-three handler wiring.
5. Replace the inert `<div>` (`CalendarView.tsx:163-165`) with the button per Decisions 2-5.

Each step compiles on its own; no step leaves the tree red.

## 5. Tests (required — `web/src/components/CalendarView.test.tsx`)

The existing file already has the harness: `vi.mock("../apiClient")` with `getOccurrences` and
`listAttachments` mocked (`CalendarView.test.tsx:14-21`), and a `TODAY`-relative fixture.

### 5.1 Fixture requirements

Add a new `describe` with **its own `beforeEach`**, which runs after the file-level one at
`CalendarView.test.tsx:78-82` and overrides `getOccurrences` only. **Never edit the shared
`beforeEach`** — that would change the fixture for the four pre-existing tests and violate the
done condition in §6. Leave the `listAttachments` mock as the shared one sets it; test 7 needs it.

The fixture must cover **both the current month and the next month**, and must contain:

| Day | Occurrences | Purpose |
| --- | --- | --- |
| 15 (current month) | 5 | the main expand/collapse subject |
| 5 (current month) | 4 | per-day isolation (test 6) |
| 20 (current month) | exactly 3 | the off-by-one boundary (test 5) |
| 15 (next month) | 5 | the month-nav regression guard (test 8) |

Every occurrence needs a **distinct `item_id`, a distinct title, and a distinct
`occurrence_at`**. Distinct titles because tests assert on individual titles and
`findByRole({ name })` throws on multiple matches; distinct timestamps because the component
sorts merged results (`CalendarView.tsx:56`), and identical timestamps would leave
visible-vs-hidden membership resting on V8's stable sort as an implicit contract. Order the
timestamps ascending so that "Item 1..3" are the visible three.

`getOccurrences` may ignore `from`/`to` and return the union of every month's occurrences from
every call — the component filters to the rendered month itself (`CalendarView.tsx:73`). Returning
the union is deliberately preferred over a `mockImplementation` that filters by `from`/`to`: because
`occurrences` state is never cleared on nav, the union lets the next month render from already-held
state with no empty intermediate frame, whereas a filtering mock would transiently reproduce exactly
the empty-grid condition that made v1's test 8 vacuous.

**The union's arithmetic is only correct because `LISTS.length === 1`** (`CalendarView.test.tsx:32-41`).
The mock is called once per list (`CalendarView.tsx:53`) and `flatMap` does not dedupe (`:55`), so
adding a second entry to that shared const would silently double every row — day 15 becomes 10 items
and day 20 becomes 6, which stops it being the exactly-3 boundary and flips test 5 from a guard into
a false failure.

### 5.2 Query rules (these are not optional — the obvious queries are wrong)

- **Assert presence/absence by title**, e.g. `queryByRole("button", { name: /D15 Item 4/ })`.
  Do **not** count `getAllByRole("button")`: it sweeps in the two month-nav buttons, and there
  is no accessible container to scope with `within()` (the day number is a sibling `<div>`,
  `CalendarView.tsx:137-144` — which is the whole reason chips carry day context at all).
- **Never assert a literal month name.** `monthLabel` is
  `toLocaleString("default", ...)` against a `TODAY = new Date()` fixture, so `"August"` breaks
  on 1 September and in any non-English ICU environment. The existing chip test dodges this
  deliberately at `CalendarView.test.tsx:89`. To select a day's toggle button, match on the
  day suffix instead: `/\+\d+ more items? — .+ 15$/` (day 5's label ends ` 5`, so it will not
  collide).
- After clicking `›`, **await the settle signal, not a chip.** Use:
  ```tsx
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  ```
  Awaiting a `findBy*` on a chip here would be a **no-op**: with the union fixture the next month's
  chips are already present from the stale-but-sufficient `occurrences` state, so the query resolves
  on its first attempt, before the refetch settles. The
  `setLoading(true)` → `setOccurrences` → `setLoading(false)` chain (`CalendarView.tsx:49-60`) then
  lands after the assertions, producing an "update not wrapped in act(...)" warning and an
  order-dependent test that usually passes — the worst failure mode, in the test that exists
  specifically to be trustworthy. `Loading…` (`CalendarView.tsx:103`) is the actual in-flight signal.

  Use the idempotent `waitFor` + `queryBy` form, **not** `waitForElementToBeRemoved`: the latter is
  the instinctive choice and it *throws* if the element is already gone, which is possible because
  `await user.click(...)` is itself act-wrapped and may have already flushed the promise.

  (Initial mount is unaffected — `occurrences` starts `[]`, so the first `findByRole` on a chip does
  genuinely wait. Only the post-nav await is hollow.)

- **Never let a derived property stand in for the thing itself. Ask of every assertion: "what
  would this still pass on?"** That falsification question is the rule; the rest is worked
  examples. Derived properties are ones the DOM *computes* from something else, so several
  different implementations collapse onto the same value:
  - **Accessible name** (`getByRole({ name })`, `toHaveAccessibleName`) falls back to text
    content when there is no `aria-label` — so it cannot tell terse-text-plus-label from
    label-rendered-as-text.
  - **Computed role** (`getByRole("button")`) matches `<div role="button">` as readily as
    `<button>` — so it cannot tell a keyboard-operable control from one dead to Enter and Space.
  - **`toBeVisible()`** is near-useless in jsdom against Tailwind, whose layout lives in classes
    jsdom never resolves.

  When the claim is about appearance or element identity, assert the thing directly —
  `toHaveTextContent` with an **anchored RegExp** (a bare string is a substring match),
  `tagName`, an explicit attribute, or `className`.

  Then two more rungs, because each was learned here the hard way: assert the **complete**
  value, never a subset — v5's test 9 checked 2 of 14 classes and passed on a 16px label; and
  where the property is only a **proxy** for rendered appearance, pair it with a manual check in
  §6, because a class assertion cannot see a halo, a font size, or a clipped cell.

- **Grab the toggle's handle once, while collapsed, and reuse it across the flip** (tests 3 and 4).
  Do **not** re-query it by name after expanding: the accessible name becomes `Show less — …` by
  design (Decision 3), so the collapsed regex will throw. Reusing the handle is safe because the
  toggle is a positionally-stable conditional child — slot 0 of the day cell is the day-number
  `<div>`, slot 1 the chip array, slot 2 the conditional — so expanding pushes elements into the
  nested array in slot 1 without shifting slot 2. React reconciles the same element type at the same
  position and updates it **in place**; the DOM node survives, and only `aria-expanded`, the label
  and the text content change.

### 5.3 Required tests

1. **Collapsed by default** — day 15 shows `D15 Item 1..3`; `D15 Item 4` and `D15 Item 5` are
   absent from the document.
2. **The control is a button, with day context and correct initial state** — resolve it with
   `getByRole("button", { name: /\+2 more items — .+ 15$/ })`, then assert **all three** of:

   ```tsx
   expect(toggle.tagName).toBe("BUTTON");
   expect(toggle).toHaveAttribute("type", "button");
   expect(toggle).toHaveAttribute("aria-expanded", "false");
   ```

   **`getByRole` does not prove it is a button.** It matches *computed role*, so it resolves
   identically against `<div role="button" tabIndex={0}>` — which would look identical, pass
   `userEvent.click()` (a mouse event a div handles fine), and be **completely dead to the
   keyboard**, since a div fires on neither Enter nor Space. That defeats the entire point of
   this change. The pre-existing chip test already knows this and does
   `expect(chip.tagName).toBe("BUTTON")` (`CalendarView.test.tsx:88`) for exactly this reason —
   copy the pattern rather than rediscovering why it is there.

   The `aria-expanded` half matters too: without it, a hardcoded `true` or an omitted attribute
   survives.
3. **Expanding reveals the rest** — clicking it makes all five titles present and flips
   `aria-expanded` to `"true"`.
4. **Collapsing restores the cap** — clicking again returns to three, and `D15 Item 4` is gone.
5. **Boundary at exactly 3** — day 20 renders no toggle at all:
   `queryByRole("button", { name: /more items? — .+ 20$/ })` is null. Catches `>= 3`, `> 2`, and
   `slice(0, 2)` in one line.
6. **Per-day isolation** — expand day 15, then assert day 5 still shows only its first three
   titles and its own button still reads `aria-expanded="false"`. **Load-bearing:** without
   this, a single `useState(false)` shared by the whole grid passes every other test, and that
   is the other obvious cheap implementation — the one that ships the worst behavior
   (expanding one day explodes the month).
7. **A revealed chip opens the right item** — click `D15 Item 5` after expanding, then assert
   `within(dialog).getByText("D15 Item 5")`, mirroring `CalendarView.test.tsx:100`. Asserting
   only that *a* dialog appeared would pass even if the revealed chip were wired to the wrong
   occurrence.
8. **Month-nav isolation — Decision 1's regression guard.** Expand current-month day 15, click
   `›`, then **await the `Loading…` settle signal per §5.2** — *not* a `findBy*` on a chip, which
   is hollow here for the reason that bullet gives — and then assert **positively**: next month's
   day 15 shows `N15 Item 1..3` only, and its toggle reads `aria-expanded="false"`.

   > **This test was vacuous in v1 of this plan and must not regress to that form.** Asserting
   > merely that the next month "is not expanded" passes on every implementation, including the
   > naive `Set<number>`: with a current-month-only fixture the component's own filter
   > (`CalendarView.tsx:73`) discards everything after the nav, so the month renders 31 empty
   > cells and there is nothing there to be wrongly expanded. The next-month fixture rows in
   > §5.1 and the positive assertion here are what make it bite.

9. **The toggle carries Decision 4's complete class string.** Assert the **whole** string, not
   a subset — compare `toggle.className` against the literal in Decision 4.

   Asserting only the two focus classes (the v5 spec) leaves twelve others unpinned, and one of
   them is load-bearing in a way jsdom will never show you: without `text-[10px]`, Tailwind
   preflight's `font-size: 100%` on `button` renders `+2 more` at the inherited base size — 16px,
   beside chips at 11px and a day number at `text-xs`. That passes every other test in this file
   and is a worse visual defect than the one v5 exists to fix. Decision 4 calls the string
   verbatim and load-bearing; the test should hold it to the whole claim.

10. **Visible text is NOT the accessible name.** Assert both halves on the same element, in both
    states — four assertions total:

    ```tsx
    expect(toggle).toHaveTextContent(/^\+2 more$/);
    expect(toggle).toHaveAccessibleName(/^\+2 more items — .+ 15$/);
    // then expand:
    expect(toggle).toHaveTextContent(/^Show less$/);
    expect(toggle).toHaveAccessibleName(/^Show less — .+ 15$/);
    ```

    **Pass a RegExp, never a string.** `toHaveTextContent("+2 more")` does a *substring* match and
    therefore **passes on the defect** — the shipped text content was
    `+2 more items — August 15`, which contains it. Only the anchored RegExp form discriminates.
    This is a jest-dom overload difference, not a style preference.

    Both states are required: the expanded pair is what verifies Label-in-Name for `Show less`,
    which the collapsed assertions say nothing about.

    **Load-bearing, and it exists because this suite already shipped the defect once.** An
    element's accessible name falls back to its text content when there is no `aria-label`, so
    every other test here — including test 2's `getByRole("button", { name: ... })` — passes
    identically whether the button renders terse text with an `aria-label`, or renders
    `toggleLabel` directly and drops the label. Only a text-content assertion separates them.


## 6. Done conditions

- `npm run typecheck` clean.
- `npm run lint` — no new errors **and no new warnings** (repo baseline: 0 errors, 2 known
  warnings, `docs/backlog.md:113`).
- `npm test` fully green, including the four pre-existing `CalendarView.test.tsx` tests, which
  must not be modified — the month-nav test at `CalendarView.test.tsx:145-156` in particular.
- `npm run build` succeeds.
- All ten tests in §5.3 present and passing (test 2 now carries three assertions).
- **Manual checks (QA, in a real browser — jsdom cannot cover any of these).** Test 9's class
  assertion is a *proxy* for rendered appearance, and v5 is the standing proof that proxies miss
  things. Confirm by eye:
  1. In **dark mode**, keyboard-focus a `+N more` button — the ring must have no white halo (R4).
  2. The toggle's text renders at the same visual size as the chips above it and fits on one
     line inside the day cell.
  3. Expanding grows the day cell and its week row; collapsing fully reverses it.
  4. No day-cell clipping: every revealed chip is visible and clickable, not cut off. **A
     `overflow-hidden` or `max-h` on the day cell would restore the original bug with the entire
     suite still green** — Decision 6 forbids it, and only this check can catch it.
- **Application-code diff confined to `CalendarView.tsx` and `CalendarView.test.tsx`.** Any
  change to other application code means the scope was misread — stop and report. `docs/**` is
  explicitly carved out: closing `docs/backlog.md:122` in place is the repo's normal practice
  for a shipped item and is expected here.

## 7. Risks

- **R1 — expansion leaking across months.** Mitigated by Decision 1 and test 8, which only
  works because of the next-month fixture rows.
- **R2 — mutating the `Set` in place.** Step 2 spells out copy-on-write.
- **R3 — scope creep into roving `tabindex`.** Non-goal in §2; the two on-ramps are named
  explicitly in Decisions 5 and 6 rather than left to be rediscovered mid-implementation.
- **R4 — dark-mode focus halo.** Mitigated by `ring-offset-background` (Decision 4). Test 9
  pins the class but **cannot verify the rendered result** — jsdom resolves no colors. The actual
  verification is §6's manual check 1. Do not restore the words "verified by test 9" here: that
  proxy-for-appearance framing is precisely what round 5 disproved.
- **R5 — one shared boolean instead of per-day state.** Mitigated by test 6.

## 8. Alternatives rejected

- **Remount-to-reset.** Extract the day cell or grid into a child keyed `${year}-${month}`,
  keep a plain `Set<number>` of day numbers, and let React discard the state on nav. Idiomatic,
  and it kills the leak by construction rather than by key discipline — test 8 would become
  unnecessary. **Rejected** because it costs a component extraction (well beyond the budgeted
  size) and because it *discards* expansion on nav, the opposite of the tradeoff accepted in
  Decision 1.
- **Accordion — `expandedDay: string | null`, one day open at a time.** Strictly simpler state,
  and it bounds the week-row growth Decision 6 accepts. **Rejected** because two busy days side
  by side is a normal family week (that is the whole use case: kids' activities clustering), and
  collapsing one day to open another would be a worse surprise than a taller row.
