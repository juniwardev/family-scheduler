# Plan Review: `fix-item-save`

Reviewer: Plan-Reviewer (adversarial, read-only on app code)
Plan: `docs/plans/fix-item-save.md` (v2)
Scope claim: frontend form-flow fix + one PATCH validation hole; no schema, no engine/auth/push changes.

I verified every load-bearing file:line the plan cites against the actual source. The core
diagnosis holds up. There is one Major gap (the primary regression test has no harness in this
repo and the plan's fallback cannot catch the bug), plus several Minor accuracy/completeness items.

---

## 1. Root-cause correctness — CONFIRMED CORRECT

The missing-`type` diagnosis is accurate and precisely located.

- `web/src/components/ReminderEditor.tsx:104` — `<button className="btn btn-sm btn-danger" onClick={() => remove(i)}>×</button>` — **no `type`**. Confirmed.
- `web/src/components/ReminderEditor.tsx:107` — `<button className="btn btn-sm btn-outline" onClick={add}>+ Add reminder</button>` — **no `type`**. Confirmed.
- Both are rendered inside the `ItemEditor` `<form>`: form opens at `ItemEditor.tsx:83`, `<ReminderEditor>` mounted at `ItemEditor.tsx:221-224`, inside the form. Confirmed nesting.
- Per HTML, a `<button>` with no `type` inside a form defaults to `type="submit"`, so a click fires the form's `onSubmit` → `handleSubmit` (`ItemEditor.tsx:53`) → create branch `createItem(draft)` (`ItemEditor.tsx:72`) in create mode. Confirmed the submit handler does call create.
- Proof-by-contrast holds: `RecurrenceEditor` weekday buttons set `type="button"` (`RecurrenceEditor.tsx:131-134`), and `ItemEditor`'s own buttons are correct — submit at `:228` (`type="submit"`), Cancel at `:231` (`type="button"`).

The batched-state analysis in §7 is also correct: `setField` (`ItemEditor.tsx:49-51`) is async, so the stray submit posts the pre-reminder `draft`. The `e.preventDefault()` at `:54` stops navigation but NOT the React handler that calls `createItem`, so the fix (kill the stray submit) is the right lever. This is not a symptom patch — it removes the actual trigger.

## 2. Fix completeness / button sweep — COMPLETE

I swept the entire `ItemEditor` form subtree (`ItemEditor` + its only two sub-components,
`RecurrenceEditor` and `ReminderEditor`) for every `<button>`:

- `ItemEditor.tsx:228` submit — explicit `type="submit"` (correct).
- `ItemEditor.tsx:231` Cancel — explicit `type="button"` (correct).
- `RecurrenceEditor.tsx:131-134` weekday — explicit `type="button"` (correct).
- `ReminderEditor.tsx:104`, `:107` — the only two missing `type`.

There are no other `<button>` elements in the subtree. The plan's fix (add `type="button"` to
exactly those two) covers 100% of the offenders. No uncovered button. (Note: text inputs at
`:125`/`:207` still allow Enter-key implicit submit — that is standard, desirable "press Enter to
create" behavior, not the reported defect. No action needed.)

## 3. "Create is already atomic" claim — SUBSTANTIALLY CORRECT (one wording nuance)

Verified end to end:

- Client posts the whole draft including reminders in one request: `createItem(draft)` → `POST /items` (`apiClient.ts:108-112`). No early POST-for-ID exists.
- Route reads reminders inline: `routes/items.ts:122` (`reminders: Array.isArray(b.reminders) ? b.reminders : []`) and validates each in `validateItemInput` (`items.ts:234-244`).
- DB writes item then reminders in the same function: `createItem` INSERT then `_upsertReminders(db, id, input.reminders ?? [])` (`db.ts:572`, helper `:790-815`).
- Design §2.3 confirms inline reminders + `201 ItemWithReminders` (`family-scheduler-design.md:400-412`).
- The separate `PUT /api/items/:id/reminders` path (`routes/reminders.ts:12`, mounted at `/api/items` via `index.ts:41`) and the `replaceReminders` client helper (`apiClient.ts:148-153`) are NOT used by any component — grep confirms the helper is only *defined*, never imported by a component.

So the create-side fix is genuinely frontend-only. **Minor caveat:** "atomically" is imprecise.
`createItem` issues sequential `.run()` calls (item INSERT, then DELETE + N reminder INSERTs) with
**no DB transaction / `db.batch()`**. It is one HTTP call and one DB function, but a failure partway
through `_upsertReminders` would leave an item persisted without its reminders. In practice this is
guarded because `validateItemInput` rejects malformed reminders *before* any write, so this path is
not reachable via the API for bad input — but the plan should not call it "atomic" without that
qualifier, and DC2's "single-call atomicity" assertion rests on pre-write validation, not on a
transaction.

## 4. Edit-flow second bug — REAL (not scope-invention), fix mostly sound, two gaps

The dropped-reminders bug is real:

- Edit branch calls `updateItem(item.id, {...})` with **no reminders** (`ItemEditor.tsx:58-70`).
- `ItemUpdatePatch` has no `reminders` field (`apiClient.ts:114-124`).
- `PATCH /api/items/:id` never touches reminders (`routes/items.ts:156-166`; `db.updateItem` `:582-645` has no reminder write).

So editing a reminder in edit mode today mutates local `draft.reminders` and is silently discarded
on Save. Confirmed — this is a genuine pre-existing bug, not manufactured scope.

The proposed reuse of `replaceReminders` (→ `PUT` → `db.replaceReminders` `db.ts:768-788`, which
purges pending dispatch per D7 then `_upsertReminders`) is a valid path. Partial-failure analysis is
sound: the item already exists (no orphan risk); if `replaceReminders` fails after `updateItem`
succeeds, state is `new timing + old reminders`, which materialize rebuilds consistently — recoverable,
no corruption. Because both awaits precede `onSave` inside the `try`, a throw correctly skips
`onSave` and the editor stays open. Good.

Two gaps the plan under-specifies:

- **(Minor, correctness) `onSave` must merge the new reminder set.** `updateItem` returns
  `ItemWithReminders` whose `reminders` reflect the **old** set (`db.ts:643` reads reminders *before*
  the PUT replaces them). `replaceReminders` returns the **new** set. If the coder calls
  `onSave(saved)` with the `updateItem` result, the UI shows stale reminders. The plan's checklist
  step 2 says "pass the updated-reminders item to onSave" but the body text does not make the merge
  explicit (`onSave({ ...saved, reminders: <result of replaceReminders> })`). Call this out
  concretely so it is not lost.
- **(Minor, scope) folding in the edit fix widens blast radius.** The reported defect is the CREATE
  premature-persist. The button-`type` fix alone resolves the reported bug for both modes. Adding the
  `replaceReminders` call is a *separate* bug fix that newly activates the `PUT` path and introduces a
  two-call non-transactional edit. It is defensible (same editor, and leaving it means edit-reminders
  still silently drop after the button fix), but it should be acknowledged as an additional fix with
  its own regression (DC3) rather than folded silently.

**Recommendation on the open question (reuse-PUT vs single-call PATCH):** keep the reuse-PUT approach
for this fix — it is minimal, needs no route/`db` change, and the partial-failure window is
recoverable and surfaced. The single-call PATCH alternative is cleaner/atomic but is a larger server
change than a defect fix warrants; leave it as a documented follow-up. Approve reuse-PUT *conditional
on* the `onSave` merge (above) and on distinct error surfacing when the PUT fails after a successful
PATCH.

## 5. PATCH title-validation hole — CONFIRMED, fix correct, but scope note is WRONG about `type`

The hole is real:

- Route: `title: typeof b.title === "string" ? b.title.trim() : undefined` (`items.ts:158`). `""`
  and whitespace trim to `""`, which is a string, so it is passed through (not `undefined`).
- `db.updateItem` binds `patch.title ?? null` (`db.ts:620`) into `title = COALESCE(?, title)`
  (`db.ts:607`). `??` only catches `null`/`undefined`, so `""` survives and `COALESCE('', title)`
  writes the empty string; `title TEXT NOT NULL` is satisfied by `''`. Blank title persists. Confirmed.

The `validateItemPatch` fix (reject empty/whitespace/>200 when `"title" in b`, before `updateItem`,
returning `400 { code: "VALIDATION" }`) is correct. `VALIDATION` is a valid `Result` code
(`types.ts:17`). Placement (after parse `b`, before the write) is right.

`start_at` scope note is accurate: it shares `COALESCE(?, start_at)` (`db.ts:610`, bind `:623`) but
is guarded at the route by `typeof b.start_at === "number"` (`items.ts:161`) and JSON cannot carry
`NaN`, so the empty-string hole does not apply; the validator's `start_at` branch is defensive only.

- **(Minor, accuracy) The plan's claim that `type` is already "enum-guarded similarly" (§4.3, line 218) is FALSE.** The PATCH route does `type: typeof b.type === "string" ? (b.type as "event" | "task") : undefined` (`items.ts:157`) — it casts **any** string through without enum validation, so `PATCH {type:"bogus"}` currently persists `"bogus"` via `COALESCE('bogus', type)`. The plan's `validateItemPatch` DOES close this (its `type` branch), and DC4 tests it — so the *fix* is actually more complete than the prose. But the rationale must be corrected: `type` is a live, currently-open hole, not "already guarded." Reviewer/coder should understand this so the `type` check is not dropped as "redundant."

## 6. Locked list & scope — WITHIN BOUNDS

Touched: `ReminderEditor.tsx` (two buttons), `ItemEditor.tsx` (edit-branch reminder persist + error
banner), `routes/items.ts` (`validateItemPatch`). No engine (materialize/send/dispatch), no auth, no
push, no schema/migration. The edit fix reuses the existing `PUT`/`replaceReminders`/`_upsertReminders`
without modifying them. The P2-N1 "purge dispatch before cascade" hard requirement is untouched (the
edit path relies on the existing D7 purge inside `replaceReminders` at `db.ts:784`). Scope is
acceptable; the only expansions (edit reminder-persist, `type` enum guard, cosmetic error banner) are
transparent and small.

## 7. Tests — MAJOR GAP on the load-bearing regression

Server-side DCs are implementable and discriminating: DC4 (PATCH blank/whitespace title → 400,
row unchanged; `{type:"bogus"}` → 400), DC2, DC5 all fit the existing `tests/unit/routing.test.ts`
harness (Hono app + local D1 via `@cloudflare/vitest-pool-workers`) and DC4 **would fail on pre-fix
code**. Good.

**The problem is DC1 and DC3 — the only tests that actually prove the REPORTED (frontend) bug — have
no harness in this repo, and the plan's fallback cannot catch the bug:**

- The single Vitest config is `defineWorkersConfig` (`vitest.config.ts:1-16`), running in the
  Cloudflare **workers runtime** (miniflare/workerd) with `include: ["tests/**/*.test.ts"]` — note
  `.test.ts` only, not `.tsx`. This environment has **no DOM** and cannot render React.
- `devDependencies` (`package.json:21-37`) include **no `@testing-library/react`, no `jsdom`, no
  `happy-dom`**, and no second Vitest project for a web/DOM environment. So the "component test
  (React Testing Library)" option in §8 is **not runnable** without adding those deps + a separate
  web Vitest project/config + widening the include glob to `.tsx`.
- Playwright is listed (`package.json:24`) and `test:e2e` is scripted, but there is **no
  `playwright.config.*`** and **zero existing e2e tests**. Standing up the first e2e also requires a
  dev server and a way past Cloudflare Access (the app is Access-JWT gated) — real setup the plan does
  not budget for.
- The plan's escape hatch — "the load-bearing DB assertions can also be done at the API layer by
  asserting no rows exist" (§8) — **does not catch this bug.** An API-layer test can only assert
  "if the client doesn't POST, nothing is written," which is trivially true and **passes on the
  pre-fix code too** (pre-fix, the extra POST is triggered by a DOM click, not by the API test). It
  cannot fail before the fix, so it does not prove the fix.

Net: DC1 is described as "the direct proof of the reported bug being fixed," but as written it is
either (a) not implementable with the current toolchain, or (b) degraded to an assertion that cannot
regress. The plan must either provision a real frontend harness (RTL + jsdom + a web Vitest project,
picking up `.tsx`) or commit to a Playwright e2e and stand up its config + Access bypass — and list
that harness work in "Affected files" and the checklist. When implemented as a component test, the
assertion should be behavioral ("clicking + Add reminder does not call `createItem`", which fails
pre-fix) with an optional cheap `expect(button.type).toBe('button')` backstop.

---

## Findings summary

- **Major** — Tests: the load-bearing DC1 (and DC3) frontend regression has no runnable harness in this repo (workers-only Vitest, no RTL/jsdom, no `playwright.config`), and the plan's API-layer fallback cannot fail on pre-fix code so it does not prove the fix. Harness provisioning must be added to scope. (§8; `vitest.config.ts`, `package.json:21-37`, no `playwright.config.*`.)
- **Minor** — §4.3 line 218 wrongly states `type` is "already enum-guarded" on PATCH; `items.ts:157` casts any string through, so `{type:"bogus"}` currently persists. The fix closes it, but the rationale is inaccurate.
- **Minor** — Edit-flow `onSave` must merge the `replaceReminders` result; `updateItem`'s returned `reminders` are stale (`db.ts:643` reads before the PUT). Make the merge explicit to avoid a stale-UI bug.
- **Minor** — "atomic" create is a single HTTP call / single DB function but NOT a DB transaction (`db.ts:547-572` sequential `.run()`s); safe only because `validateItemInput` precedes writes. Qualify the wording; DC2's atomicity assertion depends on pre-write validation.
- **Minor** — Folding the edit reminder-persist fix in widens blast radius (activates the previously-unused `PUT` path, adds a non-transactional two-call edit). Defensible, but should be acknowledged as a distinct fix with its own regression.
- **Nit** — Recommendation: keep edit on reuse-PUT (minimal); document single-call PATCH as follow-up.
- **Nit** — Text inputs allow Enter-key implicit submit; that is intended behavior, worth a one-line note so it is not mistaken for a residual defect.

The diagnosis, the create fix, the button sweep, and the PATCH title fix are all correct and minimal.
The blocking issue is that the plan's primary proof-of-fix is not testable as scoped. That is
fixable by adding harness provisioning and the four wording/correctness corrections above, without
rewriting the plan.

## Required changes (fold in before implementation)

1. Provision a runnable frontend test harness for DC1/DC3 (either: add `@testing-library/react` + `jsdom` + a dedicated web Vitest project that includes `.tsx`; OR create `playwright.config.*` plus a dev-server + Cloudflare Access bypass) and list this work in "Affected files" and the Coder checklist. Remove the "API-layer no-rows" fallback as the DC1 proof — it cannot fail on pre-fix code. DC1 must be a behavioral assertion (clicking "+ Add reminder" does NOT call `createItem`) that demonstrably fails against the current code.
2. Correct §4.3: state that PATCH `type` is currently NOT enum-guarded (`items.ts:157` casts any string) and that `validateItemPatch` newly closes it; keep the `type` check.
3. Make the edit-flow `onSave` merge explicit: pass `{ ...updatedItem, reminders: <replaceReminders result> }` to `onSave`, and surface a distinct error if `replaceReminders` fails after a successful `updateItem`.
4. Qualify the create "atomicity" wording: single HTTP call, not a DB transaction; safe because `validateItemInput` runs before any write. Adjust DC2's assertion note accordingly.

APPROVE WITH CHANGES

---

## Re-review (Pass 2)

Reviewer: Plan-Reviewer (adversarial, read-only on app code)
Plan under re-review: `docs/plans/fix-item-save.md` (v3 amendment log, lines 27-51)
Trigger: Pass 1 returned APPROVE WITH CHANGES — 1 Major (no runnable frontend harness for DC1/DC3) + 3 Minors. Owner decision: "jsdom now, Playwright later." I re-verified every amended claim against source rather than trusting the amendment log.

### Verdict on the Pass-1 Major — RESOLVED

The plan now provisions a real jsdom component-test harness as the load-bearing regression guard (§8.1, §5 table rows for `package.json`/`vitest.workspace.ts`/`ItemEditor.test.tsx`/`jsdom.setup.ts`, checklist steps 5-6). I checked each mechanical claim:

- **DevDeps genuinely absent, prerequisites genuinely present.** `package.json:21-37` confirms none of `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` are installed today, and that `@vitejs/plugin-react` (`:29`), `react`/`react-dom` (`:31-32`), `@types/react*` (`:27-28`), and `vitest` (`:35`) already exist. The plan's dependency delta (§8.1) is exactly the four missing packages — accurate, no over- or under-listing.
- **Existing config matches the plan's description.** `vitest.config.ts` is a single `defineWorkersConfig` with `include: ["tests/**/*.test.ts"]` (`:14`) — `.test.ts` only, workers pool, no DOM. The plan's split into a worker project (`.test.ts` under `tests/` + `src/worker/`) and a jsdom project (`.test.tsx` under `web/`) is a clean, collision-free glob partition. Adding `src/worker/**/*.test.ts` to the worker include is a harmless superset (no such files exist today; `Glob` finds no `*.test.tsx` anywhere yet, so nothing is mis-bucketed on day one).

**Dual-project mechanism soundness (the specific risk I was asked to probe).** Mixing `defineWorkersConfig` and a plain jsdom project in a `vitest.workspace.ts` is a supported pattern on this stack: Vitest 2.0.5 supports workspaces, and `@cloudflare/vitest-pool-workers` is designed to run as one project among others (it only needs its own project so the workers pool/miniflare D1 setup is not applied to the DOM project). Keeping them as separate projects is exactly the right isolation — the jsdom `environment`/`react()` plugin must NOT touch the workers project, and the plan says so explicitly. The plan also hedges with an acceptable fallback (a second `vitest.web.config.ts` run as another project) if the workspace file proves awkward, and keeps `"test": "vitest run"` unchanged so the CLAUDE.md `npm test` contract (both suites, one command) holds. I found **no blocking incompatibility** the plan glosses over. Caveat worth noting for the Coder (Nit, not Major): a root `vitest.config.ts` plus a `vitest.workspace.ts` can double-load the worker config if the workspace also globs it in; the Coder should make the worker project reference the existing config once (not both root-config-as-implicit-project AND workspace entry). This is standard Vitest-workspace hygiene and does not threaten feasibility.

**The load-bearing question — does the DC1 test actually FAIL pre-fix and PASS post-fix? YES.** I traced the pre-fix control flow against source:
- `ReminderEditor.tsx:107` ("+ Add reminder") has no `type`, so inside the `ItemEditor` `<form>` (`ItemEditor.tsx:83`) it is a submit button. A `userEvent.click` in jsdom dispatches a real click whose default action is form submission; jsdom fires the form's `submit` event and React's `onSubmit` (`ItemEditor.tsx:83` → `handleSubmit` `:53`) runs. `handleSubmit` calls `e.preventDefault()` (`:54`) — which only cancels navigation, not the handler — then in create mode reaches `await createItem(draft)` (`:72`). Crucially, the spy is invoked **synchronously** at the point of the `createItem(draft)` call, before the `await` suspends, so after `await userEvent.click(...)` resolves the spy has definitely registered the call. Therefore `expect(createItem).not.toHaveBeenCalled()` is RED on pre-fix code and GREEN once `type="button"` is added (§4.1). This is a genuine regression guard, not a test that passes regardless. The secondary `onSave` assertion is also satisfied (onSave fires a microtask later once the mocked `createItem` resolves), but the `createItem` assertion is the solid, synchronous one — good that the plan makes it primary and relegates the `type="button"` attribute check to an "optional backstop."
- One robustness note (Nit): the create-mode render must supply a **non-empty `lists` prop** (the List `<select>` is `required`, `ItemEditor.tsx:96`, defaulting to `lists[0]?.id`), and the plan already says to fill Title (`:129` required) and Start (`:180` required). Filling all three required fields removes any dependence on whether jsdom performs interactive constraint-validation blocking of the submit — under the common jsdom behavior (no interactive validation) the test fails pre-fix regardless, and with fields filled it fails pre-fix under either behavior. The plan mentions Title+Start but not `lists`; the Coder will pass `lists` anyway since it is a required prop, but calling it out would make the "fails pre-fix" property airtight. Non-blocking.

**Playwright deferral — CONFIRMED.** §2 non-goals (`:80-81`), §8.4 (`:437-444`), and checklist steps 6 and 8 (`:477`, `:479-480`) all mark Playwright out of scope: no `playwright.config.*` provisioning, and "Do not run `npm run test:e2e`." Matches the owner's "Playwright later." Consistent with source: `@playwright/test` is present (`package.json:24`) but there is no config and zero e2e tests.

### Minor 1 (PATCH `type` hole) — RESOLVED

Verified against source that `type` is genuinely unguarded on PATCH today: `routes/items.ts:157` is `type: typeof b.type === "string" ? (b.type as "event" | "task") : undefined` — an unchecked cast of any string, which `db.updateItem` writes via `COALESCE(?, type)` (`db.ts:606`, bind `patch.type ?? null` at `:619`). So `PATCH {type:"bogus"}` persists `"bogus"`. §4.3(b) (`:243-248`) now states this correctly as a "THIRD hole … NOT already guarded," explicitly retracts the v2 "already enum-guarded" claim, and instructs the Coder not to drop the check as redundant. `validateItemPatch` (`:267-269`) rejects any `type` other than `event`/`task`, wired before `updateItem` (`:277-280`, after the `b` parse at `items.ts:143`). DC4 (`:428-431`) asserts `{type:"bogus"}` → `400 VALIDATION` naming `type`, then re-SELECTs to confirm the old value survives, and notes it fails pre-fix. Sound and complete.

### Minor 2 (edit-flow reminder merge) — RESOLVED

Verified the stale-read: `db.updateItem` never writes reminders and reads them at `db.ts:643` (`const reminders = await getItemReminders(db, id)`) as the tail of the UPDATE, so relative to the subsequent client `PUT` the returned set is the OLD one. `apiClient.ts:148-153` confirms `replaceReminders` returns the fresh `{ reminders: ItemReminder[] }`. §4.2 (`:198-209`) now mandates `onSave({ ...saved, reminders })` using the `replaceReminders` result, with an explicit ordering/failure contract (`:211-222`): `updateItem` first; on its failure abort before `onSave`; on `replaceReminders` failure after a successful `updateItem`, surface a distinct recoverable error and do not call `onSave`. DC3 (`:413-418`) asserts the call order and that `onSave` receives an item whose `reminders` equal the `replaceReminders` result (proving stale reminders are not surfaced). Sound. Nit for the Coder: `onSave`'s param is typed `Item` and `updateItem` returns `{ item: Item }` (`apiClient.ts:126-131`); confirm the `Item`/`ItemWithReminders` type carries a `reminders` field so `{ ...saved, reminders }` typechecks without an excess-property error. This is a typecheck detail the Coder will hit immediately, not a plan defect.

### Minor 3 (atomic wording) — RESOLVED

The plan no longer implies transactional semantics anywhere load-bearing. §3.2 (`:138-146`) explicitly says "single API call, guarded by pre-write validation," never "atomic/transactional," and spells out that `createItem` issues sequential `.run()`s with no `db.batch()`. §4.1 (`:166-167`) repeats "single call guarded by pre-write validation, not a transaction." §7 (`:328-333`) restates it and marks the D1-`batch()` wrapping as an **OPTIONAL, non-scope** consideration. §2 non-goals (`:82`) lists "No DB transaction wrapping of create." DC2 (`:424-427`) now rests the "nothing written on bad input" assertion on pre-write validation (`validateItemInput`, `items.ts:223-246`), not rollback. Consistent throughout.

### Regression / new-issue sweep

- **No scope creep introduced by the amendment.** Application changes remain: `ReminderEditor.tsx` (two button types), `ItemEditor.tsx` (edit-branch persist + merge + `ApiError` banner), `routes/items.ts` (`validateItemPatch`). The only additions are test-harness devDeps + Vitest config + two new test files — the required Major resolution, explicitly allowed as "devDependencies + test config only" (§6 `:318-319`). No schema/migration, no reminder-engine/auth/push change. §4.4's `ApiError` banner swap is verified feasible: `ApiError` is exported at `apiClient.ts:15`.
- **All Pass-1 confirmed-correct items preserved.** Root-cause (§3.1), button sweep (§4.1 note + reviewer audit), create-is-frontend-only (§3.2), edit dropped-reminders diagnosis (§4.2), PATCH blank-title hole (§4.3(a)), and the Enter-key "not a defect" note (`:175-176`) are all intact and still match source (`ReminderEditor.tsx:104,107`; `ItemEditor.tsx:58-73`; `items.ts:158` + `db.ts:607/620`).
- **Done-condition → test mapping is coherent.** DC1 → jsdom component test that fails pre-fix (behavioral `createItem` not-called assertion); DC2 → server complete-create writes 1 item + 2 reminders; DC3 → edit holds-then-persists-and-merges (jsdom); DC4 → PATCH blank-title/whitespace/bogus-type → 400 + row unchanged (server, fails pre-fix); DC5 → happy paths preserved. Each maps to the correct harness (jsdom for `.test.tsx`, workers pool for server `.test.ts`).

### Pass-2 findings

- No Major remaining. Minor 1, 2, 3 and the Pass-1 Major are all resolved and verified against source.
- Nit (Coder-facing, non-blocking): supply a non-empty `lists` prop in the DC1 create-mode render so the `required` List select is valid and the "fails pre-fix" property is airtight under any jsdom validation behavior.
- Nit (Coder-facing, non-blocking): keep the worker Vitest config referenced once under the workspace to avoid double-loading `defineWorkersConfig`.
- Nit (Coder-facing, non-blocking): confirm the `Item` type carries `reminders` so the `onSave({ ...saved, reminders })` merge typechecks.

The Major and all three Minors are resolved, and the amendment introduced nothing new at Major severity. The three residual items are Coder-level implementation nits, not plan defects.

APPROVE
