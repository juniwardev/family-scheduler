# Implementation notes: Local-only dev auth shim

Plan: `docs/plans/dev-auth-shim.md`
Review (three passes, final verdict APPROVE): `docs/reviews/dev-auth-shim-review.md`
Kickoff: `docs/dev-auth-shim-kickoff.md`
Branch: `feat/dev-auth-shim` (off `main`)

## What changed

- **`src/worker/auth.ts`**
  - Added `export function isLocalDevContext(request: Request): boolean` (`auth.ts:164-172`). Parses `new URL(request.url).hostname` inside `try/catch`; returns `false` on any parse error (fail closed). Returns `true` only if the hostname is exactly `"localhost"`, `"127.0.0.1"`, or `"[::1]"`. This is the sole load-bearing production-safety signal — Cloudflare routes to the deployed Worker by hostname, so a loopback hostname can never be observed on a request that actually reached the deployed Worker.
  - Added `export function resolveDevIdentity(env: Env, request: Request): string | null` (`auth.ts:180-187`). Checks `isLocalDevContext(request)` **first** (host gate before sentinel read, per plan §3.4). If false → `null`. If true, reads `env.DEV_AUTH_IDENTITY`; if unset/empty → `null` (toggle off). Otherwise resolves to the explicit email (if it contains `@`) or `env.OWNER_EMAIL`, and lowercases the result in a single exit — matching the real path's email-lowercase normalization at `auth.ts:142` (`return { ok: true, value: { email: email.toLowerCase() } }`).
  - Inserted the shim branch at the very top of `requireAuth`'s callback (`auth.ts:203-230`), before the existing `const token = c.req.header("Cf-Access-Jwt-Assertion")` read (now at `auth.ts:232`). When `resolveDevIdentity` returns a non-null email: logs one `console.warn("[dev-auth] shim active as <email>")` (email only, no secrets/JWTs), calls the identical `upsertUser(c.env.DB, devIdentity, c.env.OWNER_EMAIL, Date.now())` used by the real path, re-applies the same D14 active-gate (`403 DEACTIVATED` if `!devUser.active`), then `c.set("user", devUser)` and `next()`. If `resolveDevIdentity` returns `null`, execution falls through unchanged to the pre-existing token/`verifyAccessJwt` block.
  - **Not touched:** `verifyAccessJwt` internals (`auth.ts:72-149`, byte-for-byte unchanged — confirmed by diff), `requireAdmin` (now `auth.ts:...`, unchanged), the D14 active-gate in the real path (`auth.ts:248-268` area, unchanged — the shim's D14 check is a *separate*, textually-identical copy inside the new branch, not a modification of the real one), and the self-deactivation guard (lives in `db.ts`/routes, not touched at all).

- **`src/worker/env.ts`** — added `DEV_AUTH_IDENTITY?: string;` to the `Env` interface (`env.ts:13-14`) with a comment noting it is not a security layer.

- **`.dev.vars.example`** — appended (not overwritten) a `DEV_AUTH_IDENTITY` block after the existing `RESEND_API_KEY` / `VAPID_PRIVATE_KEY` lines, with the local-only / non-security explanatory comment from plan §5. Both pre-existing lines preserved verbatim.

- **`tests/unit/dev-auth-shim.test.ts`** (new). Mounts the **real** `requireAuth` (imported from `src/worker/auth.ts`) via `app.use("/api/*", requireAuth)`, mirroring `src/worker/index.ts` — explicitly does NOT reuse the `testAuth` stub from `tests/unit/auth-deactivated.test.ts`. Reuses only that file's harness mechanics (`cloudflare:test` `env`, `applyMigrations`, `app.fetch(...)` pattern). Covers:
  - DC1: T1 (localhost + `DEV_AUTH_IDENTITY=owner` → 200, admin, active), T1b (owner shim identity can hit an admin-only route), T2 (127.0.0.1 + explicit member email → 200, non-admin), T2b (D14 still applies — deactivating the shim-created user yields 403 DEACTIVATED on the next shimmed request).
  - DC2 (load-bearing): T3 (deployed-style host `https://family-scheduler.juniwar-dev.workers.dev/api/me`, sentinel present — worst case — shim inert, falls through to real 401 "Missing Access JWT"), T4 (loopback host, `DEV_AUTH_IDENTITY` explicitly asserted unset in the merged env → 401 via full verification path).
  - T5: isolated unit tests of the `isLocalDevContext` seam (deployed host → false, `localhost`/`127.0.0.1`/`[::1]` → true, malformed URL string → false via caught exception).

## Exact gate condition implemented

```
isLocalDevContext(request):
  try { host = new URL(request.url).hostname } catch { return false }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"

resolveDevIdentity(env, request):
  if (!isLocalDevContext(request)) return null
  sel = env.DEV_AUTH_IDENTITY
  if (!sel) return null
  email = sel.includes("@") ? sel : env.OWNER_EMAIL
  return email.toLowerCase()
```

Activation requires **both**: `isLocalDevContext(c.req.raw) === true` AND `DEV_AUTH_IDENTITY` non-empty. Host check evaluated first, per plan §3.4. Matches the plan exactly — no deviation.

## DC2 genuine-guard sanity check

Per the task instructions, before finalizing I temporarily loosened `isLocalDevContext` to `return true` unconditionally (as the very first statement, dead code below preserved), then ran the DC2 T3 test in isolation:

```
npx vitest run tests/unit/dev-auth-shim.test.ts -t "T3"
```

Result with the loosened gate: **T3 FAILED** — `expected 200 to be 401` (the shim incorrectly activated against the deployed-style host and returned the owner's `/api/me` payload instead of falling through to the real 401). This confirms T3 is a genuine regression guard, not a vacuous pass against a stub.

I then restored the exact gate condition above and re-ran the full suite (`npm test`): all 60 tests passed, including all 11 `dev-auth-shim.test.ts` tests and the pre-existing `auth-deactivated.test.ts` (6 tests) and `routing.test.ts` (6 tests).

**Sanity-check outcome: PASS as designed** — fails when loosened, passes when correct.

## Test / typecheck results

- `npm run typecheck` — clean, no errors (`tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json`).
- `npm test` — **9 test files passed, 60 tests passed** (0 failed), including the new `tests/unit/dev-auth-shim.test.ts` (11 tests) and both pre-existing auth-related suites (`auth-deactivated.test.ts` 6 tests, `routing.test.ts` 6 tests) unchanged and green.
- `npm run lint` — could not run: `ESLint couldn't find an eslint.config.(js|mjs|cjs) file` (pre-existing ESLint v9 flat-config gap in this repo, unrelated to this change; noted per task instructions, not fixed here).

## Manual local-drive confirmation (DC4)

**Not verified by me in this session.** DC4 (append `DEV_AUTH_IDENTITY="owner"` to a local `.dev.vars`, run `npm run dev`, load the app in a browser, confirm `/api/me` and admin paths render) requires an interactive browser session against a running `wrangler dev` server, which is outside what I can drive from this environment. The automated DC1 tests (T1/T1b/T2/T2b) exercise the identical code path end-to-end through the real `requireAuth` and `Hono` app wiring pattern used by `src/worker/index.ts`, so the shim's behavior is verified at the HTTP layer. **Deferring the actual manual browser click-through to QA/the owner**, as anticipated by the task instructions.

## Deviations from the plan

None. Implementation follows `docs/plans/dev-auth-shim.md` §3.4/§3.5/§4/§5/§7/§7.1 exactly:
- Insertion point, gate order, and helper signatures match §3.4 verbatim.
- `.dev.vars.example` was appended via `Edit`, not recreated via `Write` — both pre-existing secrets preserved.
- Test file mounts the real `requireAuth`, not the `testAuth` stub, per the explicit Pass-2/Pass-3 review requirement.
- No changes to `wrangler.toml`, `verifyAccessJwt`, `requireAdmin`, the D14 gate, or the self-deactivation guard.

## Out-of-scope observations

None found relevant to this change beyond the pre-existing ESLint flat-config gap noted above (already known/out of scope per task instructions).

## Files changed

- `src/worker/auth.ts` — added `isLocalDevContext`, `resolveDevIdentity`, and the shim branch in `requireAuth`.
- `src/worker/env.ts` — added optional `DEV_AUTH_IDENTITY` binding to `Env`.
- `.dev.vars.example` — appended `DEV_AUTH_IDENTITY` example block.
- `tests/unit/dev-auth-shim.test.ts` — new test file (DC1/DC2/T5 coverage per plan §7.1).
