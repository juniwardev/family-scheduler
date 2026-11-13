# Plan: fix/push-enable-persistence — persist "Push notifications enabled" across page loads

- **Slug:** `push-enable-persistence`
- **Type:** Bug fix (frontend only)
- **Bug report:** `docs/bugs/push-enable-persistence.md` (Phase 1 root-cause complete; treated as authoritative)
- **Scope owner:** frontend, `web/src/components/NotificationSetup.tsx` + tests only

---

## 0. Revision log (amended per Plan-Reviewer)

This plan was revised in place after `docs/reviews/push-enable-persistence-review.md`
(verdict: APPROVE-WITH-CHANGES). Changes folded in:

- **(M1) `navigator.serviceWorker.ready` hang.** Added §4.6 specifying the mitigation:
  gate on `navigator.serviceWorker.getRegistration()` first (resolves to `undefined` instead
  of hanging), then await `.ready` **raced against a short timeout** that resolves to `null`.
  Effect degrades gracefully to "no-op, Enable button still shown" if no active SW arrives in
  time. New test case **DC-f** covers the "ready never resolves → no hang" path. §4.1 flowchart
  and checklist step 2 updated.
- **(M2) Bare `catch {}` → `console.warn`.** Both swallow sites (re-register POST and the outer
  ready/getSubscription failure) now `console.warn(...)` in the `main.tsx` style. The UI must
  still NOT flip out of "enabled". Updated §4.2 sketch, §4.5, and checklist step 2.
- **(m1) StrictMode double-invoke.** Added note in §4.3; **DC-c** changed from "called exactly
  once" to `toHaveBeenCalledWith(...)` so it is not brittle under StrictMode.
- **(m2) Factual correction.** §7.1 no longer claims `Notification.permission` is read at
  "module-eval time"; corrected to "read during render via the `useState` initializer, already
  null-guarded". Added an empirical-check instruction before adding the shared stub.
- **(m3) Missing test case.** Added **DC-b2**: permission `granted` + `getSubscription()` → `null`
  ⇒ Enable button shown (not a false "enabled").
- **(m4) Concrete red-then-green.** §7.2 DC-a and checklist step 7 now require running DC-a
  against the pre-fix component to observe RED, then implementing to observe GREEN.
- **(n1) Safari semantics.** §7.3 restated as **mandatory** (not optional) — DC-a proves the
  logic; only §7.3 proves Safari persistence semantics.

---

## 1. Root cause (from the confirmed investigation)

`NotificationSetup.tsx` derives its "enabled" view from local React state that resets on every
mount:

- `const [subscribed, setSubscribed] = useState(false);` (line 43) always initializes to `false`.
- The enabled view renders only when `permission === "granted" && subscribed` (line 132).
- `setSubscribed(true)` is called **only** inside `subscribe()` (line 117), which runs **only** on
  the button click path.
- The component has **no `useEffect`** — nothing ever inspects `pushManager.getSubscription()` on
  mount.

So after a reload the browser still reports `Notification.permission === "granted"` and still holds
the push subscription (it persists with the service-worker registration), but the component's
`subscribed` flag is back to `false`. The gate `"granted" && false` is false, so the component
falls through to the "Enable Push Notifications" button. **The subscription is not lost — the UI
just never looks for it.**

This confirms backlog hypothesis #2 (present-but-UI-never-checks). No server-side defect;
push *delivery* is confirmed working on device.

---

## 2. Problem statement and goals

**Problem:** A user who has already enabled push is shown the "Enable Push Notifications" button on
every subsequent load, with no indication push is on. They re-click needlessly and cannot tell push
is active.

**Goals:**

1. On mount, detect an existing push subscription and reflect the "Push notifications enabled." view
   without any user interaction, when the browser both holds a subscription and reports permission
   `"granted"`.
2. When no subscription is found, keep showing the "Enable Push Notifications" button (this also
   correctly handles the genuinely-lost / cleared-site-data case).
3. Defense-in-depth: when an existing subscription is found on mount, idempotently re-POST it to the
   server (`registerSubscription`) so the server row is guaranteed present. This is best-effort
   hardening, **not** a gate on the UI state (see Decision 4).
4. No regression to the just-shipped notifications feature: the click-to-enable path, the
   iOS/standalone gate, the push-unsupported message, and the maps-provider control all behave
   exactly as before.
5. **The detection must never hang or throw.** If no active service worker is available in a short
   window, the effect must degrade to a no-op (leave the Enable button showing) — see Decision 5
   (§4.6). This is the M1 mitigation.

---

## 3. Non-goals

