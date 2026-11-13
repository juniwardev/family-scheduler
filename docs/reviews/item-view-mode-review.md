# Plan Review: `item-view-mode`

Reviewer: Plan-Reviewer (adversarial). Plan under review: `docs/plans/item-view-mode.md`.
Rounds 1 and 2: 2026-08-21. Round 3: 2026-08-21.

This file was compacted at round 3 by request: rounds 1 and 2 are preserved as a per-item
disposition scoreboard rather than as full prose, because every item on them has now been verified
against the revised plan and the underlying source. Round 3 is the live section.

---

## Rounds 1 and 2 — disposition summary (compacted)

**Round 1 (18 required changes).** Status as of the round-3 text.

| # | Round-1 change | Round 2 | Round 3 |
| --- | --- | --- | --- |
| 1 | Thread `occurrenceEndAt` (backwards recurring range) | PARTIAL — 5 of 6 hops | **FOLDED IN** — the `ItemModal` → `ItemDetails` hop is now named in §3.12 (6-step list), §5, §8 step 6 |
| 2 | No step may leave `typecheck` red | PARTIAL — defect moved to step 6 | **FOLDED IN** — step 6 copies the shell, 7a deletes it; re-walked, all 11 steps green |
| 3 | Drop `hover:underline`; add `ring-offset-background` | FOLDED IN | Still clean; §3.9 is the single authoritative class list |
| 4 | Focus management on View → Edit | PARTIAL — premise contradicted by Radix source | **WITHDRAWN, correctly.** Decision 10 deleted; `@radix-ui/react-focus-scope` `handleMutations` re-homes focus. Residue is one §7.5 confirmation line — right call |
| 5 | Desktop `Dialog`-branch test | FOLDED IN | Unchanged; still correct |
| 6 | `listAttachments` mock in `CalendarView.test.tsx` | FOLDED IN | Unchanged (but see NB-1 for the file this rule was *not* applied to) |
| 7 | Deep link opens view mode | PARTIAL — `:133` replacement broken | **PARTIAL** — `:133` now correct (Escape); `:100` still specifies a throwing query. See B3-1 |
| 8 | Row date line → `formatOccurrenceTime` (a bug fix) | FOLDED IN | Unchanged |
| 9 | Playwright deferral, conditional | FOLDED IN | Re-verified: no `playwright.config.*` exists; `test:e2e` is in no gate list |
| 10 | `+N more` deferral filed | FOLDED IN | Unchanged |
| 11 | Keep smart-location links + null/whitespace guard | FOLDED IN | `resolveLocationRender`/`resolveMapsProvider` signatures re-verified against `src/shared/location.ts:122,146` |
| 12 | Harden the display helpers | PARTIAL — new `UNTIL` off-by-one | **FOLDED IN** — UTC formatting, one-arg signature, literal corrected. See B3 verification (b) and NB-4 |
| 13 | `canWriteList` lowercases both sides | FOLDED IN | Plus the "cannot diverge" half-sentence (§3.8) |
| 14 | Constrain the deep-link effect's deps (HC2) | FOLDED IN | Unchanged |
| 15 | HC1 + calendar NEW-1 analogue | FOLDED IN | Unchanged |
| 16 | `key` on `<ItemEditor>` | FOLDED IN but did not compile | **FOLDED IN** — union-tag form, all five sites, type-checks |
| 17 | Real touch-target criterion + row-height cost | FOLDED IN | Renumbered to Decision 10; all references follow |
| 18 | Calendar tab-stop + chip naming | FOLDED IN | Plus the `monthLabel` hoist |

**Round 2 (10 required changes).**

