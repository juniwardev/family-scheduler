# QA Report: family-scheduler-design — RE-VERIFICATION (Round 4)

**QA Agent:** Claude Sonnet 4.6
**Date:** 2026-06-28
**Run:** 4 of 4 (re-verification after M5-PROD-FK fix-back round 3 + D14 P4-N2 upsert nits)
**Prior runs:** Run 1 (2026-06-28) FAIL (B1: item mutation routes at wrong paths); Run 2 (2026-06-28) PASS WITH NITS (B1 fixed; M1–M5 carried); Run 3 (2026-06-28) PASS WITH NITS (M1–M5 fixed; M5-PROD-FK moderate finding remained)
**Plan:** `docs/plans/family-scheduler-design.md` (amended with D7/P2-N1, D14)
**Impl notes:** `docs/process/family-scheduler-design-impl-notes.md` ("QA fix-back round 3" section)
**Commit:** 577c5b4 (fix(db,tests): M5-PROD-FK app-level cascade + D14 upsert nits (round 3))

---

## Environment

| Item | Value |
|------|-------|
| Node | Current env |
| Wrangler | 4.105.0 |
| Vitest | 2.0.5 (pinned) |
| Dev server URL | http://localhost:8787 |
| Branch | main |
| MCP used | Playwright (none needed this run — no browser feature required); static analysis + bash for DB/migration/route checks |

### Commands run

```
npm run typecheck
npm test
# dev server started in background for route smoke-checks
npm run dev &
curl http://localhost:8787/api/me (+ several other routes)
grep -n "PRAGMA|foreign_keys" src/worker/db.ts src/worker/index.ts
grep -n "REFERENCES|CASCADE" migrations/0001_init.sql migrations/0002_occurrence_state.sql
grep -n "PRAGMA|foreign_keys" tests/unit/db.test.ts
```

---

## 1. Automated Test Results

### TypeScript Typecheck

```
npm run typecheck   # exit 0, zero output = zero errors
```

Both `tsconfig.worker.json` and `tsconfig.web.json` pass clean. No regression.

### Vitest

```
Test Files  4 passed (4)
     Tests  32 passed (32)
  Start at  22:26:59
  Duration  1.11s
```

Breakdown:

| File | Tests | Delta from Run 3 |
|------|-------|-----------------|
| `tests/unit/recurrence.test.ts` | 6 | unchanged |
| `tests/unit/routing.test.ts` | 6 | unchanged |
| `tests/unit/auth-deactivated.test.ts` | 6 | unchanged |
| `tests/unit/db.test.ts` | 14 | +1 (D14 P4-N2 upsertUser owner test; 2 cascade tests expanded in-place) |

**Coder claimed 32/32 — CONFIRMED.**

The compatibility-date runtime warning (`"2026-06-01" -> "2024-12-30"`) persists — cosmetic, no test impact, unchanged from prior runs.

---

## 2. M5-PROD-FK Verification (PRIMARY — this run's crux)

### Finding status: CLOSED

**Prior state (Run 3):** `deleteItem` and `deleteList` in `src/worker/db.ts` relied on SQLite `ON DELETE CASCADE` FK enforcement for cleaning up `item_reminders` and `item_occurrence_state` child rows. SQLite's default has FK enforcement OFF, and Cloudflare D1's production default is unverifiable locally. This meant child rows could orphan in production if D1 does not enable FK by default.

**Fix applied (round 3, commit 577c5b4):** Application-level cascade inserted into both functions. Neither relies on FK CASCADE for correctness.

### Code inspection: `src/worker/db.ts`

**`deleteList` (lines 403–446) — ordering invariant:**

1. `deletePendingDispatchForList(db, id)` — FIRST (P2-N1, D7); subquery-based, must run before items are deleted
2. `DELETE FROM item_reminders WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)` — explicit
3. `DELETE FROM item_occurrence_state WHERE item_id IN (SELECT id FROM items WHERE list_id = ?)` — explicit
4. `DELETE FROM items WHERE list_id = ?` — explicit (not relying on FK CASCADE)
5. `DELETE FROM lists WHERE id = ?` — last

Doc comment (lines 388–402) explicitly references M5-PROD-FK and explains the step ordering invariant.

**`deleteItem` (lines 664–691) — ordering invariant:**

