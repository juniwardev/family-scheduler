# Plan Review: `feat/ui-redesign` (Tailwind + shadcn/ui presentation-only migration)

Reviewer: Plan-Reviewer (adversarial). Date: 2026-07-11.
Plan under review: `docs/plans/ui-redesign.md`. Spec: `docs/plans/ui-redesign-spec.md`.
Scope of review: read-only verification against `web/src/App.tsx`, `web/src/index.css`, `web/src/components/ItemEditor.tsx`, `web/src/components/ItemListView.tsx`, `web/src/components/CalendarView.tsx`, all `web/src/**/*.test.tsx`, `vite.config.ts`, `tsconfig.web.json`, `vitest.workspace.ts`, `tests/setup/jsdom.setup.ts`.

## Verdict: **APPROVE-WITH-CHANGES**

The plan is thorough, spec-aligned, correctly scoped to `web/src` + frontend config, and its test-preservation reasoning is unusually careful. It correctly identifies the biggest hazards (Radix-in-jsdom, native-input preservation, `.btn-outline` coupling, `@/` alias in three places, deep-link one-shot). However, several load-bearing claims are stated as settled that are actually **unverified assumptions** which, if wrong, break the "one test edit" promise. Two are genuine Blockers because they can silently regress protected behavior (deep-link NEW-1) or break tests the plan asserts are untouched. None require a rewrite — they need the plan to (a) commit to a specific mechanism and (b) add explicit verification gates. Fold in the punch-list below and this is ready.

### Severity counts
- Blocker: 2
- Major: 5
- Minor: 4
- Nit: 3

---

## Blockers

### B1 — The deep-link NEW-1 one-shot depends on ItemListView UNMOUNTING; the plan's "list always renders" wording risks breaking it, and the plan never states the editor open-state must remain ItemListView-local.
Ref: plan Decision 5 ("the list **always renders**, and `ItemEditor` renders inside a Dialog … whose `open` = `Boolean(showCreate || editingItem)`"); `web/src/App.tsx:138-152`; `web/src/components/ItemListView.tsx:34-35,49-57,101-118`; `web/src/App.deeplink.test.tsx:121-147`.

The NEW-1 regression test passes **precisely because** switching to Calendar makes `App` render `<CalendarView>` *instead of* `<ItemListView>` (App.tsx:140-152), which unmounts ItemListView and discards its local `editingItem`/`showCreate`. On return to List, ItemListView remounts with `initialOpenItem` already `null` (App owns the one-shot), so the editor does NOT reopen. This is the entire point of the test comment at `App.deeplink.test.tsx:121-147` and `ItemListView.tsx:14-22`.

The plan's phrase "the list always renders" is dangerously ambiguous. Two readings:
- **Safe reading:** the list markup always renders *within List view* (i.e. `ItemListView` no longer swaps its own body to the editor at `ItemListView.tsx:101-118`); App still swaps `ItemListView` ↔ `CalendarView` ↔ `AdminPanel` by `activeView`. NEW-1 preserved.
- **Unsafe reading:** `ItemListView` (or a lifted editor) stays mounted across `activeView` changes so the modal can float above any view. That would keep `editingItem` alive across the Calendar round-trip and **reopen the editor**, failing `App.deeplink.test.tsx:134-146` — a test the plan claims passes unchanged.

The plan must explicitly state: (1) App continues to conditionally render `ItemListView`/`CalendarView`/`AdminPanel` by `activeView` exactly as `App.tsx:138-152` does today (no lifting of the editor above the view swap), and (2) `showCreate`/`editingItem` stay ItemListView-local. Without this pinned down, the Coder can pick the unsafe reading and silently regress a protected behavior.

**Fix:** Add an explicit invariant to Decision 5: "App's view-swap (`activeView`) is unchanged; `ItemListView` still unmounts when `activeView !== 'list'`; the Dialog/Sheet and its `open` state (`showCreate||editingItem`) live inside `ItemListView` and unmount with it. This is required for the NEW-1 remount guard." Add a Phase-3 verification step: run `App.deeplink.test.tsx` unchanged and confirm the NEW-1 case passes.

