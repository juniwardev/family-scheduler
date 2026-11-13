# QA Report: Local-only dev auth shim (`dev-auth-shim`)

Branch: `feat/dev-auth-shim` (HEAD `509e695`)
Plan: `docs/plans/dev-auth-shim.md`
Impl notes: `docs/process/dev-auth-shim-impl-notes.md`
Review (3 passes, final APPROVE): `docs/reviews/dev-auth-shim-review.md`
Kickoff: `docs/dev-auth-shim-kickoff.md`

## Summary verdict

**PASS**

Both load-bearing requirements are confirmed:
1. Production-safety (DC2) — the shim is genuinely inert against a simulated deployed context, verified through the **real** `requireAuth` (not a stub), and the gate is fail-closed by code inspection.
2. DC4 — the app is now actually drivable locally as the test user via the Playwright MCP, end to end (owner identity, admin panel, list creation, item creation), with zero JWT and zero console errors.

---

## (1) Production-safety (DC2) — detailed verification

### Test harness is genuine, not a stub

Read `tests/unit/dev-auth-shim.test.ts:20,31`:

```ts
import { requireAuth, requireAdmin, isLocalDevContext } from "../../src/worker/auth";
...
app.use("/api/*", requireAuth);
```

This mounts the **real, exported** `requireAuth` from `src/worker/auth.ts`, wired exactly as production (`app.use("/api/*", requireAuth)` mirrors `src/worker/index.ts:28`). It is explicitly **not** `tests/unit/auth-deactivated.test.ts`'s `testAuth` stub (that file's own `testAuth`, `auth-deactivated.test.ts:33-50`, reads identity from an `X-Test-Email` header and never touches `requireAuth`/`verifyAccessJwt`/the shim gate at all — confirmed by reading both files side by side). The two files are independent test apps; `dev-auth-shim.test.ts` never imports or references `testAuth`. This was the single most important thing to check per the review's Pass-2/Pass-3 Major, and it is correctly closed.

### T3/T4 — deployed-host case returns 401, even with the sentinel set

- `T3` (`dev-auth-shim.test.ts:155-166`): requests `https://family-scheduler.juniwar-dev.workers.dev/api/me` (deployed-style host) with `DEV_AUTH_IDENTITY: "owner"` **set** (worst case) and no JWT header → asserts `401 UNAUTHENTICATED`, `"Missing Access JWT"`. This is the load-bearing safety test: sentinel present, host non-loopback, shim must stay inert.
- `T4` (`:168-182`): requests `http://localhost/api/me` with `DEV_AUTH_IDENTITY` **explicitly asserted unset** in the merged env (`expect(mergedEnv.DEV_AUTH_IDENTITY).toBeUndefined()` before the fetch, per plan §7.1 Nit 4) → asserts `401 UNAUTHENTICATED`. Proves loopback host alone is not sufficient; the toggle must also be present.
- Ran `npm test` myself (see below) and confirmed both pass through the real gate. I also confirmed empirically that the `[dev-auth] shim active` console.warn (auth.ts:215) fires **only** for T1/T1b/T2/T2b (the DC1 tests) in the captured stderr output, and never for T3/T4 — direct evidence the shim did not activate for the deployed-host / sentinel-unset cases, exactly as the code predicts.

### Gate is fail-closed by code inspection (`src/worker/auth.ts:164-187`)

```ts
export function isLocalDevContext(request: Request): boolean {
  let host: string;
  try {
    host = new URL(request.url).hostname;
  } catch {
    return false; // any URL/hostname parse error → fail closed
  }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function resolveDevIdentity(env: Env, request: Request): string | null {
  if (!isLocalDevContext(request)) return null; // SECURITY GATE first → fail closed
  const sel = env.DEV_AUTH_IDENTITY; // read ONLY inside the gated branch (non-security)
  if (!sel) return null; // toggle OFF (unset/empty) → real path runs
  const email = sel.includes("@") ? sel : env.OWNER_EMAIL;
  return email.toLowerCase();
}
```

- `new URL(...)` is wrapped in `try/catch → return false` — confirmed, no swallowed-exception fail-open.
- Host check runs and returns before the sentinel is ever read (`resolveDevIdentity` line 181 gates on `isLocalDevContext` first, sentinel read at line 182) — confirmed, matches plan §3.4 exactly.
- There is no path where a non-loopback host or an unset sentinel yields shim activation — activation requires the conjunction of both an affirmative loopback host AND a non-empty sentinel (`auth.ts:210-211`, `if (devIdentity) { ... }`), never an absence-based default.
- `requireAuth` (`auth.ts:202-269`): the shim branch is the first statement in the middleware callback (`:210-230`), before the existing `Cf-Access-Jwt-Assertion` read (now at `:232`). When `resolveDevIdentity` returns `null`, control falls through **unmodified** to the pre-existing token/`verifyAccessJwt` block — confirmed byte-identical to the pre-shim path by reading the full file.

