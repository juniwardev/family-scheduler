# Impl notes: fix/push-enable-persistence

- **Plan:** `docs/plans/push-enable-persistence.md` (amended, §0 revision log)
- **Review:** `docs/reviews/push-enable-persistence-review.md` — round-2 verdict APPROVE
- **Branch:** `fix/push-enable-persistence` (based on `main` @ `8176170`), left **uncommitted**
  per instructions.

## Files changed

1. `web/src/components/NotificationSetup.tsx`
   - Added `useEffect` to the React import.
   - Added module-local `READY_TIMEOUT_MS = 3000` constant and `getSubscriptionSafely()` helper
     (§4.6): `getRegistration()` first (resolves rather than hangs; short-circuits to `null` on
     `undefined`), then `.ready` raced against a timeout that **resolves** `null` (never rejects),
     timer cleared in `finally`. Never awaits `navigator.serviceWorker.ready` directly.
   - Added the on-mount `useEffect`, declared unconditionally immediately after the five
     `useState` calls and above the iOS/standalone and push-unsupported early returns (Decision 1
     — Rules of Hooks). Body: in-body feature detection with early `return`; `mounted` flag +
     cleanup; `getSubscriptionSafely()` call; guards `if (!mounted) return` then
     `if (!sub || Notification.permission !== "granted") return`; sets `permission`/`subscribed`
     to reflect "enabled"; best-effort re-registers via `registerSubscription()` in its own
     try/catch (`console.warn` on failure, does not flip UI); outer try/catch also
     `console.warn`s. Empty dependency array.
   - No changes to `subscribe()`, `requestPermissionAndSubscribe()`, the maps-provider control, or
     either early return's behavior (only their position moved after the new hook, as specified).

2. `web/src/components/NotificationSetup.test.tsx` (new)
   - DC-a, DC-b, DC-b2, DC-c, DC-d, DC-e, DC-f, plus a DC-f companion case for the
     `getRegistration()` → `undefined` short-circuit (made concrete per the round-2 advisory note,
     not left optional).
   - `vi.mock("../apiClient", ...)` with `importActual`, spying only `registerSubscription`.
   - Per-test `stubServiceWorker()`/`makeSub()` helpers; container exposes both `getRegistration()`
     and `ready`. Per-test `Notification.permission` override via a `setPermission()` helper.
     `afterEach` unstubs globals, restores real timers, resets `Notification.permission`, and
     deletes any `navigator.serviceWorker`/`window.PushManager` stub (n2 test-hygiene note).
   - `toHaveBeenCalledWith(...)` used for DC-c (not call-count) per the StrictMode note (m1) — the
     test tree here isn't wrapped in `StrictMode` (only `main.tsx` wraps `<App/>`), but the
     assertion is written to be robust either way as instructed.

3. `tests/setup/jsdom.setup.ts`
   - Added a gated `Notification` stub (`if (typeof Notification === "undefined")`) with a
     settable static `permission` (default `"default"`) and `requestPermission()` returning
     `Promise.resolve(permission)`. Added because the empirical check (see below) showed
     `Notification` is genuinely absent in this jsdom/Vitest environment — not a redundant stub.

## DC-a red-then-green (m4)

Ran `npx vitest run web/src/components/NotificationSetup.test.tsx --project web -t "DC-a"`
against the component **before** adding the `useEffect`/helper (test file existed, component did
not yet have the fix). Observed **RED**: `TestingLibraryElementError: Unable to find an element
with the text: /Push notifications enabled\./i` — the DOM showed only the "Enable Push
Notifications" button, confirming the test reproduces the bug exactly as described in
`docs/bugs/push-enable-persistence.md`.

Then implemented the fix in `NotificationSetup.tsx` and re-ran the full test file: all 8 cases
including DC-a now **PASS (GREEN)**.

## Empirical stub check (m2)

Before touching `jsdom.setup.ts`, ran a scratch test logging `typeof Notification`,
`typeof navigator.serviceWorker`, and `typeof window.PushManager` under this project's jsdom
Vitest environment. Result: all three are `"undefined"`. Conclusion: the shared, gated
`Notification` stub in `jsdom.setup.ts` **is needed** (not a no-op) — added as specified in the
plan, gated so it cannot clobber a real implementation and cannot affect unrelated mounting tests
(`App.test.tsx`, `App.deeplink.test.tsx` — both still pass, see below).

## Commands to run the feature locally

```
npm run typecheck
npm test
npx vitest run web/src/components/NotificationSetup.test.tsx --project web
```

Manual Safari verification (mandatory per plan §7.3, not automatable): enable push in Safari
(16.4+, installed/standalone PWA), fully close the browser, reopen the app — UI should show
"Push notifications enabled." without re-clicking. This step was **not** performed by the Coder
(no device access in this environment) — flagged for QA/owner per the plan's own instruction that
this is mandatory manual verification, not a jsdom-covered case.

## Results

- **`npm run typecheck`**: clean, no errors (`tsc --noEmit` for both `tsconfig.worker.json` and
  `tsconfig.web.json`).
- **`npm run lint`**: fails with the pre-existing ESLint 9 flat-config gap
  (`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`) — this is the known,
  out-of-scope gap called out in the task instructions. Used `npm run typecheck` as the gate
  instead, per instructions. Not fixed (out of scope; would require touching ESLint config, not
  called for by the plan).
- **`npm test`**: **137/137 passed** (18 test files). Baseline was 129/129; the new
  `NotificationSetup.test.tsx` contributes **8** new cases (DC-a, DC-b, DC-b2, DC-c, DC-d, DC-e,
  DC-f, DC-f-companion). No existing test regressed.

## Deviations from the plan

- **DC-f timer/waitFor interaction (not in the plan, discovered during implementation):** the
  plan's §7.1 sketch suggested `vi.advanceTimersByTime(READY_TIMEOUT_MS)` combined with RTL's
  `waitFor`. In practice, mixing Vitest fake timers with `@testing-library/react`'s `waitFor`
  (which polls via real timers/microtasks under the hood in this RTL/Vitest combination) caused
  the test to hang and hit the 5000ms Vitest test timeout. Fixed by using
  `await vi.runAllTimersAsync()` (which drives both the fake-timer clock and pending microtasks
  to completion) followed by a synchronous assertion instead of `waitFor`. This is a test-only
  mechanics fix, not a change to the plan's design or the component's production behavior — the
  timeout constant, the race, and the graceful-degradation contract are all exactly as specified
  in §4.6. Noting it here rather than treating it as silent improvisation, since the plan's test
  sketch technically called out `advanceTimersByTimeAsync` as one option and `runAllTimersAsync`
  as the robust variant of the same intent (advance-fake-timers-then-assert).
- No other deviations. All checklist items in plan §9 (steps 1-9) were implemented as specified.

## Out-of-scope observations

- `backup-notif-3546f0c.sql` is present as an untracked file in the repo root (pre-existing,
  unrelated to this plan). Not touched, not investigated further — flagging per guardrails since
  it's untracked and unexplained, but it is not in scope for this fix.
- The round-2 review's second advisory note ("still-installing SW shows enabled next launch") is
  a QA-facing behavioral note, not a code change — no code change was made for it, per the task
  instructions. QA should not treat a transient "button still shown" on the very first relaunch
  after enabling (while the SW is still installing/activating) as a regression; it should resolve
  on the *next* launch once the SW has activated.