- **No Worker/server changes.** The `/api/subscriptions` endpoint is already idempotent —
  `db.ts:892-899` is `INSERT ... ON CONFLICT(endpoint) DO UPDATE`, an upsert keyed on `endpoint`,
  so re-POSTing the same subscription creates no duplicate rows. Confirmed by direct read.
- **No change to the maps-provider `<select>` control** or its `handleMapsProviderChange` handler.
- **No change to the `subscribe()` click path** or `requestPermissionAndSubscribe()` behavior
  (other than that hooks now run before the early returns — see Decision 1).
- **No change to the iOS/standalone gating decision or the push-unsupported message.** Their
  *placement* moves after the new hook declaration, but their *behavior* is identical.
- **No change to `main.tsx` SW-registration code.** The M1 fix is contained entirely in the new
  effect; we do NOT change how/when `sw.js` is registered.
- Not adding a "disable / unsubscribe" affordance. Out of scope.
- Not changing `apiClient.ts` — `registerSubscription()` and `getVapidPublicKey()` are used as-is.

---

## 4. Proposed design

### 4.1 Overview

Add a single `useEffect` that runs once on mount. Its body feature-detects the push APIs, resolves
the service-worker registration **without hanging** (Decision 5, §4.6), reads the current
subscription, and — if a subscription exists **and** `Notification.permission === "granted"` — sets
both `permission` and `subscribed` so the existing render gate at line 132 produces the enabled
view. If a subscription is found it also best-effort re-registers it with the server.

```mermaid
flowchart TD
    M[Component mounts] --> H[useEffect runs once]
    H --> FD{serviceWorker + PushManager + Notification present?}
    FD -- no --> NOOP[no-op: state stays default -> button/unsupported path]
    FD -- yes --> REG["await getRegistration() (resolves, never hangs)"]
    REG --> R2{registration present?}
    R2 -- no --> KEEP2[no active SW -> leave state -> Enable button shown]
    R2 -- yes --> READY["await Promise.race(reg.ready-ish, timeout->null)"]
    READY --> TO{timed out / null?}
    TO -- yes --> KEEP3[warn + leave state -> Enable button shown]
    TO -- no --> GS[reg.pushManager.getSubscription]
    GS --> Q{sub != null AND Notification.permission === granted?}
    Q -- no --> KEEP[leave state as-is -> Enable button shown]
    Q -- yes --> SET[if still mounted: setSubscribed(true) + setPermission(granted)]
    SET --> RR[best-effort registerSubscription(sub.toJSON)]
    RR -- resolves --> DONE[enabled view]
    RR -- rejects --> WARN[console.warn; UI stays enabled]
    WARN --> DONE
```

### 4.2 Decision 1 — React-hooks ordering vs the early returns (the critical restructure)

**Constraint:** Rules of Hooks require every hook to run on every render, in the same order. The
component today early-returns **before** any place a `useEffect` could sit:

- line 82: iOS-not-standalone early return
- line 86: push-unsupported early return

If we naïvely add the effect after those returns, it would be a conditionally-called hook — a Rules
of Hooks violation.

**Resolution: declare the effect at the top level, before the early returns, and guard the effect
BODY (not the hook call).** The `useEffect` call is unconditional; all conditionality lives inside
the callback, which feature-detects and bails early. This preserves hook order across every render
regardless of which early return fires.

Intended top-of-component structure (all existing `useState` hooks stay where they are; the new
`useEffect` is inserted immediately after them, still above every early return). The registration
resolution below delegates to the `getSubscriptionSafely()` helper defined in §4.6 so the effect
body stays readable:

```tsx
export function NotificationSetup({ user, onUserChange }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsSaving, setMapsSaving] = useState(false);

  // On mount, reflect an already-active push subscription so the UI does not force a re-click
  // every load (root cause of push-enable-persistence). Declared unconditionally, ABOVE the
  // early returns below, to satisfy the Rules of Hooks — the conditionality lives in the body.
  useEffect(() => {
    let mounted = true;

    // Feature-detect INSIDE the body (not around the hook). In jsdom and unsupported browsers
    // these globals are absent; bail cleanly without throwing.
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      typeof Notification === "undefined"
    ) {
      return;
    }

    void (async () => {
      try {
        // getSubscriptionSafely (see §4.6) resolves the registration WITHOUT hanging:
        // getRegistration() first (resolves undefined, never hangs), then .ready raced
        // against a timeout that resolves null. Returns null if no active SW arrives in time.
        const sub = await getSubscriptionSafely();
        if (!mounted) return;                       // unmounted while awaiting -> do nothing
        if (!sub || Notification.permission !== "granted") return; // keep showing the button

        // Reflect the already-enabled state (gate at line ~132 is permission==="granted" && subscribed).
        setPermission("granted");
        setSubscribed(true);

        // Defense-in-depth: best-effort re-register so the server row is guaranteed present.
        // NOT a gate on the UI — a failure here must not undo the enabled state above.
        const json = sub.toJSON();
        const keys = json.keys as { p256dh: string; auth: string } | undefined;
        if (json.endpoint && keys) {
          try {
            await registerSubscription({
              endpoint: json.endpoint,
              p256dh: keys.p256dh,
              auth: keys.auth,
              user_agent: navigator.userAgent,
            });
          } catch (err) {
            // Do NOT flip the UI: the local subscription is authoritative; /api/subscriptions is
            // an upsert on endpoint so this is best-effort hardening. Warn (not silent) so a
            // persistently-broken server row is observable — the exact failure this step targets.
            console.warn("push re-register on mount failed:", err);
          }
        }
      } catch (err) {
        // Registration/getSubscription resolution failed — leave state at defaults so the Enable
        // button remains. Warn (not silent) per explicit-error-handling; never throw out of effect.
        console.warn("push subscription check on mount failed:", err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []); // run once on mount; no reactive deps

  // ... existing mapsProviderControl, handleMapsProviderChange ...

  // Early returns stay exactly here, AFTER the hooks:
  if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return <div>{mapsProviderControl}</div>;
  }
  if (!("PushManager" in window) || !("serviceWorker" in navigator)) {
    // ... unsupported message ...
  }
  // ... subscribe(), requestPermissionAndSubscribe(), render gates unchanged ...
}
```

Only change to imports: `import React, { useState, useEffect } from "react";` (add `useEffect`).

> **StrictMode note (m1):** `main.tsx` renders `<React.StrictMode>`, which in dev mounts →
> unmounts → remounts, running this effect **twice**. The `mounted` flag neutralizes the first
> run's `setState` (UI is correct), but the best-effort `registerSubscription` POST may fire on
> both invocations. That is functionally harmless because `/api/subscriptions` upserts on
> `endpoint` (no duplicate rows). Consequently the plan does NOT claim the POST fires exactly once;
> tests assert on *arguments* (`toHaveBeenCalledWith`), not call count — see DC-c. Production
> (non-StrictMode) runs the effect once.

> Note on the iOS/standalone early return coexistence: on iOS-not-standalone the effect body still
> runs (hooks run before returns), but on that platform the render still produces the maps-only
> view. The effect setting `subscribed`/`permission` has no visible effect there because that
> branch returns before the enabled gate. This is acceptable and matches the bug report's
> constraint that the iOS gate behavior is unchanged. The effect does not alter which early return
> fires.

### 4.3 Decision 2 — Idempotence / race safety

- **Dependency array `[]`:** run exactly once per mount. There are no reactive inputs (permission
  and subscription are read imperatively from browser APIs, not from props/state), so an empty
  array is correct and avoids re-running on re-render. (StrictMode dev double-invoke is covered in
  the §4.2 note; it does not change correctness because the effect is idempotent and the POST is an
  upsert.)