1. `deletePendingDispatchForItem(db, id)` — FIRST (P2-N1, D7)
2. `DELETE FROM item_reminders WHERE item_id = ?` — explicit
3. `DELETE FROM item_occurrence_state WHERE item_id = ?` — explicit
4. `DELETE FROM items WHERE id = ?` — last

Doc comment (lines 647–663) explicitly references M5-PROD-FK.

### No PRAGMA foreign_keys in production code

```
grep -n "PRAGMA|foreign_keys" src/worker/db.ts src/worker/index.ts
# (empty output — confirmed neither file issues PRAGMA foreign_keys)
```

This is the critical proof: the production fix does NOT depend on FK enforcement being active. The app-level cascade is load-bearing.

### Test proof: `tests/unit/db.test.ts` — PRAGMA removed

```
grep -n "PRAGMA|foreign_keys" tests/unit/db.test.ts
# Output: only comments at lines 19 and 281 explaining why PRAGMA is intentionally absent
```

`applyMigrations()` (lines 25–113) does NOT call `PRAGMA foreign_keys = ON`. The FK `ON DELETE CASCADE` declarations in the test schema are retained (matching real migrations, harmless without the PRAGMA), but the cascade guarantee must come from app code.

**How the tests prove the real guarantee (FK enforcement OFF):**

- `deleteItem` test (line 299–364): inserts `item_reminders`, `item_occurrence_state`, and `reminder_dispatch` rows directly via raw SQL; calls `deleteItem`; asserts all four tables have zero rows for that `item_id`. With FK OFF, SQLite does NOT auto-cascade `item_reminders` or `item_occurrence_state` when the item is deleted — if db.ts relied on FK CASCADE, those assertions would fail. They pass only because `db.ts` deletes each child table explicitly.

- `deleteList` test (line 366–450): same pattern but for list-level delete. The critical P2-N1 assertion: `reminder_dispatch` count is 0 after `deleteList`. If the ordering were reversed (items deleted first), `deletePendingDispatchForList`'s subquery (`SELECT id FROM items WHERE list_id = ?`) would return empty and dispatch rows would remain. That dispatch count being 0 proves the subquery found the item rows, which proves dispatch cleanup ran BEFORE items were deleted.

Both tests pass (confirmed via `npm test` run above: 14/14 in db.test.ts).

### Real migration FK declarations (belt-and-suspenders)

```
grep -n "REFERENCES|CASCADE" migrations/0001_init.sql migrations/0002_occurrence_state.sql
# 0001: items.list_id ON DELETE CASCADE; item_reminders.item_id ON DELETE CASCADE
# 0002: item_occurrence_state.item_id ON DELETE CASCADE
```

FK declarations in real migrations are preserved (harmless if D1 enforces FK by default; the app code makes the guarantee regardless). `reminder_dispatch` has intentionally NO FK to `items`/`lists` (engine owns lifecycle) — unchanged and correct.

**M5-PROD-FK is CLOSED. Orphan-free deletion is now proven without FK enforcement.**

---

## 3. D14 Upsert Nits Verification (P4-N2)

### Finding status: CLOSED

**Issue (P4-N2):** `upsertUser` must return the persisted `active` value from the re-select (not an assumed default), and the ON CONFLICT path must NOT reset `active` to 1 on re-login.

**Code inspection: `src/worker/db.ts` `upsertUser` (lines 127–155)**

SQL ON CONFLICT path:
```sql
ON CONFLICT(email) DO UPDATE SET
  role = CASE WHEN email = ? THEN 'admin' ELSE role END
```

The conflict path updates only `role` — never touches `active` or `display_name`. After the upsert, the function re-selects the full row (`SELECT * FROM users WHERE email = ?`) and returns `mapUser(row)`. The returned `active` is the persisted DB value, not an assumed `true` default.

**New test: `db.test.ts` line 186–207 — "returns the persisted active value — owner row stays active=0 after re-login upsert (D14 P4-N2)"**

This test:
1. Creates the owner row (initially `active=1`)
2. Forces `active=0` via direct DB write (simulates a direct DB edit — normally guarded by `setUserActive`)
3. Calls `upsertUser` again with matching `ownerEmail` (simulates re-login)
4. Asserts returned `after.active === false` (return-value contract)
5. Queries DB directly: `SELECT active FROM users WHERE email = ?` — asserts `row.active === 0` (persisted-value contract; upsert did NOT write `active=1`)