| # | Round-2 change | Round 3 disposition |
| --- | --- | --- |
| 1 | `Close` collision / in-modal query scoping | **PARTIAL** — the Close half is fixed and the reasoning is correct (verified: both dismiss buttons are inside the content, `sheet.tsx:57-60`, `dialog.tsx:42-45`). The same duplicate-target class was not swept at `App.deeplink.test.tsx:100`. See B3-1 |
| 2 | `UNTIL` renders on the wrong day; wrong literal | **FOLDED IN** — verified below |
| 3 | `key={state.item?.id ?? "create"}` is TS2339 | **FOLDED IN** — verified below |
| 4 | Decision 10 built on a wrong Radix claim | **FOLDED IN by deletion** — verified below |
| 5 | §8 step 6 "move" leaves the tree red | **FOLDED IN** — verified below |
| 6 | Unwritten `ItemModal` → `ItemDetails` hop | **FOLDED IN** |
| 7 | `user.hover()` guard is vacuous | **FOLDED IN** — restated as a static `className` assertion with the correct regex |
| 8 | Title button's class list specified twice | **FOLDED IN** — §3.9 snippet is authoritative; §8 step 7c points at it |
| 9 | Stale `App.deeplink.test.tsx` descriptive strings | **FOLDED IN** — added to Decision 8's table; the impl-notes rule widened to "assertions, test names, and comments" |
| 10 | Five smaller items (`monthLabel`, same-day range, Attachments exemption, `canWriteList` note, HC3 `UNTIL` parsing) | **FOLDED IN** — all five present and correct |

Nothing from either round was declined without a recorded reason, and nothing on the round-1 §11 /
round-2 R2-12 "do not undo these" lists was stripped: HC1, HC2, HC3's split, R11's desktop test,
Decision 2's B1/NEW-1 preservation, the `ItemListView.tsx:48-53` comment instruction, edge case 1's
`formatOccurrenceTime` requirement, edge case 5, edge case 9, the R3/§7.1 "does this test actually
run" thread, and R5's move-verbatim discipline are all intact.

---

## Round 3

Scope: verify the round-2 folds landed and are correct; hunt for damage caused by a net-subtractive
revision; verify the Escape substitution against the component source; re-walk §8 for per-step
greenness; look for new blocking defects.

Read fresh for this round (not trusted from the plan): `web/src/components/ui/sheet.tsx`,
`web/src/components/ui/dialog.tsx`, `web/src/components/ItemListView.tsx` (in full),
`web/src/components/CalendarView.tsx` (in full), `web/src/App.deeplink.test.tsx` (in full),
`web/src/App.tsx:150-274`, `web/src/components/ListSidebar.tsx:120-169`,
`web/src/components/RecurrenceEditor.tsx:1-95`, `web/src/components/ReminderEditor.tsx:18-47`,
`web/src/components/ItemEditor.tsx:40-70` + grep, `web/src/components/AttachmentsView.tsx:1-45`,
`web/src/types.ts:28-60`, `src/shared/itemLabels.ts`, `src/shared/location.ts:100-169`,
`tests/setup/jsdom.setup.ts`, `vitest.workspace.ts`, `tsconfig.web.json`, `package.json`,
`node_modules/@radix-ui/react-dialog/dist/index.mjs` (grep for `hideOthers`).

### 3.1 The round-2 fixes: verified

