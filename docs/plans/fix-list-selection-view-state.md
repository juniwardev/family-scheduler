# Plan: fix-list-selection-view-state

**Slug:** `fix-list-selection-view-state`
**Type:** Bug fix (client-side view state)
**Scope:** Application-code changes are `web/src/` only: `types.ts` + `App.tsx` + a new `App.test.tsx` (the approved Option B `activeView` fix) PLUS a minimal, localized defensive guard in `web/src/components/InstallBanner.tsx` and a new `web/src/components/InstallBanner.test.tsx` (M2 amendment — see §8.0b/§5.6/§8.2). Two files OUTSIDE `web/src/` are also touched: `tests/setup/jsdom.setup.ts` — to add shared `window.matchMedia` (M1) AND `window.localStorage` (M2) stubs required for App-level jsdom tests to mount — and `tests/unit/dev-auth-shim.test.ts` — a test-only isolation hardening of T4 (M2, §8.3). No API/server, schema, auth-logic, reminder, or push changes. The T4 change is test-only; `verifyAccessJwt`/`requireAuth` are untouched.

## 1. Root cause (from investigation)

`web/src/App.tsx` holds TWO independent "which panel is showing" states:

- `view: AppView` (`"list" | "calendar"`) — `App.tsx:14`, set by the List/Calendar tabs.
- `showAdmin: boolean` — `App.tsx:19`, toggled ONLY by the Admin button (`:86`).

The main-panel render (`:103-115`) is a waterfall with `showAdmin` at the top:

```
showAdmin && role==="admin"  → AdminPanel
else view==="calendar"       → CalendarView
else                         → ItemListView
```

Once `showAdmin === true`, nothing resets it. The list-selection handler (`onSelect={setSelectedListId}`, `:97`) and the List/Calendar tab handlers (`:73,:79`) update `selectedListId`/`view` but never touch `showAdmin`, so AdminPanel keeps winning the cascade until a full reload re-initializes `showAdmin` to `false`. This is why the "List" tab can go visually active while AdminPanel stays rendered: two sources of truth for one concept, drifting out of sync.

Confirmed in-browser (Playwright MCP) in `docs/bugs/list-selection-view-state-investigation.md`.

## 2. Problem statement and goals

Clicking a list in the sidebar, or the List/Calendar/Admin tabs, must immediately switch the main panel to the matching view from ANY prior view, with no reload, and the nav tab's active highlight must always match the rendered panel.

## 3. Non-goals

- No server/API changes (all API calls already return 2xx).
- No schema, auth-logic, reminder-engine, or push changes. (The M2 T4 change is test-only isolation hardening — see §8.3 — and does NOT modify `verifyAccessJwt`/`requireAuth` or any shipped auth code.)
- No redesign of `AdminPanel`, `ItemListView`, `CalendarView`, `ListSidebar` internals beyond the wiring the fix requires.
- No broad jsdom-environment or browser-API hardening beyond the TWO stubs the App test needs (`matchMedia`, `localStorage`) and the ONE localized `InstallBanner` guard. The remaining unguarded browser-API call sites surfaced by the §13 audit are explicitly a follow-up ticket, NOT this ticket.
- Not fixing the "create-list does not auto-select the new list" gap beyond what the view-switch fix already resolves (see §10, Open questions).

## 4. Chosen approach: (B) single source of truth — RECOMMENDED

**Decision: Option B.** Unify `showAdmin` + `view` into ONE `activeView` discriminated enum: `"list" | "calendar" | "admin"`.

### Rationale (weighed against scope)

The task is a small bug, which argues for the (A) band-aid (reset `showAdmin = false` in the three nav handlers). But (A) leaves the exact defect the investigation identifies — two sources of truth for one concept — intact. The band-aid re-breaks the moment any future nav path forgets to reset `showAdmin` (a new tab, a deep link, a "jump to list" action). The recurrence surface is every current and future handler.

Option B is a small, contained refactor (one type, one deleted state var, three handlers, one render conditional, all in `App.tsx` + one line in `types.ts`) that makes the drift structurally impossible: there is one value, the render switches on it, and the tab highlight reads the same value. The diff is only marginally larger than (A) and removes the bug class rather than one instance. For a state model this small, the correct model costs about the same as the patch. Recommend B.

### Safety property B gives us for free (role-gating + no member whitescreen)

