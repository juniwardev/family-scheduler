# Plan Review: `push-crypto-fix`

Reviewer: Plan-Reviewer (adversarial, read-only on app code)
Plan under review: `docs/plans/push-crypto-fix.md`
Brief (source of truth): `docs/push-crypto-fix-brief.md`
Owner ratified decisions applied: (1) `send.ts` classification LOCKED; (2) frontend `getSubscription()` re-prompt fix DEFERRED / OUT OF SCOPE.

## Summary

The core diagnosis and the chosen VAPID fix are **correct and well-specified**. File:line evidence in the plan is accurate. The JWK import shape is right, the "no DER→JOSE conversion" claim is correct for WebCrypto, and the locked-engine reasoning checks out. Two issues keep this from a clean approve: (a) the plan keeps the frontend change as in-scope-optional, which contradicts ratified decision #2; and (b) the plan under-tests the encryption path that — by its own admission — is executing end-to-end for the first time, while dismissing it as "not affected." There is concrete code-level evidence that a *second* latent bug may exist in `encryptPayload`, which would make the production done-condition fail on first deploy with no automated test to catch it.

---

## 1. Root-cause correctness — CONFIRMED (no finding)

Verified against `src/worker/channels/push.ts:76-84`:

- Line 76 comment ("stored as base64url-encoded PKCS8 DER") is wrong; line 77 does `b64urlToBytes(env.VAPID_PRIVATE_KEY)` and line 78-84 calls `importKey("pkcs8", privateKeyBytes, …)`.
- `wrangler.toml:22` `VAPID_PUBLIC_KEY` is 87 base64url chars → 65 bytes. The leading `B`+`K` decodes to `0x04…` (base64 index 1 = `000001`, plus top 2 bits of `K`=`00` → `0x04`), i.e. the canonical `0x04 || X || Y` uncompressed point. The plan's byte-level claim is exact.
- `src/worker/env.ts:13` comments the private key as a raw base64url ES256 scalar.

The diagnosis is sound: a bare 32-byte scalar passed to `importKey("pkcs8", …)` throws `DataError: Invalid PKCS8 input`. The decode helper `b64urlToBytes` is not the bug. Agreed.

## 2. The chosen fix (JWK import) — CORRECT (no finding)

- `x = pubBytes.slice(1,33)`, `y = pubBytes.slice(33,65)`, `d` = private scalar: correct splitting of `0x04||X||Y`.
- `bytesToB64url` (`push.ts:41-45`) strips `=` padding, so JWK fields are unpadded base64url as required. Correct.
- Re-normalizing `d` via `bytesToB64url(b64urlToBytes(env.VAPID_PRIVATE_KEY))` is a reasonable defensive choice.
- **No DER→JOSE conversion is correct.** WebCrypto ECDSA `sign` returns raw `r||s` (IEEE P1363 / JOSE), unlike Node's DER output. The existing `bytesToB64url(new Uint8Array(sigBuf))` at `push.ts:92` is already right, and the `Authorization: vapid t=…,k=${env.VAPID_PUBLIC_KEY}` header at `push.ts:254` correctly publishes the raw public key.
- `ext: true` in the JWK with `extractable=false` in the import call is allowed by the WebCrypto spec (a `true` JWK `ext` may be imported as non-extractable). Not a problem.