**(a) The five `key=` sites and the `effective` form — CORRECT, AND IT TYPE-CHECKS.**
All five sites (§3.10 snippet, §4 row 7, R12, §8 step 6, the §9 change table) now read
`key={effective.mode === "edit" ? effective.item.id : "create"}`. `state.item?.id` survives only in
§3.10's and §8 step 6's explicit "do **not** write this" warnings, which is where it belongs.
Narrowing: `effective` is `ItemModalState | null`; after the gate the discriminant test narrows the
true branch to `{ mode: "edit"; item: Item }`, so `effective.item.id` is legal, and `create`/`view`
both fall to the literal. The `null` case is handled by "Gate the whole body on … `effective !==
null`" — an early `return null` narrows `effective` for the whole body below it, and the JSX-inline
`{effective && …}` spelling narrows too. Either implementation compiles. (One wording snag in the
same sentence: NB-3.)

**(b) `describeRecurrence` — CORRECT.** Signature is one argument at every site (§3.6 line 193,
§3.7, §4 row 2, §8 step 3); R2-9's contradiction is gone. I recomputed the expected literal:
`formatOccurrenceTime(Date.parse("2026-12-31T00:00:00Z"), "UTC", true)` takes the first
zone candidate, so `formatInZone` succeeds and no `" UTC"` suffix is appended
(`itemLabels.ts:44-55`), and `Intl.DateTimeFormat("en-US", {weekday:"short", month:"short", …})`
yields `Thu, Dec 31, 2026` — Dec 31 2026 is a Thursday (2026 starts on a Thursday and is not a leap
year). The table row is right. HC3's split survives verbatim (§3.7 HC3 block, edge case 13, §8 step
3 all repeat "hardening in `describeRecurrence`, never in `parseRRule`"), and the corrected `UNTIL`
instruction matches the source: `parseRRule` returns `until: "2026-12-31"`
(`RecurrenceEditor.tsx:68-70`), so `Date.parse(\`${state.until}T00:00:00Z\`)` + `Number.isFinite` is
the right guard. One factual slip in a *rationale* cell: NB-4.

**(c) Decision 10's deletion — CLEAN, AND NOTHING WAS LOST.** I grepped every `Decision N`, `R1N`,
`§3.1N`, `§8 step N`, and `edge case N` reference in the file. There are **no orphans**: the only
occurrences of "Decision 11" and "R13" are inside the §9 record of their own deletion; §3.13 is now
"Decision 10 — touch targets…" and all four references to it (the §3.9 snippet comment at line 311,
§7.5's tap-target criterion, §8 step 7c, backlog 10e) point at the touch-target decision; edge cases
renumber cleanly (15 = focus after a calendar edit-save, cited at §7.5; 16 = mixed-case owner email;
17 = two Close buttons, cited in the §9 table); no `§3.14` reference remains. The substantive claim
also holds — `@radix-ui/react-dialog` is `^1.1.19` and `react-focus-scope`'s `handleMutations`
focuses the container when `activeElement === document.body` after a subtree removal — so deleting
the decision and keeping a §7.5 *confirmation* line is exactly right. Deleting rather than re-basing
was the better of the two options I offered.

**(d) The `ItemModal` → `ItemDetails` hop — WRITTEN DOWN** in §3.12 (item 5 of 6), in the
`ItemDetailsProps` comment in §5, and in §8 step 6, each time with the reason (both props optional →
omitting them compiles clean). `OccurrenceEntry.end_at: EpochMs | null` (`types.ts:57`) and the
chip's `occ.end_at ?? undefined` conversion re-verified.

### 3.2 Deletion damage: none found

This was the highest-risk area and it came out clean. Beyond the reference sweep in (c): §4's 19-row
inventory still matches §8's steps under the stated "§8 governs" rule; §4 rows 8/9/10/11 are cited
correctly from the prose; backlog entries 10a–10e are each cited exactly once from their originating
decision; §6's risk table runs R1–R12 with no gaps; §7.3's file table still covers every test file
that exists. The `describeRecurrence` timezone revert did not leave a stale two-argument call
anywhere. The `user.hover()` deletion did not orphan §7.5's compensating CSS-only item (still
present). No section references a deleted paragraph.

### 3.3 The Escape substitution: reasoning verified, and it works in both branches

- **The premise is true.** `sheet.tsx:57-60` and `dialog.tsx:42-45` each render the built-in dismiss
  *inside* `…Primitive.Content`, with `<span className="sr-only">Close</span>`. So `within(dialog)`
  genuinely cannot disambiguate it from `ItemDetails`'s footer Close. The Architect's stated reason
  is correct, not a rationalisation.
- **Escape dismisses in both branches.** `sheet.tsx:2` imports `SheetPrimitive` from
  `@radix-ui/react-dialog` — the Sheet *is* a Radix Dialog. Both branches therefore go through
  `DismissableLayer`'s document-level escape handler → `onOpenChange(false)` → the plan's single
  `close()` (edge case 9). `user.keyboard("{Escape}")` dispatches on `document.activeElement` (inside
  the content, per Radix autofocus) and reaches the document listener. The NEW-1 test already has a
  `userEvent.setup()` instance at `:126`.
- **No conflict with the deep-link one-shot or NEW-1.** `onInitialOpenItemConsumed?.()` fires at
  *open* time (`ItemListView.tsx:81`), before any dismissal, so App has already cleared
  `initialOpenItem`; Escape and the old Cancel click land on the identical `close()`. The
  open → close → Calendar → List → assert-not-reopened sequence is untouched.

### 3.4 §8 re-walk: every step leaves the tree green — including 6/7a

I walked all 11 steps against the real files.

- Steps 1–5 create leaf modules (`vitest.workspace.ts`, `permissions.ts`, `rrule.ts` +
  `RecurrenceEditor` import swap, `itemDisplay.ts` + `ReminderEditor` import swap, `ItemDetails.tsx`)
  plus their tests. Each compiles and lints standalone. `tsconfig.web.json` includes
  `web/src/**/*` and maps `@/*`, so the moved-module imports and the new `.test.ts` files are all in
  the program.
- **Step 6 → 7a is now correct.** Step 6 says "**COPY — do not move**", explicitly notes that
  `ItemListView` still references `editorModal` at `:217` (confirmed — it does, and builds it at
  `:149-167`), and states the duplication is deliberate for exactly one step. A duplicated shell is
  not a type error and no installed ESLint rule objects. Step 7a is where the original dies. This
  closes the R2-5 hole and R10's stale "steps 8 and 9" phrasing is corrected.
- Step 7 (a–g) is one step and ends green. Step 8 keeps the `CalendarView` prop and `App.tsx:232`
  together — verified necessary: `App.tsx:232` is `<CalendarView lists={lists} />` today and the new
  `user` prop is non-optional. Steps 9–11 are gates and docs.
- Two mechanical consequences of step 7a that the plan does not spell out are gate-caught, not
  gate-breaking: NB-6.

### 3.5 BLOCKING — B3-1: Decision 8's `:100` replacement query matches two elements and throws

This is the un-swept remainder of R2-1's own defect class, and it is the only blocking item I found.

Decision 8's table (§3.11), which §4 row 11 and §8 step 7g make the authoritative diff for
`App.deeplink.test.tsx`, specifies for `:100`:

> `getByDisplayValue("Deep-linked birthday party")` → `getByText("Deep-linked birthday party")`
> **plus** `expect(screen.queryAllByRole("textbox")).toHaveLength(0)`

The second assertion is fine (see below). The first throws `Found multiple elements`:

1. That test boots the full `App` with `getItems` mocked to `{ items: [DEEP_LINKED_ITEM] }`
   (`App.deeplink.test.tsx:78`) and a selected list — the third test's
   `getByRole("heading", { name: /Groceries/ })` at `:145` proves a list is selected, and
   `ItemListView`'s `if (!listId) return` at `:169` precedes the modal, so the modal opening at all
   proves the rows render. So `ItemRow` renders the title.
2. Under this plan the row title becomes a `<button>` whose only direct text is `item.title`
   (§3.9), and `ItemModal` renders the same string as the `SheetTitle` (§3.6, title row).
3. `getByText` matches on each element's *own* text nodes, so both the row button and the sheet
   title match. Two matches → throw.

Why the sibling assertion is nonetheless safe, and why the asymmetry matters: Radix's modal content
calls `hideOthers(content)` from the `aria-hidden` package
(`node_modules/@radix-ui/react-dialog/dist/index.mjs:17,139`), so while the modal is open everything
outside the portal carries `aria-hidden="true"`. `*ByRole` queries respect that, so
`queryAllByRole("textbox")` sees only in-dialog textboxes → `0` in view mode, and it does **not**
pick up `ListSidebar`'s always-rendered "New list name" `<Input>` (`ListSidebar.tsx:146`, inside the
`hidden md:flex` desktop aside that jsdom renders because no stylesheet is loaded). `getByText`,
however, does **not** filter on `aria-hidden` — which is precisely why one of the two new assertions
works and the other does not.

