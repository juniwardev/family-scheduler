# Implementation notes: `fix-list-selection-view-state`

Plan: `docs/plans/fix-list-selection-view-state.md` (amended, Pass-3 APPROVE —
`docs/reviews/fix-list-selection-view-state-review.md`)
Branch: `feat/fix-list-selection-view-state`
Base branch: `feat/family-scheduler` (this branch was already checked out with in-progress work at
the start of this session; base commit for the branch point is `14e9ae6` — "feat(auth): local-only
dev auth shim (loopback-gated) (#3)").

## Summary

Completed the amended plan on top of already-present, typecheck-clean work from the earlier
session (Option B `activeView` unification in `App.tsx`/`types.ts`, the `matchMedia` jsdom stub,
and a drafted `App.test.tsx`). This session added the M2-amendment items: the shared
`localStorage` jsdom stub, the `InstallBanner` defensive guard, a new `InstallBanner.test.tsx`
regression test, and the `dev-auth-shim.test.ts` T4 test-isolation hardening. No server/API/schema/
auth-logic changes. No `.dev.vars` edits. No §13 audit follow-up items implemented. No
auto-select-on-create-list implemented (owner-deferred, per plan §10).

## Files changed

- `web/src/types.ts:77` — `AppView` extended to `"list" | "calendar" | "admin"` (pre-existing from
  prior session, verified unchanged and correct against plan §5.1).
- `web/src/App.tsx` (pre-existing from prior session, verified unchanged and correct against plan
  §5.2–§5.5):
  - `:14` — `activeView`/`setActiveView` state (renamed from `view`/`setView`); `showAdmin` state
    deleted.
  - `:70-89` — List/Calendar/Admin tab classes and `onClick` handlers all derive from/set
    `activeView`.
  - `:96` — sidebar `onSelect={(id) => { setSelectedListId(id); setActiveView("list"); }}` — this
    is the load-bearing line that fixes the reported defect (selecting a list now escapes Admin).
  - `:102-114` — render conditional switches on `activeView`, keeping the
    `activeView === "admin" && user.role === "admin"` role gate.
- `tests/setup/jsdom.setup.ts:15-29` — `window.matchMedia` stub (pre-existing from prior session,
  M1 amendment, unchanged).
  - `tests/setup/jsdom.setup.ts:31-56` (this session, §8.0b) — added the `window.localStorage`
    in-memory `Storage` stub (Map-backed `getItem/setItem/removeItem/clear/key/length`), gated on
    `typeof window.localStorage === "undefined"`, installed via `Object.defineProperty(window,
    "localStorage", { value, configurable: true, writable: true })` so per-test `vi.stubGlobal`
    overrides in `InstallBanner.test.tsx` can replace and later restore it.
- `web/src/components/InstallBanner.tsx` (this session, §5.6):
  - `:17-38` — added `safeGetItem`/`safeSetItem` module-scope helpers (feature-detect
    `typeof localStorage === "undefined"` + `try/catch`).
  - `:44` (was `:21`) — the mount `useEffect` read now calls `safeGetItem("install-banner-dismissed")`
    instead of the unguarded `localStorage.getItem(...)`. Read failure degrades to "not dismissed."
  - `:76` (was `:53`) — the Dismiss handler now calls
    `safeSetItem("install-banner-dismissed", "1")` instead of the unguarded
    `localStorage.setItem(...)`. Write failure is swallowed; `setShow(false)` still runs
    unconditionally right after, so Dismiss always hides the banner for the current session even
    if persistence fails. No shared storage util introduced; change is localized to this one file
    per plan.
- `web/src/App.test.tsx` (new, pre-existing draft from prior session; verified against the amended
  plan and left as-is — it already implements DC1–DC4 correctly):
  - DC1 (`:87-102`, load-bearing): admin user, click Admin, assert AdminPanel shown, click a
    *different* sidebar list ("Chores", not the auto-selected first list "Groceries") so the
    assertion proves a real view switch, assert that list's `ItemListView` heading is shown AND
    AdminPanel is gone.
  - DC2 (`:104-121`): List tab escapes Admin, and the List tab has no `btn-outline` class while
    Calendar/Admin do.
  - DC3 (`:123-138`): Calendar tab escapes Admin (asserts CalendarView's `‹`/`›` month-nav
    buttons).
  - DC4 (`:140-149`): member user never sees the Admin button or AdminPanel.
  - Mocks `getMe`/`adminGetUsers`/`getItems`/`getOccurrences` via `vi.mock("./apiClient", ...)`
    spreading `importActual`, modeled on `ItemEditor.test.tsx`. Every test awaits the post-load UI
    (`screen.findByRole("button", { name: "Admin" })` or an ItemListView heading) before
    interacting, per the plan's async-mount note.
- `web/src/components/InstallBanner.test.tsx` (new, this session, §8.2):
  - Case 1 (load-bearing): stubs `localStorage.getItem` to throw via `vi.stubGlobal("localStorage",
    <throwing stub>)`; asserts `render(<InstallBanner />)` does NOT throw, and the banner stays
    hidden (jsdom UA is not iOS).
  - Case 2 (graceful degradation): sets an iOS `navigator.userAgent` via
    `Object.defineProperty(window.navigator, "userAgent", { value: "...iPhone...", configurable:
    true })` (restored in a `finally`) so `isIos()` is true and the banner renders; stubs
    `getItem` to return `null` (not dismissed) and `setItem` to throw; clicks Dismiss and asserts
    it does not throw AND the banner is removed from the DOM (`setShow(false)` still ran).
  - `afterEach(() => vi.unstubAllGlobals())` cleans up the per-test `localStorage` override,
    relying on the `configurable: true` from the §8.0b stub.
- `tests/unit/dev-auth-shim.test.ts` (this session, §8.3, test-only):
  - T4 (`:168-183`) now force-`delete`s `DEV_AUTH_IDENTITY` from the merged env
    (`delete (mergedEnv as unknown as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY;`) right
    after building `mergedEnv = { ...env, OWNER_EMAIL }`, before the existing
    `expect(...).toBeUndefined()` guard and the fetch. Mirrors how T1–T3 use `extraEnv` to SET the
    toggle, but T4 FORCE-UNSETS it so the "unset" precondition holds deterministically regardless
    of ambient/`.dev.vars` contamination. `{ ...env }` is a shallow own-enumerable copy, so the
    `delete` cannot mutate the shared `cloudflare:test` `env` or leak to other tests. No change to
    `verifyAccessJwt`, `requireAuth`, or `isLocalDevContext`. `.dev.vars` was NOT edited (owner
    handles that separately).
- `docs/process/fix-list-selection-view-state-impl-notes.md` (this file).

Docs carried into this commit at the fix boundary (per instructions, not newly authored this
session except where noted): `docs/bugs/list-selection-view-state.md`,
`docs/bugs/list-selection-view-state-investigation.md`, `docs/plans/fix-list-selection-view-state.md`
(amended), `docs/plans/fix-list-selection-view-state-coder-questions.md` (the prior session's
blocker note), `docs/reviews/fix-list-selection-view-state-review.md` (all 3 passes, final APPROVE).

## How to run the feature locally

```
npm install
npm run dev            # wrangler dev — serves Worker API + PWA
```

Manual drive via the dev-auth shim (`.dev.vars` sets `DEV_AUTH_IDENTITY=owner`, unedited by this
session): sign in, click "Admin", then click a list in the sidebar — the main panel switches to
that list's `ItemListView` immediately with AdminPanel gone, no reload required. Creating an item
now works without a reload (previously blocked because the app was stuck rendering AdminPanel).

## How to run the tests

```
npm test               # runs BOTH vitest projects (worker + web) via vitest.workspace.ts
npm run typecheck      # tsc --noEmit for both worker and web tsconfig
npx vitest run --project worker   # worker-only
npx vitest run --project web      # web/jsdom-only
```

`npm run lint` still cannot run — pre-existing ESLint v9 flat-config gap (no `eslint.config.js` in
the repo). Confirmed identical failure before/after this change
(`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`), unrelated to this fix, not fixed here
per instructions.

## Test counts

- `npm run typecheck`: clean, no errors (both `tsconfig.worker.json` and `tsconfig.web.json`).
- `npm test`: **11 test files, 66 tests, all passing.**
  - Worker project: `push-encrypt` (1), `push-vapid` (3), `recurrence` (6), `auth-deactivated` (6),
    `routing` (6), `dev-auth-shim` (11, includes the now-hardened T4 — confirmed passing), `
    items-validation` (10), `db` (14) = 57 tests.
  - Web project: `InstallBanner.test.tsx` (2, new), `ItemEditor.test.tsx` (3, pre-existing,
    unaffected), `App.test.tsx` (4, DC1–DC4) = 9 tests.
  - `dev-auth-shim.test.ts` T4 is confirmed GREEN in this run (was the previously-noted concern —
    the force-delete hardening makes it deterministic regardless of `.dev.vars` state).

## Genuine-guard sanity checks (both performed, per instructions)

**(a) DC1 (App.tsx view-state guard):** Temporarily reverted the `:96` sidebar `onSelect` line
from `onSelect={(id) => { setSelectedListId(id); setActiveView("list"); }}` back to
`onSelect={setSelectedListId}` (the pre-fix behavior). Ran `npx vitest run web/src/App.test.tsx`:
**DC1 FAILED** — `await screen.findByRole("heading", { name: /Chores/ })` timed out because
AdminPanel ("Admin — User Roster") stayed rendered (confirmed via the dumped DOM in the failure
output). The other 3 tests (DC2–DC4) still passed, as expected — they only exercise the tab
buttons, not the sidebar `onSelect` path. Restored the line, re-ran `npm run typecheck && npm test`
— **all 66 tests pass again**, confirming DC1 is a genuine, pre-fix-failing regression guard.

**(b) InstallBanner guard:** Temporarily reverted the mount-effect read at `InstallBanner.tsx` from
`safeGetItem("install-banner-dismissed")` back to the unguarded
`localStorage.getItem("install-banner-dismissed")`. Ran
`npx vitest run web/src/components/InstallBanner.test.tsx`: **case 1 (mount-read guard) FAILED**
with `AssertionError: expected [Function] to not throw an error but 'Error: blocked: storage
disabled' was thrown`, and the console showed the uncaught error propagating out of the
`InstallBanner` component's passive effect (React's "Consider adding an error boundary..."
warning) — exactly the failure mode that tears down `<App/>` in a real storage-hostile browser.
Restored the guard, re-ran `npm run typecheck && npm test` — **all 66 tests pass again**,
confirming the guard test is a genuine, pre-guard-failing regression guard.

## Deviations from the plan

None. All amended-scope items (§5.6, §8.0b, §8.2, §8.3) were implemented exactly as specified. The
prior session's already-completed items (Option B design, §8.0 `matchMedia` stub, drafted
`App.test.tsx`) were reviewed against the final amended plan and found correct as-is — no changes
were needed to them this session.

