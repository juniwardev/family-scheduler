# QA Report: `fix-item-save`

Branch: `feat/fix-item-save`
Plan: `docs/plans/fix-item-save.md` (v3, Pass-2 APPROVE)
Impl notes: `docs/process/fix-item-save-impl-notes.md`
Review: `docs/reviews/fix-item-save-review.md` (Pass 1: APPROVE WITH CHANGES, Pass 2: APPROVE)

## Summary verdict

**PASS**

Both Vitest projects pass in full (49/49 tests, 8/8 files), typecheck is clean, the DC1 regression
test is a genuine behavioral guard (verified by code inspection), and code inspection confirms all
four scoped fix items match the plan exactly. Manual browser E2E was blocked by a real environment
constraint (Cloudflare Access JWT auth, no dev bypass exists in this codebase) — documented below,
not counted against the fix. Verdict rests on automated tests + code inspection per the verdict
guidance's explicit allowance for this scenario.

---

## A. Automated tests

### A1. `npm test`

Command run: `npm test` (→ `vitest run`, picks up `vitest.workspace.ts`).

```
✓ |worker| tests/unit/push-encrypt.test.ts       (1 test)
✓ |worker| tests/unit/push-vapid.test.ts         (3 tests)
✓ |web|    web/src/components/ItemEditor.test.tsx (3 tests)
✓ |worker| tests/unit/recurrence.test.ts         (6 tests)
✓ |worker| tests/unit/auth-deactivated.test.ts   (6 tests)
✓ |worker| tests/unit/routing.test.ts            (6 tests)
✓ |worker| tests/unit/items-validation.test.ts   (10 tests)
✓ |worker| tests/unit/db.test.ts                 (14 tests)

Test Files  8 passed (8)
     Tests  49 passed (49)
```

Matches the impl-notes claim exactly: 46 worker tests + 3 web tests = 49. Both `worker` and `web`
Vitest projects ran under a single `npm test` invocation via `vitest.workspace.ts`, confirming the
dual-project harness works as designed (plan §8.1).

### A2. `npm run typecheck`

```
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json
(no output — clean)
```

Clean for both the worker and web tsconfigs, as claimed.

### A3. `web/src/components/ItemEditor.test.tsx` — DC1 genuine-guard review

Read the full file (`web/src/components/ItemEditor.test.tsx:1-149`). Confirmed:

- Renders `ItemEditor` in **create mode** (no `item` prop) at line 82, with `lists={LISTS}` where
  `LISTS` (`:40-49`) is a non-empty array of one list — satisfies the reviewer Pass-2 nit that the
  required `<select>` needs a non-empty `lists` prop.
- `vi.mock("../apiClient", ...)` (`:30-38`) replaces `createItem`, `updateItem`, `replaceReminders`
  with spies while keeping other exports real (`vi.importActual`).
- Fills Title (`:84`, via `user.type`) and Start (`:85`, via `fireEvent.change` on the
  `datetime-local` input) — both are `required` fields on the real `<form>`.
- Clicks "+ Add reminder" (`:92`, `user.click`).
- Load-bearing assertion (`:96-97`): `expect(apiClient.createItem).not.toHaveBeenCalled()` and
  `expect(onSave).not.toHaveBeenCalled()`.
- Cheap backstop (`:90`): `expect(addReminderButton).toHaveAttribute("type", "button")`.

**Why this is a genuine guard, traced against the fixed source:**
`ReminderEditor.tsx:104,107` now carry `type="button"` explicitly (confirmed by direct read of the
file). Before this fix, per HTML spec, a `<button>` with no `type` inside an enclosing `<form>`
(`ItemEditor.tsx:99`, `<form onSubmit=...>`) defaults to `type="submit"`. A `userEvent.click` in
jsdom dispatches a real click that would trigger native form submission, running React's `onSubmit`
→ `handleSubmit` (`ItemEditor.tsx:53`) → in create mode, `await createItem(draft)` (`:88`) — this
call would be registered on the `createItem` spy synchronously at the call site, before any
microtask suspension, so `expect(apiClient.createItem).not.toHaveBeenCalled()` would be red on
pre-fix code. With `type="button"` present, the click only runs the `onClick` handler (`add()` in
`ReminderEditor.tsx`), never reaching the form's submit handler, so `createItem` is never called —
green post-fix. This matches the Plan-Reviewer's independent Pass-2 trace (`docs/reviews/fix-item-save-review.md:208-210`) and the Coder's documented git-stash revert/reapply verification
(`docs/process/fix-item-save-impl-notes.md:95-107`, all 3 web tests failed on reverted code and
passed after reapply). I did not re-run the revert myself (read-only on app code per QA scope), but
the static trace independently confirms the same mechanism the Coder and reviewer both verified
empirically.

### A4. `tests/unit/items-validation.test.ts` — DC2/DC4/DC5 coverage review