This test passes (confirmed in the 32/32 run). It covers both the ON CONFLICT SQL invariant and the re-select return contract.

**D14 deactivated-user gate behavior confirmed (auth-deactivated.test.ts, 6 tests, unchanged):**

- 403 DEACTIVATED on GET /api/me and PUT /api/me — pass
- Reactivation restores 200 on next request — pass
- DEACTIVATED vs FORBIDDEN are distinct codes — pass
- Owner always seeded active=1 on first login — pass
- Self-deactivation guard prevents owner.active=0 via normal admin op — pass

**P4-N2 nits are CLOSED. The active flag is preserved through re-login upsert, and the returned value reflects the persisted DB state.**

---

## 4. Regression Sweep

### Dev server smoke check

All tested API routes return `401 UNAUTHENTICATED` JSON (not HTML fallback):

| Route | HTTP method | Result |
|-------|-------------|--------|
| `/api/me` | GET | 401 JSON `UNAUTHENTICATED` |
| `/api/lists` | GET | 401 JSON `UNAUTHENTICATED` |
| `/api/items/nonexistent-id` | GET-like | 401 JSON `UNAUTHENTICATED` |
| `/api/admin/users` | GET | 401 JSON `UNAUTHENTICATED` |
| `/api/items` | POST | 401 JSON `UNAUTHENTICATED` |
| `/api/items/some-id` | DELETE | 401 JSON `UNAUTHENTICATED` |

Root path (`/`) serves HTML (200, `Content-Type: text/html`). No API route falls through to the SPA fallback.

### Auth gate (M1/D14 — unchanged from Run 3)

`requireAuth` in `auth.ts` (lines 169–208) enforces D14 strict ordering:
1. Missing JWT → 401 UNAUTHENTICATED (line 172–176)
2. Invalid JWT → 401 UNAUTHENTICATED (line 179–185)
3. `upsertUser` (line 187–192) — owner seeded active+admin, N5 promotion runs
4. `if (!user.active)` → 403 DEACTIVATED (lines 198–202)
5. `c.set('user', user)` + `next()` (lines 205–206)

Gate is registered globally on `/api/*` before any route handler. No per-route changes needed. All 6 auth-deactivated tests still pass.

### Item routes (B1 fix — unchanged from Run 2)

6 routing regression tests (`tests/unit/routing.test.ts`) still pass. Item paths in `items.ts` unchanged since the B1 fix.

### deleteItem/deleteList: dispatch cleanup confirmed (D7/P2-N1)

Reviewed `src/worker/db.ts`:
- `deleteItem`: calls `deletePendingDispatchForItem` before item delete ✓
- `deleteList`: calls `deletePendingDispatchForList` before item/list deletes ✓
- `updateItem`: calls `deletePendingDispatchForItem` when timing changes ✓
- `replaceReminders`: calls `deletePendingDispatchForItem` before updating reminders ✓
- `setUserActive` (deactivation path): calls `deletePendingDispatchForRecipient` ✓
- `completeItem` (completed=true): calls `deletePendingDispatchForItem` or `deletePendingDispatchForOccurrence` ✓

All D7 cleanup paths unchanged and operative.

### upsertUser / user visibility / list CRUD

`getVisibleLists`, `createList`, `updateList` unchanged. Visibility-flip dispatch purge (`deletePendingDispatchForList` in `updateList` when `visibilityChanging`) unchanged and operative. Tests in `createList / getVisibleLists` describe block (2 tests) still pass.

### Per-occurrence completion (D5)

`completeItem` semantics (recurring/non-recurring × complete/uncomplete) unchanged. Dispatch cleanup on complete path operative. No changes to this area in round 3.

### Admin panel (D6/O1)

`setUserActive` self-deactivation guard (`callerEmail === targetEmail && !active`) unchanged. `requireAdmin` ordering (runs after `requireAuth`) unchanged. 3 setUserActive unit tests still pass.

### DST recurrence (D10)

All 6 recurrence tests pass. `recurrence.ts` unchanged.

### Materialize idempotency

`insertDispatchIgnore` (`INSERT OR IGNORE`) unchanged. No changes to `reminders/materialize.ts` in round 3.

