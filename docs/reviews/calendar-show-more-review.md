# Plan Review: `calendar-show-more`

Reviewer: Plan-Reviewer (adversarial). Plan under review: `docs/plans/calendar-show-more.md`.
Round 1: 2026-08-22.

Sources read in full: `web/src/components/CalendarView.tsx`, `web/src/components/CalendarView.test.tsx`,
`docs/backlog.md`, `eslint.config.js`, `vitest.workspace.ts`, `vitest.config.ts`, `package.json`,
`web/src/components/ui/button.tsx`, `CLAUDE.md` (project + global).

Summary: the diagnosis is right, Decision 1 is right and its stated rationale checks out against the
source, and every `file:line` citation in the plan resolves to what the plan says it does (audited
below — all 14 correct). The design is sound and the scope discipline holds. **The test section is
where this plan is weak**: the one test the plan names as its regression guard (§5 test 5) is
*vacuous* against the existing mock harness and would pass on the exact naive implementation it
claims to catch, and a whole class of wrong implementation (one shared boolean for all days) passes
all six tests as written. Those are fixable inside §5 without touching §3 or §4.

---

## 1. Citation audit — all correct

| Plan claim | Verified |
| --- | --- |
| `CalendarView.tsx:145` = `dayOccs.slice(0, 3).map(...)` | ✓ |
| `CalendarView.tsx:163-165` = the inert `<div>` (snippet quoted verbatim at plan:17-19 matches) | ✓ |
| `CalendarView.tsx:157` = chip `onClick` → `itemModal.openView` | ✓ |
| `CalendarView.tsx:63-64` = `year`/`month` from `currentMonth` | ✓ |
| `CalendarView.tsx:178-181` = `onSaved` → `setReloadToken` | ✓ |
| `CalendarView.tsx:147` = chip `type="button"` | ✓ |
| `CalendarView.tsx:154-156` = the "day number is a SIBLING `<div>`" comment + `aria-label` | ✓ |
| `CalendarView.tsx:87` = `monthLabel` | ✓ |
| `CalendarView.tsx:136` = `min-h-[80px]` day cell | ✓ (note: the leading empty cells at `:124` share it) |
| `CalendarView.tsx:26-32` = the `useState` block | ✓ |
| `CalendarView.tsx:128-168` = the day-cell map | ✓ |
| `CalendarView.test.tsx:14-21` = `vi.mock("../apiClient")` with both fns | ✓ |
| `CalendarView.test.tsx:144-156` = the month-nav test | ✓ (`:144` is the `describe`, `:145-156` the `it`) |
| `button.tsx:8` carries `ring-offset-background` | ✓ |
| Chip focus classes quoted at plan:98-100 match `CalendarView.tsx:158` exactly | ✓ |
| Lint baseline "0 errors / 2 warnings" | ✓ per `docs/backlog.md:113` |

No citation in this plan is wrong or stale. That is unusual and worth saying.

## 2. Decision 1 — the claimed bug is real, and the key is sufficient (with one nit)

Pressure-tested as requested.

**The naive-version bug is real.** `year`/`month` (`CalendarView.tsx:63-64`) are derived from
`currentMonth` on every render; `prevMonth`/`nextMonth` (`:80-81`) replace `currentMonth`; nothing
resets component state. A `Set<number>` of bare day numbers therefore survives the nav, and the day
cells are re-rendered from `Array.from({length: numDays}, (_, i) => i + 1)` (`:128`) — the same
integers in the new month. Expand day 15 in August, page to September, and September 15 renders
expanded. The plan's description at plan:52-57 is accurate, not a strawman.

**Is `${year}-${month}-${day}` sufficient?** Within a single render, `year` and `month` are constants
(the grid only ever draws `currentMonth`), so the key is exactly "this cell, this month". There is no
second axis of identity the cell has — no timezone, no list scoping, no per-user dimension — so yes,
the key is sufficient for the state's purpose. Two follow-ups, both minor:

- **F2-a (cosmetic, non-blocking).** The key is format-ambiguous only under a negative
  `getFullYear()` (year ≤ 0 gives `"-1-11-15"`). Reaching that requires ~2027 clicks on `‹`. Not
  worth changing; noting it so the next reader does not re-derive it. If the architect wants it gone
  for free, `new Date(year, month, day).getTime()` as a `Set<number>` key is equally cheap and has no
  format at all — but that is preference, not a defect.
- **F2-b (real, unstated).** The plan is right that a `reloadToken` refetch dropping a day below 4
  items renders identically (plan:67-69) — with `visibleOccs = isExpanded ? dayOccs : dayOccs.slice(0,3)`
  a ≤3 list renders the same either way and the `dayOccs.length > 3` button disappears. What the plan
  does not say is that **the stale `true` stays in the `Set`**, so if that day later climbs back above
  3 (another save moves an item onto it) the day silently re-expands without the user asking. I agree
  with the plan's conclusion (don't reset), but the reasoning as written ("becomes a no-op") is
  incomplete — it is a *dormant* flag, not a no-op. Say so in the comment the coder writes, or the
  next person to see a spontaneously-expanded day will file it as a bug.

## 3. Would any step fail typecheck or lint? No.

Walked steps 1-5 against `tsconfig.web.json`'s consumer (`npm run typecheck` runs both projects) and
`eslint.config.js`:

- `useState<Set<string>>(() => new Set())` — the lazy initializer is contextually typed, `new Set()`
  infers `Set<string>`. Clean.
- `toggleDay` is declared in the component body and used in the returned JSX — no `no-unused-vars`.
- No hook is added inside a conditional or a loop; `react-hooks/rules-of-hooks` (error,
  `eslint.config.js:52`) is satisfied. No new effect, so no `exhaustive-deps` (warn, `:53`) surface —
  the "no new warnings" done condition at plan:172-173 is achievable.
- **F3-a (style, not lint).** `eslint.config.js` enables no stylistic rules (`js.configs.recommended`
  + `typescript-eslint` recommended only), so plan:132's
  `if (next.has(key)) next.delete(key); else next.add(key);` passes lint. It does, however, run
  against the global "no clever one-liners that hurt readability" rule in `~/.claude/CLAUDE.md`.
  Prescribing a braced multi-line form costs nothing and avoids a reviewer/coder argument later.

**F3-b — the button's `className` is unspecified.** Decision 3 (plan:98-102) names only the four
focus-visible classes. The element being replaced is a `<div className="text-[10px] text-muted-foreground">`
(`CalendarView.tsx:164`), which is block-level and full-width. A `<button>` is `inline-block` under
Tailwind preflight, so unless the plan says so the coder must guess whether to carry
`block w-full text-left`, whether to keep `text-[10px] text-muted-foreground`, and whether to add any
hover affordance at all (a button with zero hover feedback next to chips that have `hover:bg-accent/80`
reads as still-inert — the very impression this change exists to remove). The `item-view-mode` review
had to force a single authoritative class list for exactly this reason; do it here up front. Give the
complete literal string once, the way plan:98-100 gives the focus fragment.

## 4. Do the six tests prove the fix? Two do not, and one class of bug escapes entirely.

This is the substantive part of the review.

**F4-a — §5 test 5 (the named regression guard) is vacuous as written. Highest-severity finding.**

Plan:163-165 says the month-nav test "is the test that fails on the naive `Set<number>`
implementation, so it must exist." Against the existing harness it does not fail on the naive
implementation — it passes on every implementation, including a deliberately broken one.

Why: `beforeEach` (`CalendarView.test.tsx:78-82`) sets `getOccurrences` to
`mockResolvedValue({ occurrences: [OCCURRENCE] })` — a fixed array, ignoring the `from`/`to`
arguments. The fixture timestamps are pinned to the *current* month (`:46-47`). After clicking `›`,
`CalendarView` refetches and then filters with
`if (d.getFullYear() === year && d.getMonth() === month)` (`CalendarView.tsx:73`), so **every**
occurrence is discarded and the next month renders 31 empty cells. "Assert the same day number there
is not expanded" is then trivially true: there are no chips and no `+N more` button to be expanded in
the first place. A `Set<number>` implementation passes it. So does a global `let expanded = true`.

To make it load-bearing the fixture must place ≥4 occurrences on the same day number in **both**
months — either `mockImplementation((_id, from, to) => ...)` filtering a two-month fixture, or (
simpler, and the component filters anyway) returning the union of both months' occurrences from every
call. Then the assertion must be positive, not an absence: on next month's day 15, assert 3 chips are
shown and the button reads `aria-expanded="false"`. That assertion fails on `Set<number>` and passes
on `Set<string>`, which is what the plan claims it does.

Two mechanical notes for whoever writes it: the click on `›` triggers an async refetch
(`CalendarView.tsx:40-61`), so the test must `await` a `findBy*` before asserting or it will produce
`act` warnings and read stale DOM — the existing month-nav test (`:145-156`) gets away with a sync
`getByRole("heading")` only because the heading does not depend on the fetch. And day 15 exists in
every month, including the December → January rollover that `new Date(year, month + 1, 1)` handles,
so the day number choice is safe.