The plan does contain its own remedy: §7.2's query-scoping requirement says it applies "to every test
below **and to `App.deeplink.test.tsx`**" and prescribes `within(screen.getByRole("dialog"))`. But
§7.2 motivates that rule *only* with duplicate accessible names (`Edit`, `Close`), so a Coder has no
reason to apply it to a text query, and the authoritative table spells the unscoped form. The two
statements contradict each other on the same line of the file the plan is most protective about, and
the failure mode ("Found multiple elements" in `App.deeplink.test.tsx`, under banners saying any
change here is a review-blocking red flag) invites exactly the wrong repair — editing the fixture or
the mocks, which *is* the structural change R1 forbids.

Fix (one line, no behaviour change): make the `:100` row read
`within(await screen.findByRole("dialog")).getByText("Deep-linked birthday party")`, or assert on the
dialog's accessible name instead (`expect(dialog).toHaveAccessibleName("Deep-linked birthday
party")` — Radix wires `aria-labelledby` to the title). Keep `screen.queryAllByRole("textbox")`
document-wide; it is meaningful *because* of `hideOthers`. While there, add one clause to §7.2's
scoping rule: scope in-modal **text** queries too, because the item title is duplicated between the
list row and the dialog title even though it is not a duplicated accessible name.

### 3.6 Non-blocking observations for the Coder