Read the full file (`tests/unit/items-validation.test.ts:1-303`). Confirmed coverage:

- **DC2** (`:146-181`): a complete `POST /api/items` with 2 reminders → `201`, exactly 1 `items` row
  and 2 `item_reminders` rows (`countRows` assertions at `:162-163`). A create missing `title` →
  `400 VALIDATION`, zero items/reminders written (`:166-180`).
- **DC4** (`:186-232`): `PATCH {title:""}` → `400 VALIDATION` naming `title`, row unchanged
  (`:198-208`); `PATCH {title:"   "}` (whitespace) → same (`:210-219`); `PATCH {type:"bogus"}` →
  `400 VALIDATION` naming `type`, row unchanged (`:221-231` — explicitly labeled "the third hole" in
  the test, matching plan §4.3(b)).
- **DC5** (`:237-302`): complete create still `201`s (`:238-246`); create missing required field
  still `400 VALIDATION` (`:248-253`); `PATCH {title:"New"}` → `200` with title updated
  (`:255-268`); `PATCH {type:"task"}` → `200` (`:270-283`); `location`/`notes` → `null` still
  succeeds (`:285-301`).
- **Edit persists + merges reminders**: this is covered by the jsdom `ItemEditor.test.tsx` DC3 tests
  (`:101-148`), not by `items-validation.test.ts` — correct split, since the merge logic lives in the
  React component (`ItemEditor.tsx:74-86`), not the server route. DC3 test 1 (`:102-132`) asserts
  mid-form "+ Add reminder" fires no API calls, then Save fires `updateItem` once, `replaceReminders`
  once, and `onSave` is called with `{ ...updatedItem, reminders: freshReminders }` — explicitly
  proving the merge uses the **fresh** `replaceReminders` result, not the stale `updateItem` result.
  DC3 test 2 (`:134-148`) confirms Cancel mid-edit persists nothing.

All DC2/DC4/DC5/DC3 done-conditions are genuinely covered, not just nominally referenced.

### A5. `vitest.workspace.ts` review

Read `vitest.workspace.ts:1-37`. Two cleanly separated projects:
1. `worker` — `defineWorkersConfig` (existing miniflare/D1 setup unchanged), scoped to
   `["tests/**/*.test.ts", "src/worker/**/*.test.ts"]`.
2. `web` — jsdom environment + `@vitejs/plugin-react`, scoped to `["web/**/*.test.tsx"]`, with
   `setupFiles: ["tests/setup/jsdom.setup.ts"]`.

Confirmed the worker project is defined inline (not double-loading `vitest.config.ts`), per the
reviewer's Pass-1 nit. `tests/setup/jsdom.setup.ts` (read in full) imports
`@testing-library/jest-dom/vitest` and registers `afterEach(cleanup)` from
`@testing-library/react` — addresses the documented DOM-leak-between-tests issue. The actual test
run (§A1) confirms zero glob collisions: the worker suite ran its pre-existing 36 tests plus the new
10 `items-validation` tests = 46, not doubled; the web project ran exactly the 3 new
`ItemEditor.test.tsx` tests. Matches the impl-notes claim precisely.

### A6. Lint (informational, per impl-notes claim)

```
npm run lint
ESLint: 9.39.4
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
```

Confirmed: fails with the same pre-existing ESLint v9 flat-config gap the impl-notes describe
(`docs/process/fix-item-save-impl-notes.md:90-93`). Not a regression introduced by this change — no
`eslint.config.js` exists anywhere in the repo (checked separately: not in scope for this fix, and
the plan explicitly says not to fix it here).

---

## B. Code inspection of the four scoped fix items

Read all changed application files directly against the plan:

1. **`web/src/components/ReminderEditor.tsx:104,107`** — both buttons now carry `type="button"`.
   Primary fix present exactly as specified in plan §4.1.
2. **`web/src/components/ItemEditor.tsx:53-96`** — edit branch: `updateItem` runs first (`:59-69`);
   on success, `replaceReminders(item.id, draft.reminders)` is called (`:75`) and the result is
   merged into `onSave({ ...saved, reminders })` (`:76`) — using the **fresh** `reminders` from
   `replaceReminders`, not the stale ones from `updateItem`. If `replaceReminders` throws, a distinct
   error is surfaced (`"Item saved, but reminders failed to save: ..."`, `:80-84`) and `onSave` is
   **not** called (`return` at `:85` before falling through). The outer catch (`:91-92`) uses
   `err instanceof ApiError ? err.message : String(err)` per plan §4.4. All matches plan §4.2/§4.4
   exactly.
3. **`src/worker/routes/items.ts:145-146,257-276`** — `validateItemPatch` is called immediately
   after parsing the PATCH body (`:145-146`), before the `rrule`/`end_at` checks and before
   `updateItem`. The validator (`:260-276`) rejects a present blank/whitespace/>200-char `title`, a
   present `type` not in `{event, task}`, and defensively validates a present non-numeric/`NaN`
   `start_at`. Matches plan §4.3 verbatim, including the code block given in the plan.
