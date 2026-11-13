# Plan Review: `fix/push-enable-persistence`

- **Reviewer:** Plan-Reviewer (adversarial)
- **Plan:** `docs/plans/push-enable-persistence.md`
- **Bug report:** `docs/bugs/push-enable-persistence.md`
- **Date:** 2026-07-11
- **Verdict:** **APPROVE-WITH-CHANGES**

The plan correctly identifies the root cause (UI-never-checks, hypothesis #2), the fix
direction matches the confirmed investigation, and it is genuinely frontend-only with no
Worker/apiClient/schema changes. The hooks-ordering restructure is sound. However there are
a few real correctness/robustness gaps and one factual inaccuracy in the plan's own
reasoning that should be folded in before implementation. None are rewrite-level.

---

## Verification of the plan's claims against the code

All structural claims check out against `web/src/components/NotificationSetup.tsx`:

- `const [subscribed, setSubscribed] = useState(false)` at **line 43** — confirmed.
- Enabled gate `permission === "granted" && subscribed` at **line 132** — confirmed.
- `setSubscribed(true)` only inside `subscribe()` (line 117) — confirmed.
- No existing `useEffect` — confirmed (`import React, { useState }` at line 3).
- iOS-not-standalone early return at **line 82**, push-unsupported early return at **line 86**
  — confirmed, both sit before where a `useEffect` could go.
- `db.ts` upsert `ON CONFLICT(endpoint) DO UPDATE` at **lines 892-899** — confirmed. Re-register
  is idempotent (keyed on `endpoint`); no Worker change needed. Claim is accurate.
- `registerSubscription({ endpoint, p256dh, auth, user_agent })` signature in `apiClient.ts`
  (lines 174-181) matches what the effect will call — confirmed.
- The `sub.toJSON()` / `keys as { p256dh; auth }` cast pattern the plan reuses exists verbatim
  at lines 106-108 — confirmed, so the typecheck expectation in step 4 is right.
- `vitest.workspace.ts` "web" project globs `web/**/*.test.tsx` and loads
  `tests/setup/jsdom.setup.ts` — confirmed. New test file placement is valid.
- `InstallBanner.test.tsx` / `ItemEditor.test.tsx` patterns (`vi.mock("../apiClient")` with
  `importActual`, `vi.unstubAllGlobals()` in `afterEach`, UA override via `Object.defineProperty`)
  — confirmed; the plan's test strategy mirrors real existing patterns.

The hooks-ordering resolution (Decision 1) is correct: an unconditional `useEffect` declared
above both early returns, with all conditionality inside the callback body, does not violate the
Rules of Hooks. No other hook sits below an early return, and the plan introduces no other
conditional hooks. This is the load-bearing design decision and it is right.

---

## Findings by severity

### Blocker
None.

### Major

**M1 — `navigator.serviceWorker.ready` can hang forever; the effect has no timeout and the
plan does not account for it.**
Ref: Plan §4.1/§4.2 (the `await navigator.serviceWorker.ready` step); code `web/src/main.tsx:6-18`.

`navigator.serviceWorker.ready` is a promise that **only resolves once a service worker becomes
active for the page**; it never rejects and never times out on its own. In `main.tsx`, SW
registration is deferred behind `window.addEventListener("load", ...)` and can fail
(`.catch` just warns). If the SW never activates (registration failed, private mode, first load
before `load` fires, or a Safari quirk), `await ...ready` **hangs indefinitely**. The effect's
outer try/catch does NOT help — a pending promise never throws. The `mounted` guard prevents a
bad `setState`, but the async closure and its captured scope leak until the promise settles
(effectively forever for that mount).

Consequences: not a crash, but (a) a dangling pending microtask/closure per mount, and
(b) on Safari specifically (the owner's repro platform) if `ready` is slow or never resolves,
the "enabled" state is never reflected — i.e. the fix silently does nothing and the bug appears
unfixed, with no error surfaced. Since the whole point is Safari persistence, this is Major.

Required change: race `navigator.serviceWorker.ready` against a timeout (e.g.
`Promise.race([navigator.serviceWorker.ready, timeout(N)])`), OR gate on
`navigator.serviceWorker.controller` / `getRegistration()` (which resolves to `undefined`
rather than hanging), before awaiting `.ready`. The plan should state the chosen approach and
its rationale, and a test case should cover "ready never resolves → no hang, button still shown".

**M2 — Silent swallow of the re-register failure violates the project's explicit-error-handling
preference and leaves zero observability.**
Ref: Plan §4.2 (empty `catch {}`), §4.5 (re-register precedence), global `CLAUDE.md`
("Prefer pure functions and explicit error handling").

The plan is correct that a failed re-register POST must NOT flip the UI. But swallowing it with a
bare `catch {}` and no log means a persistently-broken server row (e.g. the endpoint got wiped
server-side) is completely invisible — the exact "delivery silently stops" class of bug this
"defense-in-depth" step exists to prevent. The user's global rules mandate explicit error
handling. At minimum the two swallow sites (the re-register catch AND the outer
ready/getSubscription catch) should `console.warn` with context, not swallow silently. This is
cheap and materially improves debuggability of the very failure mode the step targets.

Required change: replace both bare `catch {}` blocks with `catch (err) { console.warn(...) }`
(match the `main.tsx:15` `console.warn("SW registration failed:", err)` style already in the
codebase). Update §4.5 and the checklist step 2 accordingly.

### Minor

**m1 — React 18 StrictMode double-invokes the effect; the plan does not mention it, and it
interacts with the un-guarded re-register POST.**
Ref: `web/src/main.tsx:23-26` renders `<React.StrictMode>`; Plan §4.3 ("effect never runs again").

In dev, StrictMode mounts → unmounts → remounts, running the effect **twice**. The `mounted`
flag correctly neutralizes the first run's `setState`, so UI is fine. But the best-effort
`registerSubscription` POST will fire on BOTH invocations (the first run's POST is already
in-flight past the `mounted` check by the time cleanup runs, and the second run fires its own).
This is harmless functionally (upsert is idempotent) but the plan's statement "the effect never
runs again (empty deps), so it cannot later stomp the click result" is imprecise for StrictMode,
and DC-c asserts `registerSubscription` is "called **once**" — that assertion may be flaky/
wrong under StrictMode if the test tree is wrapped in it. Recommend: (a) note StrictMode in §4.3,
(b) make DC-c assert "called with the right args" via `toHaveBeenCalledWith` rather than
"called exactly once", or explicitly render the test tree WITHOUT StrictMode and document that.

**m2 — Factual inaccuracy: the plan claims the component reads `Notification.permission` at
"module-eval time (line 41)"; it does not.**
Ref: Plan §7.1 ("the component reads `Notification.permission` at module-eval time (line 41)").

Line 40-41 reads `Notification.permission` inside the component function body during **render**,
already guarded by `typeof Notification !== "undefined"`. It is not module-eval, and it is
already null-safe. This weakens the stated justification for adding a **shared** `Notification`
stub to `jsdom.setup.ts` ("so other App-level trees mount without throwing") — the existing code
does not throw when `Notification` is absent. The shared stub is still reasonable to add (the
effect and tests need a settable `permission`), but the rationale in §7.1 is wrong and should be
corrected so the Coder/QA don't rely on a false premise. If jsdom already provides a
`Notification` global in this environment, the gated `if (typeof Notification === "undefined")`
stub is a no-op — verify empirically rather than asserting it is needed.

**m3 — Test gap: "permission granted but `getSubscription()` returns null" is documented as an
edge case (§4.4) but not given its own test case.**
Ref: Plan §4.4 (edge case), §7.2 (DC-b lumps "permission may be default OR granted").

DC-b says permission "may be `default` or even `granted`" with a null subscription, but a single
case won't exercise both. The `granted + null-sub → button shown` path is the more interesting
one (it's the "subscription genuinely dropped by the push service" case and the one most likely
to regress if someone later keys "enabled" off permission alone). Recommend an explicit case, or
parametrize DC-b over both permission values.

**m4 — Test rigor: the plan asserts DC-a "fails on pre-fix code" but the checklist only says to
sanity-check this mentally.**
Ref: Plan §7.2 DC-a, §9 step 7 ("confirm DC-a would fail against pre-fix code (sanity)").

For a bug-fix, the reproduction-confirmation step should be concrete. The Coder should actually
run DC-a against the current (pre-effect) component once to observe the failure, then add the
fix — not merely reason that it "would" fail. Recommend making step 7 an explicit
"run test against pre-fix code, observe RED, then implement, observe GREEN" instruction.

### Nit

**n1 — `getSubscription()` + `Notification.permission === 'granted'` is the right "enabled"
signal, but Safari caveats are unverified.**
Ref: Plan §4.4 / bug report Safari repro.

The plan assumes Safari resolves `serviceWorker.ready` and persists `pushManager` subscriptions
with the same semantics as Chrome. Safari's Web Push (16.4+, standalone PWA only) generally does
persist the subscription across launches, so the approach is sound in principle. But the plan
does not flag that this is an assumption tied to the exact platform in the repro. The manual
verification step (§7.3) does cover it end-to-end on Safari, which is the right mitigation —
just call out explicitly that DC-a (jsdom) proves the *logic* but only §7.3 proves *Safari
semantics*, so §7.3 is mandatory, not optional, for this fix.

**n2 — `PushManager in window` feature-check in the effect body may need the same test stub the
plan already added for `stubServiceWorker`.**
Ref: Plan §7.1 helper (`if (!("PushManager" in window)) window.PushManager = ...`).

The helper is present and correct; just ensure DC-e (feature-absent no-op) deletes/undefines
`serviceWorker` AND does not leave a `PushManager` stub from a prior test leaking across cases
(cleanup ordering). Minor test-hygiene note.

---

## Scope / regression assessment

Confirmed truly frontend-only. No changes to the maps-provider `<select>` /
`handleMapsProviderChange`, the `subscribe()` click path, `requestPermissionAndSubscribe()`, the
iOS/standalone early return, the push-unsupported message, `apiClient.ts`, or any Worker code.
The only shared surface is the `subscribed`/`permission` state (effect and click converge on the
same enabled values, and the effect never resets them — verified against lines 117-118 vs the
proposed setters). No scope creep detected. The three touched files (`NotificationSetup.tsx`,
new test, `jsdom.setup.ts`) are all necessary and minimal.

One coupling note: the shared `Notification` stub in `jsdom.setup.ts` is loaded by the ENTIRE
"web" project (App.test.tsx, App.deeplink.test.tsx, etc.). It must be gated
(`if typeof Notification === "undefined"`) and inert so it cannot alter behavior of unrelated
mounting tests. The plan says to gate it (step 5) — good — but see m2: verify it's even absent
in this jsdom before adding it.

---

## Required changes (must fold in before implementation)

1. **(M1)** Guard `navigator.serviceWorker.ready` against hanging — race it against a timeout,
   or use `getRegistration()`/`controller` which resolve rather than hang. Document the choice
   and add a test that "ready never resolves → no hang, Enable button still shown".
2. **(M2)** Replace both bare `catch {}` blocks (re-register failure AND outer
   ready/getSubscription failure) with `catch (err) { console.warn(...) }` per the project's
   explicit-error-handling rule and the existing `main.tsx` warn style. Update §4.5 and
   checklist step 2.
3. **(m1)** Account for React StrictMode double-invocation in §4.3, and change DC-c to assert
   `toHaveBeenCalledWith(...)` (or render without StrictMode) instead of "called exactly once".
4. **(m2)** Correct the §7.1 claim that `Notification.permission` is read at "module-eval time";
   it is read (already null-guarded) during render. Verify empirically whether jsdom already
   supplies `Notification` before asserting the shared stub is required.
5. **(m3)** Add an explicit test case (or parametrize DC-b) for
   `permission === "granted"` + `getSubscription() === null` → Enable button shown.
6. **(m4)** Make checklist step 7 a concrete "run DC-a against pre-fix code, observe failure,
   then implement" reproduction-confirmation step.

APPROVE-WITH-CHANGES

---

## Re-review (round 2)

- **Date:** 2026-07-11
- **Amended plan:** `docs/plans/push-enable-persistence.md` (see its §0 revision log)
- **Verdict:** **APPROVE** (ready for Coder)

Re-read `CLAUDE.md` (global + project) this pass. The hard rules that bear on this fix —
explicit error handling / `Result<T>` style, `email` from JWT only, cleanup pending dispatch
before FK cascade — are either satisfied (explicit-error-handling now met by the `console.warn`
amendments) or out of scope (no Worker/DB touch). No regression against those rules introduced.

### Per-item PASS/PARTIAL/FAIL table

| # | Round-1 item | Status | Evidence in amended plan |
| --- | --- | --- | --- |
| M1 | `serviceWorker.ready` hang | **PASS** | New §4.6 + `getSubscriptionSafely()` helper (plan 358-379): `getRegistration()` gate returns `null` on `undefined` without touching `.ready`; `Promise.race([ready, timeout→null])` with `READY_TIMEOUT_MS=3000`; timer cleared in `finally`. Every absence/timeout branch returns `null` → effect early-returns → Enable button stays. DC-f (plan 534-542) locks it. |
| M2 | Bare `catch {}` swallow | **PASS** | Both sites now `console.warn`: re-register catch (plan 207-212, `"push re-register on mount failed:"`) and outer catch (plan 214-217, `"push subscription check on mount failed:"`). §4.5 (301-309) and checklist step 2 (616-618) updated; neither flips UI out of enabled. DC-d (523-527) optionally spies `console.warn`. |
| m1 | StrictMode double-invoke | **PASS** | §4.2 StrictMode note (241-247) + §4.3 (258-262) acknowledge double-invoke; DC-c (514-521) now asserts `toHaveBeenCalledWith(...)`, explicitly "not call count". `mounted` flag neutralizes first-run `setState`; upsert makes double-POST harmless. |
| Factual (m2) | `Notification.permission` read timing | **PASS** | §7.1 (419-426) now says "read during render via the `useState` initializer, already null-guarded"; module-eval claim removed. §0 (27-29) logs the correction. Empirical-check-before-stub instruction added (424-426, checklist step 5). Matches code at `NotificationSetup.tsx:40-41`. |
| m3 | granted + null-sub test | **PASS** | DC-b2 added (plan 508-512): permission `granted` + `getSubscription()` → `null` ⇒ Enable button, not false "enabled". Cross-linked from §4.4 (285-288). |
| m4 | Concrete red-then-green | **PASS** | DC-a (494-501) and checklist step 7 (642-645) now require running DC-a against the pre-fix component to observe RED, then GREEN — "Do not treat this as a mental sanity check; actually run both states." |

**Result: 6/6 PASS.** (n1 also upgraded to mandatory in §7.3 (544-553); n2 test-hygiene note folded into §7.1 (488-490). Both nits addressed, though only advisory.)

### New-issue scan on the amendments

- **`getSubscriptionSafely()` correctness.** Reviewed the helper sketch (plan 363-378) line by
  line. `getRegistration()` resolves (`undefined` or a registration) rather than hanging —
  correct per spec. Timer is declared outside the race and cleared in `finally` on both the
  win-branch and the timeout-branch → **no timer leak**. The timeout promise resolves `null`
  (never rejects) → the graceful-degradation contract holds; a timeout is not conflated with a
  throw. `if (!reg || !("pushManager" in reg)) return null` correctly handles the timed-out
  (`null`) case and a registration lacking `pushManager`. No hang path remains: the only
  unbounded promise (`.ready`) is always raced against the timer. **No new correctness defect.**

- **"registration whose SW is still installing" (raised in the task).** If `getRegistration()`
  resolves a registration whose worker is only `installing`/`waiting` (not yet active),
  `.ready` will not resolve until activation. The helper does not hang on this — it is raced
  against `READY_TIMEOUT_MS` and degrades to the Enable button. On the next mount (after
  activation) it resolves. This is the correct, non-hanging degradation and is acceptable for a
  best-effort "reflect existing subscription" effect. Not a blocker; worth a one-line QA note.

- **Dangling `.ready` promise after the race resolves via timeout.** When the timeout wins,
  the still-pending `navigator.serviceWorker.ready` promise is abandoned. This is a benign,
  intrinsic property of `Promise.race` (JS has no promise cancellation) and the plan implicitly
  accepts it. It does not leak a timer and does not fire `setState` (guarded by `mounted` and by
  the early-return-on-`null`). Acceptable — matches the task's own "acceptable?" framing.

- **DC-a flakiness from the timeout race (raised in the task).** DC-a uses `stubServiceWorker`
  with a **resolved** `ready` (`Promise.resolve(reg)`), so `Promise.race` settles on the
  resolved branch effectively immediately — the 3000 ms timer never fires and is cleared in
  `finally`. DC-a does not use fake timers, so there is no advance-timer coordination needed and
  no race against wall-clock. **DC-a is deterministic, not flaky.** Fake timers are correctly
  scoped to DC-f only (plan 477-479), where `readyNeverResolves` forces the timeout branch. The
  stub separation (shared settable `Notification`; per-test `serviceWorker`/`getRegistration`/
  `ready`) is sound and matches the `InstallBanner.test.tsx` cleanup discipline
  (`vi.unstubAllGlobals()` + `vi.useRealTimers()` in `afterEach`, plan 639-641).

- **Scope creep check.** Still strictly frontend-only. §3 non-goals (88-99) unchanged; the
  amendment adds only the module-local `getSubscriptionSafely()` helper + `READY_TIMEOUT_MS`
  constant inside `NotificationSetup.tsx`. No Worker, `apiClient.ts`, `main.tsx`, config, click
  path, or maps-control change. Affected-files table (392-394) and "not changed" list (396-398)
  still hold. **No scope creep introduced by the amendment.**

- **DC set sufficiency.** DC-a (enabled-on-mount, red→green), DC-b (default+null → button),
  DC-b2 (granted+null → button), DC-c (POST args), DC-d (POST-failure still enabled + warn),
  DC-e (feature-absent no-op), DC-f (ready-never-resolves → no hang). This covers every branch
  of the §4.1 flowchart and both M1 sub-paths (`getRegistration()`→undefined short-circuit and
  `.ready` timeout). Sufficient and, per the timer analysis above, non-flaky.

### New findings

None at Blocker/Major/Minor. Two advisory notes only:

- **(advisory)** DC-f's "companion assertion" for the `getRegistration()`→`undefined`
  short-circuit (plan 541-542) is described as optional ("or a second variant"). Since that is
  the single most common real-world branch (no active SW yet on first paint), the Coder should
  make it a concrete assertion rather than skip it. Not a blocker — DC-e already exercises a
  no-SW path — but cheap insurance.
- **(advisory)** Add a one-line QA note that on a still-installing SW the enabled view may only
  appear on the *next* launch (see installing-SW analysis above), so QA does not file a false
  regression if the very first post-enable relaunch still shows the button transiently.

### Verdict

**APPROVE — ready for Coder.** All six round-1 items resolved (6/6 PASS), both nits addressed,
and the M1 mitigation (`getSubscriptionSafely()` + `READY_TIMEOUT_MS`) is correct, hang-proof,
and leak-free with no new correctness or flakiness defect introduced. The two advisory notes are
optional hardening, not gates.
