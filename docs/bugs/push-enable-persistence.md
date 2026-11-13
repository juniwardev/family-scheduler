# Bug: "Enable Push Notifications" does not persist across page loads

- **Slug:** `push-enable-persistence`
- **Source:** Backlog item ("Push notification enablement doesn't persist across logins"); owner reproduced 2026-07-11.
- **Severity:** Real UX defect. Push *delivery* works (confirmed on iPhone); the app just always re-shows the "Enable" button, so the user re-clicks it every load and can't tell push is on.
- **Area:** Frontend only — `web/src/components/NotificationSetup.tsx`.

## Reproduction (owner-confirmed)

1. Open the app in Safari, click **Enable Push Notifications** (subscribes successfully).
2. Fully close the browser, reopen the app.
3. **Actual:** the UI shows "Enable Push Notifications" again, as if never enabled.
4. **Expected:** the UI reflects that push is already enabled, without re-clicking.

## Root cause (CONFIRMED by code read — Phase 1 complete)

`NotificationSetup.tsx` derives "enabled" from local React state that resets every mount:

- `const [subscribed, setSubscribed] = useState(false);` (line 43) — **always initializes `false`**.
- The "enabled" view renders only when `permission === "granted" && subscribed` (line 132).
- `setSubscribed(true)` is called **only** inside `subscribe()` (line 117), which runs **only when the user clicks the button**.
- The component has **no `useEffect`** — nothing checks `pushManager.getSubscription()` on mount.

Therefore, on reload: the browser still remembers permission (`Notification.permission` → `"granted"`) and still holds the push subscription (it persists with the service-worker registration), but the component's `subscribed` flag is back to `false`. The gate `"granted" && false` is false, so it falls through to the "Enable" button. The subscription is **not** actually lost — the UI just never looks for it.

This confirms backlog **hypothesis #2** (present-but-UI-never-checks) and rules out hypothesis #1 (subscription genuinely lost).

## Fix direction (owner decisions locked)

- **Add an on-mount effect:** `await navigator.serviceWorker.ready` → `reg.pushManager.getSubscription()`. If a subscription exists AND `Notification.permission === "granted"` → `setSubscribed(true)`. If it returns `null`, keep showing the button (correctly handles the genuinely-lost case too).
- **Defense in depth (owner chose YES):** when an existing subscription is found on mount, idempotently re-POST it via `registerSubscription()` so the server is guaranteed to have it. This is SAFE and needs no Worker change — the `/api/subscriptions` insert is already `INSERT ... ON CONFLICT(endpoint) DO UPDATE` (`db.ts:894`), an upsert keyed on endpoint (no duplicate rows).

## Constraints / notes for the fix

- **iOS/standalone gate:** line 82 early-returns (no push UI) on iOS when not standalone. The on-mount check must coexist with this — hooks must run unconditionally (no early `return` before the effect); guard the effect body, not its declaration.
- **Feature-detect:** guard `navigator.serviceWorker` / `PushManager` before use (jsdom + unsupported browsers). See [[jsdom-browser-api-stubs]].
- **Tests:** jsdom component test mocking `navigator.serviceWorker.ready` + `pushManager.getSubscription()`; assert (a) existing subscription + granted → renders "enabled" on mount WITHOUT a click, (b) no subscription → renders the button, (c) the re-register POST fires when a subscription is found. Needs `Notification` + `navigator.serviceWorker` stubs added to `tests/setup/jsdom.setup.ts`.