### B2 — `App.deeplink.test.tsx` NEW-1 closes the editor via `getByRole("button", { name: /^cancel$/i })`, then asserts editor gone via `queryByText("Edit Item")` — under a Radix Dialog/Sheet with animated exit, "gone" may lag and the Cancel wiring is more fragile than the plan states.
Ref: `App.deeplink.test.tsx:132-134`; plan Decision 5 (`onOpenChange={(o)=>{ if(!o) onCancel(); }}`) and R6/edge-case notes; `tailwindcss-animate` in plan §5.1.

Two coupled risks the plan treats as solved but does not verify:

1. **Exit animation vs. `queryByText` immediacy.** The test does `await user.click(Cancel)` then `await waitFor(() => expect(queryByText("Edit Item")).not.toBeInTheDocument())` (App.deeplink.test.tsx:133-134). Radix Dialog/Sheet with `tailwindcss-animate` can keep content mounted during the exit transition. jsdom does not fire `transitionend`/`animationend`, so if the shadcn primitive gates unmount on an animation-end event (some Sheet variants do), the content **never leaves the DOM** and this `waitFor` times out. The plan's polyfill list (§8.1) does not address animation-end. This must be verified, and if it fails, the mitigation (e.g. disable animations in test env, or confirm the vendored primitive unmounts on state not on `animationend`) must be in the plan, not discovered by the Coder.

2. **Double-invocation of the cancel path.** `onOpenChange(false) → onCancel()` PLUS a Cancel button that itself calls `onCancel` (ItemEditor.tsx:279) means clicking Cancel could fire `onCancel` twice (once from the button, once from Radix closing on focus/escape). `ItemEditor`'s `onCancel` (ItemListView.tsx:112-115) is idempotent (just clears state), so it is probably harmless — but the `ItemEditor.test.tsx:135-149` "Cancel mid-edit" asserts `onCancel` was called **exactly once** (`toHaveBeenCalledTimes(1)`). If wiring the Dialog causes the Cancel button to also trigger `onOpenChange`, that assertion breaks — and that test is on the "pass unchanged" list. Note: `ItemEditor.test.tsx` renders `ItemEditor` in isolation (no Dialog wrapper), so it may be safe, but the plan must state that `ItemEditor.test.tsx` renders the bare component (the Dialog wrapper lives in `ItemListView`), so `onCancel` count stays 1.

**Fix:** (a) Add an explicit plan decision on test-env animations (recommend: gate `tailwindcss-animate` off or set `prefers-reduced-motion` in jsdom setup, OR verify the vendored Dialog/Sheet unmounts on open=false without waiting for `animationend`). (b) Clarify that `ItemEditor.test.tsx` continues to render the bare `ItemEditor` (Dialog wrapping is in `ItemListView`), preserving the exact-once `onCancel` assertion. (c) Make "NEW-1 passes unchanged" an explicit Phase-3 gate.

---

## Major

### M1 — The jsdom polyfill list is probably necessary-but-not-sufficient; the plan asserts sufficiency without a spike.
Ref: plan Decision 3 / §8.1; current `tests/setup/jsdom.setup.ts:1-73`.

The listed polyfills (`ResizeObserver`, pointer-capture trio, `scrollIntoView`, `DOMRect`, `PointerEvent→MouseEvent`) match the common Radix-in-jsdom set. But the plan states they are sufficient for "Dialog/Sheet/Select/Tabs/Tooltip/Checkbox" as fact. Known gaps this environment may still hit:
- **`Element.prototype.scrollTo` / `window.scrollTo`** — Radix Select/ScrollArea and some focus-restoration paths call it; not on the list.
- **`IntersectionObserver`** — some Radix/vendored components observe visibility; not on the list (lower likelihood for the primitives chosen, but Tooltip/Select positioning has used it in some versions).
- **Focus-trap interaction with `document.activeElement`** — Radix Dialog focus-trap can throw or loop if `getBoundingClientRect` returns all-zero AND no focusable node is found; the "zero-rect fallback" is noted but focus-trap edge behavior is not.
- **`hasPointerCapture` returning `false`** is correct, but `user-event` v14 pointer sequences inside a Radix Select trigger sometimes require `PointerEvent` to be a real constructor, not a `MouseEvent` alias, for `pointerId` — the alias may or may not satisfy it.

The plan already has the right escape hatch ("If a component still throws, add the specific missing API"), but it lists this as R1 mitigation rather than a required, time-boxed **Phase-1 spike**. Because six test files' "pass unchanged" status hinges on this, sufficiency must be *proven* before Phase 2/3, not assumed.

