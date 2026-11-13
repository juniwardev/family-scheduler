# QA Report: `push-crypto-fix`

**QA:** Claude (Sonnet 5)
**Date:** 2026-06-30
**Branch:** `feat/family-scheduler` (already contains commit `53ab870`)
**Read:** `docs/plans/push-crypto-fix.md`, `docs/process/push-crypto-fix-impl-notes.md`, `docs/push-crypto-fix-brief.md`, `docs/reviews/push-crypto-fix-review.md` (Pass 1 + Pass 2, both APPROVE(-WITH-CHANGES)/APPROVE), `src/worker/channels/push.ts`, `src/worker/env.ts`, `tests/unit/push-vapid.test.ts`, `tests/unit/push-encrypt.test.ts`.

`docs/dev-fixtures.md` does not exist in this repo — it is not applicable here (this is a Cloudflare Worker backend project, not a Shopify storefront, and the task's own procedure explicitly frames this as a locally-verifiable crypto fix, not a browser-click feature). No browser MCP was used; QA was performed via `Bash` (unit tests, typecheck, `git diff`, and a best-effort local `wrangler dev --test-scheduled` exercise).

---

## Summary verdict

**PASS**

Both fixes match the plan's exact byte/shape specification, all new and existing tests pass under real workerd `crypto.subtle` (36/36), typecheck is clean, the locked-file list is respected (verified via direct `git show` diff, not just impl-notes' say-so), and a best-effort local `wrangler dev` exercise confirms the fixed crypto path no longer throws. The only remaining gaps are the live-deploy production checks that are inherently outside local QA's reach and are the owner's manual step per the task brief.

---

## A. Locally-checkable verification

### 1. Unit tests

Ran `npm test`:

```
 ✓ tests/unit/push-encrypt.test.ts  (1 test) 23ms
 ✓ tests/unit/push-vapid.test.ts  (3 tests) 33ms
 ✓ tests/unit/recurrence.test.ts  (6 tests) 47ms
 ✓ tests/unit/auth-deactivated.test.ts  (6 tests) 45ms
 ✓ tests/unit/routing.test.ts  (6 tests) 46ms
 ✓ tests/unit/db.test.ts  (14 tests) 111ms

 Test Files  6 passed (6)
      Tests  36 passed (36)
```

Matches the impl-notes' claimed 36/36 exactly. Both new files (`tests/unit/push-vapid.test.ts` — 3 tests, `tests/unit/push-encrypt.test.ts` — 1 test) exist and pass, and no pre-existing test regressed.

### 2. Real crypto, not mocks

`vitest.config.ts` uses `defineWorkersConfig` from `@cloudflare/vitest-pool-workers`, which runs tests inside real `workerd` isolates. Confirmed at runtime: the `npm test` output shows Miniflare/workerd startup lines (`[vpw:inf] Starting isolated runtimes...`, `[mf:wrn] The latest compatibility date supported by the installed Cloudflare Workers Runtime is...`) before the test files run. Both new test files call `crypto.subtle.importKey`, `crypto.subtle.sign`, `crypto.subtle.verify`, `crypto.subtle.deriveBits`, `crypto.subtle.generateKey`, `crypto.subtle.exportKey`, `crypto.subtle.encrypt`/`decrypt` directly (`tests/unit/push-vapid.test.ts:111-124`, `tests/unit/push-encrypt.test.ts:51-151`) — no mocking layer, no stubs. This is genuine WebCrypto exercising the exact runtime (workerd) that runs in production Workers, closing the coverage gap that let both bugs ship.

`push-encrypt.test.ts` decrypts using a hardcoded, independently-written **single**-`0x00` info (`tests/unit/push-encrypt.test.ts:112-121`, with explicit byte-length assertions: `cekInfo.length === 28`, `nonceInfo.length === 24`, both ending `0x00`) — matching RFC 8188 §2.2 exactly, and matching the plan's §3.5 corrected byte layout. This info is **not** imported from `push.ts` (per Pass-2 review note P2-2), so encrypt (production) and decrypt (test) derive CEK/nonce independently — a genuine asymmetric regression guard, not a symmetric/tautological pass.

### 3. Independent reproduction of the regression-guard claim

