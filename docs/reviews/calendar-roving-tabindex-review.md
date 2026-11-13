# Review: `docs/plans/calendar-roving-tabindex.md`

Reviewer: Plan-Reviewer (adversarial)
Date: 2026-08-22
Plan revision reviewed: v1 (2026-08-22)
Round: 1

**Scope note.** The owner has read §1.4 and chosen to implement at §3's scope. This review does
**not** re-litigate go/no-go or the §10 option D question. §10 alternatives are discussed only under
"Alternatives not considered", and are explicitly marked informational.

---

## 0. What I verified, and what checked out

I read `web/src/components/CalendarView.tsx` and `CalendarView.test.tsx` in full,
`docs/plans/calendar-show-more.md` §5.2, `docs/reviews/calendar-show-more-review.md`'s standard, and
every file the plan cites a line number in. The citation hygiene in this plan is unusually good —
I could not find a single wrong line reference. Specifically confirmed:

- `Card` forwards arbitrary div props (`web/src/components/ui/card.tsx:5-13`), so
  `onFocus`/`onKeyDown` on it need no wrapper. Plan §7 step 5 is right.
- `web/src/lib/calendarFocus.test.ts` will be collected — `vitest.workspace.ts:46` includes
  `web/**/*.test.ts` and the comment at `:42-45` says the glob was widened for exactly this case.
- Tailwind `^3.4.19` (`package.json:57`) and user-event `^14.6.1` (`package.json:42`) as claimed.
- Lint baseline 0 errors / 2 warnings (`docs/backlog.md:147`), `exhaustive-deps` is `warn`
  (`eslint.config.js:53`).
- `ItemModal.tsx:121-127`'s `handleCloseAutoFocus` and `:42/:48/:53/:59`'s `triggerRef` capture are
  exactly as described. The jsdom precedent for Escape→restore is real
  (`ItemListView.test.tsx:196-209`), as is the Enter-activates-a-button precedent
  (`ItemListView.test.tsx:184-193`).
- §1.2's DOM-order argument against the backlog's stated motivation is **structurally correct**.
  `App.tsx:154` (`hidden … md:flex`), `:190` (`md:hidden`), `:254` (`fixed … md:hidden`), and
  `</nav>` at `:274` is the last child of the root div (`:275`). On desktop there genuinely is
  nothing focusable after `<main>`.

**§8.1's claim that all 15 existing tests pass unmodified: I checked it rather than accepting it,
and it holds.** Count is right (3 + 1 + 1 + 10 = 15). The ten from PR #20 assert `tagName`, `type`,
`aria-expanded`, exact `className` (`:398-400`), text content vs accessible name (`:417-418`,
`:422-423`), and presence/absence by title — the plan changes none of those. Two mechanisms I
checked specifically because they are the plausible breakers:

- Test 3/4 (`:273-307`) grab the toggle handle while collapsed and reuse it across the flip. Adding
  `data-cal-id`/`tabIndex` does not change the element's position in the day cell (still slot 2), so
  the in-place-update property `calendar-show-more.md:354-361` depends on survives.
- Test 8 (`:351-383`) clicks the toggle (which focuses it → `setRememberedId("t-15")`), then navs.
  Next month's day 15 also has 5 items, so `t-15` still resolves and `resolveRovingId` returns it.
  No assertion in test 8 touches `tabindex`. Green either way. **But see F4 — this same fact
  falsifies edge case E2.**

**Decision 2's geometry claim is correct, and I want to say so explicitly since the plan flags it as
"looks like an omission".** `CalendarView.tsx:137-144` renders exactly 7 weekday headers (one full
grid row), `:147-149` renders exactly `firstDayOfWeek` blanks, and `:152` renders days `1..numDays`
in ascending order with no gaps. Day `d` therefore sits at grid index `7 + firstDayOfWeek + (d-1)`,
so `column(d) = (firstDayOfWeek + d - 1) mod 7` and `column(d±7) = column(d)` unconditionally. The
month boundaries fall out of the same identity: `d - 7 < 1` ⇔ there is no cell directly above, and
`d + 7 > numDays` ⇔ there is no cell directly below, **regardless of how many leading blanks there
are**. Dropping `firstDayOfWeek` from the helper is right. One caveat worth a code comment (F13).

Decision 3's `+N more` claim also follows from the code: the toggle is rendered after the chip map
(`CalendarView.tsx:202-217` vs `:184-201`), the plan's id order is `[...chips, t-day]`
(`docs/plans/calendar-roving-tabindex.md:621-624`), and expansion only appends to `visibleOccs`
(`CalendarView.tsx:157`). So `ArrowUp` from `t-15` lands on the last revealed chip, and it moves
visually upward. The claim is sound.

Decision 8's derived-`tabIndex` approach also holds up under re-render: `dayCells` is rebuilt from
`byDay`/`expandedDays` every render, `rovingId` is recomputed from it, and no `.focus()` is called
outside the keydown handler — so a `reloadToken` refetch or a month nav cannot move focus. The
"zero `useEffect`s" claim is achievable as specified.

Finally: wrapping the `Card` in Decision 7's `group/cal` div is layout-neutral. The parent at
`CalendarView.tsx:114` is a class-less `<div>` and `<main>` (`App.tsx:223`) is not a flex container,
so an extra block-level wrapper changes nothing. The coder should not worry about that part.

---

## 1. Blocking findings

These are all in §8, which is where this review was asked to concentrate, and they are all the same
species of defect that rounds 5-7 of `docs/reviews/calendar-show-more-review.md` were about: an
assertion that passes on the wrong implementation.

### F1 (blocking) — C1's Shift+Tab step is both mis-sequenced and non-discriminating

`docs/plans/calendar-roving-tabindex.md:795` specifies, in order: focus `›` → `user.tab()` → assert
A1 focused → assert B1 `tabindex="-1"` → `user.tab()` again → assert none of the seven grid elements
focused → "Finally `await user.tab({ shift: true })` from the roving chip → `expect(nextMonthBtn).toHaveFocus()`".

Two problems.

**(a) Focus is not on the roving chip at that point — it is on `document.body`.** The preceding step
tabbed *out* of the grid, and in a standalone `CalendarView` render there is nothing focusable after
the `Card` (the hint `<p>` is not focusable, `ItemModal` renders `null` when closed —
`ItemModal.tsx:109`). user-event v14's `tab()` lands on `document.body` at the end of the tabbable
list, and `tab({ shift: true })` from `body` goes to the **last** tabbable element in the document,
which is A1 (`‹`, `›`, A1 in DOM order) — not `›`. As written this assertion fails, and the most
likely coder response to a failing assertion in a plan-specified test is to weaken it.

**(b) Even sequenced correctly, Shift+Tab *from A1* proves nothing.** A1 is the first grid element in
DOM order, so Shift+Tab from it reaches `›` on **every** implementation, including one that never sets
`tabindex="-1"` on anything. §1.3 goal 1 is "Shift+Tab from a chip **in the last week of the month**
costs one keystroke" — the fixture has F1 on day 22 precisely for this, and the test does not use it.