**Fix:** Convert §8.1 into a concrete Phase-1 exit gate: "Add a throwaway test that mounts a shadcn Dialog + Select + Tabs and interacts with each via `user-event`; the Phase-1 commit is not done until that spike passes. Add whatever additional polyfills it demands." Explicitly list `scrollTo` as a likely addition.

### M2 — `@/` alias must be added in THREE places, but the plan's headline says "two" and only conditionally covers the third (the Vitest web project).
Ref: plan Decision 1 ("must be declared in **two** places") vs. §5.3 / R3 (which then adds the web project "if needed"); `vitest.workspace.ts:29-37` (the web project has its **own inline config** and does NOT reference `vite.config.ts`).

Verified against `vitest.workspace.ts`: the `web` project is an inline object with `plugins: [react()]` and its own `test` block. It does **not** load `vite.config.ts`, so it will **not** inherit `resolve.alias`. Any `@/…` import in a `.test.tsx` (or transitively via a migrated component) will fail to resolve in the web Vitest project. The plan's own R3 acknowledges this but frames it as conditional ("add … if the workspace does not pick up") and the Decision-1 headline says "two places." This is exactly the "miss one → import failures in that context" trap the task flagged. It is effectively guaranteed to be needed given the current inline config.

**Fix:** Change the plan to state definitively: the alias goes in **three** places — `tsconfig.web.json` (paths), `vite.config.ts` (resolve.alias), and the **web project block in `vitest.workspace.ts`** (its own `resolve.alias`, since it does not inherit `vite.config.ts`). Remove the "if needed" hedge. Add a Phase-1 gate: a test that imports `@/lib/utils` and runs green in the web project.

### M3 — `dark:` variant + `darkMode:'media'` is coherent for the token-swap approach, but the plan does NOT audit vendored shadcn primitives for hard-coded `.dark` selectors that will silently not switch.
Ref: plan Decision 2 (token swap via `@media (prefers-color-scheme: dark) :root`, "no per-component `dark:` classes"); §5.4 (vendored `ui/*`).

The core premise is sound: components read `hsl(var(--token))`, the `@media` block re-points the vars, browser recolors — no `.dark` class needed. BUT some shadcn "new-york" primitives (the plan sets `style: "new-york"` in `components.json`) ship utilities with explicit `dark:` variants baked into their class strings (e.g. `dark:border-destructive`, shadow overrides, `dark:bg-*` on certain toggles/toasts). With `darkMode:'media'`, Tailwind compiles `dark:` to `@media (prefers-color-scheme: dark)` — so those **do** still switch. The real risk is any vendored file (or a doc-copied snippet) that hard-codes a `.dark ` **class selector** in raw CSS (not a `dark:` utility) — that will never activate because there is no `.dark` class on `<html>`. The plan asserts "no shadcn util hard-codes `.dark`" implicitly by not checking. Given the plan also removes any `.dark` scaffolding shadcn init may generate in `index.css`, a grep gate is cheap insurance.

**Fix:** Add a Phase-1/Phase-4 gate: `grep -r "\.dark" web/src/components/ui web/src/index.css` must return nothing (or only intentional). Confirm each vendored primitive's `dark:` utilities compile under `darkMode:'media'` (they do) and that no raw `.dark` selector was copied in. Note this explicitly in Decision 2.

### M4 — Native-vs-Radix control preservation is correct in intent, but `ItemEditor`'s Type control is currently a NATIVE radio group tied to `name="type"`, and the plan lists `RadioGroup` as a primitive to add — converting it would break behavior AND the checkbox/radio DOM assumptions.
Ref: plan §5.4 (RadioGroup "optional; may keep native radios") and R5; `ItemEditor.tsx:124-140` (native `<input type="radio" name="type">`); `ItemEditor.tsx:201-210` (native all-day `<input type="checkbox">`); `ItemListView.tsx:192-200` (native task checkbox).

R5 correctly biases toward native inputs where load-bearing, but the plan still lists `RadioGroup` and `Checkbox` as primitives "to add" and leaves the decision to the Coder ("Coder decides per-control"). Two of these are behavior-load-bearing:
- The task-complete checkbox (`ItemListView.tsx:192-200`) drives `onComplete` via `onChange`. `ItemEditor.test.tsx` and others don't query it directly, but a Radix `<button role="checkbox">` changes the event semantics.
- The Type radio (`ItemEditor.tsx:124-140`) — no test queries it by role today, but converting to Radix `RadioGroup` changes focus/keyboard behavior (arrow-key roving), which is a **user-visible behavior change**, violating "presentation-only."