### DC2 genuine-guard sanity check (from impl-notes, re-reasoned from code, not re-run)

Per instructions I did not edit application code to re-run this myself, but the impl-notes' claim is consistent with the code as shipped: loosening `isLocalDevContext` to unconditionally `return true` would make T3 (deployed host) activate the shim and return `200` instead of the expected `401`, which is exactly the reported failure (`expected 200 to be 401`). This is the correct behavior for a genuine regression guard — I reason the same conclusion independently from reading `resolveDevIdentity`'s control flow, since nothing else in T3's env would prevent the shim's `if (devIdentity)` branch from firing once `isLocalDevContext` is forced true.

### D14 active gate still enforced on the shimmed path

`auth.ts:217-225`: the shim branch calls the identical `upsertUser(c.env.DB, devIdentity, c.env.OWNER_EMAIL, Date.now())` used by the real path (`:248-253`), then re-checks `if (!devUser.active) return 403 DEACTIVATED` — a textually separate but logically identical copy of the D14 gate at `:259-264`. `T2b` (`dev-auth-shim.test.ts:131-151`) exercises this directly: creates a member via the shim, deactivates them in the DB, re-requests through the shim, and asserts `403` / `code: "DEACTIVATED"`. Confirmed passing.

### Test / typecheck results (run myself)

```
npm run typecheck   → clean, no errors (both tsconfig.worker.json and tsconfig.web.json)
npm test             → 9 test files passed, 60 tests passed (0 failed)
```

This matches the impl-notes' claim of 60/60 across 9 files exactly, including:
- `tests/unit/dev-auth-shim.test.ts` — 11/11 (T1, T1b, T2, T2b, T3, T4, T5×5)
- `tests/unit/auth-deactivated.test.ts` — 6/6, unchanged, still using its own `testAuth` stub, never touches `requireAuth`
- `tests/unit/routing.test.ts` — 6/6, unchanged

`npm run lint` could not run — pre-existing ESLint v9 flat-config gap (`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`), unrelated to this change (confirmed independently myself, matches impl-notes).

**DC2 verdict: confirmed sound.** No stub-based vacuous coverage, no reachable fail-open path, D14 intact on the shimmed path.

---

## (2) DC4 — manual local drive (Playwright MCP)

### Setup

- `.dev.vars` already existed locally (pre-existing `RESEND_API_KEY` / `VAPID_PRIVATE_KEY`, gitignored). I appended `DEV_AUTH_IDENTITY="owner"` to it (not committed — `.gitignore:4` covers `.dev.vars`; `git status` confirms clean tree throughout). Per `resolveDevIdentity`, `"owner"` (no `@`) resolves to `env.OWNER_EMAIL`, which `wrangler.toml:21` sets to `juniwar.dev@gmail.com` — so this exercises the admin/owner path as instructed.
- `npm run build` then `npm run dev` (backgrounded). Wrangler 4.105.0 started and printed `Ready on http://localhost:8787` — a loopback host, satisfying the gate's functional direction. The bindings table showed `env.DEV_AUTH_IDENTITY ("(hidden)")` loaded from `.dev.vars`.

### Drive results

| Check | Result |
|---|---|
| Load app, no Access token | `http://localhost:8787/api/me` returned `200` with `{"user":{"email":"juniwar.dev@gmail.com","role":"admin","active":true,...}}` with **zero** `Cf-Access-Jwt-Assertion` header sent — this is precisely the thing that was impossible before the shim. |
| `[dev-auth] shim active as <email>` log | Confirmed present in the `wrangler dev` stdout, e.g. `[dev-auth] shim active as juniwar.dev@gmail.com`, firing once per `/api/*` request that hit the shim branch (9+ occurrences captured), never for a static-asset request. This is the code at `auth.ts:215`. |
| App UI loads authenticated | Snapshot showed the sidebar rendering `juniwar.dev@gmail.com` and nav buttons `List` / `Calendar` / `Admin` with no login/redirect screen. Console: 0 errors, 1 pre-existing unrelated warning (deprecated `apple-mobile-web-app-capable` meta tag). |
| Admin surface reachable | Clicked "Admin" — `Admin — User Roster` table rendered showing `juniwar.dev@gmail.com — admin — Active`, with `Deactivate` correctly `[disabled]` (self-deactivation guard, unrelated to this feature, still intact). This required `GET /api/admin/users` to pass both `requireAuth` and `requireAdmin` — confirmed `200 OK` in the network log. |
| Create a list | Typed "QA Dev Auth Shim Test List", clicked `+`. `POST /api/lists → 201 Created`. List appeared in the sidebar. |
| Create an item | Selected the new list (required a page reload to clear a pre-existing, unrelated client-side list-selection UI quirk — see Issues below), clicked `+ New Item`, filled Title "QA Shim Smoke Test Item", clicked Create. `POST /api/items → 201 Created`. Item rendered in the list view. |
| Network summary | `GET /api/me → 200`, `GET /api/admin/users → 200`, `POST /api/lists → 201`, `GET /api/lists → 200`, `GET /api/lists/:id/items → 200`, `POST /api/items → 201`. No 4xx/5xx anywhere in the drive. |