**F4-b — a single shared expansion flag passes all six tests. Missing per-day isolation test.**

The plan's fixture is "5 occurrences on one day" (plan:152). With only one busy day in the grid,
`const [expanded, setExpanded] = useState(false)` shared by every cell is indistinguishable from
per-day state in tests 1-4 and 6. (Fixed test 5 would catch it, but only by accident, and only after
F4-a is folded in.) This is not a hypothetical: "one boolean" is the *other* obvious cheap
implementation, and it is the one that ships the worst behavior — expanding one day explodes the
whole month.

Add a second busy day to the fixture (say day 5 and day 15, ≥4 occurrences each) and one test:
expand day 15, assert day 5 still shows exactly 3 chips and its button still reads
`aria-expanded="false"`.

**F4-c — §5 test 6 does not assert *which* item opened.** Plan:166-168 asks only that
`role="dialog"` appears. A dialog appears when *any* chip is clicked, so the test passes if the
revealed chip is wired to the wrong occurrence — a live risk, because the plausible wrong
implementation here is a second `dayOccs.slice(3).map((occ, i) => ...)` block whose index restarts at
0 (duplicate `key`s and off-by-three handler wiring) rather than the `visibleOccs` the plan
prescribes at step 4. Tighten to `within(dialog).getByText("<title of the 5th item>")`, mirroring the
existing test at `CalendarView.test.tsx:100`.

**F4-d — no assertion that `aria-expanded` starts `"false"`.** Test 3 checks only the flip to
`"true"` (plan:161). Assert `"false"` on the initial render too; without it a hardcoded
`aria-expanded={true}` or an omitted attribute survives.

**F4-e — no boundary test at exactly 3.** Nothing in §5 pins the off-by-one. A day with exactly 3
occurrences must render no button at all. One `queryByRole("button", { name: /more/ })` →
`not.toBeInTheDocument()` catches `>= 3`, `> 2`, and `slice(0, 2)` regressions for one line.

**F4-f — the fixture spec is under-determined in three ways that will bite the coder.**

1. It must give the 5 occurrences **distinct `item_id`s and distinct titles**. Tests 1, 3 and 6 all
   assert on individual titles, and `findByRole({ name })` throws on multiple matches.
2. It must give them **distinct `occurrence_at` values**. The component sorts merged results
   (`CalendarView.tsx:56`); identical timestamps leave visible-vs-hidden membership resting on V8's
   stable-sort as an implicit contract.
3. It must override `getOccurrences` **inside the new `describe`'s own `beforeEach`** (which runs
   after the file-level one at `:78-82`) and must not touch the shared `beforeEach` — editing that
   would change the fixture for the four pre-existing tests and violate the plan's own done condition
   at plan:174-176.

**F4-g — how do you count "exactly 3 chips"? The plan does not say, and the obvious query is wrong.**
Tests 1 and 4 are phrased as counts. There is no accessible container for a day cell — the day
number is a sibling `<div>` (`CalendarView.tsx:138-144`), which is the whole reason the chips carry
day context in their labels. So `within(dayCell)` is not available, and a bare
`getAllByRole("button")` sweeps in the two month-nav buttons. The tempting scope is a regex on the
shared aria-label suffix (`/— August 15$/`) — but under Decision 3 the `+N more` button's *own*
accessible name ends in that same suffix, so the count comes back one high. Prescribe the query
explicitly: assert presence/absence by title (`queryByRole("button", { name: /Item 4/ })`), which is
unambiguous and needs no new markup.

**F4-h — hardcoding a month name in a test is a time bomb.** Decision 3's examples read
`Show 2 more items — August 15` (plan:92-93). `monthLabel` is
`currentMonth.toLocaleString("default", ...)` (`CalendarView.tsx:87`) against a `TODAY = new Date()`
fixture (`CalendarView.test.tsx:44`), so a literal `"August"` in an assertion breaks on 1 September
and in any non-English ICU environment. The existing chip test dodges this deliberately —
`new RegExp(\`Team standup.*${DAY}\`)` at `:89`. §5 test 2 says "includes the day number," which is
right; add an explicit "do not assert a literal month name" so the examples in Decision 3 are not
copied into the test verbatim.

**F4-i — R4 (the dark-mode focus halo) has no verification step at all.** It is listed as a risk at
plan:188-189 and mitigated by a class list, but jsdom asserts nothing about rendered color, and §6's
done conditions contain no manual check. The `item-view-mode` review's answer to the same problem was
a static `className` assertion. Either do that here, or add one line to §6: manually tab to a `+N
more` button in dark mode and confirm no white halo. As written, R4's mitigation is unverified.

## 5. Accessibility and interaction details the plan gets partly wrong

**F5-a — pluralization. "Show 1 more items — August 15".** The template at plan:92 produces exactly
that string for a 4-item day, which is the single most common busy day. The visible `+1 more` is
fine; the accessible name is not. Specify the singular branch.

**F5-b — WCAG 2.5.3 "Label in Name" violation.** The visible text is `+2 more`; the prescribed
accessible name is `Show 2 more items — August 15`, which does not contain the visible string
(`"2 more"` yes, `"+2 more"` no). Speech-input users saying "click plus two more" get nothing. The
expanded state is worse: visible `Show less`, name `Show fewer items — August 15` — the visible words
do not appear in the name at all. The chips at `CalendarView.tsx:156` are compliant because their
label *starts* with the visible title; this new control breaks the pattern the plan says it is
following (plan:96-97). Costless fix: `+2 more items — August 15` and `Show less — August 15`.

**F5-c — DOM order after expanding leaves the revealed chips *behind* the focus point.** The button
replaces the `<div>` at `CalendarView.tsx:163-165`, i.e. it sits **after** the chips. Expand, and
chips 4..N are inserted *above* the still-focused button; the next `Tab` goes to the following day,
so a keyboard user must `Shift+Tab` backwards into the content they just asked for. This is a real
consequence of Decision 3 that the plan does not mention while claiming the a11y story is complete.

**Explicitly: the fix for this is NOT roving `tabindex`.** Document it as an accepted cost in the
code comment, or — if the architect wants more — a single `ref` + `.focus()` on the first revealed
chip. Both are in scope; grid-wide arrow-key navigation is not.

## 6. Scope discipline — holds, with two named temptations

The non-goals at plan:30-39 are correctly drawn and R3 (plan:186-187) names the roving-`tabindex`
risk. Two things in the source will tempt a coder across the line:

- **F6-a.** The day cell already carries `className="relative"` (`CalendarView.tsx:136`) — a
  ready-made positioning context that makes an absolutely-positioned popover look like a two-line
  change. Decision 4 forbids the *outcome* (plan:112-114) but never mentions this affordance. Name
  it, so nobody "discovers" it mid-implementation.
- **F6-b.** F5-c above is the natural on-ramp to roving `tabindex`. Bound it in the plan, as above.

Otherwise the diff really is confined to the two named files, and §4's five steps are each
independently compilable — no step leaves the tree red.

## 7. Contradiction between §6 and repo convention

**F7-a.** Plan:178-179 says "Diff confined to `CalendarView.tsx` and `CalendarView.test.tsx`. Any
change outside those two files means the scope was misread — stop and report." But every shipped item
in `docs/backlog.md` is marked resolved in place when it lands (see `:106`, `:109`, `:112`, `:118`,
`:120`), and the entry this plan implements is `docs/backlog.md:122`. As written, the done condition
forbids the closing bookkeeping the repo always does. Carve out `docs/**` explicitly — the rule is
about *application* code.

**F7-b (minor).** §6 omits `npm run build`. `npm run typecheck` runs `tsc --noEmit` and Vite builds
separately (`package.json:9-10`); for a JSX-only change the risk is near zero, but the sweep is ~10
seconds and other plans in this repo include it.

## 8. Alternatives not considered

The plan states its non-goals crisply but weighs no alternative to per-day `Set` state. Two deserve a
sentence each, if only to be rejected on the record:

- **Remount-to-reset**: extract the day cell (or the grid) into a child keyed
  `key={`${year}-${month}`}`, keep a plain `Set<number>` of day numbers, and let React discard the
  state on nav. Idiomatic, eliminates the leak by construction rather than by key discipline, and
  makes F4-a's regression test unnecessary. It costs a component extraction (more than 8 lines) and
  it *discards* expansion on nav, which is the opposite of the tradeoff accepted at plan:63-65 — so
  rejecting it is defensible. Rejecting it silently is not.
- **Accordion (`expandedDay: string | null`)**: one day open at a time. Bounds the week-row growth
  that Decision 4 accepts, and is strictly simpler state. Rejected on the grounds that two busy days
  side by side is a normal family week, presumably — but say so.

Neither changes my verdict; both are cheap to dismiss in two lines and their absence is the only
place this plan reads as under-argued rather than over-argued.

---

## Required changes