## Locked areas — confirmed untouched

- No server/API/schema/auth-logic changes: `src/worker/auth.ts` (`verifyAccessJwt`, `requireAuth`,
  `isLocalDevContext`) was not touched; only the T4 *test*'s merged-env construction changed.
- `.dev.vars` was NOT edited (owner-owned cleanup, per plan §8.3).
- §13 audit follow-up items (e.g. `NotificationSetup`'s handler-only `serviceWorker`/`PushManager`/
  `Notification.requestPermission` guards) were NOT implemented — explicitly out of scope per the
  plan and the task instructions.
- Auto-select-on-create-list (`ListSidebar.handleCreate` not calling `onSelect(newId)`) was NOT
  implemented — owner-deferred per plan §10.
- No redesign of `AdminPanel`, `ItemListView`, `CalendarView`, or `ListSidebar` internals beyond the
  wiring the fix required (none of these files were touched).

## What QA should verify

1. Manual repro of the original bug is now fixed: with `DEV_AUTH_IDENTITY="owner"` in `.dev.vars`,
   run `npm run dev`, sign in as admin, click "Admin," then click a list in the sidebar — the main
   panel must switch to that list's `ItemListView` immediately (AdminPanel gone), with NO reload
   required. Confirm creating an item in that list now works without a reload.
2. Nav-tab highlight always matches the rendered panel: click List/Calendar/Admin in any order and
   confirm exactly one tab lacks the `btn-outline` class at a time, matching what's rendered in the
   main panel.
3. Role-gating: as a non-admin (member) user, confirm the Admin button never renders and AdminPanel
   never appears regardless of navigation.
4. InstallBanner survives a storage-hostile browser: this is best verified via the automated
   `InstallBanner.test.tsx` suite (both cases green) since simulating Safari Private Browsing
   manually is impractical; if desired, QA can spot-check by temporarily disabling site storage in
   a real browser's dev tools and confirming the app does not white-screen.
5. Confirm `npm run lint` still fails with the same pre-existing flat-config error (not a
   regression introduced by this change) — no action expected, just confirmation.
6. Confirm `npm test` shows 66 passing tests across 11 files (both Vitest projects), including the
   hardened `dev-auth-shim.test.ts` T4 and the new `App.test.tsx`/`InstallBanner.test.tsx` suites.
