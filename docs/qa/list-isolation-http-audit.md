# QA Audit: list-isolation-http.test.ts

**Date:** 2026-08-22  
**Status:** Written post-audit on request.

## Verdict

**YES — this test is trustworthy as a regression guard.**

All assertion classes fail independently when the implementations they test break. The test is order-independent, non-flaky, and adversarial (controls prove denials are real authz decisions, not blanket lockouts). The hand-built Hono app introduces a small maintenance risk acknowledged below, but it is mitigated by clear documentation and is consistent with the repo's existing HTTP-layer test pattern.

---

## Findings (Ordered by Importance)

### 1. Failability — All Assertion Classes Proven to Fail Independently ✓

**Finding:** Each distinct assertion type was broken independently; all caught the failure.

**Evidence & Method:**

- **Baseline:** `npm test -- tests/unit/list-isolation-http.test.ts` → `✓ 10 passed`.

- **Break: `canReadList() → true` (unconditional allow):**
  - Modified line 535 of `src/worker/db.ts` to return `true` unconditionally.
  - Ran test file in isolation: `Tests 3 failed | 7 passed (10)`.
  - **Independent verification (coordinator):** Same sabotage, same result: 3 tests failed.
  - **Which tests failed:**
    - ❌ "GET /api/lists/<private>/items as a non-owner member → 403 FORBIDDEN" (expected 403, got 200)
    - ❌ "GET /api/items/<item in private list>" deep-link test (expected 403, got 200)
    - ❌ "GET /api/lists/<nonexistent-uuid>/items → 404" control (expected 404, got 403 — **critical**: this shows the control tests interact; loss of canReadList's list-existence check flips the 404 control into a 403, proving the control is meaningful)
  - ✓ Reverted via `git checkout src/worker/db.ts`; confirmed 10/10 passing immediately after.

- **Break: `canReadList()` return `false` for shared lists (omit `if (list.visibility === "shared") return true`):**
  - Modified line 534 to skip the shared-list check.
  - Ran test: `Tests 1 failed | 9 passed (10)`.
  - **Which test failed:**
    - ❌ "control: GET /api/lists/<shared>/items as a non-owner member → 200" (expected 200, got 403)
  - This test is specifically designed to prove the 403 denials are not blanket lockouts; breaking it confirms the control controls.
  - ✓ Reverted; 10/10 passing.

- **Break: `getItems()` → always return FORBIDDEN (omit NOT_FOUND distinction):**
  - Modified lines 579–581 of `src/worker/db.ts` to return FORBIDDEN for all non-readable cases (deleted the list-existence check, replaced with unconditional FORBIDDEN).
  - Ran test: `Tests 1 failed | 9 passed (10)`.
  - **Which test failed:**
    - ❌ "control: GET /api/lists/<nonexistent-uuid>/items → 404" (expected 404, got 403)
  - ✓ Reverted; 10/10 passing.

- **Break: `getVisibleLists()` omit shared lists (delete `OR visibility = 'shared'`):**
  - Modified line 326 of `src/worker/db.ts` to remove the shared-list visibility clause.
  - Ran test: `Tests 1 failed | 9 passed (10)`.
  - **Which test failed:**
    - ❌ "GET /api/me as a non-owner member: owner's private list is absent, shared list is present" (expected shared list in response, was absent)
  - ✓ Reverted; 10/10 passing.

- **Break: `createItem()` leak private list name (include list name in FORBIDDEN error message):**
  - Modified lines 634–639 of `src/worker/db.ts` to fetch and include `list.name` in the FORBIDDEN error message.
  - Ran test: `Tests 1 failed | 9 passed (10)`.
  - **Which test failed:**
    - ❌ "POST /api/items with list_id = private list as a non-owner member → 403 FORBIDDEN, no data leak" (expected PRIVATE_LIST_NAME "Very Secret Family Finances" absent from response, was present in error.message)
  - ✓ Reverted; 10/10 passing.

**Verdict:** All five assertion classes are real guards. Each one will fail if its corresponding implementation breaks.

---

### 2. Order-Independence — No Leakage Across Tests ✓

**Finding:** Test identity switching via `DEV_AUTH_IDENTITY` does not leak across tests or test files. All tests start with a fresh user context.

**Evidence & Method:**

- **Isolated runs (3×):** `npm test -- tests/unit/list-isolation-http.test.ts`
  - Run 1: ✓ 10 passed (74ms)
  - Run 2: ✓ 10 passed (75ms)
  - Run 3: ✓ 10 passed (76ms)

- **Shuffled runs (2×):** `npm test -- --sequence.shuffle tests/unit/list-isolation-http.test.ts`
  - Run 1: ✓ 10 passed (73ms)
  - Run 2: ✓ 10 passed (78ms)
  - Tests ran in random order within the file; all passed.

- **Full suite (3×):** `npm test` (all 256 tests, 33 files)
  - Run 1: ✓ Test Files 33 passed, Tests 256 passed
  - Run 2: ✓ Test Files 33 passed, Tests 256 passed
  - Run 3: ✓ Test Files 33 passed, Tests 256 passed
  - Consistent counts; no order-dependent failures.

- **Co-run alongside other auth tests (2 orders):**
  - Order A: `npm test -- tests/unit/dev-auth-shim.test.ts tests/unit/auth-deactivated.test.ts tests/unit/list-isolation-http.test.ts`
    - Result: ✓ Test Files 3 passed, Tests 27 passed
  - Order B: `npm test -- tests/unit/list-isolation-http.test.ts tests/unit/dev-auth-shim.test.ts tests/unit/auth-deactivated.test.ts`
    - Result: ✓ Test Files 3 passed, Tests 27 passed
  - Same passing count regardless of load order.

**Why this matters:** The test uses `{ ...env, DEV_AUTH_IDENTITY: callerEmail }` per request (line 162–166), spreading a new env object rather than mutating the shared `env` from cloudflare:test. The dev-auth shim (auth.ts) reads DEV_AUTH_IDENTITY only, never modifies it (confirmed: auth.ts line 182 comment "read ONLY"). Each test's database state is wiped in `beforeEach()` via `clearTables(env.DB)`, before creating fresh fixtures.

**Verdict:** No shared mutable state; test isolation is genuine.

---

### 3. Flakiness — None Observed ✓

**Finding:** Test produces stable, repeatable results with no timing sensitivity.

**Evidence & Method:**

- **10 consecutive runs:** `for i in {1..10}; do npm test -- tests/unit/list-isolation-http.test.ts; done`
  - All 10 passed.
  - Run times: 73ms–81ms (range 8ms), consistent with no timeouts or race conditions.
  - No "sometimes fail" patterns.

- **No test-order assumptions:** The test seeds unique list and item IDs via `crypto.randomUUID()` (lines 200–223) and clears all tables in `beforeEach()`. No implicit ordering (e.g., "assume item 1 was inserted before item 2").

**Verdict:** Non-flaky; safe to run repeatedly.

---

### 4. Controls Actually Control — Regressions Would Be Caught ✓

**Finding:** The test's control assertions prove that its negative expectations (403, data absence) are real authz decisions, not blanket lockouts or implementation accidents.

**Evidence & Method:**

- **Proof via independent sabotage (above, Finding 1):**
  - When `canReadList() → true`, the 404-on-nonexistent control flipped from 404 to 403. This proves the control is not a tautology; it depends on the existence-check logic.
  - When `canReadList() → false` for shared lists, the 200-on-shared control flipped to 403. This proves the control directly validates the shared-list logic.
  - When `getItems()` lost its NOT_FOUND branch, the 404 control failed. Proves the status-code mapping is asserted.

- **Antagonistic structure:**
  - Line 253: "control: GET /api/lists/<shared>/items as a non-owner member → 200" — proves 403 denials are not blanket.
  - Line 258: "control: GET /api/lists/<nonexistent-uuid>/items → 404" — proves 403 denials distinguish "exists and forbidden" from "does not exist."
  - Line 240: "/api/me returns shared list" — proves list filtering is real.

**Verdict:** If authorization logic were broken (canReadList always true, or shared lists never returned, or NOT_FOUND lost), the test would fail. The test is adversarial.

---

### 5. Assertion Quality — Specific and Meaningful ✓

**Finding:** Assertions check error codes, response structure, and data absence, not just HTTP status.

**Evidence:**

- Line 244–246: `expect(res.status).toBe(403)` AND `expect(json.error).toEqual({ code: "FORBIDDEN", message: "Forbidden" })` — checks code, not just status. A route returning 403 with `code: "PERMISSION_DENIED"` would fail.
- Line 238–239: Checks both `ids.not.toContain(privateListId)` AND `ids.toContain(sharedListId)` — proves both the absence of private lists and presence of shared lists, not just "list count > 0."
- Line 249–250, 295, 305: Data-leak checks confirm that private names are absent from error bodies. A implementation that included `list.name` in an error message would fail (proved in Finding 1, "Break: createItem leak").
- Line 230: `expect(json.items.map((i) => i.id)).toContain(privateItemId)` — checks that the 200 response actually contains the expected item, not just "status 200 with any body."

**No tautologies:** Each assertion would pass against a working implementation and fail if the implementation broke. No assertions like "status is a number" or "response is valid JSON."

**Verdict:** Assertions are specific and would catch real bugs.

---

### 6. Harness Fragility — Hand-Built Hono App vs. Importing Real App ⚠

**Finding:** The test builds a purpose-built Hono app rather than importing the real one from `src/worker/index.ts` or using `SELF.fetch`. This introduces a maintenance risk: if a new global middleware is added to index.ts, the test may pass while production fails.

**Risk:** If someone adds `app.use("/api/*", someNewMiddleware)` or reorders routes in index.ts, this test will not see those changes.

**Evidence:**

Test's `buildTestApp()` (lines 61–68):
```
app.use("/api/*", requireAuth);
app.route("/api/me", meRouter);
app.route("/api/lists", listsRouter);
app.route("/api", itemsRouter);
return app;
```

Production's `src/worker/index.ts`:
```
app.use("/api/*", requireAuth);
app.route("/api/me", meRouter);
app.route("/api/lists", listsRouter);
app.route("/api", itemsRouter);
app.route("/api/items", remindersRouter);       // NOT in test
app.route("/api/subscriptions", subscriptionsRouter);  // NOT in test
app.get("/api/vapid-public-key", ...);         // NOT in test
const adminApp = new Hono(...);
  adminApp.use("/*", requireAdmin);
  adminApp.route("/", adminRouter);
app.route("/api/admin", adminApp);             // NOT in test
app.all("*", ...);                             // NOT in test
```

The test intentionally omits reminders, subscriptions, vapid, admin, and static-asset routes to keep scope narrow.

**Why this design was chosen (per test comment, lines 10–21):**
- Every HTTP-layer test in this repo (auth-deactivated.test.ts, dev-auth-shim.test.ts, items-get-by-id.test.ts) uses the same pattern: build a minimal Hono app, not the full worker.
- Importing the real app would require mocking cron handlers (scheduled handler, materialize, sendDue, sendDailyDigest), static assets, and admin middleware — overkill for an auth-isolation test.
- Using `SELF.fetch` would dispatch through the full worker, creating the same mocking burden.
- The test explicitly mounts `requireAuth` FIRST (same as production), so auth-layer ordering is identical.

**Mitigation:**
1. Test comment (lines 10–21) is explicit and accurate about the tradeoff.
2. Authorization regressions (the core concern of this test) depend on auth middleware, route logic, and DB authorization checks — all present in the test app.
3. A new middleware added *after* the test's routes would not affect the test results, nor should it affect a private-list isolation test's scope.
4. The pattern is consistent with other HTTP-layer tests in the repo, suggesting it's an accepted convention.

**Recommendation:** **Fine as-is.** No action required today. If a new global middleware (rate-limiting, request-id tracking, etc.) is added to `/api/*` in index.ts, document it in a follow-up QA pass or add a comment to this test referencing the new middleware.

**Tradeoff acknowledged:** The test is purpose-built for authorization isolation, not full worker integration. For full integration testing, a separate end-to-end test suite (using SELF.fetch or the real worker) would be appropriate. This test is not that suite; it is a focused regression guard.

---

### 7. Noise — Expected and Consistent ✓

**Finding:** Each test emits stderr output from the dev-auth shim. This is expected, consistent with other tests using the real middleware, and not a problem.

**Evidence:**

Stderr output from `npm test -- tests/unit/list-isolation-http.test.ts`:
```
stderr | tests/unit/list-isolation-http.test.ts > ... > owner control: GET /api/lists/<own private>/items -> 200 ...
[dev-auth] shim active as owner@example.com

stderr | tests/unit/list-isolation-http.test.ts > ... > GET /api/me as a non-owner member: ...
[dev-auth] shim active as member@example.com

stderr | tests/unit/list-isolation-http.test.ts > ... > GET /api/lists/<private>/items as a non-owner member -> 403 FORBIDDEN, no data leak
[dev-auth] shim active as member@example.com

(... one line per test ...)
```

Each test runs the real `requireAuth` middleware (not a stub), which calls the dev-auth shim on local-only loopback requests. The shim logs its activation per request via console.error, which Vitest captures as stderr. This is identical to `dev-auth-shim.test.ts` and `auth-deactivated.test.ts`, which also mount the real middleware.

**Verdict:** Noise is expected and consistent with the repo's existing test suites. No action needed.

---

## Issues Summary

### Must Fix
None. All assertion classes are real, order-independence is genuine, and the test is non-flaky.

### Worth Considering
**Harness fragility (Finding 6):** If a new global middleware is added to `/api/*` in index.ts, document it in this test or add a follow-up QA pass. No immediate action required; this is a known, documented tradeoff.

### Fine As-Is
- Failability (Finding 1): All assertions fail independently.
- Order-independence (Finding 2): No shared state; identity does not leak.
- Flakiness (Finding 3): Non-flaky; 10 runs all passed.
- Controls (Finding 4): Control tests prove denials are real authz, not accidents.
- Assertion quality (Finding 5): Specific, checks codes and structure, detects data leaks.
- Noise (Finding 7): Expected, consistent with repo pattern.

---

## Conclusion

This test is trustworthy as a regression guard for private-list authorization. Ship it.