None of these affect the verdict. Each is either gate-caught, cosmetic, or a follow-up commit.

- **NB-1 — `ItemModal.desktop.test.tsx` is the one new test file not told to mock `listAttachments`.**
  §7.2 requires that mock for `ItemDetails.test.tsx`, `ItemListView.test.tsx`, and
  `CalendarView.test.tsx`, but the desktop test renders `ItemModal` **in view mode**, which mounts
  `ItemDetails` → `AttachmentsView`, which fetches on mount (`AttachmentsView.tsx:20-37`). Unmocked
  that is a real `fetch` resolving after the assertion window: act warnings, not a failure (the
  component catches). Add `vi.mock("../apiClient", …)` with `listAttachments` for consistency with
  the plan's own rule.
- **NB-2 — the `App.deeplink.test.tsx` mock-list contradiction.** §3.11 "recommends" adding
  `listAttachments: vi.fn()` to that file's mock factory, while §1's DoD, §4 row 11 and §7.3 all say
  the mocks are untouched and a mock change means "stop". Both cannot be obeyed. The safe reading is
  to leave the mocks alone (today's editor path already fires an unmocked attachment fetch via
  `ItemEditor.tsx:302` → `AttachmentsEditor`, so this is unchanged in kind) and to check for new act
  warnings as §3.11 requires — but the plan should say which rule wins.
- **NB-3 — Decision 7's `open` is undefined, and one reading kills the close animation.** §3.10 says
  "Gate the whole body on `open` and on `effective !== null`", but `ItemModalProps` (§5) has no
  `open` prop. Read literally as `if (!open) return null`, the component unmounts the moment `state`
  goes null — which deletes the very close animation `lastStateRef` exists to survive, and makes the
  ref dead code. Intended (and consistent with the rest of the decision): `const open = state !==
  null` passed to `<Dialog open={open}>`, and `return null` only when `effective === null`
  (i.e. never opened).
- **NB-4 — HC3's `BYDAY=` rationale cell is wrong, though its required behaviour is right.** For
  `FREQ=WEEKLY;BYDAY=`, `parts.BYDAY` is `""`, which is falsy, so `parseRRule` returns `byday: []`
  (`RecurrenceEditor.tsx:65`) — not `[""]`, and `DAY_LABELS[""]` is never reached. The case that
  actually needs the label guard is `BYDAY=XX`. Expected output (`Every week`) and the test cases are
  unaffected. (This corrects my own round-2 claim that I had re-derived all four rows.)
- **NB-5 — "scope every row-level query with `within(row)`" has no `row`.** `ItemRow` renders a
  `<Card>` (a `<div>`) inside the `<ul>` at `ItemListView.tsx:202`, so there is no `listitem` role to
  query. The Coder will need `getByText(title).closest("div[class*=…]")` or a `data-testid`; say
  which, or drop the instruction for the row case.
- **NB-6 — two mechanical edits step 7a does not name.** (i) `ItemListView.tsx:188`'s
  "+ New Item" `onClick={() => setShowCreate(true)}` must become `openCreate()`; (ii) the now-unused
  `Dialog`/`Sheet`/`useMediaQuery`/`ItemEditor` imports (`:6,11,12,13`) must go or lint fails. Both
  are caught by the step gate.
- **NB-7 — the `canWrite` restructure in step 7c.** Today the whole action container is wrapped in
  `{canWrite && …}` (`ItemListView.tsx:292`). "Render View unconditionally; keep Edit/Delete behind
  `canWrite`" means the guard moves from the container onto the two buttons. Obvious on contact, but
  one clause would save a re-read.
