# QA Report: fix-list-selection-view-state

**Slug:** `fix-list-selection-view-state`
**Branch:** `feat/fix-list-selection-view-state`
**Plan:** `docs/plans/fix-list-selection-view-state.md` (3 review passes, all APPROVE)
**Impl notes:** `docs/process/fix-list-selection-view-state-impl-notes.md`
**QA date:** 2026-07-01 (per session clock)

## Summary verdict

**PASS**

The Option B `activeView` unification is implemented exactly as approved (§5.1–5.5), the automated suite is green (66/66 tests, both Vitest projects), `dev-auth-shim.test.ts` T4 genuinely force-unsets `DEV_AUTH_IDENTITY` without weakening the 401 safety assertion, DC1 is a real (non-vacuous) regression guard, the `InstallBanner` guard test is a real discriminator, and — after correcting a stale-build trap described below — the manual browser drive confirms the core bug (panel stuck on Admin after selecting a list) is fixed with no reload required, tab active-state always matches the rendered panel, and the create-item flow works without a reload. Scope is clean: no server/API/schema/auth-logic diff, `.dev.vars` untouched.

---

## A. Automated verification

### A1. `npm run typecheck` and `npm test`

```
npm run typecheck   -> clean, no errors (tsconfig.worker.json + tsconfig.web.json)
npm test            -> Test Files 11 passed (11); Tests 66 passed (66)
```

Matches the impl-notes claim of 11 files / 66 tests exactly. Breakdown observed in this run:
- Worker project (57 tests): `push-encrypt`(1), `push-vapid`(3), `recurrence`(6), `auth-deactivated`(6), `routing`(6), `dev-auth-shim`(11), `items-validation`(10), `db`(14).
- Web project (9 tests): `InstallBanner.test.tsx`(2), `ItemEditor.test.tsx`(3), `App.test.tsx`(4).

**T4 confirmed passing and genuinely hardened.** `tests/unit/dev-auth-shim.test.ts:175-186`:

```ts
const mergedEnv = { ...env, OWNER_EMAIL } as unknown as Env;
delete (mergedEnv as unknown as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY;
expect((mergedEnv as unknown as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY).toBeUndefined();

const res = await testApp.fetch(
  new Request("http://localhost/api/me", { method: "GET" }),
  mergedEnv
);
expect(res.status).toBe(401);
```

This force-deletes the key from a shallow copy (`{...env}`), so the "unset" precondition holds regardless of the ambient `.dev.vars`/`cloudflare:test` env — matches plan §8.3 exactly, byte-for-byte. The `toBeUndefined()` guard is kept, and the assertion still proves loopback + unset → full verification → 401 (`UNAUTHENTICATED`). No change to `verifyAccessJwt`/`requireAuth`/`isLocalDevContext` (grepped `src/worker/auth.ts` — untouched by this diff). `.dev.vars` was NOT edited by the Coder — confirmed it already had `DEV_AUTH_IDENTITY="owner"` set going into this QA session (pre-existing, not introduced here).

### A2. DC1 genuine-guard check (`web/src/App.test.tsx`)

Read `web/src/App.test.tsx:87-102`. DC1:
1. Mocks `getMe`/`adminGetUsers`/`getItems`/`getOccurrences` via `vi.mock("./apiClient", ...)` spreading `importActual`.
2. `renderAsAdmin()` awaits `screen.findByRole("button", { name: "Admin" })` before any interaction (correct async-mount handling, per plan §8.1).
3. Clicks "Admin", asserts `"Admin — User Roster"` present.
4. Clicks a **different** sidebar list ("Chores", not the auto-selected first list "Groceries") — this is a stronger guard than the plan's minimum, since it proves a genuine cross-list switch, not a no-op re-render.
5. Asserts the Chores `ItemListView` heading is present AND `"Admin — User Roster"` is gone.

I did not revert application code to independently re-run the "fails pre-fix" check (per instructions, reasoning from code only), but the impl-notes' documented sanity check (reverting `App.tsx:96`'s `onSelect` to `setSelectedListId` only, re-running, observing `DC1` fail with a timeout on `findByRole("heading", {name: /Chores/})` while AdminPanel stayed rendered, then restoring and confirming 66/66 green again) is consistent with the actual code path: pre-fix, `onSelect={setSelectedListId}` never touches `activeView`/`showAdmin`, so the render waterfall's admin branch would still win. This is a genuine, non-vacuous regression guard.

DC2 (`:104-121`) additionally asserts the List tab lacks `btn-outline` while Calendar/Admin have it — locks in the tab-highlight invariant. DC3 (`:123-138`) covers Calendar-from-Admin. DC4 (`:140-149`) covers member role-gating (Admin button absent, AdminPanel never renders). All four map correctly to their done-conditions.

### A3. InstallBanner guard test (`web/src/components/InstallBanner.test.tsx`)