The plan's R5 language is good but too soft ("Coder decides"). For a presentation-only migration, the safe default should be **mandated**, not left open, for these three specific controls.

**Fix:** Make R5 prescriptive for the enumerated controls: task-complete checkbox, all-day checkbox, and Type radios **stay native** (Tailwind-styled), full stop. Reserve Radix `Checkbox`/`RadioGroup` for net-new controls only (there are none in this migration). Drop `RadioGroup` from §5.4's "to add" list, or mark it explicitly "not added in v1."

### M5 — The plan claims Radix Select is a drop-in for the current native `<select>`s, but two of them have behavior-coupled `onChange` semantics and the location-kind select conditionally renders — Radix Select changes value/empty-string handling.
Ref: plan §5.4 (Select consumed by ItemEditor list/location-kind, ReminderEditor unit, RecurrenceEditor, NotificationSetup); `ItemEditor.tsx:111-120` (list select, `required`), `ItemEditor.tsx:173-187` (location-kind select with `value=""` → `null` mapping).

Radix `Select` is NOT a native `<select>`: it has no `required` form-participation, it does not emit a native `change` event, and an empty-string option value (`ItemEditor.tsx:174,182` maps `""` → `null`) is awkward in Radix (Radix Select disallows empty-string item values in recent versions and requires a placeholder instead). The location-kind mapping (`e.target.value === "" ? null : …`) would need rework, which edges from "presentation" into "behavior." Also `ItemEditor.tsx:111` `list select` is `required` and part of the `<form>` submit — Radix Select won't block submit on empty. No test queries these selects by role today, so tests may survive, but the **behavior** (form validation, empty→null) is at risk.

**Fix:** For the list select (`required`, form-participating) and the location-kind select (empty-string→null), the plan should either (a) keep them as styled **native `<select>`** (consistent with the native-input bias in R5), or (b) explicitly document the Radix-equivalent behavior (placeholder replacing the empty option, manual required-check) and confirm it's not a user-visible behavior change. Recommend native `<select>` for these two to stay honestly presentation-only. Add this to §5.4/R5.

---

## Minor

### m1 — theme-color OQ1: the plan's recommendation (match `--background`) contradicts the spec's literal text ("teal so the status bar matches"). Genuinely needs owner sign-off; do not let the Coder guess.
Ref: plan Decision 2 / OQ1; spec §2 ("Update the PWA `theme-color` … to the teal").
The plan makes a defensible argument (status bar sits above app bg, not accent) but this directly overrides an approved spec line. This is a one-line change either way, but it is an owner decision, not an architect default. Flag clearly.

### m2 — Tailwind v3-vs-v4 (OQ2): v3 is the right low-risk call for media-dark-mode; the plan justifies it well. This is safe with the architect's default and does NOT need owner sign-off unless the owner has a standing preference. Downgrade this from "needs sign-off" to "FYI, proceed on v3 unless owner objects."

### m3 — `useDefineForClassFields: true` (R8) — correctly flagged as low risk. CVA/clsx/tailwind-merge are plain functions, no class fields. No action needed beyond the note. Confirmed against `tsconfig.web.json:11`.

### m4 — CSP / offline for `lucide-react` and `tailwindcss-animate`: the plan correctly says no external font/CDN. Confirm `lucide-react` icons are tree-shaken SVG components (they are — no runtime fetch) and `tailwindcss-animate` is build-time only (it is — a Tailwind plugin). No network calls, offline-safe. One gap: the plan does not mention verifying the **service worker precache** still lists the (now differently-hashed, possibly larger) JS/CSS bundle. The Tailwind CSS bundle is new. Add a Phase-4 check that `web/sw.ts`'s precache/build output still covers the emitted CSS asset.

---

## Nits

### n1 — Plan §5.1 lists all UI deps under `devDependencies`. For a Vite app the runtime imports (`clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/*`, `tailwindcss-animate`) are compiled into the shipped bundle. Placing them in `devDependencies` is fine for a bundled frontend (they're inlined), but is inconsistent with convention and can surprise a future reader or a CI that prunes dev deps before build. Recommend runtime shadcn deps in `dependencies`, Tailwind/postcss/autoprefixer in `devDependencies`. Cosmetic.