**Nit (2a):** sourcing `x`/`y` from `VAPID_PUBLIC_KEY` couples correct signing to BOTH env vars being a *matched* pair. The §3.3 shape guard validates the public point's shape but not that it corresponds to `d`. WebCrypto's EC JWK import will typically validate the point-vs-scalar consistency at runtime (and the cron's try/catch would re-report a mismatch as `push crypto error`), so this is acceptable — but worth a one-line comment that the two secrets must be rotated as a pair.

## 3. Blast radius / completeness — DIAGNOSIS RIGHT, MITIGATION THIN (Major 3a)

Confirmed: `signVapidJwt` runs at `push.ts:236` *before* `encryptPayload` at `push.ts:237`, so encryption has never executed against a real push service. `encryptPayload` uses `importKey("raw", recipientKeyBytes, {name:"ECDH"…})` at `push.ts:115-121` and does **not** share the `pkcs8` call. The plan's claim that "no second instance of *this same bug* exists" is accurate and carefully worded.

**But the plan conflates "doesn't share the pkcs8 bug" with "is correct."** The done-condition is a real delivered notification, which requires `encryptPayload` to be RFC-8291-correct — and that path has zero automated coverage and has never run end-to-end. Inspecting it adversarially surfaces a concrete red flag:

- `push.ts:175`: `cekInfo = concatBytes(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array(1))`
- `push.ts:184`: `nonceInfo = concatBytes(enc.encode("Content-Encoding: nonce\0"), new Uint8Array(1))`

`"…aes128gcm\0"` already encodes one `0x00`; concatenating `new Uint8Array(1)` appends a **second** `0x00`. RFC 8188 `cek_info` is `"Content-Encoding: aes128gcm" || 0x00` (a single null), after which WebCrypto's HKDF-Expand appends the `0x01` counter itself. This looks like a one-byte-too-many `info`, which would derive the wrong CEK/nonce and produce ciphertext the browser cannot decrypt — i.e. the push service may return 201 but **no notification ever shows**. I cannot execute the code to prove it from this seat, but it is exactly the kind of second bug the brief warned about ("push has two crypto ops … verify end-to-end delivery, not just that `importKey` stops throwing").

Consequence: the plan's only gate for this path is a single manual production device check (Step 9). If the encryption bug is real, the team burns a deploy + cron-tick + device cycle to discover something a deterministic unit test would have caught in seconds. The plan should not lean entirely on a manual gate for a path it admits is running for the first time. (See Required Change 2 — this does not ask the Coder to *fix* encryption blindly; it asks for an automated round-trip/known-vector test so any such bug is found before the manual gate, and triaged as a follow-up per §6.3 if confirmed.)

## 4. Test adequacy — GOOD for VAPID, GAP for encryption (Minor 4a)

- The new `tests/unit/push-vapid.test.ts` matches the `include: ["tests/**/*.test.ts"]` glob in `vitest.config.ts`, which uses `defineWorkersConfig` (workerd / real `crypto.subtle`). So the regression test runs against genuine WebCrypto, not a mock — this is exactly the gap that let the bug ship, and the test WOULD have failed on the old `pkcs8` path. Good.
- Verifying the JWT signature with the imported public key is sufficient positive coverage for the VAPID fix.

**Minor (4a):** the verify step imports the public key as JWK from the *test* keypair's own `x`/`y`. A stronger test imports the public key via `importKey("raw", <65-byte 0x04||X||Y>, …)` — mirroring the `k=` server contract — so the test proves the signature validates against the *published* public point, not just an internally-consistent JWK. Cheap hardening; recommend it.

**Minor (4b):** no automated coverage for `encryptPayload`/`buildPushBody` at all (ties to 3a). Recommend at least a structural/no-throw test, ideally a decrypt round-trip or a known RFC-8291 vector.

## 5. Locked-list respect — CORE OK, ONE SCOPE VIOLATION (Major 5a)

- `send.ts` is correctly left untouched; the plan never proposes editing its classification. Good — consistent with ratified decision #1.
- email channel, auth, data model, migrations, `wrangler.toml` values: untouched. Good.
- `env.ts:13` comment-only change is harmless (env.ts is not on the locked list).
- Exporting `signVapidJwt` for testability is acceptable; it exposes no key material.

**Major (5a) — scope/governance:** ratified decision #2 says the frontend `getSubscription()` re-prompt fix is DEFERRED and OUT OF SCOPE, and the plan "may mention it only as a deferred follow-up, **not as in-scope work**." The plan violates this: `web/src/components/NotificationSetup.tsx` is listed in the §4 affected-files table, and Step 7 invites the Coder to implement it inline ("Do it in this change only if it stays ~10 lines and clean"). §6.2 even hands the Coder a hooks-ordering implementation recipe. This is in-scope-optional, not deferred-only, and it adds real regression surface (the early returns at `NotificationSetup.tsx:37,41` make a hooks insertion error-prone). It must be cut to a one-line deferred note.

## 6. Retry-backlog reasoning — CORRECT (no finding)

Traced through the code and confirmed:

- `push.ts:238-243`: crypto failure returns `{statusCode:0, transient:true}`.
- `send.ts:103-110`: `statusCode:0` is not in `[400,500)`, so it hits the `else` → `anyTransient=true`; `send.ts:121-130` then leaves the row pending (`summary.transient++`). The plan's observation that the engine keys off `statusCode`, not the `transient` boolean, is accurate (the flag is effectively dead).
- `db.ts:978-988` `getDueDispatch` selects `fire_at <= now AND fire_at > now - GRACE_MINUTES*60000` with `GRACE_MINUTES = 30` (`config.ts:9`). So a deterministic failure retries only within a 30-minute window, then ages out to inert `pending`. No infinite loop. Correct, and the recommendation to leave classification alone is the right call given the lock.

**Nit (6a):** "the stuck rows will clear cleanly" is slightly generous — aged-out rows are never re-selected but remain in the table as orphaned `pending` rows forever, and the original 4:25 PM reminders are simply lost (their fire time has passed). That is acceptable for a defect fix, but the plan should say "go inert (and are not re-delivered)" rather than "clear cleanly," so QA's done-condition #4 check isn't looking for them to disappear.

## 7. Done-conditions — PRODUCTION GATE CONCRETE, LOCAL GATE VAGUE (Minor 7a)

- Production (Step 9): deploy → reminder a few minutes out → `wrangler tail` at cron tick → assert no `push crypto error`, push under `sent`, real desktop notification. Concrete and checkable. Good. (Its reliability depends on encryption being correct — see 3a.)
- **Minor (7a):** Step 6 "trigger the scheduled handler" gives no command. `wrangler dev` does not fire crons automatically; specify the mechanism (e.g. the `/__scheduled?cron=*/5+*+*+*+*` test endpoint or `wrangler dev --test-scheduled`) so the local gate is actually runnable. Also note the local fetch will hit the real FCM endpoint for any real subscription, so "no crypto error" (not "delivery completes") is correctly the right local assertion — keep that framing.

---

## Alternatives the architect did not flag

- **Derive `x`/`y` from `d` via scalar multiplication** instead of reading `VAPID_PUBLIC_KEY`, which would remove the matched-pair coupling (2a). Correctly not chosen — it needs EC point math and is more brittle than reusing the stored point. Worth a one-line mention of why.
- **A decrypt round-trip vector test for `encryptPayload`** (using a locally generated recipient keypair) as the automated proxy for the manual delivery gate. Not considered; directly addresses 3a/4b.

## Required changes (fold in before implementation)

1. Remove `web/src/components/NotificationSetup.tsx` from the §4 affected-files table and from Step 7. Downgrade §6.2 to a one-line "deferred follow-up — do NOT implement in this change" note, per ratified decision #2. (Major 5a)
2. Add deterministic automated coverage for the encryption path (`encryptPayload`/`buildPushBody`) — a decrypt round-trip or known RFC-8291 vector — so the first-time-executed path is validated before the single manual production gate. If that test surfaces a real bug (e.g. the suspected double-`0x00` HKDF `info` at `push.ts:175,184`), triage it as a follow-up per §6.3 rather than expanding this fix's scope, but do not ship the "real notification delivered" done-condition resting solely on a manual device check. (Major 3a / Minor 4b)
3. In the §1 / §3.4 wording, stop implying the encryption path is "not affected"/correct; state precisely that it does not share the `pkcs8` bug but is unverified end-to-end and is covered by change #2. (Major 3a)
4. Specify the exact local cron-trigger command in Step 6 (e.g. `/__scheduled` endpoint). (Minor 7a)
5. (Recommended) Have `push-vapid.test.ts` verify the signature against the public key imported via `"raw"` from the 65-byte `VAPID_PUBLIC_KEY`, mirroring the `k=` contract. (Minor 4a)
6. (Recommended) Reword §6.1 done-condition #4 framing from "clear cleanly" to "go inert / are not re-delivered." (Nit 6a)

The VAPID fix itself (items in §3.2/§3.3) is correct and may proceed as written.

APPROVE WITH CHANGES

---

## Re-review (Pass 2)

Reviewer: Plan-Reviewer (adversarial, read-only on app code)
Plan revision reviewed: amended `docs/plans/push-crypto-fix.md` with §9 "Amendment log" (2026-06-30).
Purpose: verify the two Pass-1 Majors (5a scope, 3a encryption) are genuinely resolved and no regression / new gap was introduced.

### Verdict on the two Majors

**Major 5a (frontend scope) — RESOLVED.** Verified there is no lingering in-scope reference to `NotificationSetup.tsx`:
- §2 non-goals (line 75): "No frontend change. … The Coder must not touch `web/src/components/NotificationSetup.tsx`."
- §4 affected-files table no longer lists the component; it is under "Explicitly NOT touched" (line 193).
- The former Step 7 that invited inline implementation is gone; the step list (§7) contains no frontend step, and the §7 preamble (line 245) re-states "Do NOT touch `web/src/components/NotificationSetup.tsx`."
- §6.2 (lines 227-231) is now titled "Deferred follow-up (NOT in this change)" with an explicit "do NOT implement" and the hooks-ordering recipe reduced to a risk note (why it is isolated), not an implementation guide.
- §9 amendment log records the removal.
Every remaining mention is deferral/rationale only. No in-scope leakage. Owner decision #2 holds.

**Major 3a (encryption HKDF double-null) — RESOLVED, and I independently confirm the bug is real.** Verified byte-for-byte against the actual code:
- `push.ts:175` (read from source): `const cekInfo = concatBytes(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array(1));`. The string literal ends in `\0` (one `0x00`); `new Uint8Array(1)` is a zero-initialized 1-byte array (a second `0x00`). True double-null. **Confirmed, not refuted.**
- `push.ts:184` (read from source): `const nonceInfo = concatBytes(enc.encode("Content-Encoding: nonce\0"), new Uint8Array(1));`. Same double-null. **Confirmed.**
- RFC 8188 §2.2 requires `cek_info = "Content-Encoding: aes128gcm" || 0x00` and `nonce_info = "Content-Encoding: nonce" || 0x00` — a single trailing null. WebCrypto `HKDF deriveBits` performs HKDF-Expand and appends the `0x01` block counter itself (RFC 5869); the caller supplies only the info context. So the correct info ends in exactly one `0x00`, and the current code passes two. Wrong CEK and wrong nonce → AES-GCM output the browser cannot decrypt → push service returns 201 but no notification renders. The plan's failure-mode narrative is accurate.
- The plan's corrected instruction (§3.5 lines 159/168; Step 3 lines 257-258) replaces both with `enc.encode("Content-Encoding: aes128gcm\0")` and `enc.encode("Content-Encoding: nonce\0")` — a single trailing `0x00` each. Correct.
- "First HKDF is already correct and unchanged" claim: verified. `push.ts:149-153` builds `enc.encode("WebPush: info\0") || recipientKeyBytes || serverPublicKeyBytes` with a single `\0` and no trailing `new Uint8Array(1)`. That matches RFC 8291 §3.4 `key_info = "WebPush: info" || 0x00 || ua_public || as_public`, and the surrounding extract (`salt = authBytes`, IKM = shared secret, 256-bit output) matches the RFC. The plan correctly leaves it untouched. This asymmetry (149-153 single-null vs 175/184 double-null) corroborates the "copy error" diagnosis.
- Off-by-one check: `cekInfo`/`nonceInfo` are consumed only as the `info` arg to `deriveBits`. Nothing reads their `.length` or otherwise depends on the old (wrong) length. `concatBytes` remains used at 149, 195, 216, so removing its use at 175/184 leaves no dead code and no other caller affected. Removing `new Uint8Array(1)` fully resolves the defect with no side effects. CEK 128 bits / nonce 96 bits and the `0x02` record delimiter (line 195) are untouched and correct.

Both Pass-1 Majors are genuinely resolved. Nothing introduced by the amendment rises to Major.

### One transcription defect in the reference hex — Minor (new)

**Minor (P2-1):** §3.5's "exact corrected byte layout" for `nonceInfo` (plan line 176) is transcribed wrong. It reads `43 6F 6E 74 65 6E 74 2D 45 6E 63 6F 64 69 6E 67 3A 20 6F 6E 63 65 00` — after `3A 20` (": ") the bytes `6F 6E 63 65 00` decode to **"once\0"** (23 bytes total), i.e. the leading `6E` ("n") of "nonce" is missing. The correct layout for `"Content-Encoding: nonce\0"` is 24 bytes: `43 6F 6E 74 65 6E 74 2D 45 6E 63 6F 64 69 6E 67 3A 20 6E 6F 6E 63 65 00`. The adjacent prose ("23 ASCII bytes … followed by a single `0x00`") and the operative code instruction (`enc.encode("Content-Encoding: nonce\0")`) are both correct, so a Coder following the string literal produces correct bytes — but a QA reviewer hand-verifying against this hex reference would be misled on a byte-precise crypto fix. The `cekInfo` hex on line 174 was checked and is correct (28 bytes, decodes to `"Content-Encoding: aes128gcm\0"`). Fix the `nonceInfo` hex to include the missing `6E`. This is documentation-only and does not block implementation.

### New encryption test (`tests/unit/push-encrypt.test.ts`) — adequate

- **Round-trip vs fixed vector:** the plan's reasoning (Step 6 line 277) is sound. `encryptPayload` mints the ephemeral AS keypair via `crypto.subtle.generateKey` (confirmed at `push.ts:124-128`), so salt and server public key differ every run and a fixed RFC 8291 §5 known-answer vector cannot match without changing the production signature to inject the ephemeral key. Injecting a key purely for testing would add production surface for no delivery benefit. A self-consistent encrypt→decrypt round-trip is the right choice here. (A fixed vector would give slightly stronger assurance that the whole scheme — not just internal self-consistency — matches the RFC, but that is a nice-to-have, not a blocker; the real RFC conformance gate remains the production device check in Step 10.)
- **Does the round-trip actually prove the fix, or could a symmetric bug pass falsely?** The asymmetry is what makes it meaningful, and it is clearly specified: Step 6 (line 275) requires the test's decrypt side to re-derive with the **correct single-`0x00`** infos, and line 277 records the rationale ("it will FAIL against the buggy double-null encrypt and PASS once fix #2 is applied"). Because encrypt (production) and decrypt (test) derive CEK/nonce from independently-written info strings, a double-null on the encrypt side yields a different CEK/nonce than the single-null decrypt side, the AES-GCM auth tag check fails, and the test fails. So the test is a genuine regression guard, not a tautology.
  - **Nit (P2-2):** to preserve that asymmetry, the test must construct its info bytes independently and must NOT import or reuse any info-building helper from `push.ts`. Today this is safe because the info construction at `push.ts:175/184` is inline and unexported, but the plan should state explicitly "hardcode the RFC infos in the test; do not import them from `push.ts`" so a future refactor that exports a shared `cekInfo` helper can't silently turn the round-trip into a symmetric no-op. Optional but cheap.
- **VAPID regression test still specified and hardened:** Step 5 (lines 264-269) retains `tests/unit/push-vapid.test.ts` with real crypto, and now folds in Pass-1 Minor 4a — it verifies the signature against the public key imported via `importKey("raw", <65-byte 0x04||X||Y>, …)`, mirroring the `k=` contract. Adequate.

### Scope / regression check on the amendment

- Files touched remain `src/worker/channels/push.ts` (the file under fix), the comment-only `src/worker/env.ts:13`, and two new test files. `src/worker/reminders/send.ts` is explicitly left untouched (§2 line 71, §4 line 193, §7 line 245) — owner decision #1 holds; the transient/failed classification is not modified. No email, auth, data-model, migration, or `wrangler.toml`-value changes.
- The amendment expands the `push.ts` edit to include the two-line HKDF fix. This is **not** scope creep: the brief's done-condition is a delivered notification ("a notification actually appears"), and the brief explicitly warned "push has two crypto ops … verify end-to-end delivery." The double-null fix is necessary to meet the stated goal and stays within Decision D2's implementation (RFC 8291 unchanged). In-scope.
- Exporting `signVapidJwt`, `encryptPayload`, and (if needed) `buildPushBody` for testability exposes no key material and changes no runtime behavior. Acceptable.

### Pass-1 confirmed items — preserved, not degraded

- VAPID JWK import shape (§3.2): unchanged and still correct (`x`=slice(1,33), `y`=slice(33,65), normalized `d`, `ext:true`, non-extractable).
- Root cause at `push.ts:77-84` (§1): preserved with accurate file:line.
- base64url handling (`b64urlToBytes`/`bytesToB64url`): unchanged, correct.
- No DER→JOSE conversion (§3.2 line 118): preserved.
- Retry-backlog reasoning (§6.1): preserved; Nit 6a folded in — now reads "go inert (and are **not** re-delivered)" rather than "clear cleanly."
- Local cron-trigger command (Minor 7a): folded — Step 8 (line 281) now names `/__scheduled` / `wrangler dev --test-scheduled` and keeps the correct "no crypto error, not delivery-completes" local assertion.
- Done-conditions (Step 10): concrete and preserved — local `wrangler dev` scheduled trigger, production `wrangler tail` at the cron tick asserting no `push crypto error` and push under `sent`, and a real notification appearing on a device (the gate that catches a 201-but-nothing-shows decrypt failure).

### Remaining findings (all sub-Major; none blocks implementation)

- Minor (P2-1): correct the `nonceInfo` reference hex in §3.5 (missing `6E`; should be 24 bytes decoding to `"Content-Encoding: nonce\0"`). Code instruction is already correct.
- Nit (P2-2): instruct the encryption test to hardcode the RFC infos independently and not import any info helper from `push.ts`, to keep the round-trip's asymmetry future-proof.

Both Pass-1 Majors are genuinely resolved and nothing introduced by the amendment is Major. Per the review rubric this clears to approve; the two items above are recommended, non-blocking cleanups (the operative code instructions and string literals in the plan are correct as written).

APPROVE