- **NB-8 — the `Unit` type is not mentioned in the `splitOffsetMinutes` move.** `fromMinutes` returns
  `{ value: number; unit: Unit }` and `Unit` is also used by `toMinutes`, which stays
  (`ReminderEditor.tsx:18-32`). Structural typing makes a locally re-declared union compatible, so
  either duplicating it or exporting it from `itemDisplay.ts` works — just pick one.
- **NB-9 — `ItemModal` is never explicitly told to compute `canWrite`.** §3.6 says
  `canWrite = canWriteList(list, user)` and §5 gives `ItemDetails` a `canWrite: boolean` prop, so the
  resolution (`lists.find(l => l.id === item.list_id)` — necessary because calendar items span
  lists) has to happen in `ItemModal`. Worth one clause in §8 step 6 next to the `occurrenceEndAt`
  forwarding instruction, since it is the same kind of unenforced hop.
- **NB-10 — the `Edit` ambiguity §7.2 guards against would not actually fire for `getByRole`.**
  Because of `hideOthers`, the row's Edit is `aria-hidden` while the modal is open, so an unscoped
  `getByRole("button", { name: /^edit$/i })` matches only the modal's. The scoping rule is still the
  right discipline (it is robust to a future non-modal surface) — just note that it is
  belt-and-braces there, and load-bearing for **text** queries (B3-1).

### 3.7 Things this round confirmed that a round 4 must not undo

The subtract pass was disciplined and I do not want it reversed: the `describeRecurrence` one-argument
signature (adding a timezone back re-introduces a west-of-UTC off-by-one), Decision 10's deletion
(Radix already re-homes focus; re-adding the guard re-adds a test that cannot fail), the static
`className` form of the R2 hover guard, the "copy then delete" split across steps 6/7a, and the
decision **not** to relabel the footer `Close` to `Done` (a test-query problem correctly solved
without touching shipped copy). Also still correct and load-bearing: HC1, HC2, HC3, R11's separate
desktop test file, and D-OQ1 as settled by the owner.

---

## Required changes (round 3)

1. **Fix `App.deeplink.test.tsx:100` in Decision 8's table (B3-1).** `getByText("Deep-linked
   birthday party")` matches both the list row's title button and the dialog title and throws
   `Found multiple elements`. Scope it — `within(await screen.findByRole("dialog")).getByText(…)` —
   or assert the dialog's accessible name instead. Keep `screen.queryAllByRole("textbox")`
   unscoped; Radix's `hideOthers` makes it correct as written. Add one clause to §7.2's scoping rule
   noting that in-modal **text** queries need scoping too, because `getByText` (unlike `*ByRole`)
   does not filter on `aria-hidden` and the item title is duplicated between the row and the dialog.

Everything else I found this round is in §3.6 and is explicitly non-blocking: fold in what is cheap,
ignore the rest, and do not spend a fourth round on them.

Round 3 verdict: APPROVE WITH CHANGES — **superseded by the follow-up verification below.**

---

## Round 3 — follow-up verification