Render guard stays `activeView === "admin" && user.role === "admin"`. If a member ever ends up with `activeView === "admin"` (they can't via the UI — the Admin button is role-gated — but defensively), the first branch is false, `activeView === "calendar"` is false, so the render falls through to `ItemListView`. A member never renders AdminPanel and never white-screens.

## 5. Exact changes (file:line targets)

> **Scope note (M1 + M2 amendments):** the approved Option B application-code diff (§5.1–5.5) is confined to `web/src/App.tsx` + `web/src/types.ts`. The M2 amendment adds ONE further localized application-code change in `web/src/components/InstallBanner.tsx` (§5.6, a defensive `localStorage` guard) — this is production-robustness, not scope creep (rationale in §5.6). The test-harness fixes additionally edit TWO files outside `web/src/`: `tests/setup/jsdom.setup.ts` (shared jsdom stubs — `matchMedia` from M1, `localStorage` from M2; see §8.0/§8.0b) and `tests/unit/dev-auth-shim.test.ts` (test-only T4 isolation hardening; §8.3). None of these change runtime API/server/schema/auth behavior.

### 5.1 `web/src/types.ts:77`

```ts
export type AppView = "list" | "calendar" | "admin";
```

### 5.2 `web/src/App.tsx` state

- `:14` rename for clarity: `const [activeView, setActiveView] = useState<AppView>("list");`
- `:19` **delete** `const [showAdmin, setShowAdmin] = useState(false);`

(Renaming `view` → `activeView` is recommended for readability but optional; if the Coder keeps the name `view`, every reference below must use that name consistently.)

### 5.3 `web/src/App.tsx` nav handlers (`:70-91`)

- List tab (`:72-76`):
  - class: `` `btn btn-sm ${activeView === "list" ? "" : "btn-outline"}` ``
  - `onClick={() => setActiveView("list")}`
- Calendar tab (`:77-82`):
  - class: `` `btn btn-sm ${activeView === "calendar" ? "" : "btn-outline"}` ``
  - `onClick={() => setActiveView("calendar")}`
- Admin button (`:83-90`), keep the `user.role === "admin" && (...)` role gate wrapping the button; change from toggle to direct-set so it behaves like a tab, and give it an active-state class matching the others:
  - class: `` `btn btn-sm ${activeView === "admin" ? "" : "btn-outline"}` ``
  - `onClick={() => setActiveView("admin")}`

  Behavior note: the Admin button is no longer a toggle. You leave Admin by clicking List or Calendar (or selecting a list). Clicking Admin while already in admin is a harmless no-op. This is the intended tab model and is what removes the drift.

### 5.4 `web/src/App.tsx` sidebar selection (`:97`)

Selecting a list must also land the user on the list view:

```tsx
onSelect={(id) => { setSelectedListId(id); setActiveView("list"); }}
```

### 5.5 `web/src/App.tsx` render conditional (`:103-115`)

```tsx
{activeView === "admin" && user.role === "admin" ? (
  <AdminPanel />
) : activeView === "calendar" ? (
  <CalendarView lists={lists} />
) : (
  <ItemListView
    listId={selectedListId}
    lists={lists}
    user={user}
    items={items}
    onItemsChange={setItems}
  />
)}
```

### 5.6 `web/src/components/InstallBanner.tsx` — defensive `localStorage` guard (M2 amendment)

**This does NOT change the Option B design.** It is a separate, localized production-robustness fix that also happens to unblock the App test (see §8.0b for why the shared stub alone is not the whole story).

**Why this is robustness, not scope creep.** `InstallBanner` renders on EVERY app load (`App.tsx:59`, unconditional, not gated by role or view). Its `localStorage` access is currently UNGUARDED (`:21` read in a mount `useEffect`, `:53` write in the Dismiss handler). Unguarded `localStorage` is not merely a jsdom problem — it **throws in real browsers** when storage is unavailable: Safari Private Browsing (historically threw on access), when the user has disabled site data / cookies-and-storage, in some embedded webviews, and on `QuotaExceededError` for writes. Because `InstallBanner` mounts on every load and there is no error boundary in the tree (`main.tsx` renders `<App/>` bare under `StrictMode`), an unguarded throw here **white-screens the entire app** for any such user. Guarding it is a genuine defect fix in shipped code, independent of the test harness. Note the same file already guards `navigator` (`:5`) and `window` (`:11`) defensively — `localStorage` is the one inconsistent omission; this brings it in line.

**Guard shape (feature-detect + try/catch around BOTH read and write; keep it minimal and localized to this file).** Add two tiny module-scope helpers and route both call sites through them:

```tsx
// localStorage can be absent or throw on access (Safari Private Browsing,
// storage disabled, quota). InstallBanner renders on every load with no error
// boundary above it, so an unguarded throw here white-screens the whole app.
// Degrade safely: on read failure treat the banner as NOT dismissed; on write
// failure silently skip persisting (the banner may reappear next load — acceptable).
function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // best-effort; failure to persist is non-fatal (banner may show again)
  }
}
```

- `:21` becomes: `const dismissed = safeGetItem("install-banner-dismissed");`
- `:53` (Dismiss handler) becomes: `safeSetItem("install-banner-dismissed", "1"); setShow(false);` — note `setShow(false)` still runs regardless, so Dismiss always hides the banner for the current session even if persistence fails.

Keep the change confined to `InstallBanner.tsx`. Do NOT introduce a shared storage util or touch other components.

## 6. Grep list — every `showAdmin`/`view` consumer to update

Confirmed the ONLY consumers live in two files (grep `showAdmin|setShowAdmin|AppView|\bview\b|setView` across `web/src`):

- `web/src/types.ts:77` — `AppView` union (add `"admin"`).
- `web/src/App.tsx:2` — import of `AppView` (unchanged; still used).
- `web/src/App.tsx:14` — `view` state (rename → `activeView`).
- `web/src/App.tsx:19` — `showAdmin` state (**delete**).
- `web/src/App.tsx:72,73` — List tab class + handler.
- `web/src/App.tsx:78,79` — Calendar tab class + handler.
- `web/src/App.tsx:85,86` — Admin button class + handler.
- `web/src/App.tsx:97` — sidebar `onSelect`.
- `web/src/App.tsx:103,105` — render conditional.

No other file reads `showAdmin` or `view`. `AdminPanel`, `CalendarView`, `ItemListView`, and `ListSidebar` do not reference either — they only receive props/callbacks, so no changes are needed inside them.

## 7. Regression-risk areas (protect these)

- **Nav-tab active states** — all three tabs now derive their highlight from the single `activeView`, so the "List active but Admin showing" desync is structurally gone. Verify all three highlight correctly (test DC2).
- **Admin role-gating** — the button stays wrapped in `user.role === "admin" && (...)`, and the render keeps `&& user.role === "admin"`. A member can never reach AdminPanel; if state somehow said admin, they fall through to ItemListView (no whitescreen). (test DC4).
- **Sidebar selection highlight + click** — `ListSidebar` still receives `selectedListId` (unchanged) and an `onSelect(id)` that sets the id AND `activeView`. The `background: selectedListId === list.id ? ...` highlight and the delete/visibility `stopPropagation` handlers are untouched.
- **ItemListView / CalendarView rendering** — these now actually render when selected (previously blocked behind AdminPanel). `ItemListView`'s `useEffect([listId])` fetch and `CalendarView`'s `getOccurrences` fire as expected.
- **Item editor / creation workflow** — this is what the QA "needed a reload to create an item" note traces to: you were stuck in Admin, so ItemListView (which hosts ItemEditor) never rendered. Once selecting a list switches to ItemListView, the create/edit flow works without reload. No change to `ItemEditor`.
- **InstallBanner behavior (M2 guard)** — the guard must not change the banner's user-visible behavior in a real browser: when storage works, `safeGetItem`/`safeSetItem` are transparent pass-throughs (same dismissed-persistence as today). Only when storage is absent/throws does behavior change — and it degrades to "banner may reappear" instead of "app white-screens." Verify the banner still shows on iOS-non-standalone and stays dismissed across loads when storage works (existing manual/E2E posture; unchanged).
- **Initial load** — `loadMe()` (`:20-39`) and first-list init (`:25-27`) are untouched; default `activeView` stays `"list"`.

## 8. Tests / done conditions

### 8.0 Test-harness prerequisite (M1 amendment): stub `window.matchMedia` in the jsdom setup

`App` mounts `ListSidebar` (`App.tsx:92`), which mounts `NotificationSetup` (`ListSidebar.tsx:144`). `NotificationSetup`'s function body calls `isStandalone()` on every render (`NotificationSetup.tsx:37`), and `isStandalone()` calls `window.matchMedia("(display-mode: standalone)")` **unguarded** (`NotificationSetup.tsx:22-27`). jsdom does **not** implement `window.matchMedia`, and the shared setup file `tests/setup/jsdom.setup.ts` does not polyfill it. Rendering `<App/>` therefore throws `TypeError: window.matchMedia is not a function` on render, before any assertion runs — so `App.test.tsx` cannot mount and DC1–DC5 would never actually guard anything.

**Chosen fix: add a minimal `window.matchMedia` stub to `tests/setup/jsdom.setup.ts`.** This is preferred over `vi.mock("./components/NotificationSetup")` inside `App.test.tsx` because it lives in ONE shared place and lets ALL current and future jsdom component tests mount any component tree that touches `matchMedia` (including `NotificationSetup`, `InstallBanner`, and future callers) without each test re-mocking. It is more general and does not couple `App.test.tsx` to `NotificationSetup`'s internals.

Add the following to `tests/setup/jsdom.setup.ts` (module top level, so it runs before any test renders; placement alongside the existing setup is fine):

```ts
// jsdom does not implement window.matchMedia. Components mounted in jsdom tests
// (e.g. NotificationSetup via isStandalone) call it unguarded, which throws on render.
// Provide a minimal stub so App-level and other component trees can mount.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {}, // deprecated, kept for older consumers
    removeListener: () => {}, // deprecated, kept for older consumers
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
```

Notes:
- `matches: false` means `isStandalone()` returns `false` in jsdom (not standalone), which is the desired test posture.
- The `as unknown as MediaQueryList` cast keeps `tsc`/eslint clean without implementing the full `MediaQueryList` surface.
- This is one of TWO files touched outside `web/src/`; see the §5 scope note and §3.

### 8.0b Test-harness prerequisite (M2 amendment): stub `window.localStorage` in the same jsdom setup

**Why a SECOND stub is needed (the Coder's blocker).** With the §8.0 `matchMedia` stub in place, `<App/>` still throws on mount via a DIFFERENT unguarded browser API. `App.tsx:59` renders `<InstallBanner />` unconditionally. `InstallBanner.tsx:21` calls `localStorage.getItem("install-banner-dismissed")` **unguarded**, inside a mount `useEffect`. In this repo's Vitest jsdom project (jsdom 29 under Node 26), `window.localStorage` is `undefined` (Node emits `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`, and the Vitest jsdom environment does not provide it). The read throws `TypeError: Cannot read properties of undefined (reading 'getItem')` inside a passive effect; with no error boundary, React unmounts the whole `<App/>` tree, leaving `<body><div /></body>`. Every DC1–DC5 test then fails with "Unable to find … the role 'button' and name 'Admin'." This reproduces on every `<App/>` render regardless of `activeView` — it is unrelated to the Option B change, exactly parallel to the M1 `matchMedia` situation (second component `InstallBanner`, second API `localStorage`).

**Decision (owner): do BOTH the shared stub AND the app-code guard (§5.6).** They serve different purposes and are not redundant:
- The **shared stub** (this section) makes `localStorage` present and functional in ALL jsdom component tests, so `InstallBanner` (and any future storage-using component) mounts with real behavior (dismissed-state persistence works within a test), consistent with the M1 `matchMedia` rationale — one place, benefits all current/future jsdom tests.
- The **app-code guard** (§5.6) fixes the real production defect (storage-hostile browsers white-screen the app) and means the app no longer DEPENDS on the environment providing `localStorage`. The guard is what makes the app robust; the stub is what gives tests realistic storage.

Add the following to `tests/setup/jsdom.setup.ts` (module top level, ALONGSIDE the `matchMedia` stub, gated so it does not disturb any suite that already has a working `localStorage`):

```ts
// jsdom (under this Node/Vitest combo) may not provide window.localStorage.
// InstallBanner reads it unguarded on mount, which throws and unmounts the tree.
// Provide a minimal in-memory Storage stub so App-level component trees can mount.
// Gated so it never overrides a real/working localStorage in other environments.
if (typeof window.localStorage === "undefined") {
  const store = new Map<string, string>();
  const localStorageStub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageStub,
    configurable: true,
    writable: true,
  });
}
```

Notes:
- Stub shape covers the full `Storage` surface the owner asked for: `getItem`/`setItem`/`removeItem`/`clear`/`key`/`length`, Map-backed in-memory. `length` is a getter (matches the real `Storage` contract). The explicit `: Storage` annotation keeps `tsc` honest.
- Use `Object.defineProperty(window, "localStorage", …)` rather than a bare `window.localStorage = …` assignment, because in jsdom `localStorage` is defined as a prototype accessor; a plain assignment can throw or no-op in strict mode, whereas `defineProperty` with `configurable: true` reliably installs the stub AND lets per-test overrides (`vi.stubGlobal`) replace it and restore it.
- `configurable: true` is important so the §8.2 guard test can `vi.stubGlobal("localStorage", <throwing stub>)` to simulate a storage-hostile browser and have it cleanly unstubbed afterward.
- With this stub, `InstallBanner`'s `safeGetItem` returns `null` (nothing dismissed), so the banner logic runs harmlessly and `<App/>` mounts.

### 8.1 App component test (`web/src/App.test.tsx`)

Add a new jsdom component test `web/src/App.test.tsx` (picked up by the `web` Vitest project in `vitest.workspace.ts`, `include: ["web/**/*.test.tsx"]`). Follow the mocking pattern in `web/src/components/ItemEditor.test.tsx` (`vi.mock("../apiClient", ...)` spreading `importActual` then overriding the called functions).

Mock the apiClient functions the tree calls on render so nothing hits the network:
- `getMe` → `{ user, lists }` (admin user + at least one list) — App mount.
- `adminGetUsers` → `{ users: [...] }` — AdminPanel mount.
- `getItems` → `{ items: [...] }` — ItemListView effect.
- `getOccurrences` → `{ ... }` (empty occurrences) — CalendarView.

**Async-mount note (M1 amendment):** `App` renders a `"Loading Family Scheduler…"` placeholder until `getMe()` resolves (`App.tsx:45`, `loadMe` `:20-39`). Every test in DC1–DC5 must AWAIT the loaded UI before interacting — e.g. `await screen.findBy...` for a post-load element (a nav tab or the initial `ItemListView`) — so clicks on Admin/List/Calendar or a sidebar list run against the loaded tree, not the loading placeholder. Model this on `ItemEditor.test.tsx`'s `waitFor`/async-`await` usage. Do NOT query or click synchronously right after `render(<App/>)`.

**Why the test now mounts (M1 + M2 amendments, corrects the prior §8 claim):** the test renders because §8.0 stubs `window.matchMedia` AND §8.0b stubs `window.localStorage` in the shared jsdom setup. BOTH are required; either alone still throws on `<App/>` mount (matchMedia via `NotificationSetup`, localStorage via `InstallBanner`). (The earlier version of this plan claimed `NotificationSetup` "early-returns `null` in jsdom" and therefore needed no handling — that was FALSE, as the M1 review established; and it did not anticipate the second `localStorage` throw at all, which the Coder surfaced.) With both stubs in place, `isStandalone()` returns `false`, `NotificationSetup` renders harmlessly, `InstallBanner`'s `safeGetItem` returns `null`, and the render succeeds; no push mock is needed and you should NOT stub `Notification`/`PushManager`.

Assert against stable text: AdminPanel renders `"Admin — User Roster"` (`AdminPanel.tsx:52`); ItemListView renders the selected list's name; CalendarView renders its own heading.

Test cases (map to done-conditions):

1. **DC1 (core regression — MUST fail pre-fix):** render App as admin → `await` the loaded UI → click "Admin" → assert `"Admin — User Roster"` present → click a list in the sidebar → assert the list's ItemListView is shown AND `"Admin — User Roster"` is gone. On pre-fix code, `onSelect={setSelectedListId}` leaves `showAdmin===true`, so AdminPanel stays and the "gone" assertion fails; post-fix `onSelect` sets `activeView="list"` and it passes. This is the load-bearing regression guard — it genuinely fails pre-fix and passes post-fix once the harness (§8.0 + §8.0b) lets App render.
2. **DC2:** from Admin, click the "List" tab → ItemListView shown, AdminPanel gone, and the List tab is the active tab (no `btn-outline` class on List; `btn-outline` present on Calendar/Admin).
3. **DC3:** from Admin, click "Calendar" → CalendarView shown, AdminPanel gone.
4. **DC4 (role-gating preserved):** render App as a `member` user → the Admin button is not rendered, and AdminPanel never appears regardless of interaction. (Optionally, directly assert that with a member user the app renders ItemListView, not AdminPanel.)
5. **DC5:** `npm test` — BOTH Vitest projects (`worker` + `web`) stay green; existing `ItemEditor.test.tsx` unaffected; the new `InstallBanner.test.tsx` (§8.2) green; the hardened `dev-auth-shim.test.ts` T4 (§8.3) green.

Manual QA done-condition (for the QA agent, not the Coder): with `DEV_AUTH_IDENTITY="owner"` in `.dev.vars`, `npm run dev`, reproduce the original steps (Admin → click a list) and confirm the panel switches with no reload; confirm create-item now works without a reload.

Lint/typecheck done-conditions (Coder runs after the change): `npm run typecheck` and `npm run lint` clean. Deleting `showAdmin` must leave no dangling references (the grep list in §6 is exhaustive).

### 8.2 InstallBanner guard test (`web/src/components/InstallBanner.test.tsx`) — M2 amendment

New jsdom test that regression-protects the §5.6 guard, so a future refactor cannot silently reintroduce the unguarded `localStorage` access that white-screens the app. Home: a NEW `web/src/components/InstallBanner.test.tsx` (picked up by the `web` project; keeps the assertion close to the component and out of the already-busy `App.test.tsx`).

Because the shared §8.0b stub installs a working `localStorage`, this test must OVERRIDE it per-case with a throwing stub via `vi.stubGlobal("localStorage", <throwing stub>)` (cleaned up by `vi.unstubAllGlobals()` in an `afterEach`, relying on the `configurable: true` from §8.0b).

Cases:

1. **Mount-read guard (load-bearing — mirrors the exact App blocker):** stub `localStorage` so `getItem` throws (`{ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }` plus no-op `removeItem/clear/key/length`). `render(<InstallBanner />)` and assert it does NOT throw (the component mounts and returns `null` harmlessly, since jsdom's UA is not iOS so the banner stays hidden — the point is that the unguarded read no longer crashes). This is the case that, before the guard, tears down the whole `<App/>` tree.
2. **Dismiss-write guard (graceful degradation):** force the banner visible — set an iOS user agent via `Object.defineProperty(window.navigator, "userAgent", { value: "…iPhone…", configurable: true })` (restore in `afterEach`), so `isIos()` is `true`; the §8.0 `matchMedia` stub already returns `matches:false` so `isStandalone()` is `false`; stub `localStorage.getItem` to return `null` (not dismissed) and `setItem` to throw. `render`, `await` the Dismiss button, click it, and assert (a) it does NOT throw and (b) the banner is removed from the DOM (because `setShow(false)` still runs after the swallowed write error). If reproducing the iOS UA proves brittle in the harness, case 2 may be reduced to asserting `safeSetItem` swallows a throwing `setItem` without error via a direct unit call; case 1 (the mount-read guard) is the mandatory, load-bearing one.

### 8.3 dev-auth-shim T4 test-isolation hardening (`tests/unit/dev-auth-shim.test.ts`) — M2 amendment (test-only)

**Problem (test-isolation weakness in a SECURITY-relevant suite).** T4 ("loopback host + `DEV_AUTH_IDENTITY` unset → full verification → 401", `:168-182`) asserts the "unset" precondition against the AMBIENT `cloudflare:test` `env`. Under miniflare, a stray `DEV_AUTH_IDENTITY` line in a developer's local `.dev.vars` is loaded into that test `env`, so `mergedEnv = { ...env, OWNER_EMAIL }` (`:172`) carries it in. The dev-auth shim then activates on the loopback host, returns 200 instead of 401, and both the `expect(...DEV_AUTH_IDENTITY).toBeUndefined()` guard (`:173`) and the 401 assertion fail. The test's correctness currently DEPENDS on the ambient env being clean — a contamination risk in exactly the load-bearing production-safety suite that must be deterministic.

**Fix (test-only; force the var unset regardless of ambient/.dev.vars).** Mirror how T1/T2/T3 control the toggle via `makeRequest`'s `extraEnv` merge (`:83-92`) — but where they SET `DEV_AUTH_IDENTITY`, T4 must FORCE-DELETE it from the merged env so the "unset" precondition holds no matter what the ambient env contains. Concretely, in T4, after building `mergedEnv`, delete the key before the assertion and fetch:

```ts
const mergedEnv = { ...env, OWNER_EMAIL } as unknown as Env;
delete (mergedEnv as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY;
expect((mergedEnv as { DEV_AUTH_IDENTITY?: string }).DEV_AUTH_IDENTITY).toBeUndefined();

const res = await testApp.fetch(
  new Request("http://localhost/api/me", { method: "GET" }),
  mergedEnv
);
expect(res.status).toBe(401);
```

- Use `delete` (removes the key entirely) rather than assigning `undefined`, so any shim check of either the value OR key-presence sees a truly unset var — the most faithful reproduction of a clean env. `{ ...env }` is a shallow own-enumerable copy, so `delete` on it does not mutate the shared `cloudflare:test` `env` and cannot leak to other tests.
- The existing `toBeUndefined()` guard is KEPT — it now passes deterministically because the delete guarantees it, instead of hoping the ambient env omitted the key.
- This is strictly test-only: no change to `requireAuth`, `verifyAccessJwt`, `isLocalDevContext`, or any shipped code. The owner will separately remove the stray `.dev.vars` line; the Coder must NOT edit `.dev.vars`. This fix makes the TEST independent of that cleanup so it can never be re-contaminated.

## 9. Step-by-step checklist for the Coder

1. `web/src/types.ts:77` — extend `AppView` with `"admin"`.
2. `web/src/App.tsx:14` — rename `view/setView` → `activeView/setActiveView`.
3. `web/src/App.tsx:19` — delete the `showAdmin` state line.
4. `web/src/App.tsx:72-73` — List tab: class + `setActiveView("list")`.
5. `web/src/App.tsx:78-79` — Calendar tab: class + `setActiveView("calendar")`.
6. `web/src/App.tsx:83-90` — Admin button: keep role-gate wrapper; class from `activeView === "admin"`; `onClick={() => setActiveView("admin")}`.
7. `web/src/App.tsx:97` — `onSelect={(id) => { setSelectedListId(id); setActiveView("list"); }}`.
8. `web/src/App.tsx:103-115` — rewrite render conditional to switch on `activeView` (keep `&& user.role === "admin"` on the admin branch).
9. `web/src/components/InstallBanner.tsx` — add `safeGetItem`/`safeSetItem` helpers and route `:21` (read) and `:53` (write) through them, per §5.6. Keep the change localized to this file.
10. `tests/setup/jsdom.setup.ts` — add the `window.matchMedia` stub (§8.0) AND the `window.localStorage` stub (§8.0b). Both gated; both alongside existing setup.
11. Add `web/src/App.test.tsx` with DC1–DC4, awaiting the loaded UI (§8.1) before each interaction.
12. Add `web/src/components/InstallBanner.test.tsx` with the guard cases (§8.2).
13. `tests/unit/dev-auth-shim.test.ts` — harden T4 to force-delete `DEV_AUTH_IDENTITY` from the merged env (§8.3). Test-only; do NOT touch `.dev.vars` or any `src/worker/*` code.
14. Run `npm run typecheck`, `npm run lint`, `npm test` (both projects). Fix until green. (Optional sanity: temporarily revert the §5.4 `onSelect` change and confirm DC1 fails, then restore — proves DC1 is a genuine guard.)

## 10. Risks, edge cases, and open questions

- **Loss of Admin toggle-off via the Admin button.** Direct-set means the Admin button no longer toggles back to the previous view; you exit Admin via List/Calendar or a list click. This is the intended tab model and matches the List/Calendar buttons. If product wants a true toggle, that is a UX decision, not part of this fix — flag but do not implement.
- **Create-list does not auto-select the new list (DECIDED: separate follow-up).** `ListSidebar.handleCreate` (`ListSidebar.tsx:25-39`) calls `createList` then `refresh()` but never `onSelect(newId)` and does not capture the created list's id, so a freshly created list is not auto-opened. This is a pre-existing gap separate from the view-switch defect. The QA "needed a reload to create an item" symptom is resolved by this plan (selecting a list now switches to ItemListView). The operator has decided this is a separate follow-up; it is NOT implemented here. A follow-up would make `handleCreate` select the returned list id (requires confirming `createList`'s response shape).
- **Remaining unguarded browser-API call sites (DECIDED: follow-up, see §13 audit).** The §13 audit found other unguarded browser-API accesses in `web/src/`, but ALL of them are either already guarded, only reached in event handlers (not on mount), or not on the `<App/>` test render path. Only `localStorage` (this ticket) actually blocks `<App/>` mount. The handler-path ones (e.g. `NotificationSetup`'s `serviceWorker`/`Notification.requestPermission`) are NOT fixed here; they are recommended as a follow-up "jsdom-hardening / app-robustness" ticket. Do NOT expand this ticket to fix them.

## 11. Workflow

No server or schema change. This plan proceeds plan-review → Coder → QA, with QA's manual done-condition via the dev-auth shim and the DC1–DC5 component tests (plus the §8.2 guard test and §8.3 hardened T4) as the automated gate.

## 12. Amendment log

- **2026-06-30 — M1 (plan-review blocker) folded in, mechanical/test-harness only; approved Option B design unchanged.**
  - Added §8.0: stub `window.matchMedia` in `tests/setup/jsdom.setup.ts` (shared setup) so `App.test.tsx` — which mounts `NotificationSetup` via `ListSidebar` — can render in jsdom instead of throwing `TypeError: window.matchMedia is not a function`. Chose the shared-setup stub over per-test `vi.mock` because it is one place and benefits all current/future jsdom component tests; rationale stated inline.
  - Corrected the false §8 reasoning: removed the claim that `NotificationSetup` "early-returns `null` in jsdom." It does not (the `PushManager` branch returns a `<p>` at `:41-43`), and execution never reaches it because the unguarded `matchMedia` throws first. Replaced with the accurate reason the test now works (the `matchMedia` stub; `isStandalone()` returns `false`).
  - Scope note: acknowledged that the fix touches ONE file outside `web/src/` — `tests/setup/jsdom.setup.ts` (test-infra, no app/server/schema change). Updated the top-of-file Scope line, added a §5 scope note, and added checklist step 9.
  - Await-loading test note (§8.1): DC1–DC5 must mock `getMe`/lists and `await` the resolved (post-load) UI before clicking Admin/List/Calendar or a sidebar list, since `App` gates its whole UI behind an async `getMe()` fetch. Modeled on `ItemEditor.test.tsx`.
  - Nit n5 (framing) also tidied: the deferred auto-select-on-create item is restated in §10 as decided-deferred rather than an open question. Design (Option B: `activeView` enum, handlers, render, role-gating, initial-state parity) is unchanged.

- **2026-06-30 — M2 (second jsdom render blocker + owner scope expansion) folded in; approved Option B design and the M1 `matchMedia` stub UNCHANGED.** Triggered by `docs/plans/fix-list-selection-view-state-coder-questions.md` (App cannot mount because of a SECOND unguarded browser API, `localStorage`).
  - **localStorage — BOTH shared stub AND app-code guard AND a guard test (owner decision):**
    - §8.0b: added an in-memory `window.localStorage` stub to `tests/setup/jsdom.setup.ts` (gated behind `typeof window.localStorage === "undefined"`, installed via `Object.defineProperty` with `configurable: true`), alongside the M1 `matchMedia` stub. Shape covers `getItem/setItem/removeItem/clear/key/length` (Map-backed). Makes all jsdom component trees mount with realistic storage.
    - §5.6: added a minimal, localized defensive guard in `web/src/components/InstallBanner.tsx` (`safeGetItem`/`safeSetItem`, feature-detect + try/catch around the `:21` read and `:53` write; on read failure treat as "not dismissed", on write failure silently skip). Rationale recorded: `InstallBanner` renders on every load with no error boundary, so unguarded `localStorage` white-screens the whole app in Safari Private Browsing / storage-disabled / quota situations — this is a production defect, not scope creep.
    - §8.2: added a new `web/src/components/InstallBanner.test.tsx` regression test — mount does not throw when `localStorage.getItem` throws (load-bearing), and Dismiss degrades gracefully when `setItem` throws.
  - **Browser-API audit (§13):** read-only sweep of `web/src/` for unguarded browser-API usage on the render/mount path vs. handlers. Headline: exactly ONE unguarded on-mount call still blocks `<App/>` render — `localStorage.getItem` at `InstallBanner.tsx:21` — and it is fixed by this amendment (stub + guard). `matchMedia` was the M1 blocker (already stubbed). Everything else is guarded, handler-only, or off the test render path. Recommendation: fix ONLY `localStorage` now; the handler-path items are a follow-up ticket (recorded in §10 and §13). No other on-mount thrower found.
  - **T4 test-isolation hardening (§8.3, test-only):** hardened `tests/unit/dev-auth-shim.test.ts` T4 to force-`delete` `DEV_AUTH_IDENTITY` from its merged env so the "unset" precondition holds regardless of ambient/`.dev.vars` contamination, mirroring the `extraEnv` pattern T1/T2/T3 use to SET the toggle. No shipped auth code touched; the Coder must NOT edit `.dev.vars` (owner removes the stray line separately).
  - **Scope/bookkeeping:** updated the top-of-file Scope line and §5 scope note and affected-files framing to include `web/src/components/InstallBanner.tsx`, `web/src/components/InstallBanner.test.tsx`, the second stub in `tests/setup/jsdom.setup.ts`, and `tests/unit/dev-auth-shim.test.ts`. Updated §8.1 "why it mounts" to require BOTH stubs, DC5 to include the new guard test + hardened T4, and the §9 checklist (steps 9–14). Still NO server/API/schema/auth-logic change.

## 13. Browser-API audit (M2, read-only) — on-mount throwers vs. safe/handler-only

**Purpose:** the owner wants the SHAPE of the "unguarded browser API surfaced only when `<App/>` mounts in jsdom" problem, not to discover blockers one at a time (M1 = `matchMedia`, M2 = `localStorage`). This is a read-only sweep of `web/src/` (grep: `matchMedia`, `localStorage`, `sessionStorage`, `navigator`, `serviceWorker`, `Notification`, `PushManager`, `window.location`/`location.`, `history`, `IntersectionObserver`, `ResizeObserver`, `crypto`, `fetch`, `indexedDB`, `BroadcastChannel`, `caches`). No misses beyond the grep hits below were found. Assumes BOTH shared stubs (§8.0 `matchMedia`, §8.0b `localStorage`) are in place.

| # | Site (file:line) | API | Runs at… | Under current jsdom (both stubs)? | Severity |
|---|---|---|---|---|---|
| 1 | `InstallBanner.tsx:21` | `localStorage.getItem` | **Mount** (`useEffect`, `[]`) | **Throws today** (`localStorage` undefined) → tears down `<App/>` | **Breaks App render — FIX NOW** (stub §8.0b + guard §5.6) |
| 2 | `InstallBanner.tsx:53` | `localStorage.setItem` | Handler (Dismiss click) | Would throw on click if storage absent; not on mount | Handler-only; fixed opportunistically by §5.6 guard + covered by §8.2 |
| 3 | `NotificationSetup.tsx:24` (via `:37`) | `window.matchMedia` | Mount (component body) | Safe — STUBBED (M1 §8.0), returns `matches:false` | Was the M1 blocker; now safe |
| 4 | `InstallBanner.tsx:12` (via `:22`) | `window.matchMedia` | Mount (effect), but short-circuited by `isIos()` first | Safe — jsdom UA not iOS so never reached; also stubbed | Safe |
| 5 | `NotificationSetup.tsx:31` | `Notification.permission` | Mount (state init) | Safe — **guarded** `typeof Notification !== "undefined"` → `"default"` | Safe / already guarded |
| 6 | `NotificationSetup.tsx:37,64` / `InstallBanner.tsx:6` | `navigator.userAgent` | Mount (`:37`) / handler (`:64`) / effect (`:6`) | Safe — `navigator` exists in jsdom; `InstallBanner:5` guards `typeof navigator` | Safe |
| 7 | `NotificationSetup.tsx:41` | `"PushManager" in window`, `"serviceWorker" in navigator` | Mount (component body) | Safe — `in` checks never throw; both false → renders `<p>Push not supported</p>` | Safe |
| 8 | `NotificationSetup.tsx:48,50` | `navigator.serviceWorker.ready`, `reg.pushManager.subscribe` | Handler (`subscribe`, click) | Not on mount; would need mocks only if a test drives the subscribe flow | Handler-only — follow-up if ever tested |
| 9 | `NotificationSetup.tsx:75` | `Notification.requestPermission` | Handler (Enable click) | Not on mount | Handler-only — follow-up |
| 10 | `NotificationSetup.tsx:9,19` | `atob` / `btoa` | Handler-called helpers only | Available globally in jsdom/Node anyway; not on mount | Safe |
| 11 | `apiClient.ts:31` | `fetch` | Called by `getMe`/`getItems`/etc. | Mocked via `vi.mock("../apiClient")` in tests; global `fetch` exists in Node 26 regardless | Safe — mocked |
| 12 | `main.tsx:7,9` | `"serviceWorker" in navigator`, `navigator.serviceWorker.register` (in `window load` listener) | App ENTRY module top-level / load event | **Not on the component-test render path** — tests render `<App/>` directly and never import `main.tsx`; `in` check is safe regardless | Safe (off test path) |
| 13 | `main.tsx:20` | `document.getElementById` | App entry module | Off test path (not imported by tests) | Safe (off test path) |

**Conclusion / recommendation.**
- **Fix NOW (this ticket):** ONLY row 1 (`localStorage.getItem` on mount) — via the §8.0b shared stub AND the §5.6 app guard. Row 2 (`setItem` in the Dismiss handler) is fixed for free by the same §5.6 guard and covered by §8.2, since it lives in the same file and the guard is symmetric. No other change is needed to make DC1–DC5 mount.
- **Follow-up (NOT this ticket):** rows 8–9 (`NotificationSetup`'s `serviceWorker`/`pushManager`/`Notification.requestPermission` in click handlers). They do not run on mount, so they do not block any current test; they would only matter if a future test exercises the push-subscribe flow, which would then need `navigator.serviceWorker`/`Notification` mocks. Recommend a dedicated "jsdom-hardening / push-flow test-fixtures" ticket rather than absorbing it here.
- **No new on-mount throwers beyond `localStorage`.** With both stubs in place, `<App/>` mounts cleanly; nothing else on the render path throws.
