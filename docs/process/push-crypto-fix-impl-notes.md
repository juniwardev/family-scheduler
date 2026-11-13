# Implementation Notes: `push-crypto-fix`

**Coder:** Claude Sonnet 5
**Date:** 2026-06-30
**Branch:** `feat/family-scheduler`
**Plan:** `docs/plans/push-crypto-fix.md` (APPROVE, Pass 2 — `docs/reviews/push-crypto-fix-review.md`)
**Brief:** `docs/push-crypto-fix-brief.md`

---

## What changed

### 1. `src/worker/channels/push.ts:62-107` — VAPID JWK import fix (root cause #1)

- Replaced `crypto.subtle.importKey("pkcs8", privateKeyBytes, ...)` (previously lines 77-84, operating on a raw 32-byte P-256 scalar and throwing `DataError: Invalid PKCS8 input`) with a JWK import:
  - `pubBytes = b64urlToBytes(env.VAPID_PUBLIC_KEY)` — 65-byte uncompressed point `0x04 || X(32) || Y(32)`.
  - Added a shape guard: `if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) throw new Error(...)` (logs shape only, never key material).
  - `x = bytesToB64url(pubBytes.slice(1, 33))`, `y = bytesToB64url(pubBytes.slice(33, 65))`.
  - `d = bytesToB64url(b64urlToBytes(env.VAPID_PRIVATE_KEY))` (normalized to unpadded base64url).
  - `crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y, d, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])`.
- Left `crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, sigInput)` and `bytesToB64url(new Uint8Array(sigBuf))` unchanged — no DER→JOSE conversion added (WebCrypto ECDSA already returns raw `r||s`).
- Rewrote the stale line-76 comment ("stored as base64url-encoded PKCS8 DER") to correctly document the raw JWK-source format.
- Changed `async function signVapidJwt` to `export async function signVapidJwt` for testability.

### 2. `src/worker/channels/push.ts:189, 198` — HKDF double-null fix (root cause #2)

