# Implementation notes: `fix-item-save`

Plan: `docs/plans/fix-item-save.md` (v3, Pass-2 APPROVE — `docs/reviews/fix-item-save-review.md`)
Branch: `feat/fix-item-save`
Base commit before this work: `146523d` (docs: add post-v1 backlog and notifications/location brief)

## Summary

Implemented exactly the four in-scope items from the approved plan: the frontend premature-submit
fix (primary defect), the edit-flow reminder-merge fix, the PATCH server-validation hardening
(blank title + invalid type), and the jsdom test-harness provisioning with the DC1–DC5 test suite.
No schema migration, no reminder-engine/auth/push changes.

## Files changed

- `web/src/components/ReminderEditor.tsx:104,107` — added `type="button"` to the remove (`×`) and
  "+ Add reminder" buttons so they no longer default to `type="submit"` inside the `ItemEditor`
  `<form>`. This is the primary fix for the reported defect (premature item persistence when
  adding a reminder mid-create).
- `web/src/components/ItemEditor.tsx`:
  - `:4` — import `replaceReminders` and `ApiError` from `../apiClient`.
  - `:58-95` (`handleSubmit`, edit branch) — after `updateItem` resolves, call
    `replaceReminders(item.id, draft.reminders)` and merge the FRESH reminder set into
    `onSave({ ...saved, reminders })` (fixes the pre-existing stale-reminders bug: `updateItem`'s
    own `reminders` field reflects the OLD set because `db.ts:643` reads reminders before the
    subsequent PUT replaces them). If `replaceReminders` fails after a successful `updateItem`, a
    distinct recoverable error is surfaced (`"Item saved, but reminders failed to save: ..."`) and
    `onSave` is NOT called — no half-applied state is surfaced to the parent.
  - Error banner (`catch` block) now uses `err instanceof ApiError ? err.message : String(err)`
    for both the outer catch and the new reminders-catch, per plan §4.4.
- Swept `ItemEditor.tsx` and `ReminderEditor.tsx` for any other in-form `<button>` missing an
  explicit `type` — confirmed none beyond the two above (`ItemEditor`'s own Save/Create button is
  `type="submit"` at `:228`+22 offset, Cancel is `type="button"`; `RecurrenceEditor`'s weekday
  buttons already use `type="button"`).
- `src/worker/routes/items.ts`:
  - `:145-147` — call new `validateItemPatch(b)` immediately after parsing the PATCH body, before
    the existing `rrule`/`end_at` checks and before `updateItem` runs; returns `400 { code:
    "VALIDATION" }` naming the offending field, nothing is written on rejection.
  - `:257-275` (new function `validateItemPatch`) — rejects a present-but-blank/whitespace/>200
    `title`, rejects a present `type` not in `{event, task}` (the "third hole" — `items.ts:157`
    previously cast any string through unchecked), and defensively validates a present `start_at`
    is a finite number (route-level `typeof` guard already made this unreachable via JSON, kept
    per plan as defense-in-depth). Reused the existing `VALIDATION` `Result` code from
    `src/worker/types.ts:17` — no new code invented. Create path (`POST /api/items`) is unchanged.
- `package.json` / `package-lock.json` — added devDependencies `@testing-library/react`,
  `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`. No script changes — `"test":
  "vitest run"` still runs both projects (Vitest auto-discovers `vitest.workspace.ts`).
- `vitest.workspace.ts` (new) — dual-project Vitest config:
  1. `worker` project — the existing `defineWorkersConfig` (wrangler/miniflare D1 setup),
     `include: ["tests/**/*.test.ts", "src/worker/**/*.test.ts"]`. Defined inline in the workspace
     file (not referenced as a glob to `vitest.config.ts`) to avoid double-loading
     `defineWorkersConfig` (reviewer Nit).
  2. `web` project — `environment: "jsdom"`, `plugins: [react()]`,
     `include: ["web/**/*.test.tsx"]`, `setupFiles: ["tests/setup/jsdom.setup.ts"]`.
  - The pre-existing root `vitest.config.ts` is left in place unmodified (still valid as a
    standalone single-project config if ever invoked directly with `--config vitest.config.ts`),
    but Vitest ignores it in favor of `vitest.workspace.ts` when running the default `vitest run` —
    verified empirically: worker test count post-change is exactly the pre-change count (36) plus
    the new items-validation tests (10) = 46, not doubled.
- `tests/setup/jsdom.setup.ts` (new) — imports `@testing-library/jest-dom/vitest` (adds DOM
  matchers to `expect`) and registers `afterEach(cleanup)` from `@testing-library/react` (RTL does
  not auto-cleanup under Vitest the way it does under Jest; without this, DC3's two tests in the
  same file leaked DOM nodes between tests and caused "multiple elements found" failures).
- `web/src/components/ItemEditor.test.tsx` (new) — DC1 (load-bearing regression) and DC3
  component tests. Note: `ItemEditor`'s `<label>` elements are not programmatically associated
  with their inputs (no `htmlFor`/`id`, no nesting), so `getByLabelText` cannot resolve
  Title/Start; the test queries by DOM structure instead (first `input[type="text"]` = Title,
  first `input[type="datetime-local"]` = Start) — documented in the test file. `lists` prop is
  non-empty per reviewer nit (Pass-2 nit 1).