Screenshots:
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/docs/qa/screenshots/dev-auth-shim-list-created.png`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/docs/qa/screenshots/dev-auth-shim-item-created.png`

**DC4 verdict: confirmed.** The app is genuinely drivable locally as the test user without any Access JWT, admin surfaces work, and CRUD operations succeed end to end through the shim.

### Cleanup

Stopped the `wrangler dev` background process after the drive (`pkill -f "wrangler dev"`, confirmed no residual process). Left the appended `DEV_AUTH_IDENTITY="owner"` line in the local, gitignored `.dev.vars` for any follow-up local QA — it is not committed (`git status` shows a clean tree on `feat/dev-auth-shim` throughout this session).

---

## Issues found

### Issue 1 (Nit, out of scope, pre-existing) — list-selection view doesn't refresh after in-place navigation

- **Repro:** With the app loaded and a list already created, click a list item in the sidebar (or the "List" nav tab) without a full page reload — the main panel stays on whatever view was last rendered (e.g. stuck on "Admin — User Roster") instead of switching to the selected list's item view. A full page reload/navigation resolves it correctly.
- **Severity:** Nit. This is a client-side (`web/src/`) state/routing quirk, not an auth issue. The plan explicitly states "No client (`web/src/`) change required" for this feature (`docs/plans/dev-auth-shim.md` §2), and the underlying API calls (`GET/POST /api/lists`, `GET/POST /api/items`) all succeeded correctly regardless — this is purely a view-state re-render gap, unrelated to the dev-auth shim.
- **MCP used:** Playwright MCP (accessibility snapshots + network requests).
- **Recommendation:** Track separately as a UI bug ticket if not already known; does not block this feature's verdict.

No issues found in the auth-shim code itself, the gate logic, the test coverage, or the production-safety property.

---

## Console errors and warnings

- 0 console errors throughout the entire drive.
- 1 pre-existing, unrelated warning: `<meta name="apple-mobile-web-app-capable" content="yes"> is deprecated. Please include <meta name="mobile-web-app-capable" content="yes">` — cosmetic PWA manifest nit, not introduced by this change.

## Network failures and slow responses

- No failed (4xx/5xx) requests during the drive except the expected/intended `401`s produced by the automated T3/T4 tests (not part of the browser drive — those are unit-test assertions).
- All browser-drive requests completed in single-digit milliseconds per the `wrangler dev` local log (`3-25ms` range); no slow responses observed. Not a production-representative performance signal (local D1 + no network JWKS fetch in the shim path), but not a concern for this feature.

## Accessibility observations

- Not a focus area for this auth-only change; the app rendered with standard interactive roles (`button`, `textbox`, `combobox`, `radio`, `checkbox`, `table`) picked up cleanly by the Playwright accessibility-tree snapshot, suggesting no obvious regressions from this change (which touches no `web/src/` code).

## Performance notes

None specific to this feature. The shim adds one `upsertUser` DB call on the local-only path, identical in cost to the real path's equivalent call; no JWKS fetch occurs on the shim path (bypassed entirely), which is expected and by design.

## Screenshots

- `docs/qa/screenshots/dev-auth-shim-list-created.png` — app authenticated as `juniwar.dev@gmail.com`, admin panel visible, new list created in sidebar.
- `docs/qa/screenshots/dev-auth-shim-item-created.png` — item "QA Shim Smoke Test Item" created and rendered inside the new list.

---

## Verdict rationale

- Automated suite: 60/60 tests pass (9 files), typecheck clean, DC2 safety tests genuinely exercise the real `requireAuth` (confirmed by reading the test file and by observing the `[dev-auth] shim active` log line firing only for the DC1 tests, never T3/T4).
- Production-safety confirmed: gate is fail-closed by code inspection (try/catch → false, host-before-sentinel ordering, no absence-based activation), and empirically the shim never activated for the deployed-style host / sentinel-unset cases.
- D14 active gate is enforced identically on the shimmed path (T2b), confirmed by reading the code and the passing test.
- DC4 payoff confirmed via a genuine Playwright-driven local session: authenticated with zero JWT, admin panel reachable, list + item created end to end, zero console errors, `[dev-auth] shim active as juniwar.dev@gmail.com` observed in the dev server log exactly as designed.
- The single Nit found (list-selection view-state quirk) is a pre-existing, unrelated client-side issue explicitly out of scope for this auth-only change, and does not affect the security property or the local-drive payoff.

PASS