### n2 — AppShell extraction (OQ4) is genuinely a no-sign-off-needed architect choice; either is fine. Agree with the plan flagging it only for reviewer awareness. No action.

### n3 — Bottom-tab primitive (OQ3): Button-row vs `Tabs`. Either satisfies `aria-current`. Recommend a plain Button row over Radix `Tabs` — Radix `Tabs` couples tab selection to `TabsContent` panels and roving focus, which is a heavier fit for what is really view-routing owned by `activeView` in App. Not a blocker; a Button row is lower-risk for the `App.test.tsx` `aria-current` assertion. Architect default is fine.

---

## Must-fix punch-list (fold in before Coder starts)

1. **(B1)** Pin the invariant in Decision 5: App keeps swapping `ItemListView`/`CalendarView`/`AdminPanel` by `activeView` exactly as today; the editor Dialog/Sheet and its `open` state (`showCreate||editingItem`) stay **inside `ItemListView`** and unmount with it. Add a Phase-3 gate: `App.deeplink.test.tsx` (esp. NEW-1) passes unchanged.
2. **(B2)** Decide and document test-env animation handling for Radix Dialog/Sheet (disable animations / reduced-motion in jsdom setup, or verify unmount is state-driven not `animationend`-driven). Clarify `ItemEditor.test.tsx` renders the bare component so `onCancel` stays exactly-once. Make NEW-1 close-then-not-reopen an explicit gate.
3. **(M2)** Change "two places" → **three places** for the `@/` alias, including the `web` project block in `vitest.workspace.ts` (it does not inherit `vite.config.ts`). Add a Phase-1 gate importing `@/lib/utils` in a web-project test.
4. **(M1)** Turn §8.1 polyfills into a Phase-1 **spike/exit gate** (mount+interact a Dialog+Select+Tabs via user-event before committing Phase 1); add `Element.prototype.scrollTo`/`window.scrollTo` to the likely list.
5. **(M4 + M5)** Make native-control preservation **prescriptive**, not "Coder decides": task-complete checkbox, all-day checkbox, Type radios, the `required` list `<select>`, and the empty→null location-kind `<select>` all stay **native** (Tailwind-styled). Drop `RadioGroup` from v1; keep native `<select>` for the two behavior-coupled selects.
6. **(M3)** Add a `grep`-based gate that no raw `.dark` selector leaks into `web/src/components/ui/*` or `index.css`.
7. **(m1)** Route theme-color target (OQ1) to the **owner** — it overrides an approved spec line; do not let the Coder pick.

## Owner sign-off genuinely required before Coder starts
- **New-dependency list (§5.1):** yes — ~a dozen frontend packages. Standard/MIT/offline-safe, but this is a real supply-chain surface expansion and the plan itself flags it. Owner should approve the list.
- **OQ1 theme-color target (background vs teal):** yes — the plan's recommendation contradicts approved spec §2. Owner decides.
- **OQ2 Tailwind v3 vs v4:** NO sign-off needed — v3 is the correct low-risk default; proceed unless the owner has a standing v4 mandate.
- **OQ3 bottom-tab primitive & OQ4 AppShell extraction:** NO sign-off needed — architect's call; either is fine.

---

## Re-review (round 2)

Reviewer: Plan-Reviewer (adversarial). Date: 2026-07-11.
Trigger: architect amended the plan to fold in the round-1 punch-list and encoded two LOCKED owner decisions (deps APPROVED; OQ1 theme-color = teal). This pass re-verifies each round-1 finding against the amended plan AND the current code, and checks whether the amendments introduced new problems. Read-only.

Re-verified against code: `web/src/App.tsx:138-152` (view-swap intact), `web/src/App.deeplink.test.tsx:121-147` (NEW-1 + Cancel→leaves-DOM), `web/src/components/ItemEditor.tsx:111-120,124-140,173-186,204` (list select `required`, Type radios, location-kind `""→null` select, all-day checkbox), `web/src/components/ItemListView.tsx:34-35,101-118,194` (`showCreate`/`editingItem` local `useState`, task-complete checkbox), `web/src/components/ReminderEditor.tsx:88-103` (two native channel checkboxes + unit select), `web/src/components/ItemEditor.test.tsx:135-149` (bare-component render, `onCancel` exactly-once), `vitest.workspace.ts:29-37` (inline web project, no `resolve.alias` today), `tsconfig.web.json:1-15` (no `baseUrl` today), `web/src/App.test.tsx:119-121` (`.btn-outline` coupling still present).