Case 1 (`:24-46`, load-bearing) stubs `localStorage.getItem` to throw via `vi.stubGlobal`, renders `<InstallBanner />`, and asserts `render` does not throw. Traced the mechanism: pre-guard, `InstallBanner.tsx:44`'s `localStorage.getItem` call would throw synchronously inside the mount `useEffect`; RTL flushes effects inside `act()`, so an uncaught throw there propagates out of `render()`. Post-guard, `safeGetItem` (`InstallBanner.tsx:22-29`) catches it and returns `null`. This is a genuine discriminator — the impl notes document reverting the guard and observing case 1 fail with the exact expected error signature (`AssertionError: expected [Function] to not throw ... 'Error: blocked: storage disabled'`), which is consistent with the code.

Case 2 (`:48-88`) forces an iOS UA so the banner renders, stubs `setItem` to throw, clicks Dismiss, and asserts no throw and the banner is removed (because `setShow(false)` still runs at `InstallBanner.tsx:77` after the swallowed write error). Correct and matches plan §8.2.

### A4. Scope check

```
git diff main --stat
```

Touches only: `tests/setup/jsdom.setup.ts`, `tests/unit/dev-auth-shim.test.ts`, `web/src/App.test.tsx`, `web/src/App.tsx`, `web/src/components/InstallBanner.test.tsx`, `web/src/components/InstallBanner.tsx`, `web/src/types.ts`, plus docs under `docs/plans`, `docs/process`, `docs/reviews`, `docs/bugs`. No `src/worker/*` (server/API/schema/auth) file is in the diff. `.dev.vars` is untouched (confirmed via `git status` — it's gitignored and unmodified; it already had `DEV_AUTH_IDENTITY="owner"` set). No scope violation.

`web/src/App.tsx`, `web/src/types.ts`, and `web/src/components/InstallBanner.tsx` were read in full and match the plan's exact-diff sections (§5.1–5.6) verbatim — `activeView` state (`App.tsx:14`), `showAdmin` deleted, all three tab classes/handlers derive from `activeView` (`App.tsx:70-89`), sidebar `onSelect={(id) => { setSelectedListId(id); setActiveView("list"); }}` (`App.tsx:96`), render conditional (`App.tsx:102-114`) with `activeView === "admin" && user.role === "admin"` role gate preserved.

---

## B. Manual end-to-end drive (Playwright MCP)

**Setup:** `.dev.vars` already had `DEV_AUTH_IDENTITY="owner"` set (no edit needed — confirmed via `cat .dev.vars`; `wrangler.toml:21` confirms `OWNER_EMAIL = "juniwar.dev@gmail.com"`, matching). Started `npm run dev` (wrangler dev, `http://localhost:8787`).

### Important finding during setup — stale prebuilt `dist/` (process nit, not a code defect)

On the first pass through the drive, the bug appeared to **still be present**: clicking "Admin" then clicking a newly-created second list ("QA Selection Test List B") left `"Admin — User Roster"` rendered, even though the "List" tab's class correctly showed as active (no `btn-outline`) — i.e., `activeView` state was updating correctly but the rendered panel wasn't switching. This looked exactly like the pre-fix defect.

Root cause of that false alarm: this repo's `[assets] directory = "./dist"` in `wrangler.toml` means `wrangler dev` serves the **prebuilt** static bundle, not live `web/src/` source. `dist/assets/main-*.js` had an mtime from **before** this fix's `App.tsx` changes (confirmed via `stat`: dist bundle ~9.6 hours older than `App.tsx`). `npm run dev` has no `predev`/build step (`package.json` scripts confirmed), so a developer running exactly the impl-notes' "How to run the feature locally" steps (`npm install && npm run dev`) will silently test a stale frontend build if `dist/` predates the latest source change.

**This is not a defect in the fix** — the source-level render logic is correct (confirmed via A4 above and the corrected drive below). It is a **process/documentation gap**: the impl notes' "How to run the feature locally" section does not mention running `npm run build` first. I ran `npm run build` (fresh `vite build`, output confirmed newer than `App.tsx`), reloaded the page, and re-ran the entire drive — the fix behaved correctly in every scenario below. **Recommend the Coder/impl-notes add a `npm run build` step before `npm run dev` to the manual-verification instructions**, or wire a `predev` script, to prevent this exact false-negative from recurring for future QA/developers. Flagged as a Nit since it does not indicate the fix itself is broken, but it is a real trap.

### B1. Core bug repro (DC1) — CONFIRMED FIXED

Steps: loaded app as owner/admin (`juniwar.dev@gmail.com`, role admin) → clicked **Admin** (main panel → "Admin — User Roster") → created a second list "QA Selection Test List B" (to have >1 list for a genuine switch) → clicked that list in the sidebar, **without reloading**.

Result: main panel **immediately** switched to `ItemListView` for "QA Selection Test List B" ("No items in this list yet."); "Admin — User Roster" was gone. No reload was performed at any point.

Screenshots:
- `.playwright-mcp/qa-01-admin-before-click.png` — Admin panel showing before the click.
- `.playwright-mcp/qa-02-after-click-list-b-from-admin.png` — panel switched to the list view, Admin gone.

Verified via `browser_evaluate` that tab classNames were consistent with state: `List` → `"btn btn-sm "` (active, no `btn-outline`), `Calendar`/`Admin` → `"btn btn-sm btn-outline"`.

### B2. List/Calendar tabs from Admin (DC2/DC3) — CONFIRMED

- From Admin, clicked **List** tab: `ItemListView` shown (retained last-selected list, "QA Selection Test List B"), AdminPanel gone, List tab marked `[active]` in the a11y snapshot (focus/active state matched render).
- From Admin, clicked **Calendar** tab: `CalendarView` rendered ("July 2026" month grid with `‹`/`›` nav), AdminPanel gone. Screenshot: `.playwright-mcp/qa-03-calendar-from-admin.png`.
- In both cases exactly one tab lacked the active-state styling class at a time, matching the rendered panel. No "tab active but wrong panel" desync observed anywhere in the drive.

### B3. Regression smoke — create-list → select → create-item flow (no reload) — CONFIRMED

- Switched back to List tab, selected "QA Dev Auth Shim Test List" from the sidebar (switch worked immediately).
- Clicked "+ New Item", filled Title "QA post-fix regression item", clicked Create.
- New item appeared in the list immediately, no reload — this is exactly the original QA-reported symptom ("creating an item required a reload") and it is now resolved.
- Cleaned up test artifacts afterward (deleted the test item and the second test list) to leave the local dev DB in its original state.

### B4. Admin still reachable + role-gated (owner/admin) — CONFIRMED

Admin control rendered for the admin user throughout the drive and clicking it always rendered `AdminPanel` ("Admin — User Roster" with the user roster table showing `juniwar.dev@gmail.com — admin — Active`). Could not test a non-admin user locally (no second real identity available in this dev environment beyond the shim's `DEV_AUTH_IDENTITY`), consistent with the impl-notes' stated limitation. Role-gating logic itself was verified via the DC4 automated test (§A2) — member never sees Admin button, AdminPanel never renders regardless of state.

### B5. Console and network — CLEAN

- Console messages during the (rebuilt, correct) drive: **0 errors**. One pre-existing, unrelated warning repeated (`<meta name="apple-mobile-web-app-capable">` is deprecated — an existing PWA meta-tag warning, not introduced by this fix).
- All API calls during the entire drive returned 2xx/201: `GET /api/me` (200), `GET /api/lists/:id/items` (200, multiple), `GET /api/admin/users` (200, multiple), `POST /api/items` (201). No 4xx/5xx during the corrected drive.
- (Noted separately: during the *stale-build* false-alarm pass before rebuilding, one transient `401` on `/api/me` and a `404` on `/favicon.ico` appeared in the full-session console log; these were artifacts of an early cold-start navigation and the favicon 404 is expected/pre-existing — neither reproduced in the corrected drive and neither is related to this fix.)

---

## Issues found

None that affect the verdict. One process nit:

- **Nit N1 — stale `dist/` trap in manual-verification instructions (Playwright MCP; caught during setup, not a code defect).** `npm run dev` (`wrangler dev`) serves the prebuilt `./dist` static bundle per `wrangler.toml`'s `[assets] directory = "./dist"`; there is no `predev` build step. If `dist/` predates the latest `web/src/` changes (as it did at the start of this QA session), the app will silently run stale frontend code and can produce a false "bug still present" result. Recommend adding `npm run build` to the impl-notes' "How to run the feature locally" section (or a `predev` script) so this doesn't trip up the next QA pass or developer. Severity: Nit (tooling/documentation, not application logic).

## Console errors and warnings

- Errors: 0 during the corrected drive.
- Warnings: 1 recurring, pre-existing, unrelated — deprecated `apple-mobile-web-app-capable` meta tag (PWA manifest concern, out of scope for this fix).

## Network failures and slow responses

None. All requests during the corrected drive returned 2xx/201. No slow responses observed (local dev server, D1 local binding).

## Accessibility observations

- All interactive nav elements (List/Calendar/Admin tabs, sidebar list items, New Item/Edit/Delete buttons) are exposed as proper `button`/`listitem` roles in the accessibility tree and were operable via `getByRole` queries throughout the drive — no ARIA regressions observed from this change.
- Tab active/inactive state is communicated only via a CSS class (`btn-outline` absence/presence), not via `aria-current` or `aria-pressed`. This is pre-existing (not introduced by this fix) and outside this ticket's scope, but worth a note for a future accessibility pass: screen reader users have no semantic indication of which nav tab is "active" beyond visual styling.

## Performance notes

Not applicable — no performance trace was needed; this is a client-side state-routing fix with no new network calls or heavy renders. Manual drive felt instantaneous (in-memory state transition, no fetch on tab/list switch since `items`/`lists` were already loaded).

## Screenshots referenced

- `.playwright-mcp/qa-01-admin-before-click.png` — AdminPanel rendered before the core-bug-repro click.
- `.playwright-mcp/qa-02-after-click-list-b-from-admin.png` — panel switched to `ItemListView` after selecting a list from Admin (bug fixed).
- `.playwright-mcp/qa-03-calendar-from-admin.png` — CalendarView rendered after clicking Calendar tab from Admin.

## Verdict

PASS