The Architect applied B3-1 plus six of the ten non-blocking observations. I re-read every changed
section (§3.7 HC3 table, §3.10, §3.11 including the `:100` row and the mock-rule paragraph, §7.2 in
full, §7.2's `ItemModal.desktop.test.tsx` block, §8 steps 6, 7a, 7c) and re-checked the source where
a claim was new.

**(a) B3-1 is genuinely closed.** Decision 8's `:100` row now reads
`within(await screen.findByRole("dialog")).getByText("Deep-linked birthday party")`. That is the
correct form: `findByRole("dialog")` resolves the portal content, and `within(...)` restricts the
text query to the modal subtree, so the row's title `<button>` can no longer collide with the
`SheetTitle`. The inline note states the reason accurately, including the `*ByRole`-vs-`*ByText`
`aria-hidden` asymmetry that makes the sibling `queryAllByRole("textbox")` assertion safe unscoped.
`within` is exported from `@testing-library/react`, which the file already imports from — an added
named import, not a structural change, so it stays inside the DoD's "assertions only" rule.

**(b) No new blocking defect and no fresh contradiction in the seven edits.**

- **§7.2 rewrite** — the new "text queries are the real hazard" bullet is correct and names
  `App.deeplink.test.tsx:100`, so the table and the rule now agree instead of contradicting. The
  `Edit` bullet's belt-and-braces framing matches what I verified in `@radix-ui/react-dialog`
  (`hideOthers(content)`, `dist/index.mjs:17,139`).
- **`data-testid="item-row"`** — safe on both sides. `Card` is
  `forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>` and spreads `{...props}` onto
  its `<div>` (`ui/card.tsx:5-12`), so the attribute reaches the DOM; TypeScript exempts hyphenated
  JSX attribute names from excess-property checking, so it also compiles on a component whose props
  type does not declare it. `closest("[data-testid=\"item-row\"]")` then resolves the row from any
  descendant. No runtime or a11y effect.
- **NB-3 / Decision 7's `open`** — this was the edit that touches runtime behaviour and it is now
  right: derive `const open = state !== null`, pass it to `<Dialog open={open}>` / `<Sheet
  open={open}>`, and return `null` **only** when `effective === null`, with an explicit ban on
  early-returning on `!open`. That preserves the `open: true → false` transition Radix needs to play
  the close animation while `effective` keeps the title painted, which is the entire point of the
  decision. The `effective === null` early return still narrows `effective` for the `key=` expression
  below it, so the union-tag form continues to type-check.
- **§3.11 mock rule** — the contradiction is resolved in the safe direction (DoD wins, mocks
  untouched, new act warnings are a stop-and-report). Verified the premise holds: today's deep-link
  path already mounts `ItemEditor` → `AttachmentsEditor` (`ItemEditor.tsx:302`), so the view-mode
  fetch is unchanged in kind and no act warning would be *new*.
- **NB-1 / NB-6 / NB-7** — the desktop spec now mocks `../apiClient` for `listAttachments`; step 7a
  names `:188`'s `openCreate()` and the dead `Dialog`/`Sheet`/`useMediaQuery`/`ItemEditor` imports;
  step 7c names the `canWrite` guard moving from the container onto `Edit`/`Delete`. All three match
  the source I read.
- **NB-4 / HC3** — the corrected table is now accurate against `RecurrenceEditor.tsx:65`: `BYDAY=XX`
  is the row that needs the label guard, `BYDAY=` yields `[]` from the falsy check and needs none.
  The output-contract row (`BYDAY=` / `BYDAY=XX` → `Every week`) and the §7.2 test list stay
  consistent with it.
- Not applied, and correctly so: NB-8 (either `Unit` spelling type-checks structurally) and NB-10
  (informational; folded into §7.2's wording).

**(c) Nothing on the §3.7 "must not undo" list was disturbed.** Re-checked each: the one-argument
`describeRecurrence` and the UTC `UNTIL` literal are unchanged; Decision 10 stays deleted with the
§7.5 confirmation line intact and no reference resurrected; the R2 guard is still the static
`className` assertion with no `user.hover()`; step 6 still says "COPY — do not move" with step 7a
doing the deletion; the footer `Close` is still not relabelled; HC1, HC2, HC3's split, R11's separate
desktop file and D-OQ1 are all untouched.

**Two residual nits, for the Coder, not for another round** (neither can produce wrong behaviour;
both are self-revealing at the step-6 gate):

- §8 step 6 spells the new instruction as
  `canWriteList(lists.find(l => l.id === effective.item.list_id), user)`. `effective.item` is only
  legal where `effective` is narrowed to the `view` arm — which is the natural place to write it,
  since `canWrite` is a prop of `<ItemDetails>` and `<ItemDetails>` renders only in view mode. If
  hoisted above the branch it is TS2339 (the same absent-property rule the `key=` warning explains),
  caught instantly by `tsc`. Unlike the round-2 `key` defect, there is no position where the intended
  code is unwritable and no wrong-looking fix to fall into.
- All hooks in `ItemModal` (`useMediaQuery`, `useRef`, the `lastStateRef` `useEffect`) must sit
  **above** the `if (effective === null) return null` early return, or
  `react-hooks/rules-of-hooks` errors. Standard React, and the lint gate catches it.

No blocking issues remain.

APPROVE