### Per-item results

| Item | Round-1 severity | Round-2 result | Note |
|---|---|---|---|
| B1 | Blocker | **PASS** | Decision 5 + §2 non-goals + §7 Phase-2/3 now pin the invariant unambiguously: App keeps the `App.tsx:138-152` view-swap; `ItemListView` unmounts on `activeView !== 'list'`; `showCreate`/`editingItem` stay `useState` INSIDE `ItemListView` (verified at `ItemListView.tsx:34-35`); the Dialog/Sheet lives inside `ItemListView`'s tree. The "list always renders" phrasing is explicitly scoped to "within List view" and the old ambiguous wording is called out as removed (Decision 5, line 205). No residual wording lifts the editor above the swap. |
| B2 | Blocker | **PASS** | Decision 3 + Decision 5 + §8.1 now require state-driven unmount (not `animationend`-gated), proven by the Phase-1 spike (asserts Dialog content leaves DOM on `open=false` via `waitFor`), PLUS belt-and-suspenders animation neutralization (reduced-motion via the existing `matchMedia` stub). Explicit prohibition on `forceMount`+`Presence`-until-`animationend`. `ItemEditor.test.tsx` bare-component render confirmed at `ItemEditor.test.tsx:140`; plan mandates the modal wrapper stays in `ItemListView`, keeping `onCancel` exactly-once (`ItemEditor.test.tsx:148`). Cancel→leaves-DOM `waitFor` (`App.deeplink.test.tsx:134`) is safe under state-driven unmount. |
| M1 | Major | **PASS** | §8.1 + Phase-1 exit gate (checklist step 9) is now a hard gate: temporary test mounts Dialog+Select+Tabs, drives via `user-event`, asserts state-driven unmount; commit blocked until green. `scrollTo`/`window.scrollTo` pre-listed; real-`PointerEvent` fallback noted. |
| M2 | Major | **PASS** | Alias now mandated in THREE places (Decision 1, §5.3, checklist step 4), including the inline `web` project in `vitest.workspace.ts`. Verified both gaps still real: `vitest.workspace.ts:29-37` has no `resolve.alias`; `tsconfig.web.json` has no `baseUrl`. Phase-1 gate imports `@/lib/utils` in a web-project test. Hedge removed. |
| M3 | Major | **PASS** | Decision 2 + Phase-1/Phase-4 `grep -rn "\.dark" …` gate added, with the correct clarification that `dark:` UTILITIES compile fine under `darkMode:'media'` and only a raw `.dark` CLASS selector is the hazard. |
| M4 | Major | **PASS** | §5.4 + R5 now PRESCRIPTIVE: task-complete checkbox, all-day checkbox, Type radios stay native; `RadioGroup` explicitly "NOT added in v1"; `Checkbox` dropped from the primitives list. All three verified native in code (`ItemListView.tsx:194`, `ItemEditor.tsx:204`, `ItemEditor.tsx:124-140`). No "Coder decides" left for these. |
| M5 | Major | **PASS** | §5.4/R5 mandate the `required` list `<select>` (`ItemEditor.tsx:111-120`) and the empty→null location-kind `<select>` (`ItemEditor.tsx:173-186`) stay native; shadcn `Select` restricted to non-form-critical dropdowns (ReminderEditor unit, RecurrenceEditor freq/end, NotificationSetup provider). Both selects verified in code with the exact `required` + `""→null` semantics the plan describes. |
| m1 (theme-color) | Minor | **PASS** | RESOLVED to teal per LOCKED owner decision; Decision 2 encodes the light/dark meta pair (`#4a9d8e`/`#5cb3a3`) and manifest `theme_color: #4a9d8e`; removed from open questions. The plan explicitly notes the earlier "match `--background`" draft was overridden. No Coder guess remains. |
| m2 (v3 vs v4) | Minor | **PASS** | De-gated: v3 is the accepted low-risk default, no sign-off (Decision 1 OQ2, §9 R2). |
| m3 (useDefineForClassFields) | Minor | **PASS** | Noted as low-risk, no action; unchanged. |
| m4 (SW precache CSS) | Minor | **PASS** | Phase-4 checklist step 27 adds the SW-precache check for the emitted Tailwind CSS asset. |
| n1 (dep placement) | Nit | **PASS** | §5.1 splits runtime shadcn deps → `dependencies`, Tailwind/postcss/autoprefixer → `devDependencies`. |
| n2 (AppShell) | Nit | **PASS** | Left as architect's call (OQ4). |
| n3 (bottom-tab primitive) | Nit | **PASS** | Left as architect's call (OQ3); `aria-current` assertion path preserved either way. |