Required: split the Shift+Tab assertion into its own step (or its own test) that explicitly focuses
**F1** first, then `user.tab({ shift: true })`, then asserts `nextMonthBtn` has focus. From F1 the
assertion is discriminating: it fails on any implementation that leaves A1/B1/E1-E3/toggle tabbable.

### F2 (blocking) — nothing tests the defining property of a roving `tabindex`

Every C-test either checks initial `tabindex` (C1), or checks that focus *moved* (C2-C8), or checks
`tabindex` after a modal close (C11). None of them checks that **the tab stop follows focus and the
grid is re-entered where you left it**. That is the entire point of the pattern, and an
implementation that computes `rovingId` once and never updates `rememberedId` (a broken or missing
`handleGridFocus`) passes C1 through C11 as specified — arrow keys still move DOM focus, Enter still
works, Shift+Tab still escapes. The only observable difference is re-entry.

Required: add a test that pins the transfer and the re-entry, e.g.

- focus A1, `{ArrowDown}` → E1 focused;
- `expect(A1).toHaveAttribute("tabindex", "-1")` **and** `expect(E1).toHaveAttribute("tabindex", "0")`;
- `await user.tab()` (out of the grid), then `await user.tab({ shift: true })` → `expect(E1).toHaveFocus()`
  and `expect(A1).not.toHaveFocus()`.

The final pair is what makes it bite: on the frozen-`rovingId` implementation, re-entry lands on A1.

### F3 (blocking) — C9's second half does not exercise the fallback it claims to

`:803` says the second half of C9 "proves the stale remembered id fell back rather than leaving the
grid with no tab stop". It does not. C9 never focuses anything inside the grid — it focuses
`nextMonthBtn`, which is outside the `Card` — so `rememberedId` is still `null` when the nav happens.
`resolveRovingId(days, null)` and `resolveRovingId(days, <stale id>)` return the same thing (the
first element), so the assertion passes identically on an implementation with **no stale-id handling
at all**, including one that would crash or blank the tab stop on a genuinely stale id.

Required: establish a remembered id first. Focus **A1** (day 8) before clicking `›`; the fixture's
next month has occurrences only on day 15, so `c-8-0` is genuinely absent after the nav and the
fallback branch is the only thing that can produce a tab stop. Then the existing
`expect(chipN1).toHaveFocus()` after `user.tab()` is load-bearing.

(The first half of C9 — `expect(nextMonthBtn).toHaveFocus()` after the nav settles — is genuinely
load-bearing and correctly specified. It is the R1 guard and it is the best test in §8.)

### F4 (blocking, correctness not just testing) — edge case E2 is factually wrong in the general case

`:557` states: "Month nav while a chip is focused … The remembered id is stale → falls back to the
new month's first element."

That is only true when the new month has no element at the same **positional** id. Because §5.2's
scheme is deliberately positional (`c-15-0`, `t-15`), a remembered id very often survives a month
nav pointing at a *different item*. The existing test 8 fixture is a live example: `t-15` exists in
both months (`CalendarView.test.tsx:220-238`), so navigating with the toggle remembered keeps the tab
stop on next month's toggle with no fallback whatsoever.

This is not necessarily wrong behavior — §5.2 property 3 argues positional ids are correct — but E2
asserts the opposite of what will actually happen, and a coder writing a test from E2 will write a
test that fails or, worse, one that only passes because of the coincidence in F3.

Required: correct E2 to state both branches (id survives positionally → tab stop stays at that
position in the new month; id absent → fallback to first element), and say which one §8's C9
exercises after F3's fix.

### F5 (blocking) — §8.2 has no month-boundary `ArrowUp` case

The pure suite covers `ArrowDown` at the column bottom (P4, `:758`), `ArrowRight` past the last
non-empty day (P8, `:762`), and `ArrowLeft` before the first (P10, `:764`). There is **no
`ArrowUp` at the top of a column** — the week-1 boundary this review was asked to check. That is the
one direction where the obvious naive implementation (`days[day - 1 - 7]`) indexes negatively and
returns `undefined` rather than `null`, or wraps via a `.at()` call to the end of the array. It is
also the direction P5 (`:759`) already exercises in its non-boundary form, so the boundary case is
the natural companion and its absence is conspicuous.

Required: add `ArrowUp` from `c-3-0` → `null`, and `ArrowUp` from `c-6-0` → `null`
(day 6 − 7 < 1 too, and it is a *different* column, which guards a shared-guard mistake). Also add
`nextFocusId([], "c-3-0", "ArrowDown")` → `null` for the empty-`days` case; P15 (`:769`) covers
`resolveRovingId` on an empty month but nothing covers `nextFocusId` on one.

### F6 (blocking) — C10's await is the hollow-await antipattern §5.2 exists to forbid

`:804` specifies `await screen.findByRole("heading")` as C10's settle point. With
`getOccurrences → { occurrences: [] }`, the heading (`CalendarView.tsx:120-122`) is present on the
very first render, so the `findBy*` resolves on attempt one — before the fetch promise settles. The
`setLoading(true)` → `setOccurrences` → `setLoading(false)` chain (`CalendarView.tsx:59-70`) then
lands after the assertions, producing "update not wrapped in act(...)" and an order-dependent test.
This is verbatim the failure `docs/plans/calendar-show-more.md:314-331` was written to prevent, and
this plan inherits that rule wholesale at `:703`.

Required: C10 must await the `Loading…` settle signal —
`await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument())` — the same
idempotent `waitFor` + `queryBy` form the existing test 8 uses (`CalendarView.test.tsx:367`).

### F7 (blocking) — no test pins the chip's `className`, which is exactly what R2's fallback rewrites

R2 (`:516-525`) names the mitigation for the top risk: "swap the chips' and toggle's
`focus-visible:` ring classes for `focus:`". The toggle's complete class string is pinned by an
existing test (`CalendarView.test.tsx:398-400`). **The chip's is not pinned by anything.** There is
no assertion anywhere in the file on `CalendarView.tsx:197`.

That matters twice over. First, §7 step 4 rewrites the chip's surrounding JSX (moving `visibleOccs`
into `dayCells`) and step 5 adds two attributes to the chip element — the plan's own safety argument
at `:630-633` ("if any of them changes, those tests fail loudly") is true for the toggle and false
for the chip. Second, if R2 does fire in QA, the chip half of the fix is unguarded, and losing
`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`
from the chips is precisely the WCAG 2.4.7 / dark-mode-halo class of defect that
`calendar-show-more` rounds 5-6 shipped once already.

Required: add a component test asserting the chip's **complete** `className` verbatim against
`CalendarView.tsx:197`, modelled on existing test 9. Cheap, and it converts step 4's refactor from
"trust me" into a caught error.

### F8 (blocking) — §1.2 bullet 3 and Decision 4's hint-rejection rest on a claim that is not true

`:59-61`: "Screen readers are not affected either way… A roving `tabindex` changes the **Tab
sequence only**." And `:299-302` rejects an `sr-only` hint because "the audience for the hint and the
audience for the feature do not overlap… Screen-reader users navigate by their own mechanisms and are
unaffected by `tabindex`."