1. **Fix §5 test 5 so it is load-bearing (F4-a).** The current mock returns a fixed
   current-month-only fixture, so after paging the next month is empty and the assertion is vacuous —
   it passes on the `Set<number>` implementation the plan says it catches. Require a fixture with ≥4
   occurrences on the same day number in **both** months, a positive assertion (3 chips +
   `aria-expanded="false"` on next month's day), and an `await`ed `findBy*` after the `›` click.
2. **Add a per-day isolation test (F4-b).** Two busy days in the fixture; expanding one must leave
   the other at 3 chips and `aria-expanded="false"`. Without it, a single shared boolean passes the
   whole suite.
3. **Tighten §5 test 6 (F4-c)** to assert the dialog contains the revealed item's title, not merely
   that a dialog exists.
4. **Add the two cheap guards (F4-d, F4-e):** `aria-expanded="false"` on initial render, and "a day
   with exactly 3 occurrences renders no button."
5. **Specify the fixture and the queries (F4-f, F4-g, F4-h):** distinct ids/titles/timestamps;
   override `getOccurrences` in the new `describe`'s own `beforeEach` and never in the shared one;
   assert by title rather than by counting `getAllByRole("button")` (the `+N more` button's own label
   shares the chips' day suffix); no literal month name in any assertion.
6. **Give the button's complete `className` once, authoritatively (F3-b)** — including block/width/
   alignment (it replaces a block-level `<div>`) and a hover affordance, not just the four
   focus-visible classes.
7. **Fix the accessible name (F5-a, F5-b):** singular for a 4-item day, and make the visible text a
   prefix of the accessible name (`+2 more items — August 15` / `Show less — August 15`) so
   WCAG 2.5.3 holds, matching the chips at `CalendarView.tsx:156`.
8. **Address the post-expand keyboard flow (F5-c)** — revealed chips land *before* the focused
   button in DOM order. Accept it in a comment or move focus to the first revealed chip; state
   explicitly that roving `tabindex` remains out of scope either way.
9. **Correct Decision 1's `reloadToken` reasoning (F2-b):** a stale `true` is dormant, not a no-op,
   and will silently re-expand the day if it climbs back above 3 items. Keep the "no reset" decision;
   fix the justification and put it in the comment.
10. **Fix §6's scope rule (F7-a):** carve out `docs/**` so closing `docs/backlog.md:122` is not a
    stop-and-report condition. Optionally add `npm run build` (F7-b).
11. **Add a verification step for R4 (F4-i)** — jsdom cannot see the dark-mode halo; either a static
    `className` assertion or an explicit manual check in §6.
12. **Record the two rejected alternatives (§8)** — remount-to-reset via a keyed child, and the
    single-open accordion — with one line of rationale each.
13. **Name the `relative` day-cell class at `CalendarView.tsx:136` as an off-limits affordance
    (F6-a)**, so Decision 4's "no popover" holds under implementation pressure.
14. *(Optional, style only)* Brace the toggle's `if/else` (F3-a) — lint permits the one-liner, the
    global style rule does not love it.

APPROVE WITH CHANGES

---

# Round 2 — 2026-08-22

Plan re-read in full at v2. Re-verified against `web/src/components/CalendarView.tsx`,
`web/src/components/CalendarView.test.tsx`, `eslint.config.js`, `docs/backlog.md`.

All 14 round-1 changes are genuinely folded in — I checked each against the plan text and, where the
change asserted something about the source, against the source. Nothing was folded in name only, and
nothing on round 1's list was silently dropped or weakened. The two additions the coordinator flagged
as their own (the day-suffix regex, and the union fixture) are both **sound**, and I validated them
against the component rather than accepting them; see R2-Q1 and R2-Q2. The union approach in
particular turns out to be the better of the two options I offered in round 1, for a reason neither of
us had stated.

What is left is smaller than round 1 by an order of magnitude: one genuine under-specification (which
is exactly the one the coordinator asked about, so their instinct was right) and one flake risk in
test 8, both fixable inside §5.2. No decision in §3 needs to move.

## R2-1 — Disposition of the 14 required changes

| # | Round-1 change | Disposition |
| --- | --- | --- |
| 1 | F4-a: make test 8 load-bearing | **FOLDED IN.** §5.1 adds the next-month day-15 row; §5.3 test 8 asserts positively (`N15 Item 1..3` only, `aria-expanded="false"`). Re-derived: under `Set<number>` the nav carries `15`, so `N15 Item 4/5` render and the assertion fails — it now bites. The blockquote at plan:287-292 correctly states *why* v1 was vacuous, which is the part that stops it regressing |
| 2 | F4-b: per-day isolation | **FOLDED IN.** Day-5 row (4 occurrences) + test 6, with the "single shared boolean" rationale attached. A grid-wide `useState(false)` now fails |
| 3 | F4-c: test 7 asserts which item | **FOLDED IN.** `within(dialog).getByText("D15 Item 5")`, citing `CalendarView.test.tsx:100` (verified — that is the `within(dialog).getByText("Team standup")` line) |
| 4 | F4-d / F4-e | **FOLDED IN.** Initial `aria-expanded="false"` is in test 2 with its rationale; test 5 is the day-20 exactly-3 boundary. Note the boundary regex `/more items? — .+ 20$/` deliberately omits the `\+\d+` head, so it also catches a buggy `+0 more` — that is a better test than I asked for |
| 5 | F4-f / F4-g / F4-h | **FOLDED IN.** §5.1 fixture table + distinct id/title/timestamp with the reasons; §5.2 forbids `getAllByRole` counting, forbids literal month names, and prescribes the day-suffix regex |
| 6 | F3-b: complete `className` | **FOLDED IN.** Decision 4 gives one verbatim string including `block w-full text-left`, the retained `text-[10px] text-muted-foreground`, and `hover:text-foreground`. `text-foreground` is a real token in this file (`CalendarView.tsx:140`), so the JIT will emit the hover variant |
| 7 | F5-a / F5-b | **FOLDED IN and correct.** `+1 more item` singular branch present. Checked the WCAG 2.5.3 property directly: visible `+2 more` is a literal prefix of `+2 more items — August 15`, and visible `Show less` of `Show less — August 15`. Both now pass Label-in-Name; v1 passed neither |
| 8 | F5-c: post-expand keyboard flow | **FOLDED IN.** Decision 5 accepts the Shift+Tab cost, records the ref+`.focus()` alternative *and* its rejection reason (including the `exhaustive-deps` surface — correct, that is a real cost given `eslint.config.js:53`), and restates the roving-`tabindex` boundary "in either direction" |
| 9 | F2-b: dormant, not a no-op | **FOLDED IN.** plan:75-82 spells out the re-expansion scenario and requires it in the code comment. This is now more accurate than my round-1 phrasing |
| 10 | F7-a / F7-b | **FOLDED IN.** §6 scopes the rule to "application-code diff" and names `docs/backlog.md:122` as expected work. `npm run build` added |
| 11 | F4-i: R4 verification | **FOLDED IN** as test 9, with a caveat — see R2-5 |
| 12 | §8 alternatives | **FOLDED IN.** Both recorded with real rationale, not strawmen. The accordion rejection ("kids' activities clustering") is the right argument |
| 13 | F6-a: `relative` off-limits | **FOLDED IN.** Decision 6, and §2's non-goals now point at it |
| 14 | F3-a: braced `if/else` | **FOLDED IN** |
| — | F2-a (offered as optional) | Recorded as a cosmetic note at plan:84-86 rather than changed. Correct call |

Bonus, not requested: step 4 now forbids a second `dayOccs.slice(3).map(...)` block (plan:207-208).
That was the wrong implementation my F4-c was defending against, and forbidding it at the source is
better than only catching it in a test.

Citations re-audited on every line the revision touched or moved — all resolve. Two are off by a
hair; see R2-6.

## R2-Q1 — The day-suffix regex and the expanded state. Mechanism is sound; the plan does not say so.

**Your reasoning is right, and I verified it rather than reasoning about React in the abstract.** The
toggle is rendered from `{dayOccs.length > 3 && (<button .../>)}`, which compiles to the **third
positional child** of the day cell (`CalendarView.tsx:136`'s `<div>`): slot 0 is the day-number
`<div>`, slot 1 is the chip array, slot 2 is the conditional. Expanding pushes new elements into the
nested array in slot 1; it does not shift slot 2. React reconciles slot 2 against the same element
type (`button`) at the same position, so it **updates in place** — the DOM node is preserved and only
`aria-expanded`, the label and the text content change. A handle grabbed while collapsed stays valid
across the flip, and `userEvent.click(staleHandle)` in test 4 is equally safe.

So: **do not change the label scheme.** It is WCAG-correct as of change 7 and the tests should not
get a vote on it. Letting a test selector dictate an accessible name is the tail wagging the dog, and
you would be trading a real user-facing property for a convenience.

**But the plan currently under-specifies this, and that is the gap.** §5.2 hands the coder exactly one
selector, `/\+\d+ more items? — .+ 15$/`, valid only in the collapsed state — while tests 3 and 4 both
need to reference the toggle *after* the flip. A coder following TL's ordinary "never hold a stale
handle, always re-query" habit will call
`getByRole("button", { name: /\+2 more items — .+ 15$/ })` after clicking, get a throw, and then
improvise a second selector on the spot. That improvisation is precisely what you said you wanted to
pre-empt. Make the handle discipline an explicit §5.2 rule, with the reason, so it is a decision
rather than a coder's guess:

> The toggle's DOM node survives the state change — it is a positionally-stable conditional child, so
> React updates it in place rather than remounting. Grab the handle **once while collapsed** and reuse
> it across the click in tests 3 and 4. Do **not** re-query by name after expanding: the accessible
> name changes to `Show less — …` by design (Decision 3) and the collapsed regex will throw.

If you want a state-independent selector anyway, one already exists without touching the labels —
both states end in `— ${monthLabel} ${day}`, and the toggle is the only control on that day whose
name *starts* with `+` or `Show less` (chips start with their title), so
`/^(\+\d+ more|Show less)\b.* 15$/` is unambiguous against the `D15 Item N` fixture. I would still
prefer the handle rule: it is one sentence and needs no second regex to be maintained.

Two collision checks on the regexes as written, since they are load-bearing and easy to get wrong —
**both are clean**:

- `/…— .+ 15$/` does not match day 5's `+1 more item — August 5` (needs ` 15` at end).
- `/…— .+ 5$/` (day 5's selector, implied by §5.2's parenthetical) does not match day 15's
  `… — August 15`: ` 5$` requires a **space** immediately before the final `5`, and in `August 15`
  that character is `1`. Greediness of `.+` cannot change this. It also excludes day 20 and day 25.

Title regexes are clean too: `/D5 Item 1/` does not match `D15 Item 1` (the char before `5` is `1`,
not `D`), and `N15`/`D15` prefixes keep the two months' fixtures apart.

## R2-Q2 — The union fixture is safe. Validated against the filter, with two caveats.

**Validated, not assumed.** Trace: `getOccurrences` is called once per list with `from`/`to`
(`CalendarView.tsx:46-47, 53`); the results are `flatMap`-merged and sorted (`:55-56`) and stored
wholesale — **nothing in the effect filters by date**. The only date filter is the `byDay` loop
(`:71-78`), which keeps an occurrence solely when
`d.getFullYear() === year && d.getMonth() === month` against the *rendered* month (`:63-64`). So
next-month rows returned during the current month are dropped at grouping time and are invisible;
after `nextMonth()` (`:81`) the same filter drops the current-month rows and admits the next-month
ones. Returning the union from every call is safe. The mock ignoring `from`/`to` costs only the
(pre-existing, out-of-scope) ability to assert the requested range.

**It is also the better option of the two I offered, for a reason worth writing down.** Because
`occurrences` state is not cleared on nav, the union means the next month's chips render *from the
already-held state* the instant `currentMonth` changes — there is no empty intermediate frame. A
`mockImplementation` that filtered by `from`/`to` would reproduce, transiently, exactly the empty-grid
condition that made v1's test 8 vacuous. The union structurally cannot.

Two caveats to fold into §5.1:

- **R2-2 (coupling worth one line).** The union's arithmetic depends on `LISTS` having exactly one
  entry (`CalendarView.test.tsx:32-41`). `Promise.all(lists.map(...))` calls the mock **once per
  list** and `flatMap` does not dedupe (`CalendarView.tsx:53-55`), so adding a second list to the
  shared `LISTS` const would silently double every occurrence — day 15 becomes 10 items, day 20
  becomes 6 and stops being the exactly-3 boundary, and test 5 flips from guard to false failure.
  Nothing today does this; the point is that a future edit to a *shared* const at the top of the file
  would break the new fixture in a way whose cause is three indirections away. One sentence in §5.1
  ("the union is only correct because `LISTS.length === 1`; a second list would double every row")
  costs nothing and saves that debugging session.
- **R2-3 (real, and it lands on test 8) — see below.**

## R2-3 — §5.2's "`await` a `findBy*` after `›`" is a no-op in test 8, the one test it was written for

This is a direct consequence of the union approach, so it did not exist when I wrote the round-1
finding.

§5.2's third bullet (plan:256-258) tells the coder to `await` a `findBy*` after clicking `›` so the
async refetch settles. With the union fixture, `screen.findByRole("button", { name: /N15 Item 1/ })`
**resolves on its first attempt**, from the stale-but-sufficient `occurrences` state described above,
*before* the refetch has settled. The await therefore guarantees nothing. The subsequent
`setLoading(true)` → `setOccurrences` → `setLoading(false)` chain (`CalendarView.tsx:49-60`) can then
land after the test's assertions, producing an "update not wrapped in `act(...)`" warning and a
genuinely order-dependent test. It will usually pass — TL's async wrapper flushes microtasks and
`mockResolvedValue` settles quickly — which is the worst failure mode: an intermittent one, in the
test that exists specifically to be trustworthy.

Await the *settle signal* instead of a chip. `CalendarView.tsx:103` renders `Loading…` (single `…`
character) while the fetch is in flight, which is exactly that signal. Prescribe the idempotent form:

```tsx
await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
```

Note *idempotent* is load-bearing here: `waitForElementToBeRemoved` is the instinctive choice and it
**throws** if the element is already gone by the time it runs, which is possible because
`await user.click(...)` is itself act-wrapped and may have already flushed the promise. The `waitFor`
+ `queryBy` form passes whether or not `Loading…` was ever observed.

(Initial mount is unaffected — `occurrences` starts `[]`, so the first `findByRole` on a chip does
genuinely wait for the fetch. Only the post-nav await is hollow.)

## R2-4 — §4 step 3 omits `hiddenCount` / `toggleLabel`

Decision 3 introduces both (plan:110-113); §4 step 3 lists only `dayKey`, `isExpanded`, `visibleOccs`
as the derived values (plan:198-203), and step 5 defers to "the button per Decisions 2-5". The coder
will work it out, but §4 is otherwise a literal, copy-able sequence and this is the one place it stops
being one. Add the two lines to step 3. (No correctness issue either way: `hiddenCount` goes negative
on quiet days but is only ever read inside the `dayOccs.length > 3 &&` branch.)

## R2-5 — Test 9 is satisfiable by a partially-correct class list

`expect(className).toContain("ring-offset-background")` passes if the coder keeps that one class and
drops `focus-visible:ring-2` — i.e. it verifies the *halo fix* but not that there is a visible focus
ring at all to have a halo. Since Decision 4 now specifies the string verbatim, assert against more of
it: `ring-offset-background` **and** `focus-visible:ring-2`, or simply assert the full Decision-4
string. Minor, but test 9 exists solely because jsdom cannot check the rendered result, so it should
carry the whole claim it stands in for.

## R2-6 — Nits (no action required, recorded for accuracy)

- plan:249 cites `CalendarView.tsx:138-144` for the day-number sibling `<div>`. The element opens at
  `:137`; `:138` is its `className` prop. Off by one on the opening tag only.
- plan:141 says "The four `focus-visible:` classes are copied from the chips" — there are five
  (`outline-none`, `ring-2`, `ring-ring`, `ring-offset-1`, `ring-offset-background`). The string
  itself at plan:136 is correct and matches `CalendarView.tsx:158` exactly; only the count in the
  prose is wrong.
- Decision 4's string adds `mb-0.5` and `rounded-sm`, which the replaced `<div>` (`CalendarView.tsx:164`)
  did not have. Deliberate-looking (it matches the chips) and harmless — noting it so it is not read
  as an accident during QA.

## R2-7 — Re-confirmed clean

Typecheck and lint are still clear at v2: no new hook, so no `rules-of-hooks` or `exhaustive-deps`
surface (Decision 5's rejection of the ref+effect is what keeps it that way); `hiddenCount` and
`toggleLabel` are both consumed, so no `no-unused-vars`; the braced toggle satisfies the global style
rule. Scope discipline holds — both roving-`tabindex` on-ramps (Decision 5's focus temptation and
Decision 6's `relative`) are now named in the plan rather than left to be rediscovered, which is
stronger than round 1 asked for.

---

## Required changes (round 2)

1. **Add the expanded-state handle rule to §5.2 (R2-Q1).** The mechanism you proposed is correct —
   the toggle updates in place and the stale handle survives — but the plan never says so, and §5.2's
   only selector is collapsed-state-valid while tests 3 and 4 need the toggle after the flip. State
   the rule and the reason. **Do not change the label scheme to get a stable selector**; it is
   WCAG-correct now and the tests should not dictate it.
2. **Replace §5.2's post-`›` await with a settle-signal await (R2-3).** With the union fixture the
   prescribed `findBy*` on a chip resolves before the refetch settles, so test 8 — the plan's most
   important test — can assert against a mid-flight component and emit `act` warnings. Use
   `await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument())`
   (`CalendarView.tsx:103`), and note why `waitForElementToBeRemoved` is the wrong tool here.
3. **Record the union fixture's `LISTS.length === 1` dependency in §5.1 (R2-2).** One sentence; the
   mock is called once per list and `flatMap` does not dedupe.
4. **List `hiddenCount` and `toggleLabel` in §4 step 3 (R2-4)**, so the implementation sequence stays
   literal.
5. **Strengthen test 9 (R2-5)** to assert `focus-visible:ring-2` alongside `ring-offset-background`,
   or the full Decision-4 string.
6. *(Nits, optional — R2-6)* `:138-144` → `:137-144`; "four `focus-visible:` classes" → five.

All six are edits to §4 step 3 and §5 only. No decision in §3 moves, the fixture design stands, and
the plan does not need another architectural pass — fold these in and it is ready for the coder.

APPROVE WITH CHANGES

---

# Round 3 — 2026-08-22

Delta-only pass, as requested. Confirmed first that §3 did not move: Decisions 1-6 are byte-identical
to v2 apart from the two round-2 nits landing inside Decision 4's prose (plan:144, "five"). The label
scheme in Decision 3 (plan:112-117) is untouched, which is what I asked for.

All six round-2 items are folded in, and five of them are complete. One is folded into §5.2 but **not
propagated to §5.3**, leaving the plan contradicting itself about the one test this whole review
thread has been circling.

## R3-1 — Disposition

| # | Round-2 change | Disposition |
| --- | --- | --- |
| 1 | R2-Q1 handle discipline | **FOLDED IN** — plan:294-301. The slot-0/1/2 reasoning is stated as the justification, so it reads as a decision. Re-verified against source: the day cell's children are the day-number `<div>` (`CalendarView.tsx:137-144`), the chip array (`:145-162`), and the conditional (`:163-165`) — three positional slots exactly as the plan describes. Accurate |
| 2 | R2-3 settle-signal await | **PARTIAL** — §5.2 is exactly right; §5.3 test 8 still says the opposite. See R3-2 |
| 3 | R2-2 `LISTS.length === 1` | **FOLDED IN** — plan:257-261, with the doubling consequence spelled out. Citations check: `CalendarView.test.tsx:32-41` is the `LISTS` const, `CalendarView.tsx:53` is the per-list call, `:55` the non-deduping `flatMap`. The union-vs-filtering-mock rationale is now in §5.1 (plan:251-255) rather than only in this review — right call, that argument belongs in the plan |
| 4 | R2-4 `hiddenCount` / `toggleLabel` in step 3 | **FOLDED IN** — plan:206-212, plus the negative-on-quiet-days note. Scope re-checked: `monthLabel` (`CalendarView.tsx:87`) is declared before the `return`, so it is visible inside the day-cell map. Compiles |
| 5 | R2-5 test 9 asserts both classes | **FOLDED IN** — plan:337-340, with the "no visible ring means no halo to fix" reason |
| 6 | R2-6 nits | **FOLDED IN** — `:137-144` at plan:268, "five" at plan:144. Both now correct against source |

Every citation touched by v3 re-resolves: `CalendarView.tsx:49-60` really is the
`setLoading(true)` → `setOccurrences` → `setLoading(false)` chain, `:103` really is
`Loading…` (and the plan uses the same single U+2026 character the source does — worth confirming,
since a three-dot `...` would silently never match).

## R3-2 — §5.3 test 8 still prescribes the hollow await that §5.2 now forbids

plan:326-328:

> Expand current-month day 15, click `›`, **`await` the next month's chips**, then assert positively…

That is verbatim the instruction §5.2's new third bullet exists to overrule. §5.2 says "After
clicking `›`, **await the settle signal, not a chip**" and then spends fourteen lines (plan:275-292)
explaining that awaiting a chip is a no-op under the union fixture. Test 8 is the only test in the
plan that clicks `›`, so §5.2's rule was written *for* test 8 — and test 8 still tells the coder to
do the forbidden thing.

A coder working test-by-test through §5.3 (which is how §5.3 is structured — nine numbered,
independently implementable specs) will write
`await screen.findByRole("button", { name: /N15 Item 1/ })` and will be following the plan when they
do it. They will then be inside the exact failure mode §5.2 describes: a resolved-on-first-attempt
query, a `setLoading`/`setOccurrences` chain landing after the assertions, an act warning, and a test
that "usually passes". The plan rates that as "the worst failure mode, in the test that exists
specifically to be trustworthy" (plan:284-285). I am holding it to its own standard.

Two things keep this from being worse than it is, and I want to be precise rather than alarming:

- The **assertions** in test 8 are unaffected. Even with the hollow await, the test still fails on
  `Set<number>` — the union data is identical before and after the refetch, so the regression guard
  still bites. This degrades trustworthiness, not correctness.
- The contradiction is resolvable by a careful reader: §5.2 is titled "Query rules (these are not
  optional)" and is explicitly general. But "the coder will work out which of our two contradictory
  instructions wins" is not a standard worth endorsing anywhere, and least of all in test 8, which
  has now been subtly wrong in two consecutive revisions for two different reasons.

Fix is one phrase: replace "`await` the next month's chips" with "await the settle signal per §5.2"
(or inline the `waitFor` line). Nothing else in test 8 changes.

## R3-3 — Your judgement call on the second regex was right

You took the handle rule and declined to also add `/^(\+\d+ more|Show less)\b.* 15$/`. Agreed, and
your reasoning is the better version of mine: two selectors for one element is a maintenance trap,
and a plan that is already prescriptive about queries should have exactly one prescription per
target. Do not swap it. The handle rule is also the *stronger* teaching — it tells the coder
something true about how the component reconciles, whereas a second regex would only have routed
around the problem.

For the record, tests 3 and 4 are the only specs that touch the toggle post-flip; tests 2, 5, 6 and 8
all query it while collapsed, so the single collapsed-state regex covers them and the handle rule
covers the rest. There is no gap left.

## R3-4 — Nits (no action required)

- The `waitFor` snippet at plan:277 uses an import the test file does not currently have
  (`CalendarView.test.tsx:4` imports `render, screen, within`). The coder will add it without being
  told; noting it only so it is not mistaken for a missing dependency at review time.
- `toggleLabel` is now built for all ~31 day cells per render, producing a nonsense
  `+-3 more items — …` string for quiet days. plan:211-212 already covers why that is safe (never
  read outside the `dayOccs.length > 3` branch). Harmless, and cheaper than a conditional.

## R3-5 — Re-confirmed clean

No new lint or typecheck surface in v3 (the only new code is two `const`s in step 3, both consumed).
Scope discipline unchanged: application-code diff still confined to two files with `docs/**` carved
out; no decision in §3 moved; nothing from round 1 or round 2 was weakened or dropped in the process
of folding round 2 in — I checked the round-1 items specifically, since that is where regressions
usually hide by revision three.

---

## Required changes (round 3)

1. **Fix §5.3 test 8's await (R3-2).** plan:327 still says "`await` the next month's chips", which is
   precisely what §5.2's third bullet forbids and was written to replace. Point it at the settle
   signal instead. One phrase; nothing else in the test changes.

That is the entire list. It is a single-phrase correction with no design consequence, so **this does
not need another review round** — make the edit and hand the plan to the coder. Everything else in
v3 is complete and verified, and the plan is in materially better shape than most that reach
implementation in this repo: the two tests that would have silently proven nothing (8 and 6) now
bite, the accessible name is WCAG-correct, and every non-obvious constraint the component imposes on
its tests is written down rather than left to be rediscovered.

APPROVE WITH CHANGES

---

# Round 4 — 2026-08-22

Delta verified. I re-read v4 in full rather than diffing the two changed regions, specifically to
confirm the "nothing else changed" claim rather than accept it.

**R3-2 is resolved.** §5.3 test 8 (plan:330-333) now reads "click `›`, then **await the `Loading…`
settle signal per §5.2** — *not* a `findBy*` on a chip, which is hollow here for the reason that
bullet gives". That is consistent with §5.2's third bullet (plan:279-296) in both instruction and
prohibition, and it points at the reason rather than restating it, so the two cannot drift apart
again. The contradiction is gone.

**Nothing else moved.** §§1-4, 5.1, 5.2, 5.3 tests 1-7 and 9, and §§6-8 are unchanged from v3;
Decisions 1-6 are unchanged from v2. All source citations still resolve (the cited files have not
changed since round 1). Cross-references re-checked and all consistent: §5.1's fixture table matches
the days used by tests 5, 6 and 8; §5.2's selector regex matches test 2's; the handle rule's "tests 3
and 4" matches the only two specs that touch the toggle post-flip; §6's "all nine tests" matches the
nine in §5.3; R1/R4/R5 point at tests 8/9/6 respectively.

**The v4 revision-history entry is accurate and worth keeping.** Test 8 was vacuous in v1 (no
next-month fixture), carried a hollow await in v2 (introduced by the union fixture), and in v3 kept
the hollow instruction in §5.3 after §5.2 had overruled it — three revisions, three distinct defects,
exactly as stated. Putting the "re-read §5.2 first" warning in the plan rather than only in this
review is the right call: the next person to touch that test will have the plan open, not this
thread.

**One non-blocking observation, recorded rather than required.** The button's `onClick` wiring
(`onClick={() => toggleDay(dayKey)}`) is never written literally — §4 step 2 defines `toggleDay`,
step 3 defines `dayKey`, and step 5 says "the button per Decisions 2-5", but the line that actually
makes the control do anything is left to inference. There is exactly one way to write it, and tests 3
and 4 fail loudly if it is missing, so this is self-catching and I am not asking for a change. Noting
it only so it is on the record that I saw it and judged it harmless, rather than missed it.

I have no reservation left. The verdict below is on substance — the round-3 item is genuinely fixed
and my sweep of the rest turned up nothing new that a coder would trip on. If it had, I would have
said so and taken the fifth round.

APPROVE

---

# Round 5 — 2026-08-22 (post-approval, v5)

Sending a plan back after an APPROVE is the right call, and so is the framing: the nine-test spec I
signed off shipped a visible defect. Before anything else — **I missed this too, across four
rounds**, and I missed it for a diagnosable reason worth writing down, because it generalizes past
this plan. I spent rounds 1-3 asking "would this test pass against a *wrong implementation of the
behavior*?" and never asked "would it pass against a *right behavior rendered wrong*?" Every guard I
demanded was a behavioral guard. The suite ended up with no presentational guard at all, and I
approved it.

Answers to the four questions, then the sweep, which found one more instance.

## R5-1 — Q1: yes, test 10 closes the hole. Re-derived, not taken on trust.

**Against the shipped implementation** (`<button …>{toggleLabel}</button>`, no `aria-label`):
`textContent` is `+2 more items — August 15`. jest-dom's `toHaveTextContent` with a **RegExp**
argument runs `.test()` against the whitespace-normalized text content, so the anchored
`/^\+2 more$/` requires the whole string to be exactly `+2 more`. It is not → **fails**. Correct.

**Against the corrected implementation** (`<button aria-label={toggleLabel}>{toggleText}</button>`):
`textContent` is `+2 more` → `/^\+2 more$/` passes; the accessible name resolves from `aria-label`
to `+2 more items — August 15` → `/^\+2 more items — .+ 15$/` passes. Both halves green. Correct.

So test 10 discriminates, and it is the *only* test in the spec that does — I re-checked the other
nine against the shipped implementation and every one of them passes on it, exactly as you found.
The accessible-name half of test 10 also passes on both implementations (name falls back to text
content), so to be precise about which assertion is doing the work: **the text-content half is the
entire guard**, and the accessible-name half is there to pin WCAG (R5-2). That is fine, but it means
the guard is one anchored regex deep, which leads directly to:

**R5-1a — the footgun that would make test 10 vacuous, and it must be in the plan.** `toHaveTextContent`
performs a **substring** match when passed a *string* and a full `.test()` when passed a *RegExp*. So
`expect(toggle).toHaveTextContent("+2 more")` — the form a coder will type by reflex, and which reads
as obviously equivalent — **passes on the shipped implementation**, because `+2 more` is a substring
of `+2 more items — August 15`. The anchored regex form is load-bearing and the string form silently
is not. Given that this plan's entire history is tests that looked right and proved nothing, that
distinction cannot be left to the coder's knowledge of jest-dom's overload semantics. Say it in
test 10.

## R5-2 — Q2: WCAG 2.5.3 still holds, in all three states

Label-in-Name requires the visible label text to be contained in the accessible name; the plan's
stronger self-imposed rule is that it be a **prefix**. With the split strings:

| State | Visible (`toggleText`) | Accessible name (`toggleLabel`) | Prefix? |
| --- | --- | --- | --- |
| Collapsed, ≥2 hidden | `+2 more` | `+2 more items — August 15` | ✓ |
| Collapsed, 1 hidden | `+1 more` | `+1 more item — August 15` | ✓ |
| Expanded | `Show less` | `Show less — August 15` | ✓ |

The singular branch is the one worth double-checking, since the two strings diverge there
(`item` vs `items`) — `+1 more` is still a clean prefix of `+1 more item — …`. Holds.

Worth noting the split *improves* the situation rather than merely preserving it: before v5 the
property was true but unobservable, because visible text and accessible name were the same string.
Now they are genuinely different strings and test 10 asserts both, so 2.5.3 is verified rather than
assumed — for the first time in this plan.

## R5-3 — Q3: the sweep. One more live instance, plus three low-severity residuals.

I re-read all ten specs asking only "could a *visibly wrong* implementation pass this?"

**R5-3a — test 9 has the same defect, and it is currently shippable. This is the finding.**

Decision 4 gives the button's className verbatim and calls the layout classes "load-bearing and not
optional" (plan:156-160). Test 9 asserts that the className contains exactly **two** of those twelve
classes: `ring-offset-background` and `focus-visible:ring-2`. Everything else in Decision 4 is
specified and unasserted. Concretely, an implementation that renders

```tsx
<button className="focus-visible:ring-2 focus-visible:ring-offset-background" …>
```

passes all ten tests. What ships is a control with **no `text-[10px]`** — and Tailwind preflight sets
`font-size: 100%` on buttons, so it inherits 16px into a day cell whose other content is 10-11px. A
glaring 16px `+2 more` in a one-seventh-width cell is a worse visual defect than the one that
prompted this round, and it is exactly as invisible to the suite. Dropping `block w-full text-left`
is milder but real: the tap target shrinks from full-cell-width to text-width, and the focus ring
stops aligning with the chips' rings directly above it.

Since Decision 4 already mandates the string **verbatim**, the fix is cheap: assert the whole class
list, or at minimum add `text-[10px]`, `text-muted-foreground`, `block`, `w-full` and `text-left` to
test 9. I'd assert the full string via a shared const — the plan mandates verbatim, `cn()` is not
involved (it is a static string, so there is no tailwind-merge reordering), and a verbatim assertion
against a verbatim spec has no drift surface. If you prefer robustness to strictness, split
`className` on whitespace and assert set membership for each required class.

**R5-3b (low) — every chip assertion is a name assertion, not a text assertion.** Tests 1, 3, 4, 6
and 8 all phrase themselves as "day 15 *shows* `D15 Item 1..3`" but query by accessible name, which
for a chip comes from its `aria-label` (`CalendarView.tsx:156`) — derived from `occ.item.title`, not
from the rendered text node. A chip rendering the wrong text (or none) with a correct label would
satisfy all five. Severity is genuinely low: §2 forbids chip changes and step 4 alters only
`slice(0, 3)` → `visibleOccs`, so nothing in this diff can break chip text. But if you want the
belt-and-braces version, one `getByText("D15 Item 4")` inside test 3 pins that the *revealed* chip is
actually readable, which is the user-facing claim the whole change is about. Optional.

**R5-3c (low) — `type="button"` is specified in Decision 3 and asserted nowhere.** No live defect
today (the button has no form ancestor, so the `submit` default is inert), but Decision 3 invokes the
`fix-item-save` history explicitly, and `expect(toggle).toHaveAttribute("type", "button")` is one
line. Optional.

**R5-3d (low) — nothing pins that the toggle renders *after* the chips.** Decision 5's entire
accepted-cost analysis rests on that DOM order, and reversing it would visibly put the `+2 more` line
*above* the items. Step 5 says "replace the `<div>` at `:163-165`", so getting it wrong takes effort.
Mention only; I would not add a test.

**R5-3e — the one thing no jsdom test can cover, and it is the bug being fixed.** If anyone adds
`overflow-hidden` or a `max-h-*` to the day cell (`CalendarView.tsx:136`), the revealed items are
visually clipped while remaining in the DOM and the accessibility tree — so all ten tests stay green
and the original bug is back. Decision 6 forbids it in prose; nothing can assert it. This is the
honest limit of the strategy and it belongs on a manual list, not in the suite. See R5-4.

## R5-4 — Q4: test 10 is not sufficient on its own. Add the standing rule.

You asked whether the plan needs a standing rule or whether test 10 covers it. **The rule.** The
proof is R5-3a: I found test 9's gap by applying the rule as a lens, and I would not have found it by
reading test 10. Test 10 fixes one instance; the rule is what makes the next instance findable.
Suggested §5.2 bullet:

> **Assert visible properties on the rendered output, never through a derived query.**
> `*ByRole({ name })` and `toHaveAccessibleName` both resolve the *accessible name*, which falls back
> to text content when there is no `aria-label` — so neither can distinguish "correct label" from
> "label leaked onto the screen". For any element whose visible text differs from its accessible
> name, assert **both, on the same element**, and use **anchored regexes**: `toHaveTextContent` does a
> substring match when passed a string and only a full match when passed a RegExp. For visible
> properties with no accessible-tree analogue at all — typography, layout, clipping — assert the
> class list against the verbatim string the plan specifies; and where even that is impossible in
> jsdom, put it on the manual list in §6 rather than pretending the suite covers it.

Two companions I'd fold in with it:

- **A manual-verification list in §6.** Right now §6 is four commands and a test count, and R4's only
  mitigation is a *static class assertion* standing in for a rendered appearance — a proxy whose
  limits v5 just demonstrated. Three lines would do it: dark-mode focus ring shows no white halo;
  an expanded day grows rather than clipping (R5-3e); the toggle text fits a day cell at real width.
  I asked for this in round 1 as F4-i and accepted test 9 as the answer. That was the wrong trade and
  I'd like it on the record as mine.
- **An R6 in §7** naming the class — "a visible property verified only through a derived query" —
  mitigated by test 10 and the §5.2 rule. §7 is the register a future editor reads, and this is now
  empirically the most frequent failure mode in this plan's history: three times on test 8, once on
  the visible label.

## R5-5 — Defects in the v5 edit itself

- **R5-5a — the numbered list is out of order: test 10 is placed between tests 8 and 9**
  (plan:365-380). Markdown auto-numbers ordered lists by position, so the *rendered* plan shows
  "Visible text is NOT the accessible name" as **9** and "Dark-mode focus ring" as **10** — the
  reverse of the source. §7's R4 says "verified by test 9" (plan:404) and now points at the wrong
  test in the rendered view, and every prior reference in this review to "test 9" flips meaning
  depending on which form you read. Move it after test 9, or renumber.
- **R5-5b — test 10's expanded half says "assert the collapsed pair too"** (plan:367-368) immediately
  after "Then expand". It means the *expanded* pair. In a spec whose whole subject is two states with
  two strings each, that word has to be right.
- **R5-5c — test 10's expanded half is weaker than its collapsed half.** It asks only for
  "accessible name ending ` 15`", which does not pin the `Show less — ` prefix — i.e. it does not
  verify Label-in-Name for the expanded state, which is half of what R5-2 is for. Use
  `/^Show less — .+ 15$/`, matching the shape of the collapsed assertion.
- **R5-5d (nit)** — §5.2's handle bullet still scopes itself to "(tests 3 and 4)" (plan:321).
  Test 10 also grabs the toggle, expands, and re-asserts on the same element, so it belongs in that
  list.

Everything else in v5 checks out: Decision 3's rewrite (plan:131-145) is accurate and its explanation
of *why* the date belongs in the name but not on screen is the right justification; §4 step 3 derives
both strings with a pointer to Decision 3 (plan:234-237); §6's count is updated to ten (plan:390).
Nothing else in the file moved.

---

## Required changes (round 5)

1. **Extend test 9 to cover the rest of Decision 4's className (R5-3a).** Asserting two of twelve
   classes leaves a currently-shippable visible defect: dropping `text-[10px]` gives a 16px control
   in a 10px cell (preflight sets `font-size: 100%` on buttons) and passes all ten tests. Assert the
   verbatim string, or at minimum add `text-[10px]`, `text-muted-foreground`, `block`, `w-full`,
   `text-left`.
2. **State the `toHaveTextContent` string-vs-RegExp trap in test 10 (R5-1a).** The string form is a
   substring match and passes on the shipped implementation; only the anchored RegExp form is
   load-bearing. Without this note the new guard can be written vacuous on the first try.
3. **Fix test 10's placement and wording (R5-5a, R5-5b, R5-5c):** move it after test 9 (or renumber)
   so rendered numbering matches §7's "test 9" cross-reference; "collapsed pair" → "expanded pair";
   tighten the expanded accessible-name assertion to `/^Show less — .+ 15$/`.
4. **Add the visible-vs-derived standing rule to §5.2 (R5-4).** Test 10 fixes the instance; the rule
   is what makes the next one findable — R5-3a is the evidence.
5. **Add a short manual-verification list to §6 (R5-4).** Dark-mode focus ring, expanded day grows
   without clipping, toggle text fits the cell. R4's static-class proxy is not a substitute, and
   R5-3e is not assertable in jsdom at all.
6. *(Recommended, not required)* Add R6 to §7 naming the defect class. *(Optional)* R5-3b's
   `getByText` on a revealed chip; R5-3c's `type="button"` assertion.

Items 2, 3 and 5 are wording; item 1 is the only one that changes what the coder must implement, and
it changes only the test file — the `aria-label` code fix already in flight is unaffected by all six
and should not be held up. I would rather see this one come back for a sixth round than sign it
again on the strength of "the changes are small", which is the reasoning that got us here.

APPROVE WITH CHANGES

---

# Round 6 — 2026-08-22 (v6)

All six round-5 items are folded in and correct: test 10 now carries the four anchored assertions as
a literal block with the RegExp-not-string reason stated as an overload difference (plan:390-413);
test 9 asserts Decision 4's whole string with the `text-[10px]` / preflight consequence spelled out,
and is renamed away from the focus-ring framing that made a two-class subset look sufficient
(plan:380-388); §5.2 has the standing rule (plan:327-334); §6 has four manual checks explicitly
labelled as covering what jsdom cannot, in the words I'd have chosen (plan:425-434); the ordered list
renders 8, 9, 10 in sequence; the garbled expanded half is gone.

It is not quite clean. The sweep found one residual that deserves promotion, and the v6 edit itself
introduced one stale cross-reference. Both are one-line fixes.

## R6-1 — Q1: the rule generalizes about two-thirds of the way

The framing sentences are portable and would survive being lifted into another test file: *"Never let
a derived property stand in for what the user sees"* and *"When an assertion is about appearance —
what string is rendered, at what size, in what element — assert the rendered thing directly."* Naming
this plan's own defect as evidence rather than as the subject is the right use of a war story, and
listing `tagName` alongside `toHaveTextContent` and `className` already gestures past the accessible
name. So it is not a monument.

Two things stop it from being genuinely reusable in six months:

**R6-1a — it names one derived property, not the shape of the class.** A reader takes away "watch out
for accessible name." The portable version is a falsification question: **"what would this assertion
still pass on? If any answer is a rendering a user would call broken, it is a proxy."** That question
is what makes the rule usable against derived properties this plan never met — `toBeVisible()`, which
in jsdom cannot see Tailwind's class-driven layout at all and so passes on genuinely invisible
elements; `toHaveAccessibleDescription`, with its own `aria-describedby` → `title` fallback chain
(relevant here — the chips carry `title` at `CalendarView.tsx:153`); role queries generally. One
sentence buys all of them.

**R6-1b — it stops at the first rung of a three-rung ladder, and the missing rungs are the ones that
found test 9.** The rule says "assert the rendered thing directly (… `className` …)" — full stop. But
round 5's actual lesson was that a class assertion is *itself* a proxy, which is why it must be
**complete rather than a subset**, and why anything with no jsdom analogue at all goes on a **manual
list**. Test 9 and §6 both now say this locally; the rule does not carry it. Someone applying the
rule in a different file lands on "assert className" and stops — which is precisely the mistake test
9 made in v5. The ladder is: *rendered thing* → *complete class string, never a subset* → *manual
check in §6*.

Neither is a blocker. The rule as written would have caught the v5 defect and would catch the whole
accessible-name family. But you asked whether it is useful to a stranger, and honestly: with those
two sentences, yes; without them, it teaches the instance and half the lesson.

## R6-2 — Q2: not clean. One residual is the next test 9.

Re-ran the lens over all ten specs.

**R5-3c upgrades from LOW to MEDIUM, and needs reframing — nothing in the suite pins that the control
is a native `<button>`.**

I originally rated this as "`type="button"` is unasserted, no live defect." Applying the falsification
question to test 2 gives a much worse answer than I got in round 5. Test 2 says:

> `getByRole("button", { name: … })` resolves (**proving it is genuinely a button, which is the fix**)

That is not what the query proves. `getByRole("button")` matches computed role, so it resolves
identically against `<div role="button" tabIndex={0}>`. And that substitution is not cosmetic — it
breaks the **entire point of the change**: a native `<button>` activates on both Enter and Space,
while a `role="button"` div activates on neither without an explicit `onKeyDown`. The control would
be focusable and visibly identical and completely dead to the keyboard, and all ten tests would pass,
because `userEvent.click()` dispatches a mouse event that works on a div.

So: same species as the v5 defect — a claim that a derived query proves a concrete rendering property
— sitting four lines above the new rule that forbids exactly that reasoning, in a test whose own prose
asserts the proof it does not deliver.

**The decisive evidence is already in the file, and it is untouchable.** The pre-existing chip test
does this correctly:

```
87	    const chip = await screen.findByRole("button", { name: /Team standup/ });
88	    expect(chip.tagName).toBe("BUTTON");
```

`CalendarView.test.tsx:88` exists *because* role is not enough, and it is one of the four tests §6
forbids modifying. The right pattern is sitting in the same file, and the new spec did not copy it.
Fix: add `expect(toggle.tagName).toBe("BUTTON")` to test 2 and correct the parenthetical to say what
the pair actually proves. `toHaveAttribute("type", "button")` is a reasonable freebie on the same
line, though the `submit` default remains inert here (I re-checked: no `<form>` ancestor — the grid
sits in plain `<div>`s, and `ItemModal` is a portal, not an ancestor).

Note the rule already prescribes the fix — `tagName` is in its own list of direct assertions. That is
the strongest evidence I can offer for Q1: the rule generalizes well enough that applying it once
more found a second instance. It just was not applied to test 2.

**The other two residuals hold at LOW, with one caveat worth recording.**

- **R5-3b (chip visible text asserted nowhere)** — stays LOW, but I want the *reason* stated precisely,
  because it is contingent: it is low because the prescribed diff cannot reach it (step 4 changes only
  `slice(0, 3)` → `visibleOccs`, §2 forbids chip changes), **not** because the assertions are strong.
  Every chip assertion in tests 1, 3, 4, 6 and 8 resolves `aria-label`, which is derived from
  `occ.item.title` and not from the rendered text node. The moment anyone touches chip markup, five
  tests silently stop covering what they appear to cover. One `getByText("D15 Item 4")` in test 3
  would pin the feature's actual user-facing claim — that a revealed chip is *readable* — for one
  line. Optional, but it is the cheapest insurance in the file.
- **R5-3d (DOM order unpinned)** — stays LOW. Step 5 says "replace the `<div>` at `:163-165`", so
  inverting it takes deliberate effort. Worth noting that none of §6's four manual checks names it
  either; appending "…and sits below the chips" to manual check 2 closes it for free.
- **R5-3e (clipping)** — now properly covered by §6 manual check 4, including the observation that the
  whole suite stays green. Resolved.

## R6-3 — v6 introduced one stale cross-reference

**§7's R4 is now false.** plan:447-448 still reads "R4 — dark-mode focus halo. Mitigated by
`ring-offset-background` (Decision 4) and **verified by test 9**." But v6 deliberately renamed test 9
away from the focus-ring framing, and §6 now states that its class assertion is a *proxy* and puts the
actual halo verification in manual check 1. R4 as worded still claims the proxy is the verification —
the exact belief round 5 dismantled. It should read: class presence pinned by test 9, rendered result
verified by §6 manual check 1.

Small, but this is the risk register a future editor reads, and it currently tells them the opposite
of what v6 concluded.

## R6-4 — Nits

- §5.2's handle bullet still scopes itself to "(tests 3 and 4)" (plan:336). Test 10's code block
  reuses one `toggle` handle across the flip, so it belongs in that list. The plan is consistent in
  practice; only the enumeration is stale.
- §7 still has no R6 for the defect class ("a visible property verified only through a derived
  query"). I marked this optional in round 5 and it stayed optional — but since R4 needs an edit
  anyway, adding it costs one line and gives the lesson a home in the register rather than only in
  §5.2's prose.

---

## Required changes (round 6)

1. **Test 2 must pin the native element (R6-2).** Add `expect(toggle.tagName).toBe("BUTTON")`,
   mirroring `CalendarView.test.tsx:88`, and correct the prose — `getByRole("button")` matches
   computed role, so it does not prove "genuinely a button". A `<div role="button">` passes all ten
   tests and is dead to Enter and Space, which is the change's whole purpose.
2. **Fix §7's R4 (R6-3).** Test 9 no longer verifies the dark-mode halo; it pins the class string as a
   proxy, and §6 manual check 1 is the verification. R4 currently asserts what round 5 disproved.
3. **Add the falsification question and the escalation ladder to §5.2's rule (R6-1a, R6-1b).** Two
   sentences: *"what would this assertion still pass on?"*, and *rendered thing → complete class
   string, never a subset → manual check*. Without them the rule teaches the instance rather than the
   class — which is what you asked me to check.
4. *(Nits)* Handle bullet "(tests 3 and 4)" → add 10; optionally add R6 to §7 while editing R4;
   optionally append "…and sits below the chips" to §6 manual check 2, and one `getByText` on a
   revealed chip in test 3 (R5-3b).

Item 1 is the only one that changes what gets implemented, and like round 5's it touches only the
test file — the test-9 tightening already in flight is unaffected and should not be held up. You
offered a seventh round if it was not clean; it is not, but only by one real line.

APPROVE WITH CHANGES

---

# Round 7 — 2026-08-22 (v7)

All four changes verified: test 2 now asserts `tagName`, `type` and `aria-expanded` after resolving
by role, with the `<div role="button">` substitution and its Enter/Space consequence stated and
`CalendarView.test.tsx:88` named as the existing precedent (plan:367-385); §5.2's rule is rebuilt
around the falsification question (plan:333-352); §7's R4 no longer claims test 9 verifies the halo
and tells a future editor not to restore that wording (plan:480-483); §6's count line notes test 2's
three assertions (plan:457).

## R7-1 — The §5.2 rule now generalizes

It leads with the question rather than the instance — *"what would this still pass on?"* — and gives
three worked examples of the **class** (accessible-name fallback, computed role matching
`<div role="button">`, `toBeVisible()` being near-useless against Tailwind in jsdom) rather than one
instance three ways. Both rungs are there: assert the complete value never a subset, citing v5's
2-of-14; and pair proxies with a §6 manual check. Someone who has never seen this component could
lift that bullet into a different test file and get value from it. That was the bar you set, and it
clears it.

## R7-2 — Keyboard-operability sweep: clean

You set the bar at "would ship a control that is broken rather than merely imperfect," so I walked
the operability surface exhaustively rather than re-reading the specs. For each way this control
could ship broken, what pins it:

| Failure | Pinned by |
| --- | --- |
| Not reachable by keyboard | Native `<button>` is in the tab order by default; `tagName` assertion (test 2). Nothing in the plan introduces `tabIndex` |
| Reachable but not activatable (Enter/Space dead) | Same `tagName` assertion — this was round 6's finding and it is now closed |
| Activatable but focus invisible | Test 9's **complete** class string. The dangerous combination is `focus-visible:outline-none` surviving while the ring classes are dropped; a subset assertion would have allowed it, the whole-string assertion does not |
| Announces without state | `aria-expanded` asserted `"false"` initially (test 2) and `"true"` after (test 3), on the same node |
| Announces without identity | Test 10's accessible-name half, both states |
| Present but inert (`disabled`, `pointer-events-none`) | Test 9 — neither class can be added without failing the whole-string comparison |
| Tap target collapses on mobile | Test 9 — `block w-full` is inside the pinned string |
| Toggling does not toggle | Tests 3 and 4 assert the state flip behaviorally |
| Revealed items unreachable — the original bug | Test 7 clicks a previously hidden chip and asserts the right item's dialog; §6 manual check 4 covers the clipping variant jsdom cannot see |
| Keyboard trap on expand | Decision 5 adds no focus management at all; the toggle's DOM node survives the flip, so focus stays put |
| Day cell swallowing events | `CalendarView.tsx:133-135` confirms the cell has no `onClick`; the plan does not add one |

I also re-checked the remaining derived assertions specifically for *breaking* failure modes rather
than cosmetic ones. Test 5's null-check resolves a derived name, but its failure mode is a spurious
`+0 more` on a 3-item day — confusing, not broken. The chip queries in tests 1, 3, 4, 6 and 8 resolve
`aria-label`, but a chip with a correct label and wrong text is still a native button with a working
handler, so it stays reachable and activatable. Neither reaches your bar.

Nothing left in the operability class. I could not construct a v7-conformant implementation that
ships a control a user cannot reach, see, activate, or understand.

## R7-3 — Your R5-3b judgement is right; leave the chip tests alone

Three reasons, and I'd have made the same call:

1. It does not meet the bar you set — a chip with a correct `aria-label` and wrong visible text is an
   appearance defect, not an operability one.
2. It is unreachable from the prescribed diff. Step 4 changes only the map's source
   (`dayOccs.slice(0, 3)` → `visibleOccs`); §2 forbids chip changes; nothing else in §4 touches that
   markup.
3. Widening into the chip tests spends the scope discipline that §2 and §6 have held for seven
   rounds, in a file where four tests are explicitly protected. Every extra test touched is a chance
   to break one of them.

My round-6 note was about recording *why* the rating is low — it is contingent on §2's non-goal
holding, not on the assertions being strong — so that the next person to touch chip markup knows five
tests will silently stop covering what they appear to. That is a note for the future, not a change
request now. Leaving it is correct.

## R7-4 — One open nit, deliberately not a change request

§5.2's handle bullet still scopes itself to "(tests 3 and 4)" (plan:354) while test 10's code block
also reuses one `toggle` handle across the flip. The plan is consistent in *practice* — test 10's
snippet does the right thing — and this is wording, which you have reasonably ruled out as grounds
for another round. Recorded here so it is not silently dropped; do not spend a round on it.

---

No required changes. The plan is clean at the bar you set, and the remaining appearance questions are
correctly routed to QA in a real browser via §6's four manual checks — that is the right tool for
them, and it is the honest place for the properties jsdom cannot reach.

For the record across seven rounds: three defects would have shipped green — a vacuous month-nav
guard, a label rendered into the day cell, and a control that could have been dead to Enter and
Space. The first was caught by a behavioral lens, the second by neither of us until it shipped, and
the third by the rule written in response to the second. That last one is the argument for §5.2's
rule earning its place in the file rather than only in this review.

APPROVE