- `tests/unit/items-validation.test.ts` (new) — DC2, DC4, DC5 server-side tests using the same
  Hono-app-plus-local-D1 harness pattern as `tests/unit/routing.test.ts`.
- `docs/process/fix-item-save-impl-notes.md` (this file).

## How to run the feature locally

```
npm install
npm run dev            # wrangler dev — serves Worker API + PWA
```

## How to run the tests

```
npm test               # runs BOTH vitest projects (worker + web) via vitest.workspace.ts
npm run typecheck      # tsc --noEmit for both worker and web tsconfig
npx vitest run --project worker   # worker-only
npx vitest run --project web      # web/jsdom-only
```

`npm run lint` currently cannot run — pre-existing ESLint v9 flat-config gap (no
`eslint.config.js` in the repo; the plan/CLAUDE.md instructed not to fix this here). Confirmed by
running `npm run lint` before and after this change: identical failure
(`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`), unrelated to this fix.

## DC1 regression-guard sanity check (required by the plan)

Per plan checklist step 6, I verified the DC1 test is a genuine regression guard, not a test that
passes regardless of the fix:

1. Temporarily reverted `web/src/components/ReminderEditor.tsx` (removed both `type="button"`
   attributes) via `git stash push -- web/src/components/ReminderEditor.tsx`.
2. Ran `npx vitest run --project web` — **result: all 3 tests in `ItemEditor.test.tsx` FAILED**,
   including the load-bearing DC1 assertion (`createItem` was called once) and both DC3 tests
   (they also depend on the same premature-submit bug, since edit mode reaches `updateItem`
   through the same stray-submit path).
3. Restored the fix via `git stash pop`.
4. Re-ran `npx vitest run --project web` — **result: all 3 tests PASSED.**

Also verified the server-side DC4 regression guard the same way: temporarily reverted
`src/worker/routes/items.ts` (`git stash push -- src/worker/routes/items.ts`), re-ran
`npx vitest run --project worker tests/unit/items-validation.test.ts` — the 3 DC4 tests
(blank title, whitespace title, bogus type) FAILED with `expected 200 to be 400` (pre-fix code
silently accepted and persisted the bad input), the other 7 tests (DC2/DC5, unaffected by the
PATCH hole) still passed. Restored the fix; all 10 tests pass again.

## Test counts

- `npm run typecheck`: clean, no errors (both `tsconfig.worker.json` and `tsconfig.web.json`).
- `npm test`: **8 test files, 49 tests, all passing.**
  - Worker project: `push-encrypt` (1), `push-vapid` (3), `recurrence` (6), `auth-deactivated` (6),
    `routing` (6), `items-validation` (10, new), `db` (14) = 46 tests.
  - Web project: `ItemEditor.test.tsx` (3, new) = 3 tests.
  - Pre-existing worker suite (36 tests) is unchanged/still green — confirms no regression from
    the harness/config change.

## Deviations from the plan

None. All four in-scope items were implemented as specified. The three Pass-2 Coder-facing nits
were addressed:
- DC1's `lists` prop is non-empty (`LISTS` constant with one shared list).
- The worker project is defined inline in `vitest.workspace.ts` rather than referencing
  `vitest.config.ts` as a workspace glob entry, avoiding double-loading `defineWorkersConfig`.
- The web `Item` type (`web/src/types.ts:32-46`) already carries a `reminders: ItemReminder[]`
  field, so `onSave({ ...saved, reminders })` typechecks without modification — confirmed via
  `npm run typecheck` passing clean.

## Locked areas — confirmed untouched

- Reminder engine internals: no changes to `src/worker/reminders/*` (materialize/send/dispatch).
- Auth: no changes to Access JWT verification or `requireAuth`/`requireAdmin`.
- Push/notification path: no changes to VAPID/push encryption code.
- No schema migration: `item_reminders` table is unchanged; no new `Result` code (reused
  `VALIDATION`).
- Playwright E2E: NOT provisioned (`playwright.config.*` was not created,
  `npm run test:e2e` was not run) — deferred per plan §8.4/owner decision.

## What QA should verify

1. Manual repro of the original bug is now fixed: open "New Item", fill Title + Start, click
   "+ Add reminder" — the form must NOT submit/close, and no item should appear in the list until
   the user explicitly presses "Create".
2. Edit an existing item's reminders and press "Save" — the reminder changes should now actually
   persist (previously silently dropped) and the editor should reflect the freshly saved reminder
   set (not stale).
3. If the reminders PUT fails after a successful item PATCH (e.g. simulate a network failure via
   devtools), the item metadata should remain saved, a distinct error banner should appear
   ("Item saved, but reminders failed to save: ..."), and the editor should stay open (not silently
   closed with `onSave`).
4. `PATCH /api/items/:id` with `{"title": ""}`, `{"title": "   "}`, or `{"type": "bogus"}` should
   each return `400` with `error.code === "VALIDATION"` and leave the row unchanged.
5. Confirm `npm run lint` still fails with the same pre-existing flat-config error (not a
   regression introduced by this change) — no action expected here, just confirmation.