The premise is right for iOS VoiceOver swipe navigation and for desktop browse-mode/virtual-buffer
navigation. It is **wrong for Tab**, which is a first-class navigation method for screen-reader
users — NVDA and JAWS both pass Tab through to the browser, and it is the standard way an SR user
moves between interactive controls. After this change, a Tab-navigating SR user reaches exactly one
chip in the month grid and is told nothing. Combined with Decision 7's `aria-hidden="true"` on the
hint (`:362`), the result is that **no assistive-technology user is ever informed that arrow keys
exist**, which is a stronger statement than the plan makes anywhere.

I am not asking for `aria-activedescendant` — it would be actively wrong here (it requires a
composite role on the container and DOM focus to stay *on* the container, which contradicts
Decision 1's real-focus-on-real-buttons model and would change announcement, which §2 forbids).
Decision 4's "change nothing" is defensible as a decision. What is not defensible is justifying it
with a false premise.

Required: pick one and say so explicitly.
  (a) Correct §1.2 bullet 3 and Decision 4 to acknowledge the Tab-navigating SR case, and record it
      as an accepted residual under R3 with the reasoning; **or**
  (b) drop `aria-hidden="true"` from Decision 7's hint so the one sentence is at least available to
      AT (it costs one extra swipe stop at the end of the grid on iOS, and it is honest).
My preference is (b) plus a corrected (a), but either is acceptable — what is not acceptable is
leaving the current justification standing, because the next reader will treat it as verified.

---

## 2. Non-blocking findings

### F9 — P12's expectation contradicts §8.2's own fixture

The fixture table gives day 24 a single id (`:749`), but P12 (`:766`) says `End` → `c-24-0` **and
also** instructs "extend day 24 to two ids for this case". If the coder extends the shared fixture,
`End` returns `c-24-1` and the stated expectation is wrong; if they do not, "last element" is
untested. Pick one — I would add a separate two-element last day (a P12b with its own small fixture)
rather than perturbing the shared one, since day 24 is also P4/P5/P8's subject.

### F10 — P7/E9's "crosses the week-row boundary" is not a property the pure module can express

`:761` and `:564` describe P7 (`ArrowRight` day 6 → day 8) as crossing a week-row boundary. The pure
module has no notion of rows — `DayFocusables` is a flat day list (`:460-463`) — and whether 6→8
actually crosses a row depends on `firstDayOfWeek`, which the module deliberately does not receive.
The test is still worth having (it pins "skips empty days" and would fail a
`Math.floor((day-1)/7)`-clamped implementation), but the row-crossing framing overstates what it
proves, and the same overstatement is in C4 (`:798`), where days 8→9 may or may not cross a row in
any given month. Reword; do not add row awareness.

### F11 — C11's `tabindex="0"` half is decorative

`:805` claims the `tabindex` assertion is "Decision 5's actual new claim… and nothing else asserts
it". It is trivially satisfied: `rememberedId` was already `c-15-0` from focusing E1 *before* the
modal opened, and nothing clears it while the modal is open. The assertion passes even if the
focus-restore path never fed the roving state (Decision 5 point 2, `:317-318`). Harmless, keep it —
but do not describe it as proving point 2, because point 2 is not observably falsifiable in this
component (the restored element is always the remembered one). Say that instead.

### F12 — C10's final assertion is near-vacuous

`expect(nextMonthBtn).not.toHaveFocus()` after a Tab (`:804`) passes on essentially any outcome. The
real content of C10 is "no throw" plus the exact button count, both of which are fine. If you want
the Tab step to say something, assert `expect(document.body).toHaveFocus()`.

### F13 — the `day ± 7` identity deserves a stated precondition in code

The identity is exact today, but it depends on the weekday header row being exactly 7 cells
(`CalendarView.tsx:137-144`). Adding a week-number column, or any other non-day cell into the same
`grid-cols-7` flow, silently breaks the column arithmetic while every test still passes (the pure
tests have no rows, and the component tests only assert day-to-day moves). §7 step 2 already asks for
a why-comment on the identity (`:602-603`); ask it to name that precondition explicitly.

### F14 — `Home`/`End` swallowing native page-jump is not disclosed

Decision 2's table (`:214-215`) has `Home`/`End` moving focus, and the handler `preventDefault`s
whenever a target is found (`:662`). That removes jump-to-top/bottom-of-page for a keyboard user
whose focus happens to be in the grid — which, on the Calendar view, is most of the page. This is the
standard composite-widget tradeoff and I am not asking to change it, but E5 (`:560`) carefully
documents the *arrow*-at-the-edge scroll preservation and says nothing about Home/End. Add a row, and
add it to manual check 3.

### F15 — the plan should say why Playwright is not the answer to R2

R2 is called the top risk and the gate is a human eyeball (`:832`). `package.json:14` has a
`test:e2e` script, so the obvious reviewer question is "why not assert
`el.matches(':focus-visible')` in a real Chromium?". The answer is that Playwright is not
bootstrapped — no config, no spec, `npm run test:e2e` no-ops (`docs/backlog.md:155`, and I confirmed
zero `*.spec.ts` files in the repo). That is a good answer and the plan should give it, otherwise a
future reader will assume it was not considered.

### F16 — §7's "steps 3 and 4 must land in the same commit" is off by one

`:584-586` says steps 3 and 4 must be co-committed, but step 3 is "create `calendarFocus.test.ts`"
(`:605`) and the two steps that actually must ship together are 4 (`dayCells` refactor, `:609`) and
5 (the roving mechanism, `:635`). The prose immediately after even describes them correctly ("step 3
alone is a no-op refactor" — that is step 4). A coder following the numbers literally would commit
the attributes without the handlers, which is the keyboard regression the sentence exists to prevent.

### F17 — iOS Full Keyboard Access is named as a beneficiary but not in the manual checklist

`:56` lists iOS Full Keyboard Access / Switch Control as a residual real case. FKA uses arrow keys
for its own element navigation, so there is a plausible conflict with the new keydown handler that
neither jsdom nor manual check 7 (`:844-845`, taps only) will surface. Low probability, low stakes,
zero users today — but if FKA is going to be cited as a justification in §1.2, it should get a
best-effort line in §9 the same way VoiceOver does at check 8.

---

## 3. Direct opinion on Decision 7 (the discoverability hint)

**Cut it.** The Architect asked for a direct answer, so: it is the weakest part of the plan, and the
three reasons are independent of each other.

1. **Its test has no discriminating power over its own claim.** C12 (`:806`) asserts the text, the
   `aria-hidden` attribute, and the verbatim class string. The claim in Decision 7 is "visible only
   while the grid contains a keyboard focus". Every one of C12's assertions passes on a hint that is
   permanently visible, permanently invisible, or visible on mouse click — the plan admits this
   (`"a proxy"`), but the honest reading is that the feature's entire behavioral contract rests on
   manual check 5 and nothing else. That is a worse test-to-risk ratio than anything else in §8.
2. **It has a functional flaw the plan does not note.** The hint renders *below* a 5-6 week grid.
   On the surface where it matters (a desktop browser, where §1.4 says the whole beneficiary
   population lives), a user who Tabs into the grid lands on the first chip near the *top*; on a
   short window the hint is below the fold, i.e. invisible at exactly the moment it fires. If it is
   kept, it should render **above** the `Card` — the `group-has-` variant works identically on a
   preceding sibling, so this costs nothing.
3. **It is the only part of the change that alters the rendered page for every user**, including the
   iPhone user for whom §1.4 concedes the change does nothing, and it is the only part introducing a
   first-in-repo CSS pattern (`:380`) whose stated fallback (`group-focus-within`) has different
   behavior. That is a lot of surface for one sentence.

Cutting is clean, as §7 step 6 and `:382-384` already describe. If the owner keeps it, the two
required changes are: move it above the grid, and resolve F8(b) on `aria-hidden`.

---

## 4. Alternatives the Architect did not consider

Informational only — I am **not** reopening scope. Both belong in §10 for the record, because §10's
five options are all "full roving" or "nothing", with no point in between.

- **Partial reduction: only the *first* chip of each day stays tabbable.** Chips 2..N and the toggle
  get `tabindex="-1"`; arrows still rove over everything. This takes the count from ~93+ to one per
  non-empty day (realistically <10 for this family), gets goal 1 to within ~10 keystrokes instead of
  1, keeps most of the Tab-to-a-day ability the change otherwise removes (Decision 0's and R3's
  entire worry), and needs no new mechanism beyond what §3 already specifies. Strictly worse than
  §3 on goals 1-2 and strictly better on R3.
- **`Escape` (or a single dedicated key) leaves the grid, with all tab stops kept.** ~5 lines, no
  pure module, no ARIA question, no discoverability regression at all, and it delivers §1.3 goal 1 —
  the one goal §1.2 identifies as unambiguously real — while leaving goals 2-4 unaddressed. Given
  §1.4's own cost/benefit, this is the highest value-per-risk point on the curve, and §10 does not
  mention it.

---

## 5. Other categories

- **Scaling / performance.** No concerns. R8 (`:546-550`) is the right call and its instruction not
  to pre-emptively memoize is correct — a day-cell extraction would break the single-`dayCells`
  invariant R4 depends on.
- **Security.** None. The `querySelector` interpolation is addressed at §5.2 property 2 with a
  correct argument (ids match `/^[ct]-\d+(-\d+)?$/` and are generated internally, never from item
  data), and the "do not embed `occ.item_id`" warning is the right guard rail.
- **Observability.** Nothing to add; this is a UI-local change with no runtime signal worth emitting.
- **Hidden coupling / breaking changes.** The one real coupling is §7 step 4's verbatim-expression
  requirement, and F7 shows it is only half-protected today. Fixing F7 closes it. `ItemModal`,
  `App.tsx`, and `ItemListView` are genuinely untouched.

---

## Required changes

1. **F1** — Fix C1's Shift+Tab step: it currently runs from `document.body` (nothing is focusable
   after the grid), and even sequenced correctly, Shift+Tab from A1 passes on an implementation with
   no roving at all. Re-focus **F1** (day 22) explicitly and Shift+Tab from there.
2. **F2** — Add a test for the roving pattern's defining property: after `{ArrowDown}` from A1,
   assert A1 is `tabindex="-1"` and E1 is `tabindex="0"`, then Tab out and Shift+Tab back and assert
   focus returns to **E1**, not A1. Nothing in §8 currently fails on a frozen `rovingId`.
3. **F3** — C9's second half must establish a remembered id first (focus A1 before clicking `›`), or
   it passes identically on an implementation with no stale-id fallback, because `rememberedId` is
   `null` at that point.
4. **F4** — Correct edge case E2: a positional id frequently *survives* a month nav (existing test
   8's `t-15` exists in both months), so "the remembered id is stale → falls back" is wrong in the
   general case. State both branches and say which one C9 covers.
5. **F5** — Add the missing month-boundary pure tests: `ArrowUp` from `c-3-0` → `null`, `ArrowUp`
   from `c-6-0` → `null`, and `nextFocusId` against an empty `days` array → `null`.
6. **F6** — C10 must await the `Loading…` settle signal, not `findByRole("heading")`, which resolves
   on the first attempt against an empty-month fixture. This is the exact antipattern
   `calendar-show-more.md:314-331` forbids and this plan inherits at `:703`.
7. **F7** — Add a component test pinning the chip's complete `className` (`CalendarView.tsx:197`)
   verbatim. It is unguarded today, it is what §7 step 4's refactor touches, and it is what R2's
   fallback would rewrite.
8. **F8** — Correct the "screen readers are not affected either way" premise in §1.2 bullet 3 and
   Decision 4: Tab is a normal SR navigation method and those users lose 92 of 93 chips from it.
   Then either accept it explicitly under R3 or drop `aria-hidden` from Decision 7's hint.
9. **F16** — Fix the off-by-one in §7's co-commit instruction: the steps that must land together are
   **4 and 5**, not 3 and 4.
10. **Decision 7** — Cut the hint (my recommendation, §3 above), or keep it with two changes: render
    it **above** the `Card` so it is not below the fold when it fires, and resolve F8's `aria-hidden`
    question. Either way, restate C12 as a proxy for manual check 5 rather than as coverage.
11. **F9-F15, F17** — fold in the non-blocking corrections, or record a one-line rejection for each.
    F13 (state the 7-header-cell precondition in the `calendarFocus.ts` comment) and F14 (disclose
    that `Home`/`End` swallow the native page jump) are the two I would most want kept.

APPROVE WITH CHANGES

---

# Round 2

Plan revision reviewed: v2 (2026-08-22, 1107 lines)
Date: 2026-08-22

Round 1's eleven required changes are all present and all correct. Two of them are better than
what I asked for: §8.4 is a falsification map I did not request, and it includes a row whose honest
answer is "*Nothing.*" (`:996`) — a plan volunteering that one of its own assertions is
non-falsifiable is the standard this thread has been trying to reach. I have one blocking finding,
which is new in v2 and is a consequence of the fix to F1/F2, plus four accuracy nits and one
recommended addition.

## 2.1 The two re-derivations the coordinator asked for

Both were re-derived from the code, not accepted from the plan. **Both hold.**

### Does C3 fail against a frozen `rovingId`? — Yes, at three independent assertions.

Take the broken implementation precisely: `handleGridFocus` missing or non-functional, so
`rememberedId` stays `null` forever and `rovingId = resolveRovingId(days, null)` = `c-8-0` (A1) on
every render. Note the arrow keys still *work* on this implementation, because §7 step 5 reads
`currentId` from the event target rather than from `rememberedId` (`:753-754`, and Decision 8's
closing paragraph `:473-475`) — which is exactly why v1's suite was blind to it.

Walking C3 (`:960`):

1. `enterGrid` → Tab from `›` lands on A1. Identical on both implementations.
2. `{ArrowDown}` → `handleGridKeyDown` moves DOM focus to E1. Identical on both.
3. `expect(A1).toHaveAttribute("tabindex", "-1")` — frozen: `rovingId` is still `c-8-0`, so A1 is
   `"0"`. **Fails.**
4. `expect(E1).toHaveAttribute("tabindex", "0")` — frozen: E1 is `"-1"`. **Fails.**
5. Re-entry (`getByRole("button", { name: "›" }).focus()`, `await user.tab()`) — correct: E1 is the
   only tabbable in the grid, Tab lands on E1. Frozen: A1 is, so Tab lands on A1, and both
   `expect(E1).toHaveFocus()` and `expect(A1).not.toHaveFocus()` **fail.**

I also checked the re-entry step for the hazard mechanical rule 1 exists to prevent: focusing `›`
while DOM focus is on E1 fires `focusout` on E1 and `focusin` on `›`, and `›` is not a descendant of
the `Card` (`CalendarView.tsx:123` vs `:136`), so React's delegated `onFocus` on the Card does not
fire and no `setState` escapes `act`. `Button` carries no focus handler of its own
(`ui/button.tsx:39-46`). The step is safe as written.

One structural note the Architect should not "simplify" away: C3's re-entry is deliberately **not**
`enterGrid`, because it expects E1 rather than A1. If required change 1 below adds an assertion to
`enterGrid`, that inlining becomes load-bearing.

### Does C11 fail against an implementation with no stale-id handling? — Yes, and the fixture constraint is what makes it so.

Take the broken implementation precisely: `resolveRovingId` returns `remembered ?? firstId(days)`
with no membership check.

1. `enterGrid` → A1 focused → `handleGridFocus` → `rememberedId = "c-8-0"`. (This is the step v1
   lacked, and it is the whole fix.)
2. `user.click(nextMonthBtn)`, settle on `Loading…`. `expect(nextMonthBtn).toHaveFocus()` — passes
   on both; this half targets R1, not the fallback.
3. `await user.tab()` → correct implementation: `c-8-0` is absent from the new month, fallback
   returns the first id of the first non-empty day. Next month's only content is day 15, so that is
   `c-15-0` = N1, and the assertion passes.
   Broken implementation: `rovingId = "c-8-0"`, no element carries that id, **no element in the grid
   has `tabIndex={0}` at all**, Tab from `›` skips the entire grid to `document.body`, and
   `expect(N1).toHaveFocus()` **fails.**

The fixture constraint at `:910-915` is load-bearing and correctly derived: had next month carried
anything on day 8, `c-8-0` would resolve positionally (E2 branch (a)) and step 3 would pass on the
broken implementation. I also confirmed the mechanics it rests on — the union fixture returns both
months from every call and the component filters to the rendered month
(`CalendarView.tsx:80-88`), so day 8 is genuinely empty after the nav; and `N1` really is `c-15-0`
given the ascending-`occurrence_at` rule at `:917-922` and the sort at `CalendarView.tsx:66` (line
citation verified — the show-more plan's older `:56` would have been wrong).

## 2.2 The new `enterGrid` rule — reasoning confirmed, with one correction and one gap

**The prohibition on raw `.focus()` for grid elements is correct and I endorse it.** With
`IS_REACT_ACT_ENVIRONMENT` set by RTL, a bare `el.focus()` on a chip dispatches a synchronous
`focusin`, React runs the delegated handler synchronously, and `setRememberedId` executes outside
`act` — that is a genuine "not wrapped in act(...)" warning, not a theoretical one. The rule is also
consistent with existing repo practice rather than in tension with it: `ItemListView.test.tsx:189`
does call `titleBtn.focus()` directly, and that is fine precisely because that button has no focus
handler — the same reason the plan permits focusing `›`.

**One correction to the stated reasoning** (`:931-934`), worth making because an over-stated
justification invites a coder to discard the rule when they cannot reproduce it: the *warning* is
reliable, the *un-flushed `tabIndex`* half is conditional. A synchronous
`expect(el).toHaveAttribute("tabindex", …)` immediately after a raw `.focus()` can indeed read the
pre-update value; a subsequent `await user.tab()` is act-wrapped and would flush first, so that
specific sequencing is usually safe. Keep the rule as an absolute — it is cheap and it is right —
but lead with the warning rather than with the flush ordering.

**The gap (blocking, see required change 1): `enterGrid` has no settle step, and ten tests now go
through it.** The helper as written (`:940-943`) is `getByRole("button", { name: "›" }).focus()`
then `await user.tab()`. Neither line waits for anything. On first render `occurrences` is `[]` and
the fetch resolves in a `useEffect` → `Promise.all` → `.then` (`CalendarView.tsx:50-71`), so **the
grid contains zero chips at the moment `enterGrid` would run if it is the first statement after
`render(...)`**. The Tab then lands on `document.body`, and the caller's first focus assertion
fails.

The failure is loud rather than silent, which is why this is a small blocking finding and not a
repeat of the v1 class. But two things make it worth fixing before implementation rather than
during:

- The most natural remedy for "`expect(A1).toHaveFocus()` fails after `enterGrid`" is to focus A1
  directly — which is precisely what mechanical rule 1 forbids, three lines above.
- This file's history is that hollow awaits recur. `calendar-show-more` test 8 was wrong in three
  consecutive revisions (`calendar-show-more.md:37-40`), C12 carried the same defect from v1 into
  this round, and v2 is meticulous about settle signals *everywhere except the one helper every test
  now funnels through*.

The cheapest fix is to put the wait inside the helper, which also closes the "asserts nothing"
weakness (mechanical rule 2 arguably applies to `enterGrid` itself):

```tsx
async function enterGrid(user: UserEvent) {
  // The chips arrive from an async fetch; without this the Tab below enters an EMPTY grid.
  const first = await screen.findByRole("button", { name: /A1/ });
  screen.getByRole("button", { name: "›" }).focus();
  await user.tab();
  expect(first).toHaveFocus();
  return first;
}
```

C12 (empty month) does not use `enterGrid` (`:969`), so an `A1`-specific await inside it is safe.
If the Architect prefers to keep the helper assertion-free, the equivalent is a one-sentence rule in
§8.3: *every test must `await screen.findByRole(...)` for a grid chip before calling `enterGrid`.*
Either is fine; silence is not.

## 2.3 Verification of the eleven round-1 changes

| # | Change | Landed | Notes |
| --- | --- | --- | --- |
| F1 | C2 starts from F1 via `{End}` (`:959`) | ✅ | Re-derived: on a no-`tabindex="-1"` implementation Shift+Tab from F1 lands on the day-15 toggle, so it fails. Both v1 failure modes recorded in the falsification cell |
| F2 | C3 "THE ROVING TEST" (`:960`) + §8.4 (`:978-996`) | ✅ | See §2.1. §8.4 goes beyond the ask |
| F3 | C11 calls `enterGrid` first (`:968`) | ✅ | See §2.1 |
| F4 | E2 rewritten with both branches (`:634`) | ✅ | Branch (a)'s citation of `CalendarView.test.tsx:220-238` is correct — existing test 8 really does nav with `t-15` remembered |
| F5 | P5b, P5c, P14b (`:878`, `:879`, `:890`) | ✅ | P5b's rationale correctly names both naive failures (negative index, `.at(-5)` wrap). P5c is a genuinely different column (3 vs 6 mod 7) |
| F6 | C12 awaits the `Loading…` settle signal (`:969`) | ✅ | |
| F7 | C14 pins the chip's class string (`:971`) | ✅ | **I compared the literal token-by-token against `CalendarView.tsx:197`. It is byte-identical.** §8.1's correction at `:838-843` is the right framing |
| F8 | §1.2 bullet 3 (`:71-83`), Decision 4 (`:327-362`), R3 (`:582-603`) | ✅ | See §2.4 |
| F16 | "steps 4 and 5" with the old wording called out (`:665-671`) | ✅ | |
| F9-F15, F17 | | ✅ | F9: day 24 left alone, `End`'s last-element claim moved to P12b's local fixture (`:866-869`, `:887`) — cleaner than what I suggested. F10: P7 explicitly told not to claim a row crossing (`:881`), E9 carries the coverage note (`:642`). F11: C13 labelled confirmatory (`:970`) and given the "*Nothing*" row. F12: `document.body`. F13: precondition + the week-number-column example (`:691-698`). F14: E5b (`:638`) + manual check 3 (`:1026-1028`). F15: R2 (`:576-581`), citing `docs/backlog.md:155`. F17: manual check 8 (`:1039-1043`) |
| Dec. 7 | Cut | ✅ | Cross-references all re-resolve: Decision 6 → C12, Decision 8 rule 4 → C11 first half, R1 → C11, R4 → step 4, R5 → manual check 2, R6 → manual check 4, E5b/E9 → manual check 3. Manual checks renumbered consistently. §4 and §2 now state the visual diff is empty. Decision 0 re-points at R3 |

Also re-checked and still true after the v2 edits: all 15 existing tests pass unmodified (§8.1's
audit is sound; the new `data-cal-id`/`tabIndex` touch nothing any of them assert, and the toggle's
DOM node still survives the expand flip so tests 3/4's handle reuse holds).

## 2.4 On F8: yes, "accept under R3" is sufficient — and your rebuttal of `aria-describedby` is right

You asked whether accept-under-R3 is enough. It is, and I want to be explicit about why rather than
just conceding.

Your disproof of the `aria-describedby` route is **correct on mechanism, and it corrects me**.
Option (i) — a description on a role-less, non-focusable container — is genuinely never announced;
a description is surfaced when the element carrying it is focused or navigated to, and a
`role="generic"` div is neither. Option (ii) is worse than the disease for the reason you give, and
the browse-mode point is the strongest part of it: NVDA and JAWS consume arrow keys in browse mode
before the application ever sees them, so the sentence would advertise a capability that does not
apply in the mode most screen-reader users are in — announced on every one of 93 chips. Announcing
something false 93 times is worse than announcing nothing. I proposed the option; the plan disproved
it; that is the process working.

On standards: R3's accept is defensible, not merely pragmatic. WCAG 2.1.1 (Keyboard) is satisfied —
every chip remains operable via arrows plus Enter/Space. 2.4.3 (Focus Order) is satisfied. There is
no success criterion requiring that a composite widget's arrow-key affordance be *discoverable*;
that is an APG recommendation, not a conformance requirement. R3 says exactly this at `:592-595` and
does not overclaim. The residual is real, it is written down in one place, it names both affected
populations, and it has a trigger and two costed responses (`:601-603`, `:1098-1106`). That is what
I asked for.

The one thing I would guard: R3 is now load-bearing for three separate decisions (0, 4, 7). The plan
already says so at `:432-433` ("If R3 is ever deleted or weakened, this decision has to be reopened
with it"). Good.

## 2.5 New findings

### N1 (blocking) — `enterGrid` has no settle step

See §2.2. Required change 1.

### N2 (non-blocking, recommended) — one route into the roving state is still uncovered: focus arriving by mouse

§8.4 claims C3 is the test that catches "no working roving at all", and that is true for the
frozen-`rovingId` implementation. There is a second, narrower wrong implementation that the whole
suite still passes: **`setRememberedId(nextId)` called inside `handleGridKeyDown` instead of via the
delegated `onFocus`.** I walked it:

- C3 passes (the keydown sets it, so the `tabindex` transfer and re-entry both work).
- C2 passes (`{End}` sets it).
- C13 passes (`rememberedId` was already `c-15-0` from arrowing there).
- C11 passes — and note it passes *vacuously* on this implementation, because `enterGrid`'s Tab no
  longer establishes `rememberedId`, so it degrades to exactly v1's `null`-remembered form.

Decision 8 rule 3 exists specifically to catch focus "arriving by *any* route — arrow keys, mouse
click, the modal's `triggerRef` restore, and a screen reader" (`:445-448`), and no test observes any
route except the keydown handler's own `.focus()`. The user-visible consequence is modest (click a
chip with the mouse, Tab away, Tab back, and you land at the top of the month instead of where you
were), and §7 step 5 gives the correct handler as copy-pasteable code, so the risk of the wrong
implementation is low. Hence non-blocking.

If you want it closed, it is one cheap test, and the `+N more` toggle is the right subject because
clicking it does not open a modal:

> `await user.click(toggle)`; `await user.tab()` (out of the grid); `await user.tab({ shift: true })`
> → `expect(toggle).toHaveFocus()`.

On the keydown-only implementation `rememberedId` stays `null`, A1 is the only tabbable, and
Shift+Tab from `document.body` lands on A1 — so it fails. If you would rather not add it, say in
§8.4 that the mouse and modal-restore routes into `handleGridFocus` are unasserted, so the map stays
honest.

### N3 (nit) — §8.4 understates C2

`:985` says C3 is "**The only test in §8 that does**" fail against a frozen `rovingId`. C2 does too,
by a different mechanism: with `rovingId` frozen at `c-8-0`, focus sits on F1 with `tabindex="-1"`
while A1 is the only tabbable, so Shift+Tab from F1 lands on **A1**, not on `›`. Coverage is better
than claimed — but §8.4 is presented as a rigorous map, and understating it could motivate someone
to weaken C2 later on the grounds that C3 already covers this. Correct the row.

### N4 (nit) — the pure-test count is wrong in two places, differently

§9 (`:1008`) says "18 pure cases (P1-P15 including P5b, P5c, P12b, P14b)". Counting the §8.2 table:
P1, P2, P3, P4, P5, P5b, P5c, P6, P7, P8, P9, P10, P11, P12, P12b, P13, P14, P14b, P15 = **19**.
§4 (`:484`) still says "~15 pure unit tests". Done conditions get checked mechanically; make both 19.

### N5 (nit) — the `t-15` half of C11's fixture rationale is inert

`:913-915` justifies "two items rather than four" with "`t-15` exists in both months and would
survive positionally for the same reason". That reason cannot apply to C11: `rememberedId` is
`c-8-0` at the nav, never `t-15`, so a next-month toggle could not rescue the broken implementation.
The **constraint is right** (2 items keeps next month's day 15 simple and unambiguous); only the
stated reason for it is. Fix the reason or drop that sentence — an argument that does not survive
checking is exactly what round 1's F8 was about.

### N6 (nit) — §2 says "all four routes", Decision 4 labels three

`:161-162`: "Decision 7 (cut) and Decision 4 (i)-(iii) between them reject all four routes."
Decision 4 enumerates (i), (ii), (iii), and (iii) *is* Decision 7. The fourth route (a bare
`sr-only` sentence) was folded into (ii) in v2 but is still counted separately in §2. Coverage is
complete; the arithmetic is not. Also minor: `UserEvent` in `enterGrid`'s signature (`:940`) needs
`import type { UserEvent } from "@testing-library/user-event"` — it is exported in v14, but
`ReturnType<typeof userEvent.setup>` is the zero-risk alternative if it is not.

## 2.6 Standing items from round 1 that remain correctly unaddressed

For the record, so a later reader does not mistake them for oversights: the two intermediate options
in §10 (`:1090-1106`) are recorded and explicitly not adopted, which is what I asked for — they were
marked informational in round 1 and scope is settled. Nothing in round 2 reopens §1.4.

## Required changes

1. **(Blocking)** Give `enterGrid` a settle step. As written it focuses `›` and Tabs with nothing
   awaited, and the chips arrive from an async fetch (`CalendarView.tsx:50-71`) — so if it is the
   first statement after `render(...)` it Tabs into an empty grid. Ten tests now funnel through it,
   and the natural remedy for the resulting failure is a raw `.focus()` on the chip, which
   mechanical rule 1 forbids three lines above. Either put `await screen.findByRole("button", { name: /A1/ })`
   (and an `expect(first).toHaveFocus()`) inside the helper, or state in §8.3 that every caller must
   await a grid chip first. C12 does not use the helper, so an `A1`-specific await inside it is safe.
2. Fix the pure-test count: **19**, not "18" (`:1008`) and not "~15" (`:484`).
3. Correct §8.4's C3 row (`:985`): **C2 also fails against a frozen `rovingId`** (Shift+Tab from F1
   lands on A1, not `›`), so C3 is not "the only test in §8 that does". Coverage is better than the
   map claims.
4. Fix or drop the `t-15` half of C11's fixture rationale (`:913-915`) — `rememberedId` is `c-8-0`
   at the nav, never `t-15`, so that argument cannot apply. Keep the two-item constraint.
5. Reconcile §2's "all four routes" (`:161-162`) with Decision 4's three labels (i)-(iii), and
   soften mechanical rule 1's justification (`:931-934`) to lead with the `act` warning — which is
   reliable — rather than the `tabIndex` flush ordering, which is conditional. Keep the rule
   absolute. Optionally switch `enterGrid`'s `UserEvent` type to
   `ReturnType<typeof userEvent.setup>`.
6. **(Recommended, not required)** Close the last uncovered route into the roving state — focus
   arriving by mouse. `await user.click(toggle)`, Tab out, Shift+Tab back, `expect(toggle).toHaveFocus()`
   fails on a `setRememberedId`-inside-the-keydown-handler implementation, which currently passes the
   entire suite. If you decline it, record in §8.4 that the mouse and modal-restore routes into
   `handleGridFocus` are unasserted, so the map stays honest.

APPROVE WITH CHANGES

---

# Round 3

Plan revision reviewed: v3 (2026-08-22)
Date: 2026-08-22

All five required changes and the recommended one are present and correct. The two things you asked
me to re-derive rather than accept both hold, and I walked each of them against user-event's actual
tab-order semantics rather than against the plan's description of them. Verdict below is `APPROVE`;
two genuinely open items are stated plainly first, and I explain why neither warrants a fourth
round rather than quietly folding them into the approval.

## 3.1 Re-derivation: does C15 fail against the keydown-handler implementation?

**Yes — and your specific worry (that the click might route through a keyboard path and mask the
bug) does not materialise.** I checked the masking question first because it is the one that would
have invalidated the test.

**The click does not touch the keyboard path.** `user.click()` in user-event v14 dispatches
`pointerover/enter/move/down` → `mousedown` → focus → `pointerup`/`mouseup` → `click`. No `keydown`
or `keyup` is synthesised anywhere in that sequence, so `handleGridKeyDown` is never entered. The
only route by which `rememberedId` can change during step 2 of C15 is `focusin` → the delegated
`handleGridFocus` — which is precisely the handler the broken implementation omits. There is no
second path: the toggle's own `onClick` is `toggleDay` (`CalendarView.tsx:212`), which touches only
`expandedDays`.

**The click does focus the toggle, even though the toggle carries `tabindex="-1"` at that moment.**
This matters and is worth stating because it is not obvious: under *both* implementations the
toggle is `-1` when C15 clicks it (the roving element is still A1). user-event's focusability test
matches `button:not([disabled])` independently of `tabindex`, so a `-1` button is click-focusable —
matching Chrome and Firefox, and matching the existing behaviour the plan already relies on at §8.1
("`tabindex="-1"` elements are still click-focusable", `:832`).

Walking the two implementations from there:

- **Correct implementation.** Click → `handleGridFocus` → `rememberedId = "t-15"` → the toggle
  becomes the roving element. Tabbables are now `[‹, ›, toggle]`; the toggle is last in document
  order (day 15 precedes day 22, so F1 is behind it and is `-1`). Tab → `document.body` ✓.
  Shift+Tab from body → last tabbable = toggle ✓. Both assertions pass.
- **Keydown-handler implementation.** `rememberedId` stays `null`, so `rovingId` is still `c-8-0`
  and the tabbable set is `[‹, ›, A1]` while DOM focus sits on a non-tabbable toggle. This is
  user-event's "active element has `tabindex="-1"`" branch, which keeps the active element in the
  ordered list solely so it has somewhere to count from. I could not read v14's exact ordering
  branch from source here, so I derived C15 under **both** plausible behaviours:
  - *If Tab lands on `document.body`* (the branch that mirrors the correct implementation): the
    middle assertion passes, then Shift+Tab from body goes to the last **tabbable** — A1, because
    the toggle is no longer the active element and drops out of the list — and
    `expect(toggle).toHaveFocus()` **fails.**
  - *If Tab wraps to `‹`* (the default-index branch): `expect(document.body).toHaveFocus()`
    **fails** immediately.

  **C15 fails under both.** It is genuinely discriminating.

One consequence worth recording, and it is the basis of nit N8 below: under the second branch C15
fails at its *middle* assertion, which points a reader at "Tab didn't reach body" rather than at
"the tab stop didn't follow the mouse". The test still does its job; the failure message is one
step less diagnosable than it looks. C1 already carries exactly this kind of hedge for its own
`document.body` assertion (`:975`) and C15 does not.

## 3.2 Re-derivation: is the `enterGrid` settle step hollow?

**No.** A `findBy*` is hollow when the query already matches on its first attempt, before the thing
you actually care about has happened. Here it cannot:

- `occurrences` is initialised to `[]` (`CalendarView.tsx:27`), so `byDay` is empty and **no chip
  exists in the first committed render**.
- The fetch is kicked off in a `useEffect` (`:50-71`) and only `.then(setOccurrences)` puts rows in
  state. Until that resolves and React re-renders, nothing in the document has the accessible name
  `A1 — <Month> 8`, so `findByRole("button", { name: /A1/ })` genuinely polls.

The comment at `:947-951` states this correctly, and the contrast it draws with
`calendar-show-more`'s post-nav case is exactly right — there the union fixture means the next
month's chips are already present from stale state, which is what made the identical shape hollow
(`calendar-show-more.md:314-331`). I specifically wanted to see that contrast rather than a bare
"settle step", because a rule with no stated mechanism is what gets cargo-culted; you wrote the
mechanism down.

I also checked the two ways a *non*-hollow await can still be insufficient:

- **Is `rovingId` already correct when the await resolves?** Yes, and by construction rather than by
  timing: `rovingId` is derived in the same render that produced the chip, `rememberedId` is `null`
  at that point, and `resolveRovingId(days, null)` returns the first id of the first non-empty day
  = `c-8-0` = A1. There is no separate settling step for the tab stop.
- **Is there a straggler render that could move `tabIndex` between the await and the Tab?** The only
  pending update after `setOccurrences` is `.finally(() => setLoading(false))` (`:70`), and
  `loading` drives only the `Loading…` span (`:127`) — nothing in the grid, and nothing that feeds
  `tabIndex`. RTL's `findBy*` runs inside an act-wrapped `waitFor`, so pending work is flushed
  anyway; but even if it were not, the straggler is inert for this test's purposes.

And the helper's closing `expect(first).toHaveFocus()` (`:955`) converts the whole thing from a
silent precondition into an asserted one, which is what mechanical rule 2 asks of every other
intermediate landing. That was worth adding.

**One uniqueness check**, since the helper now gates ten tests on a regex: `/A1/` matches only the
day-8 chip in this fixture (titles are A1, B1, E1-E5, F1, N1, N2; next month's rows are filtered out
of the current month's render by `CalendarView.tsx:83`). No ambiguous-match risk.

## 3.3 On your framing question for §8.4's C3 row

You asked whether "C3 *names* the property by asserting the `tabindex` transfer directly, where C2
observes a side effect of it" overstates C3. **It does not — and there is a third reason it is right
that the row does not yet give.**

- C2's stated target is a *different* implementation (one that never writes `tabindex="-1"` at all).
  That it also happens to fail on a frozen `rovingId` is incidental, and incidental coverage is
  exactly the kind that gets refactored away later by someone who reads only the row's stated
  purpose. Calling C3 the guard that names the property is the correct hierarchy.
- The stronger reason: **C3's re-entry half tests something C2 cannot express at all.** C2 measures
  a single Shift+Tab from a fixed position; C3 measures whether the roving state *persists across
  leaving and re-entering the grid*, which is the actual user-facing property of a roving
  `tabindex` and the thing §1.3's goals are about. That half has no analogue in C2.

So the framing is accurate. If you want it airtight, add the persistence point to the row; that is
strictly optional.

## 3.4 Delta verification

| # | Change | Landed |
| --- | --- | --- |
| 1 | `enterGrid` settle step + `expect(first).toHaveFocus()` (`:946-956`), with the hollow-vs-genuine contrast, the loud-failure/forbidden-remedy note and the C12 carve-out (`:959-961`) | ✅ |
| 2 | Counts: `19 pure unit tests` (`:485`), `19 pure cases` + `C1-C15` (`:1027`) | ✅ — I recounted §8.2: P1-P15 plus P5b, P5c, P12b, P14b = 19, and §8.3's table has C1-C15 = 15 rows |
| 3 | §8.4's C3 row records C2's coverage (`:1004`) | ✅ — see §3.3 |
| 4 | C11 fixture rationale rejustified, `t-15` argument retracted in place (`:914-918`) | ✅ — retracting it *in situ* rather than deleting it is the right call; it stops the next reader re-deriving the wrong reason |
| 5 | §2 reads "Decision 4 rejects the three announcement routes (i)-(iii) and Decision 7 (cut) removes the visual hint" (`:161-163`); `ReturnType<typeof userEvent.setup>` (`:946`); mechanical rule 1 leads with the `act` warning and says the flush half is conditional and the rule stands regardless (`:934-941`) | ✅ |
| 6 | C15 (`:989`) + §8.4 row (`:1003`) naming what it kills and stating that the modal-restore route stays unasserted | ✅ — see §3.1 |

Nothing else in the plan moved, and the round-1 and round-2 findings all remain addressed. §8.1's
audit still holds against v3 (no new attribute or class touches anything the 15 existing tests
assert).

## 3.5 Open items — stated plainly, neither blocking

You asked me not to clear the gate over anything still open, so: two things are open. Both are
editorial, neither can let a wrong implementation ship green, and neither is a factual error — which
is why they do not justify a fourth round. Fold them in when convenient, or decline them.

- **N7 — R5 does not name C15, and C15 depends on user-event's `tabindex` fidelity more narrowly
  than any other test.** R5 (`:610-615`) lists C1, C2, C3 and C11 as the tests that depend on
  user-event honouring `tabindex="-1"`. C15 depends on something narrower still: the behaviour when
  the *active element itself* is `tabindex="-1"` (§3.1's two branches). If user-event's handling of
  that case ever changes, C15 is the first test to move, and R5 is where a maintainer would look.
  Add C15 to R5's list with that one-clause distinction.
- **N8 — C15's middle assertion is a waypoint, not the claim, and is not labelled as one.** Per
  §3.1, on one of the two plausible user-event branches C15 fails at
  `expect(document.body).toHaveFocus()` rather than at the final toggle assertion. C1 already hedges
  its identical assertion (`:975`: "if that proves environment-dependent, the seven negatives are
  the load-bearing part"). C15 deserves the same sentence: the load-bearing assertion is the final
  `expect(toggle).toHaveFocus()`.

Two trivia, mentioned once and not worth acting on unless the file is open anyway: §2's
`className` bullet (`:156-158`) still cites only the toggle's pinning test, now that C14 pins the
chip too; and C3's re-entry deliberately does **not** call `enterGrid` (because the helper now
asserts A1 has focus, while C3 expects E1) — that is correct and load-bearing, and a one-line
comment would stop a future tidy-up from "simplifying" it. Both failures would be loud.

## 3.6 Assessment

Three rounds in, the thing worth recording is that §8 now does what the previous branch's suite did
not. v1's twelve tests were thorough, well-argued, and blind — an implementation with no working
roving at all passed every one of them. v3 has C3 naming the property directly, C2 catching it from
the far end, C11 split into two halves that fail against two different wrong implementations, C15
closing the last unobserved route into the state, and §8.4 openly recording the one assertion whose
honest falsification value is *nothing*. The plan also now says, in three separate places, what its
own earlier revisions got wrong and why — which is the part that makes it durable rather than merely
correct today.

The design itself has not changed since v1 and did not need to; the geometry, the zero-effect focus
model, and the ARIA decision were right in round 1 and I re-verified them then. Ship it.

Optional changes (neither blocking; see §3.5):

1. Add C15 to R5's list (`:610-615`), noting it depends on the narrower "active element is
   `tabindex="-1"`" behaviour.
2. Label C15's `expect(document.body).toHaveFocus()` as a waypoint, mirroring C1's hedge at `:975`,
   so the final `expect(toggle).toHaveFocus()` is identified as the load-bearing assertion.

APPROVE
