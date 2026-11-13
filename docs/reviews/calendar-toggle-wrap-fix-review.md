# Review: `calendar-toggle-wrap-fix` — round 1

Reviewer: Plan-Reviewer (adversarial pass)
Plan: `docs/plans/calendar-toggle-wrap-fix.md`
Date: 2026-09-19

The fix is right, the diff is minimal, and the acceptance test genuinely pre-exists and genuinely
fails. Nothing below blocks the build. Four items are cheap fold-ins that correct text reaching a
human or close a gap in the done conditions; four are nits.

**No shell was available in this pass.** Everything below is derived from the files in the tree. I
could **not** independently confirm the `cde66c3` baseline (`1 failed, 5 passed`) or run the suite.
I did confirm the pass count is arithmetically consistent: 2 density + 2 boot + 1 keyboard on
`chromium`, plus 1 keyboard on `chromium-dark` (`playwright.config.ts:92-101`) = 6.

## Verified independently (taken off the plan's word and recomputed)

- **The 34px arithmetic (§1, plan:21-24).** Recomputes exactly: 390 − 32 (`App.tsx:223`, `p-4` below
  `md:`) − 6 (`gap-px` × 6, `CalendarView.tsx:200`) = 352; ÷7 = 50.3; − 8 (day cell `p-1`,
  `:224`) − 8 (toggle `px-1`, `:270`) = **34.3px**. Matches the plan and `docs/backlog.md:163`.
- **The `:250` / `:270` asymmetry (§1).** Correct as cited. The chip carries
  `overflow-hidden text-ellipsis whitespace-nowrap`; the toggle does not.
- **"One existing unit test breaks" (§5).** Confirmed, and confirmed it is the *only* one.
  `CalendarView.test.tsx:398-400` is the sole complete-string `toBe` on the toggle. C14
  (`:757-759`) pins the **chip** and is untouched. There are **no** snapshot tests anywhere in the
  repo (`toMatchSnapshot`/`toMatchInlineSnapshot`: zero matches).
- **The `toBe` literal cannot be broken by tooling.** `package.json` and `eslint.config.js` carry no
  `eslint-plugin-tailwindcss` and no `prettier-plugin-tailwindcss`, so nothing auto-reorders the
  class list. `:270`'s `className` is a plain string literal, not `cn(...)`, so `tailwind-merge`
  cannot rewrite it either. R2's worry (plan:116-118) is real but purely human; keeping it is fine.
- **No JIT/purge surprise.** All three utilities already ship in the bundle via the chip at `:250`
  in the same file.
- **Focus ring survives.** `overflow: hidden` clips contents, not the element's own `box-shadow`;
  the chip carries the identical three classes and E1 asserts its ring renders. Not a risk, and the
  plan is right not to list it.
- **Truncation preserves the load-bearing token.** LTR `text-overflow: ellipsis` clips the *tail*,
  so `+2` — the count, the only information the control conveys — stays visible; `+2 mo…` is a
  degraded but not lossy render. CSS truncation also leaves the accessibility tree untouched, so
  Decision 3 / WCAG 2.5.3 is not regressed. **This answers R1 more strongly than §7 does** — R1
  currently concedes the point rather than closing it.
- **The expanded state is covered too.** Beat 2 runs in both states (`spec:96,101`), and `Show less`
  (9 chars) is also over 34px, so it was wrapping as well and is fixed by the same change.
- **`toHaveText("+2 more")` (`spec:24`) is safe.** It reads `textContent`, which ellipsis does not
  alter.

## Findings

### 1. REQUIRED (non-blocking) — §3's rejection of the shorter mobile string rests on a false premise

Plan:57-60 says a `+2` variant "drags in WCAG 2.5.3 again … so the accessible name would have to
branch on viewport too." That is not so. The accessible name is unchanged and already reads
`+2 more items — <Month> 15` (`calendar-show-more.md:135-137`); `+2` **is** a prefix of it, so 2.5.3
(Label in Name) is satisfied with **no** change to `aria-label` and no viewport branching. The
rejection is still correct — a responsive label needs two spans, and it would break
`CalendarView.test.tsx:417` (`toHaveTextContent(/^\+2 more$/)`) — but the stated reason is wrong,
and a wrong accessibility rationale left in a plan is exactly how a future decision gets made badly.
This is the same failure mode §1's "why it took this long to find" describes: a plausible sentence
that nobody re-derived. Replace the reason; keep the conclusion.

### 2. REQUIRED (non-blocking) — the acceptance criterion cannot distinguish 3 classes from 1

§3 (plan:64-66) asserts all three classes are needed. I agree, and I checked the overflow chain:
the Card's `overflow-hidden` (`CalendarView.tsx:200`) clips only at the **grid's outer edge**, and
the day cell (`:224`) sets no overflow at all — so for any interior column a `whitespace-nowrap`-only
toggle would paint its overflow across the *neighbouring* day cell. The plan's claim stands.