4. **Harness provisioning** — `vitest.workspace.ts`, `tests/setup/jsdom.setup.ts`,
   `package.json`/`package-lock.json` devDependency additions — all present and functioning per §A1
   and §A5 above.

**Scope check:** `git diff main --stat` shows exactly the files listed in the plan's affected-files
table plus doc files (plan/review/impl-notes) — no changes to `src/worker/reminders/*`
(materialize/send/dispatch engine), `src/worker/auth.ts`, or any push/VAPID code. Locked areas
confirmed untouched.

---

## C. Manual E2E via dev server + Playwright MCP

**Attempted, blocked by a real environment constraint (not a defect in this fix).**

1. Started the dev server (`npm run dev` → `wrangler dev`, confirmed `Ready on http://localhost:8787`).
2. `curl -i http://localhost:8787/api/me` → `401 { "error": { "code": "UNAUTHENTICATED", "message": "Missing Access JWT" } }`.
3. Navigated to `http://localhost:8787/` in Playwright — page loads (title "Family Scheduler") but
   renders `Error: ApiError: Missing Access JWT` because `GET /api/me` returns 401. Console shows
   the matching network error (`401 @ /api/me`), plus a benign `<meta name="apple-mobile-web-app-capable">`
   deprecation warning and an unrelated `404` for `/favicon.ico`.
4. Investigated `src/worker/auth.ts` in full: `requireAuth` (`:169-208`) unconditionally requires a
   `Cf-Access-Jwt-Assertion` header and performs real RSASSA-PKCS1-v1_5 signature verification
   against the live Cloudflare Access JWKS at `https://jr-quantum.cloudflareaccess.com/cdn-cgi/access/certs`
   (`:72-149`). There is **no dev-mode bypass, no localhost exemption, and no shim** anywhere in this
   middleware or `index.ts`. (The design doc's phase-1 changelog mentions a "dev token shim" as an
   aspiration, but it is not present in the current `auth.ts` — either never implemented or removed;
   out of scope for this fix to add.)

Per the guardrail to stop after 2-3 attempts and not rabbit-hole: forging a real Cloudflare Access
JWT would require a live Access session/credentials I do not have, and provisioning an auth bypass
would be an application-code change outside QA's read-only scope. I stopped here and did not loop
further.

**Bridging per verdict guidance:** the DC1 jsdom test (§A3) is a synchronous, direct trace of the
exact DOM-click → form-submit mechanism that caused the reported bug, and it is empirically proven
(by the Coder's stash-revert-and-rerun, documented in impl-notes, and by my independent static trace)
to fail on pre-fix code and pass post-fix. Combined with the direct code read confirming
`type="button"` is present at both offending call sites, I consider the create-flow (DC1) and
edit-flow (DC3) fixes convincingly verified without the manual browser pass. DC2/DC4/DC5 (server
validation) are covered by a real Hono-app-plus-D1 integration harness (§A4), which is materially
equivalent to hitting the API directly.

Screenshots/artifacts: none captured — the only browser state reached was the pre-auth error page,
which is not informative about the fix under test.

---

## Issues found

None. No defects identified in the fix's scoped behavior.

**Nit (pre-existing, out of scope, informational only):** the local dev environment has no working
auth bypass for `/api/*`, so future QA/manual passes on this app will hit the same wall unless a dev
JWT shim is provisioned or a live Access session is used. Not a regression from this fix, not
something this fix was asked to address, but worth flagging for the broader project backlog (the
design doc's "dev token shim" note suggests this was once intended).

## Console errors and warnings

- From the pre-auth landing page only (not representative of feature behavior):
  `401 @ /api/me` (expected given no Access JWT), `404 @ /favicon.ico` (cosmetic, unrelated),
  one deprecation warning for `apple-mobile-web-app-capable` meta tag (cosmetic, unrelated,
  pre-existing).

## Network failures and slow responses

- `GET /api/me` → 401 (expected/correct behavior given missing Cf-Access-Jwt-Assertion header; not a
  defect in this fix).

## Accessibility observations

Not evaluated — the only reachable UI state was the pre-auth error screen. `ItemEditor.test.tsx`
does note (via a code comment, `:19-22`) that the form's `<label>` elements are not
programmatically associated with their inputs (no `htmlFor`/`id`, no nesting), forcing the test to
query by DOM structure instead of `getByLabelText`. This is a pre-existing accessibility gap in
`ItemEditor.tsx`, not introduced or worsened by this fix, and out of this fix's scope — flagging for
awareness only.

## Performance notes

None applicable — no performance-sensitive code paths touched by this fix.

## Screenshots

None captured (see §C — the only reachable state was uninformative for this fix).

---

PASS