All 14 round-1 items: **PASS**. No PARTIAL, no FAIL.

### New issues introduced by the amendments

Checked the four amendment-interaction risks the re-review brief called out, plus a diff of the revision note against the body:

- **N-A (Nit) — native `<select>` visually adjacent to shadcn `Select` may look inconsistent.** The plan keeps 5 native controls (2 of them `<select>`s in ItemEditor) while using shadcn `Select` in ReminderEditor/RecurrenceEditor/NotificationSetup. A restyled native `<select>` and a Radix `Select` trigger will not be pixel-identical (native dropdown chrome vs. custom popover). This is acceptable for presentation-only and correct for behavior-safety, but the plan does not explicitly acknowledge the visual mismatch or tell the Coder/QA to style the native selects to visually approximate the shadcn trigger. Recommend a one-line note in §5.4/Phase-4 sweep: "style native `<select>`s to visually match the shadcn `Select` trigger (border/radius/height tokens) so the two coexist cleanly." Non-blocking.

- **N-B (Nit) — teal `theme-color` status-bar contrast in dark mode is untested.** Decision 2 sets a dark `theme-color` of `#5cb3a3` (a fairly light teal). iOS renders status-bar glyphs (time/battery) in a system-chosen color; a mid-light teal in dark mode could yield marginal glyph contrast. This is a pure visual QA item, fully reversible, and the owner LOCKED teal — so not a plan defect, but the Phase-4 sweep (step 26) should add "verify iOS status-bar glyph legibility over the teal in both themes." Non-blocking.

- **N-C (informational) — ReminderEditor native channel checkboxes are not in the enumerated "5 controls" list.** `ReminderEditor.tsx:89-102` has two native `<input type="checkbox">` (email/push). The M4/M5 prescriptive list enumerates 5 controls and does not name these, but §5.3's ReminderEditor row does say "Checkbox(native)", and M4 drops Radix `Checkbox` from v1 entirely — so the net instruction (all checkboxes stay native) unambiguously covers them. No contradiction, but the "5 controls" framing is slightly narrower than the actual native-checkbox surface. No change required; flagging only so the Coder does not read "only these 5 are native" as license to convert the ReminderEditor checkboxes. The plan's own §5.3 already prevents this.

- **Spike-gate hardness — CONFIRMED real.** The Phase-1 spike is now a genuine commit-blocking exit gate (checklist step 9 + §7 exit gates: "The Phase-1 commit is not done until the spike passes"), not hand-wavy. It must prove mount + interact + state-driven unmount before Phase 3 primitives are used. Good.

- **Revision-note vs body — no contradiction found.** The revision note (lines 11-27) accurately summarizes the body changes. One tiny stale artifact: Decision 2 line 158 still contains a parenthetical explaining the *prior* "match `--background`" recommendation was overridden — this is intentional documentation of the override, not a live contradiction, and it reads correctly. No action.

No new Blockers or Majors. Three Nits/informational only.

### Verdict (round 2)

**APPROVE — ready for Coder.**

All 2 Blockers, 5 Majors, and the Minors/Nits from round 1 are resolved (14/14 PASS) and were re-verified against the current code, not just the plan prose. The amendments introduced no new Blocker/Major; the only new findings are three Nits (native-vs-shadcn select visual consistency, iOS dark status-bar glyph contrast, and a framing clarification on the ReminderEditor checkboxes) that are QA/polish items, not implementation blockers, and can be handled inside the existing Phase-4 sweep. The Phase-1 spike is a real hard gate. No send-back required.

**Single most important thing for the Coder to watch:** the B1 invariant end-to-end — keep `showCreate`/`editingItem` as `useState` INSIDE `ItemListView` and render the Dialog/Sheet inside `ItemListView`'s tree so it unmounts with the view; do NOT lift the editor above the `App.tsx:138-152` `activeView` swap. Prove it by running `App.deeplink.test.tsx` (esp. NEW-1) unchanged after the editor-move commit. If NEW-1 fails, the editor was lifted or ItemListView was kept mounted across views — revert that structural choice, do not patch the test.