- **Unmount guard:** a `let mounted = true;` closure flag, flipped to `false` in the cleanup
  function. Every `setState` after an `await` is guarded by `if (!mounted) return;`. This prevents
  "set state on unmounted component" warnings and stray updates. (A mounted-flag is chosen over
  `AbortController` because `serviceWorker.ready` / `getSubscription()` are not abortable fetches;
  the flag is the simplest correct guard and matches the codebase's plain-function style.)
- **Does not fight the click handler:** the effect only ever *sets* `subscribed`/`permission` to the
  enabled values when a real subscription exists; it never resets them to `false`/`default`. If the
  user clicks Enable before or during the effect, the click path also sets the same enabled values —
  the two paths converge on identical state, so there is no flip-flop. The effect does not re-run on
  re-render (empty deps), so it cannot later stomp the click result.

### 4.4 Decision 3 — What counts as "enabled" state

The existing enabled gate is unchanged: `permission === "granted" && subscribed` (line 132). The
on-mount path sets **both** consistently:

- `permission` ← `"granted"` (read from `Notification.permission`, only set when it equals
  `"granted"`).
- `subscribed` ← `true` (only when `getSubscription()` returns a non-null subscription).

Edge cases:

- **Permission granted but `getSubscription()` returns `null`** (e.g. user cleared site data, or the
  push service dropped the subscription): the effect does nothing → the "Enable Push Notifications"
  button shows. Correct — re-clicking re-subscribes. **This case has a dedicated test (DC-b2)** — it
  is the one most likely to regress if someone later keys "enabled" off permission alone.
- **Subscription present but permission not `"granted"`** (unusual; e.g. permission was revoked but a
  stale subscription lingers): the effect does not set enabled; the normal render logic applies
  (`denied` → blocked message, `default` → Enable button). Correct — we never show "enabled" without
  live permission.

### 4.5 Decision 4 — Feature detection / SSR-safety and re-register precedence

- **Feature detection:** the effect body checks `navigator`, `"serviceWorker" in navigator`,
  `"PushManager" in window`, and `typeof Notification !== "undefined"` before touching any of them,
  and returns early if any are missing. In jsdom (no service worker / PushManager by default) and on
  unsupported browsers the effect is a clean no-op that never throws.
- **Re-register precedence (explicit):** the local subscription is authoritative for the UI. The
  order is: (1) set `subscribed`/`permission` (UI now reflects enabled), then (2) attempt the
  best-effort `registerSubscription`. A rejection from step (2) is **caught and logged with
  `console.warn` — not swallowed silently** (M2). It does **not** flip the UI back to a
  broken/button state. Rationale: the server upsert is hardening, not a precondition; the browser
  already holds a valid subscription and delivery works regardless. The `console.warn` makes a
  persistently-broken server row observable in the console (matching the `main.tsx:15`
  `console.warn("SW registration failed:", err)` style) while satisfying the project's
  explicit-error-handling rule. This precedence is deliberately encoded so a reviewer/QA knows a
  warned-but-failing POST is not a regression. Locked by test DC-d.

### 4.6 Decision 5 — Non-hanging service-worker resolution (M1 mitigation)

**Problem (from review M1):** `navigator.serviceWorker.ready` resolves **only once a service
worker is active for the page**; it *never rejects and never times out on its own*. In
`main.tsx:7-18`, SW registration is deferred behind `window.addEventListener("load", ...)` and its
`.catch` merely warns. If the SW never activates (registration failed, private mode, first paint
before `load` fires, or a Safari quirk), a bare `await navigator.serviceWorker.ready` **hangs
indefinitely**. The effect's outer try/catch cannot help — a pending promise never throws. The
`mounted` guard prevents a bad `setState`, but the async closure leaks for that mount, and — worse
for this bug — on Safari (the repro platform) the "enabled" state would silently never appear, so
the fix would look like it did nothing.

**Chosen mitigation (and why):** a small `getSubscriptionSafely()` helper that:

1. Calls `navigator.serviceWorker.getRegistration()` first. Unlike `.ready`, this **resolves** — to
   a registration or to `undefined` — rather than hanging. If it resolves `undefined` (no active
   SW), return `null` immediately (no `.ready` await at all). This handles the common "no SW yet"
   case without ever touching the hanging promise.
2. If a registration is present, `await Promise.race([navigator.serviceWorker.ready, timeout])`,
   where `timeout` is a `setTimeout`-backed promise that **resolves to `null`** (does not reject)
   after a short delay (**3000 ms**, a named `READY_TIMEOUT_MS` constant). Clear the timer on the
   winning branch to avoid a dangling timer. If the race yields `null` (timed out) or a registration
   without a usable `pushManager`, return `null`.
3. Otherwise `return reg.pushManager.getSubscription()`.

**Why this approach over the alternatives:**

- Racing `.ready` against a timeout *alone* would work but still awaits the hanging promise in the
  common "no SW at all" case; `getRegistration()`-first short-circuits that case deterministically
  and is cheaper. Using **both** (getRegistration gate + a `.ready` timeout race) is belt-and-braces:
  it covers "no registration" (undefined) and "registration exists but never becomes `ready`"
  (Safari slow-activation) without ever hanging.
- Resolving the timeout to `null` (rather than rejecting) keeps the "degrade gracefully" contract:
  a timeout is an expected, non-error condition — the Enable button simply stays visible. It is
  distinct from a genuine throw, which is caught and `console.warn`ed by the effect's outer catch.
- 3000 ms is long enough for a normally-activating SW to win the race on real devices, short enough
  that a user never perceives a hang; it is a constant so it can be tuned or shortened in tests.

**Graceful-degradation contract:** in every failure/absence branch (no `navigator.serviceWorker`,
`getRegistration()` → `undefined`, `.ready` times out, no `pushManager`, or `getSubscription()` →
`null`) the helper returns `null`, the effect returns early, and the component leaves its state at
defaults → the **Enable button stays shown**. No hang, no throw, no UI flip. Locked by test **DC-f**
(ready never resolves) and **DC-e** (feature absent).

Sketch (helper lives in the same module, above the component or as a module-local function):

```tsx
const READY_TIMEOUT_MS = 3000;

// Resolve the current push subscription WITHOUT hanging on serviceWorker.ready.
// getRegistration() resolves (possibly undefined) rather than hanging; .ready is then
// raced against a timeout that resolves null. Returns null in every absence/timeout case.
async function getSubscriptionSafely(): Promise<PushSubscription | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null; // no active/registered SW -> nothing to reflect yet

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
  });
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
    if (!reg || !("pushManager" in reg)) return null; // timed out, or no pushManager
    return await reg.pushManager.getSubscription();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
```

> Note: `getRegistration()` is standard on `ServiceWorkerContainer` and available in Safari 16.4+
> (the repro platform). If a target environment lacked it, the outer feature-detect
> (`"serviceWorker" in navigator`) would still pass but the call would throw — caught by the
> effect's outer `console.warn` catch, degrading to the button. Acceptable.

---

## 5. Affected files and modules

| File | Change |
| --- | --- |
| `web/src/components/NotificationSetup.tsx` | Add `useEffect` import; add the `getSubscriptionSafely()` helper (§4.6) and the on-mount detection + best-effort re-register effect (declared above the early returns). No other logic changes. |
| `web/src/components/NotificationSetup.test.tsx` | **New** jsdom component test file (mirrors `ItemEditor.test.tsx` / `InstallBanner.test.tsx` patterns). |
| `tests/setup/jsdom.setup.ts` | Add shared minimal stubs for `Notification` (with a settable `permission`) — **only if empirically absent** (see §7.1). |

**Not changed (confirmed):** `web/src/apiClient.ts`, `web/src/main.tsx`, `src/worker/db.ts`, any
Worker route, `vitest.workspace.ts`, `vitest.config.ts` (the "web" project already globs
`web/**/*.test.tsx` and loads `tests/setup/jsdom.setup.ts`).

---

## 6. Data model and API changes

**None.** No schema, no migration, no endpoint change. The only network call added is a reuse of the
existing `POST /api/subscriptions` via `registerSubscription()`, which is already idempotent
(`ON CONFLICT(endpoint) DO UPDATE`, `db.ts:892-899`).

---

## 7. Test plan (maps to done-conditions)

Tests run under the existing **"web"** Vitest project (jsdom, `web/**/*.test.tsx`,
`setupFiles: tests/setup/jsdom.setup.ts` — confirmed in `vitest.workspace.ts`). New file:
`web/src/components/NotificationSetup.test.tsx`.

### 7.1 Stub strategy — shared vs per-test

- **Empirical check first (m2):** `NotificationSetup.tsx` reads `Notification.permission` **during
  render** via the `useState` initializer at line 40-41 — `typeof Notification !== "undefined" ?
  Notification.permission : "default"` — which is **already null-guarded**. It is *not* read at
  module-eval time, and it does **not** throw when `Notification` is absent. Therefore the shared
  stub is needed only so the effect and tests have a **settable `permission`** to drive cases, not
  to prevent a mount crash. Before adding anything to `jsdom.setup.ts`, verify empirically whether
  this jsdom already supplies a `Notification` global (e.g. log `typeof Notification` in a scratch
  test). If jsdom already provides it, the gated `if (typeof Notification === "undefined")` stub is
  a no-op and per-test overrides suffice; do not add a redundant shared stub.
- **Shared (`tests/setup/jsdom.setup.ts`), only if absent:** add a minimal `Notification` global
  stub, gated like the existing `matchMedia`/`localStorage` stubs (only define if
  `typeof Notification === "undefined"`). It needs a **settable** `permission` property (default
  `"default"`) and a `requestPermission` function. Keep it minimal and gated so it never clobbers a
  real implementation or alters unrelated mounting tests (App.test.tsx, App.deeplink.test.tsx).
- **Per-test (`vi.stubGlobal` / property override in the test file):** the *values* that vary per
  case — `Notification.permission` (`"granted"` vs `"default"`), and the service-worker container's
  `getRegistration()` / `ready` behavior (a fake registration whose `pushManager.getSubscription()`
  returns a fake subscription or `null`; or a `ready` that never resolves for DC-f). Set with
  `vi.stubGlobal`/`Object.defineProperty` inside each test, cleaned up in `afterEach`
  (`vi.unstubAllGlobals()` + restore of any `navigator`/`Notification` overrides), mirroring
  `InstallBanner.test.tsx`.

**Fake registration / subscription / container shape** (per-test helpers). Note the container must
now expose **both** `getRegistration()` and `ready` because `getSubscriptionSafely()` (§4.6) calls
`getRegistration()` first:

```tsx
function makeSub(endpoint = "https://push.example/abc") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "P256DH_KEY", auth: "AUTH_KEY" } }),
  } as unknown as PushSubscription;
}

// getSubscription: () => Promise<PushSubscription | null>
// ready: optional override; defaults to a resolved registration. Pass a never-resolving
// promise to exercise the DC-f timeout path.
function stubServiceWorker(
  getSubscription: () => Promise<PushSubscription | null>,
  opts: { readyNeverResolves?: boolean } = {}
) {
  const reg = { pushManager: { getSubscription } } as unknown as ServiceWorkerRegistration;
  const ready = opts.readyNeverResolves
    ? new Promise<ServiceWorkerRegistration>(() => {}) // never resolves -> exercises timeout race
    : Promise.resolve(reg);
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      ready,
      getRegistration: () => Promise.resolve(reg),
    },
    configurable: true,
  });
  // Ensure PushManager feature-detect passes.
  if (!("PushManager" in window)) {
    (window as unknown as { PushManager: unknown }).PushManager = function () {};
  }
}
```

For DC-f (timeout), either shorten `READY_TIMEOUT_MS` via test seam or use Vitest fake timers
(`vi.useFakeTimers()` + `vi.advanceTimersByTime(READY_TIMEOUT_MS)`) so the test does not wait 3 s
of wall-clock. Prefer fake timers to keep the suite fast; restore real timers in `afterEach`.

`registerSubscription` is mocked via `vi.mock("../apiClient", ...)` preserving `importActual` (same
pattern as `ItemEditor.test.tsx`), so the test asserts on the POST without hitting the network.

> The test must also ensure the iOS/standalone early return does NOT swallow the push UI: jsdom's
> default UA is not iPhone, so `isStandalone()`/UA gate passes through to the push branch. No extra
> stub needed, but document this so the Coder does not accidentally set an iPhone UA.

> **Test hygiene (n2):** DC-e/DC-f manipulate `navigator.serviceWorker` and possibly
> `window.PushManager`. Ensure `afterEach` restores/deletes any `PushManager` stub so a stub from
> one case does not leak into a later feature-absent case.

### 7.2 Test cases (done-conditions)

**DC-a — existing subscription + permission granted → "enabled" on mount, NO click.**
Given `Notification.permission = "granted"` and `getSubscription()` resolves a fake sub, when
`<NotificationSetup />` mounts, then (via `waitFor`) `screen.getByText(/Push notifications enabled\./i)`
is present and the "Enable Push Notifications" button is **not**. This is the load-bearing test.
**Concrete red-then-green (m4):** this assertion **FAILS against the current pre-fix component**
(no effect exists → button is shown, "enabled" text absent) — the Coder must run it once and observe
the failure (RED) to confirm it reproduces the bug — and **PASSES after the fix** (GREEN). See
checklist step 7.

**DC-b — no subscription (permission `default`) → Enable button shown.**
Given `getSubscription()` resolves `null` and `Notification.permission = "default"`, when mounted,
then `screen.getByRole("button", { name: /enable push notifications/i })` is present and the
"enabled" text is not. Baseline no-subscription case.

**DC-b2 — permission `granted` + `getSubscription()` returns `null` → Enable button shown (m3).**
Given `Notification.permission = "granted"` **and** `getSubscription()` resolves `null` (the
subscription was dropped by the push service / site data cleared), when mounted, then the Enable
button is present and "Push notifications enabled." is **not** — proving we never key "enabled" off
permission alone. This is the higher-risk regression case called out in §4.4.

**DC-c — subscription found → best-effort re-register POST fires with the sub's endpoint/keys.**
Given a fake sub + granted permission, when mounted, then (via `waitFor`)
`vi.mocked(registerSubscription)` is `toHaveBeenCalledWith({ endpoint: "https://push.example/abc",
p256dh: "P256DH_KEY", auth: "AUTH_KEY", user_agent: expect.any(String) })`. **Assert on arguments,
not call count** (m1) — StrictMode may double-invoke the effect and thus the POST; the upsert makes
that harmless, so the test must not assert "called exactly once". (If the test tree is rendered
without `<React.StrictMode>`, a single call is expected, but the `toHaveBeenCalledWith` assertion
is robust either way.)

**DC-d — re-register failure still shows "enabled" (best-effort precedence).**
Given a fake sub + granted permission, and `registerSubscription` rejects, when mounted, then the UI
still renders "Push notifications enabled." (the warned-and-swallowed POST error must not flip the
UI). Optionally assert `console.warn` was called (spy on `console.warn`) to lock the M2 observability
behavior. Proves Decision 4's precedence.

**DC-e (regression guard) — feature-absent no-op does not throw.**
Given no `navigator.serviceWorker` (delete/undefine it; also ensure no leaked `PushManager` stub),
when mounted, then `render()` does not throw and the component renders its normal non-crashing output
(the push-unsupported message path). Guards Decision 4/5 feature-detection safety.

**DC-f (M1 guard) — `serviceWorker.ready` never resolves → no hang, Enable button still shown.**
Given `stubServiceWorker(getSub, { readyNeverResolves: true })` with a `getRegistration()` that
resolves a registration (so we reach the `.ready` race) and `Notification.permission = "granted"`,
when mounted and the `READY_TIMEOUT_MS` window elapses (advance fake timers), then the effect resolves
to `null`, the component does **not** hang (the test completes), and the "Enable Push Notifications"
button is shown (no false "enabled", no thrown error). This is the concrete test the review (M1)
requires for the timeout/no-registration path. A companion assertion (or a second variant) where
`getRegistration()` resolves `undefined` confirms the short-circuit branch also shows the button
without awaiting `.ready`.

### 7.3 Manual verification (owner) — MANDATORY for this fix (n1)

DC-a proves the *logic* in jsdom, but only device verification proves *Safari's persistence
semantics* (that Safari resolves `getRegistration()`/`.ready` and persists the `pushManager`
subscription across launches). This step is **required**, not optional:

Enable push in Safari (16.4+, installed/standalone PWA) → fully close the browser → reopen the app →
the UI shows "Push notifications enabled." **without** re-clicking. This is the exact reproduction
from the bug report, expected to now pass. If it does not, the effect logic is correct but Safari
semantics differ — re-open the bug rather than assuming the jsdom greens are sufficient.

---

## 8. Risks, edge cases, and open questions

**Risks / mitigations:**

- *Rules of Hooks violation if the effect is placed after an early return.* Mitigated by Decision 1
  (unconditional hook, guarded body). The Coder must place `useEffect` **above** the line-82/86
  early returns.
- *`serviceWorker.ready` hangs forever (M1).* Mitigated by Decision 5 (§4.6): `getRegistration()`
  gate + `.ready` timeout race, both resolving (never hanging), degrading to the Enable button.
  Locked by test DC-f.
- *Re-register / ready failures invisible (M2).* Mitigated by `console.warn` at both swallow sites
  (Decision 4 / §4.2), matching the `main.tsx` style. Optionally locked by a `console.warn` spy in
  DC-d.
- *StrictMode double-invoke (m1).* The effect is idempotent; the POST is an upsert. Tests assert on
  arguments (`toHaveBeenCalledWith`), not counts, so they are not brittle under StrictMode.
- *Stray state update after unmount.* Mitigated by the `mounted` flag + cleanup (Decision 2).
- *Best-effort POST failure breaking the UI.* Mitigated by the warn + precedence (Decision 4),
  locked by test DC-d.
- *jsdom crash from touching absent push APIs.* Mitigated by in-body feature detection (Decision 4/5)
  and locked by tests DC-e/DC-f; plus the (empirically-verified) shared `Notification` stub.

**Edge cases (all handled, see §4.4/§4.6):** permission granted + null subscription (button shown —
DC-b2); subscription present + permission not granted (no false "enabled"); iOS-not-standalone
(maps-only view unchanged, effect harmless); push-unsupported browser (unsupported message, effect
no-ops); no active SW / `getRegistration()` undefined (button shown); `.ready` never resolves
(timeout → button shown — DC-f).

**Regression risk areas (for the bug report / QA):** the modified code path is the *mount* of
`NotificationSetup`. Same component also renders the maps-provider `<select>` and the click-to-enable
button — the changes must not alter those. The `subscribe()` click path shares the enabled state
(`subscribed`/`permission`) with the new effect; verify enabling via click still works (effect and
click converge on the same values, no flip-flop). No other component imports this state. The re-used
`registerSubscription` endpoint is also hit by the click path — verify the on-mount POST does not
create duplicate rows (guaranteed by the endpoint upsert; server unchanged). The shared
`Notification` stub, if added, is loaded by the entire "web" project — it must be gated and inert so
unrelated mounting tests (App.test.tsx, App.deeplink.test.tsx) are unaffected.

**Open questions:** none. All five design decisions are resolved above; all review items folded in
(§0). Owner decisions are locked.

---

## 9. Step-by-step implementation checklist for the Coder

1. In `web/src/components/NotificationSetup.tsx`, change the React import to include `useEffect`:
   `import React, { useState, useEffect } from "react";`.
2. Add the `getSubscriptionSafely()` helper and the `READY_TIMEOUT_MS` constant from §4.6 (module-
   local, above the component). Then, immediately **after** the five `useState` declarations and
   **before** the `mapsProviderControl` const / early returns, add the on-mount `useEffect` from
   §4.2. Empty dependency array. Include:
   - in-body feature detection (`navigator`, `serviceWorker`, `PushManager`, `Notification`) with an
     early `return`;
   - `mounted` flag + cleanup returning `() => { mounted = false; }`;
   - `const sub = await getSubscriptionSafely();` (which does the `getRegistration()` gate + `.ready`
     timeout race — do NOT `await navigator.serviceWorker.ready` directly, per M1);
   - guard `if (!mounted) return;` then `if (!sub || Notification.permission !== "granted") return;`;
   - `setPermission("granted"); setSubscribed(true);`
   - best-effort `registerSubscription({ endpoint, p256dh, auth, user_agent })` from `sub.toJSON()`,
     wrapped in its own try/catch whose catch is `console.warn("push re-register on mount failed:", err)`
     (NOT a bare `catch {}` — M2); it must NOT flip the UI;
   - an outer try/catch around the async body whose catch is
     `console.warn("push subscription check on mount failed:", err)` (NOT a bare `catch {}` — M2).
   - Add WHY comments explaining (a) the hooks-before-early-returns ordering, (b) the best-effort
     precedence + why we warn instead of swallow, and (c) why `.ready` must be raced/gated (match
     existing comment style).
3. Do **not** touch: `subscribe()`, `requestPermissionAndSubscribe()`, the maps-provider control, the
   iOS/standalone early return, the push-unsupported early return, the render gates, or
   `web/src/main.tsx`. They stay byte-for-byte except for the early returns' position after the new
   hook.
4. Run `npm run typecheck` and `npm run lint`; fix any issues (expect the `sub.toJSON()` keys cast to
   need the same `as { p256dh: string; auth: string }` pattern already used in `subscribe()`; the
   `setTimeout` return type is typed `ReturnType<typeof setTimeout>`).
5. In `tests/setup/jsdom.setup.ts`: first verify empirically whether `Notification` is already
   present in this jsdom (m2). If absent, add a gated minimal `Notification` global stub (only if
   `typeof Notification === "undefined"`), with a settable `permission` (default `"default"`) and a
   `requestPermission` returning `Promise.resolve("default")`, mirroring the gating/comment style of
   the existing `matchMedia`/`localStorage` stubs. If `Notification` is already present, do not add a
   redundant stub — rely on per-test overrides.
6. Create `web/src/components/NotificationSetup.test.tsx` implementing DC-a…DC-f from §7.2, using:
   `vi.mock("../apiClient", ...)` with `importActual` to spy `registerSubscription`; per-test
   `stubServiceWorker`/`makeSub` helpers (container exposes BOTH `getRegistration()` and `ready`);
   per-test `Notification.permission` override; fake timers for DC-f; a `console.warn` spy for DC-d;
   and `afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); /* restore navigator/
   Notification/PushManager overrides */ })`. Do not set an iPhone UA (keep the push branch
   reachable).
7. **Reproduction confirmation (m4) — concrete red-then-green:** run **DC-a against the pre-fix
   component** (before adding the effect, or by temporarily stubbing the effect out) and **observe it
   FAIL (RED)** — this proves the test reproduces the bug. Then implement the effect and **observe
   DC-a PASS (GREEN)**. Do not treat this as a mental sanity check; actually run both states.
8. Run the web project tests (`npm test` runs both projects) and confirm all six cases (DC-a, DC-b,
   DC-b2, DC-c, DC-d, DC-e, DC-f) pass. Confirm DC-f completes quickly (fake timers) and does not
   hang.
9. Re-run `npm run typecheck` and `npm run lint` a final time. Hand off to QA with the **mandatory**
   manual verification steps from §7.3 (n1).

**Done condition:** `NotificationSetup` reflects an already-active subscription on mount without a
click (DC-a red→green), still shows the Enable button when none exists including
granted+null-subscription (DC-b/DC-b2), best-effort re-registers (DC-c) without letting a
`console.warn`ed POST failure break the UI (DC-d), no-ops safely where push APIs are absent (DC-e),
and never hangs when `serviceWorker.ready` never resolves (DC-f); both swallow sites `console.warn`;
typecheck + lint clean; no Worker/apiClient/main.tsx changes.