- `cekInfo`: `concatBytes(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array(1))` → `enc.encode("Content-Encoding: aes128gcm\0")` (single trailing `0x00`, 28 bytes).
- `nonceInfo`: `concatBytes(enc.encode("Content-Encoding: nonce\0"), new Uint8Array(1))` → `enc.encode("Content-Encoding: nonce\0")` (single trailing `0x00`, 24 bytes).
- Did not touch the first HKDF at `push.ts:162-167` (`"WebPush: info\0" || recipientKey || serverKey`) — already correct, single null, matches RFC 8291 §3.4.
- Did not touch `salt`, key lengths (CEK 128 bits, nonce 96 bits), the `0x02` record delimiter, or `buildPushBody` framing.
- Changed `async function encryptPayload` → `export async function encryptPayload`, and `interface EncryptedPayload` → `export interface EncryptedPayload` for testability. `buildPushBody` was not exported — not needed by the test (the round-trip decrypts directly from `EncryptedPayload`'s `salt`/`serverPublicKeyBytes`/`ciphertext`, not the framed wire body).

### 3. `src/worker/env.ts:13` — comment-only

- `VAPID_PRIVATE_KEY: string; // secret (base64url-encoded ES256 private key)` → `// secret (raw base64url-encoded 32-byte P-256 scalar, web-push format — NOT PKCS8 DER)`. No behavior change.

### 4. New test: `tests/unit/push-vapid.test.ts`

- Hardcodes a locally generated **test-only** P-256 VAPID keypair (raw uncompressed 65-byte public point + raw 32-byte private scalar, base64url) — generated via Node's `crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })` and reshaped into the `web-push` raw format. Not the production secret.
- Test 1: asserts the fixture shapes are correct (65-byte point starting `0x04`, 32-byte scalar) — a sanity check on the test data itself, as the plan's §7 step 5 implies.
- Test 2: calls the now-exported `signVapidJwt(endpoint, env)` against a fake `Env`, asserts it does not throw, returns a 3-segment JWT, and that the decoded payload has the expected `aud` (endpoint origin) and a future `exp`.
- Test 3: verifies the signature for real — imports the public key via `importKey("raw", pubBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])` (mirroring the `k=` VAPID header contract) and calls `crypto.subtle.verify(...)`, asserting `true`.

### 5. New test: `tests/unit/push-encrypt.test.ts`

- Deterministic encrypt→decrypt round-trip, run under real workerd `crypto.subtle` (vitest-pool-workers).
- Generates a recipient ECDH keypair + random 16-byte auth secret, calls the now-exported `encryptPayload(...)`, then independently re-derives the shared secret / PRK / CEK / nonce on the "recipient" side per RFC 8291/8188, using **hardcoded** info strings (`"WebPush: info\0"`, `"Content-Encoding: aes128gcm\0"`, `"Content-Encoding: nonce\0"`) written directly in the test file — not imported from `push.ts` (per review note P2-2, to preserve the asymmetry as a genuine regression guard against a future refactor).
- Includes explicit byte-length/trailing-null assertions on the test's own `cekInfo`/`nonceInfo` (28 and 24 bytes respectively) as a sanity check against the plan's §3.5 corrected byte layout.
- AES-GCM decrypts the ciphertext, strips the `0x02` RFC 8188 record delimiter, and asserts the recovered JSON string matches the original payload.

---

## How I confirmed the root causes

- Read `src/worker/channels/push.ts` in full before editing (lines 62-93 VAPID, 149-208 encryption) and cross-checked every file:line claim in the plan and brief against the actual source — all matched exactly as described (the `importKey("pkcs8", ...)` call on a raw scalar; the double `new Uint8Array(1)` appended after an already-null-terminated string literal at both `cekInfo` and `nonceInfo`; the first HKDF at the time lines 149-153 already correct with a single null).
- Did not need further investigation beyond the plan — both reviewer passes (Pass 1 and Pass 2, APPROVE) had already independently verified the byte-level claims against source, and my own read of the pre-edit file confirmed the same lines.

## Regression-guard sanity check (double-null revert)

Per the plan's process step, before finalizing I temporarily reverted the `push.ts:189` and `push.ts:198` fix back to the buggy double-null form (`concatBytes(enc.encode(...), new Uint8Array(1))`) and re-ran `tests/unit/push-encrypt.test.ts` in isolation:

```
❯ tests/unit/push-encrypt.test.ts  (1 test | 1 failed) 13ms
  × ... round-trips: encrypt (production) -> decrypt (independently re-derived) recovers the plaintext
    → OperationError: Decryption failed. This could be due to a ciphertext
      authentication failure, bad padding, incorrect CryptoKey, or another
      algorithm-specific reason. Input length was 25, output length expected
      to be 25 for AES-GCM
```

This confirms the test is a genuine regression guard (fails against the bug, not a tautology). I then restored the fix (`cp` from a pre-check backup) and diffed against the backup to confirm byte-for-byte restoration — no residual diff. Re-ran the full suite afterward; all green.

## Test results

`npm run typecheck` — clean, no errors (both `tsconfig.worker.json` and `tsconfig.web.json`).

`npm test` (vitest, `@cloudflare/vitest-pool-workers` / real workerd `crypto.subtle`):

```
 ✓ tests/unit/push-encrypt.test.ts  (1 test)
 ✓ tests/unit/push-vapid.test.ts  (3 tests)
 ✓ tests/unit/recurrence.test.ts  (6 tests)
 ✓ tests/unit/routing.test.ts  (6 tests)
 ✓ tests/unit/auth-deactivated.test.ts  (6 tests)
 ✓ tests/unit/db.test.ts  (14 tests)

 Test Files  6 passed (6)
      Tests  36 passed (36)
```

All 4 new tests pass (1 in `push-encrypt.test.ts`, 3 in `push-vapid.test.ts`); all 32 pre-existing tests remain green (no regressions).

`npm run lint` — fails to run: `ESLint couldn't find an eslint.config.(js|mjs|cjs) file` (ESLint v9 flat-config gap). This is pre-existing per the task instructions and out of scope for this fix; not attempted.

## Locked-list confirmation

- `src/worker/reminders/send.ts` — **not touched**. `git diff --stat` shows no change to this file.
- `web/src/components/NotificationSetup.tsx` — **not touched**. `git diff --stat` shows no change to this file.
- Email channel, auth, data model, migrations, `wrangler.toml` — not touched.
- Decision D2 (WebCrypto VAPID + aes128gcm) unchanged as a design — both fixes are implementation-level byte/format corrections within D2, per plan §2/§8.

## What QA should verify against the live deploy (production done-condition)

This is done-condition #3 from the brief / Step 10 from the plan — a manual gate QA runs against the live deploy, not something the Coder can verify locally:

1. Deploy the fixed code.
2. Create an event with a reminder a few minutes out (with an active push subscription registered beforehand).
3. Run `npx wrangler tail` and watch the `*/5` cron tick fire:
   - Confirm **no** `push crypto error` log line.
   - Confirm the `[cron] materialize ... send={...}` summary shows the push under `sent` (not `transient` or `failed`).
4. Confirm an actual notification **appears** on at least a desktop browser (this is the check that would catch a "201 Created but nothing decrypts" failure if the encryption fix were somehow still wrong — the automated round-trip test is a strong proxy but the real push service round-trip is the final gate). Try an installed iPhone PWA too if feasible (best-effort per plan §6.3).
5. Confirm the previously-stuck `transient` dispatch rows from the original 4:25 PM incident either send (if still inside the 30-minute `GRACE_MINUTES` retry window) or are inert / not re-delivered (if aged out) — no permanent retry loop. Per plan §6.1, do NOT expect aged-out rows to disappear from the table; "inert, not re-delivered" is the correct expectation, not "cleared."

No `.approved` file was created and no deploy was performed by the Coder, per instructions.

---

## Deviations from the plan

None. Implemented exactly as specified in §3.2 (VAPID JWK shape), §3.3 (shape guard), §3.5 (HKDF byte layout — used the corrected `cekInfo` hex as given; ignored the P2-1 mis-transcribed `nonceInfo` reference hex per the task's explicit instruction to trust the string literal, which the plan's own code instruction already used correctly), and §7 (test construction, including P2-2's "hardcode infos independently, don't import from push.ts" guidance).

## Files changed

- `src/worker/channels/push.ts` — VAPID JWK import fix (~lines 62-107), HKDF double-null fix (lines 189, 198), exports added for testability (`signVapidJwt`, `encryptPayload`, `EncryptedPayload`).
- `src/worker/env.ts` — comment-only fix on line 13.
- `tests/unit/push-vapid.test.ts` — new, VAPID JWK import + sign + verify regression test.
- `tests/unit/push-encrypt.test.ts` — new, aes128gcm encrypt→decrypt round-trip regression test.