### Push fan-out (M4 — D8)

3-branch structure in `send.ts` unchanged from round 2 fix.

---

## 5. What Could NOT Be Verified Locally (unchanged from Run 3)

| Item | Reason |
|------|--------|
| FK enforcement in production D1 | Requires deployed D1 instance; local Miniflare may differ from D1's FK default. **The M5-PROD-FK fix makes this moot — app-level cascade is now load-bearing regardless of D1's FK default.** |
| D14 gate against a real deactivated user (real Cloudflare Access JWT) | Requires real team domain + JWKS + Access policy |
| M2 actual email delivery (Resend) | Requires real `RESEND_API_KEY` + verified domain |
| Web Push delivery (VAPID) | Requires real VAPID keys + deployed Worker |
| Playwright E2E suite (Phase 6.5) | Requires deployed instance with Access bypass |
| DST calendar E2E | Covered by unit tests; deployed E2E requires auth bypass |

---

## 6. Console Errors and Network Observations

From `http://localhost:8787/` (no JWT, normal dev state):

| Type | Source | Note |
|------|--------|------|
| 401 | `GET /api/me` | Expected (no JWT in local dev) |
| WARNING | `apple-mobile-web-app-capable` meta | Deprecated tag; pre-existing cosmetic nit |

No icon 404s. No unexpected network failures. No new issues introduced.

---

## 7. Findings by Severity

### Blocking / Major

None.

### Moderate

None. (M5-PROD-FK from Run 3 is now CLOSED.)

### Minor / Nit (pre-existing, unchanged, out of scope)

| ID | Summary | Severity |
|----|---------|----------|
| — | `apple-mobile-web-app-capable` deprecated meta tag in `web/index.html` | Nit |
| — | `getListById` imported in `src/worker/reminders/send.ts` but not called (no runtime impact; `noUnusedLocals` not enabled) | Nit |
| — | ESLint 9 flat config missing (`eslint.config.js`); `npm run lint` fails with config error | Pre-existing gap, out of scope |
| P4-N1 | Plan doc wording in §1.2 over-attributes owner's never-gated guarantee to upsert re-seeding; code is correct; only plan comment is imprecise — deferred to Architect per impl notes | Doc-only, deferred |
| P4-N3 | No documented recovery path for `owner.active=0` (only reachable via direct DB edit) — deferred to Architect per impl notes | Doc-only, deferred |

---

## 8. Summary

**M5-PROD-FK (CLOSED):** `deleteItem` and `deleteList` in `src/worker/db.ts` now perform explicit application-level cascade deletes in the correct order (dispatch FIRST per P2-N1, then child tables, then parent). The production Worker never issues `PRAGMA foreign_keys = ON` — confirmed by grep — so the app-level deletes are the sole correctness guarantee, which is exactly correct for production D1 regardless of its FK enforcement default. The cascade-ordering tests in `db.test.ts` now run WITHOUT `PRAGMA foreign_keys = ON` and pass, proving the guarantee via app code alone. All four child tables (`item_reminders`, `item_occurrence_state`, `reminder_dispatch`, and the items/list rows themselves) are verifiably clean after delete.

**D14 P4-N2 (CLOSED):** `upsertUser`'s ON CONFLICT path updates only `role`, never `active`. The post-upsert re-select returns the persisted DB value. The new test (db.test.ts line 186–207) covers both the SQL invariant and the return-value contract for the OWNER_EMAIL edge case. Deactivated users — including an owner forcibly set to `active=0` via direct DB edit — remain deactivated through re-login upserts. The `requireAuth` D14 gate reads this persisted value correctly.

**Automated tests:** 32/32 pass (up from 31/31 in Run 3); typecheck clean; dev server starts and all `/api/*` routes return 401 JSON without falling through to SPA.

**Regression sweep:** No regressions. All D7 dispatch cleanup paths, B1 route fixes, D14 deactivation gate, D5 per-occurrence completion, D6 admin self-deactivation guard, D10 DST recurrence, and D8 push fan-out are unchanged and operative.

**DevOps-gated items:** Real JWT, push delivery, email delivery, deployed E2E, and production D1 confirmation are out of scope; explicitly not failed. The M5-PROD-FK fix makes production FK enforcement a non-issue — the app code is now the load-bearing cascade.

---

PASS