Per instructions, I did not edit `push.ts` to re-run the Coder's revert experiment (read-only on app code). Reasoning through the code instead: `push.ts:189` (`cekInfo = enc.encode("Content-Encoding: aes128gcm\0")`, 28 bytes) and `push.ts:198` (`nonceInfo`, 24 bytes) are consumed only as the `info` parameter to `crypto.subtle.deriveBits({ name: "HKDF", ... })`. HKDF-Expand output is fully determined by `(PRK, info, length)`; a one-byte difference in `info` (double- vs single-`0x00`) produces a completely different (uncorrelated) derived CEK and nonce. Since the test's decrypt side hardcodes the RFC-correct single-null info independent of `push.ts`, if `push.ts` still had the double-null bug the test's AES-GCM decrypt would receive a CEK/nonce that does not match the CEK/nonce the ciphertext was actually encrypted under — AES-GCM would fail its authentication tag check (`OperationError: Decryption failed...`), exactly the error the Coder's impl-notes report from their manual revert experiment (`docs/process/push-crypto-fix-impl-notes.md:63-69`). This is consistent and the claim holds: the test is a real regression guard, not a false/symmetric pass.

### 4. `npm run typecheck`

```
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json
```
Clean, no output, exit 0.

### 5. Code inspection against the plan

Read `src/worker/channels/push.ts` in full (292 lines) and diffed the committed change (`git show 53ab870 -- src/worker/channels/push.ts src/worker/env.ts`) against plan §3.2/§3.5:

- **VAPID JWK import** (`push.ts:82-98`): builds `pubBytes = b64urlToBytes(env.VAPID_PUBLIC_KEY)`, guards `pubBytes.length !== 65 || pubBytes[0] !== 0x04` (§3.3 shape guard, present), slices `x = pubBytes.slice(1,33)`, `y = pubBytes.slice(33,65)`, normalizes `d = bytesToB64url(b64urlToBytes(env.VAPID_PRIVATE_KEY))`, and calls `crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y, d, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])` — byte-for-byte matches plan §3.2. The old `importKey("pkcs8", ...)` call and its misleading comment are gone. `crypto.subtle.sign(...)` and the `header.payload.signature` assembly (`push.ts:100-106`) are unchanged — no DER→JOSE conversion added, as required.
- **HKDF `info` fix** (`push.ts:189`, `push.ts:198`): `cekInfo = enc.encode("Content-Encoding: aes128gcm\0")` and `nonceInfo = enc.encode("Content-Encoding: nonce\0")` — the stray `concatBytes(..., new Uint8Array(1))` wrapper is fully removed from both, leaving exactly one trailing `0x00` each, matching plan §3.5's corrected byte layout (28 bytes / 24 bytes).
- **First HKDF unchanged**: `push.ts:163-167` still builds `concatBytes(enc.encode("WebPush: info\0"), recipientKeyBytes, serverPublicKeyBytes)` — single `\0`, no extra byte, exactly as before and as the plan requires (§3.5: "Do not touch the first HKDF").
- `salt`, CEK length (128 bits), nonce length (96 bits), the `0x02` record delimiter (`push.ts:209`), and `buildPushBody` (`push.ts:224-231`) are all untouched, matching the plan's explicit "do not touch" list.
- `env.ts:13` comment updated to `// secret (raw base64url-encoded 32-byte P-256 scalar, web-push format — NOT PKCS8 DER)` — comment-only, matches plan §4 optional item.

No deviation from the plan found.

### 6. Locked-list check

```
git diff --stat HEAD -- src/worker/reminders/send.ts web/src/components/NotificationSetup.tsx
```
produced **no output** (both files untouched by the fix). Verified independently via `git show 53ab870 --stat`, which lists only: `src/worker/channels/push.ts`, `src/worker/env.ts`, `tests/unit/push-encrypt.test.ts`, `tests/unit/push-vapid.test.ts`, plus the four `docs/` files. No email channel, auth, data model, migration, or `wrangler.toml`-value changes. Locked list fully respected — no violation.

---

## B. Best-effort local scheduled-path exercise

Started `wrangler dev --test-scheduled` locally (build succeeded via `npm run build`; local D1 already migrated). Triggered `GET /__scheduled?cron=*/5+*+*+*+*`:

- **First run** (empty local DB): `[cron] materialize inserted=0 send={"sent":0,"failed":0,"transient":0}` — no data to exercise the push path.
- To exercise the crypto path specifically, I seeded a local-only `users` row, a `push_subscriptions` row with a **real** locally-generated P-256 uncompressed public point (`p256dh`, verified 65 bytes, `0x04`-prefixed) and a random 16-byte `auth` secret, and a due `reminder_dispatch` row (`channel='push'`, `fire_at` = 1 minute before trigger time, well within the 30-minute `GRACE_MINUTES` window), pointed at a deliberately unreachable fake endpoint (`https://example.invalid/...`).
- **Second run**: `[cron] materialize inserted=0 send={"sent":0,"failed":0,"transient":1}`. Full log inspected (`grep -n "push crypto error\|Invalid PKCS8"` → **zero matches**). One `Uncaught Error: internal error; reference = ...` line appeared, which is consistent with workerd's generic error for a `fetch()` to an unreachable/invalid host (`example.invalid` is intentionally undeliverable) — i.e. the **network** POST to the push service failed as expected, not the crypto step. `push.ts`'s catch blocks correctly distinguish these: a crypto exception logs `"push crypto error: ..."` and is never present in this log; a network `fetch` exception is caught separately (`push.ts:273-276`) and classified transient with no log line, matching the observed `transient:1` result with no crypto-error log.

This confirms, locally, that `signVapidJwt` (JWK import) and `encryptPayload` (HKDF fix) both executed successfully against real key material and a real (locally-generated) recipient public key without throwing — the previous `DataError: Invalid PKCS8 input` no longer occurs. As expected per the plan (§7 step 8), local delivery cannot be completed since there is no real push service reachable, and the local assertion is correctly "no crypto error," not "delivery completes." Local seed rows were cleaned up afterward and `wrangler dev` was stopped; no residual state left in the repo or local D1.

---

## C. Owner-verified, cannot be closed by local QA

The following remain explicitly the **owner's** manual step against the live deploy (this is expected and does not affect the verdict, per task instructions):

1. `npx wrangler tail` at a real `*/5` cron tick shows **no** `push crypto error` log line, and the `[cron] materialize ... send={...}` summary shows the push under `sent` (not `transient`/`failed`).
2. A real notification actually **appears** on a device — at minimum a desktop browser; an installed iPhone home-screen PWA is best-effort per the plan (this is the check that would catch a "201 Created but nothing decrypts" failure if the HKDF fix were somehow still wrong at the live push-service layer — the local round-trip test and the local scheduled-path exercise above are strong proxies but not a substitute for a real push-service round-trip).
3. Previously-stuck `transient` dispatch rows from the original 4:25 PM incident either send (if still inside the 30-minute `GRACE_MINUTES` window) or go inert/are not re-delivered (if aged out) — no infinite retry loop. Per plan §6.1 (traced and confirmed correct by the Plan-Reviewer, Pass 1 §6), aged-out rows are expected to remain as inert `pending` rows, not disappear — QA should not expect them to "clear."

---

## Issues found

None. No defects, no test-quality concerns, no locked-file violations.

## Console errors and warnings

N/A (no browser session for this backend fix). The only warnings observed were pre-existing Miniflare compatibility-date fallback warnings (`"2026-06-01"` requested → falls back to `"2024-12-30"`, the latest the installed Workers runtime version supports) during `npm test` and `wrangler dev` — unrelated to this fix, present on every test run regardless of `push.ts` changes, and not a regression.

## Network failures and slow responses

The one `fetch()` network failure observed during the best-effort local exercise (§B) was an intentional, expected failure against a deliberately unreachable `https://example.invalid/...` test endpoint used to isolate the crypto path from the delivery path — not a defect.

## Accessibility observations

N/A — no UI change in this fix (frontend `NotificationSetup.tsx` is explicitly out of scope and untouched, confirmed in §A.6).

## Performance notes

None applicable. `npm test` completed in ~1.3s for the full 36-test suite; no performance regression signal.

## Additional notes

- `npm run lint` fails with `ESLint couldn't find an eslint.config.(js|mjs|cjs) file` — confirmed this is a pre-existing, repo-wide condition (no `eslint.config.*` exists anywhere in the repo, and no prior commit ever added one) and unrelated to this fix; matches the impl-notes' own note that this is out of scope. Not counted against the verdict.

## Files referenced

- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/src/worker/channels/push.ts`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/src/worker/env.ts`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/tests/unit/push-vapid.test.ts`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/tests/unit/push-encrypt.test.ts`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/docs/plans/push-crypto-fix.md`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/docs/process/push-crypto-fix-impl-notes.md`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/docs/push-crypto-fix-brief.md`
- `/Users/juniorwarner/Projects/React/family-scheduler-pwa/docs/reviews/push-crypto-fix-review.md`

---

PASS