But **nothing in §5's acceptance criterion tests it.** `assertNoUnintendedWrap`
(`e2e/calendar-density.spec.ts:27-49`) measures box height only. `assertChipsEllipsized` (`:51-65`)
is scoped to `[data-cal-id^="c-12-"]` and never looks at the toggle. Beat 1's containment loop
(`:79-81`) is chips-only, and would pass on the toggle anyway since `w-full` keeps the *box* inside
the cell while the *text* spills. So the e2e goes green on a one-class fix.

The thing that actually pins `overflow-hidden` and `text-ellipsis` is the updated test 9 literal —
§5 currently frames that edit as an administrative chore ("the one permitted test edit"). Say
plainly that test 9 is the criterion carrying two of the three classes, or a later diff-minimiser
drops them and every listed done condition still passes.

### 3. REQUIRED (non-blocking) — a visual prod fix with no 390px look

§6 lists typecheck, lint, unit, build, e2e and a revert-and-restore check. None of them looks at the
thing. The e2e assertion is one-sided — an **upper bound on height** — so a toggle clipped to zero
height, or truncated to something illegible, passes it. §7 R1 says "if the ellipsis proves ugly in
QA," but nothing in §6 schedules that look. Add one cheap done condition: at 390px, record what the
collapsed and expanded toggle actually read (expected roughly `+2 mo…` and `Show l…`). Given this
repo's own `assert-the-thing-not-the-derived-property` history, a height measurement standing in for
"it looks right" is the exact substitution to avoid.

### 4. REQUIRED (non-blocking) — the register entry is left wrong

`docs/backlog.md:163` is this defect's permanent entry. It (a) proposes the two fix shapes this plan
rejects and (b) states "`will go green the moment this is fixed — no test change needed`", which §5
now shows is wrong for the unit layer. House convention marks these RESOLVED with the PR and prod
version (`:161`, `:164`, `:167`). §6's "Application diff confined to `CalendarView.tsx:270` and test
9's literal" arguably forbids touching it. Add an explicit done condition to mark `:163` RESOLVED,
naming the fix actually taken and correcting the "no test change needed" clause.

### 5. NIT — `truncate` exists and is not mentioned

Tailwind's `truncate` is exactly these three declarations in one class. The plan doesn't consider
it. The right call is still the three-class form — `truncate` appears **nowhere** in `web/src`, and
sibling symmetry with `:250` is worth more than two characters — but one clause saying so saves the
next reader the detour.

### 6. NIT — "6 passed / 0 failed" is the default project set only

§6:103 hard-codes 6. That holds for `chromium` + `chromium-dark`; with `E2E_WEBKIT=1` the count
differs. `playwright.config.ts:29-32` says to run WebKit deliberately "when a branch touches focus
or **layout**" — which this one does, on the product's primary surface (iOS). Either say "6 with the
default project set" or add an optional WebKit pass.

### 7. NIT — `calendar-show-more.md:175` still publishes the superseded literal

Decision 4's verbatim class string remains the one without the three classes. A future reader
copying it restores this defect. There is repo precedent for retracting in situ
(`calendar-roving-tabindex.md:923`). I have deliberately **not** edited it — flagging it as the
Architect's call whether to supersede it there or note the staleness in this plan's §2.

### 8. NIT — pre-empt the Decision 6 misreading

`calendar-show-more.md:204` says "Do **not** add `overflow` clipping" — that rules out clipping the
day cell's *item list* (which would re-hide items). It does not bear on the toggle's own one-line
text box. One clause distinguishing them stops a future reader filing this fix as a violation.

## Answers to the specific pressure tests

1. **Right fix?** Yes. Truncation keeps the count visible and matches what the sibling chips already
   do; wrapping grew the row and misaligned the whole week. Not a trade of one defect for another.
2. **Passes for the right reason?** For the *wrap* reason, yes — height drops from ~30px to ~15px
   against a 24px ceiling. For the *ellipsis* reason, no: see finding 2. Zero-height is not a real
   risk (`overflow: hidden` does not collapse an auto-height block), but the assertion's one-
   sidedness is why finding 3 asks for a look.
3. **The test edit.** Correct call, and `toBe` must stay. Checked, not assumed: `:398-400` is the
   only toggle-class assertion in the repo; C14 (`:757`) is the chip and is unaffected; no snapshots;
   no class-order tooling.
4. **Three classes or fewer?** Three. The Card's `overflow-hidden` does not save an interior cell.
5. **Scope.** Both rejections are sound; the *reason* given for the first is not (finding 1).

## Required changes

1. Replace §3's WCAG 2.5.3 rationale for rejecting a shorter mobile string — `+2` is already a
   prefix of the unchanged accessible name, so nothing would have to branch. Keep the rejection,
   cite the real costs (second visible span, `CalendarView.test.tsx:417`).
2. State in §5 that test 9's updated literal is the **only** check pinning `overflow-hidden` and
   `text-ellipsis` — the e2e case passes on a `whitespace-nowrap`-only fix.
3. Add a 390px visual confirmation to §6 recording what the collapsed and expanded toggle actually
   read; the e2e bounds height only.
4. Add a §6 done condition to mark `docs/backlog.md:163` RESOLVED and correct its "no test change
   needed" clause.

APPROVE WITH CHANGES
