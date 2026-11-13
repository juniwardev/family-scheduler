# Plan Review: fix-list-selection-view-state

**Reviewer:** Plan-Reviewer (adversarial pass)
**Plan:** `docs/plans/fix-list-selection-view-state.md`
**Verdict basis:** Verified every file:line claim against the working tree, grepped for hidden consumers, walked all state transitions, and traced the jsdom render path for the proposed test.

---

## Summary

The chosen design — Option B, unify `showAdmin` + `view` into a single `activeView: "list" | "calendar" | "admin"` — is correct, total, and matches the confirmed root cause. Role-gating is preserved, there is no whitescreen path, initial-state parity holds, and the consumer/grep list is accurate and complete. Scope is confined to `types.ts` + `App.tsx` + a new test, and the owner's out-of-scope decision (auto-select-on-create) is respected (not implemented; deferred).

There is **one Major blocker in the test harness**: `App.test.tsx` as specified will **throw on render** in jsdom, and the plan's stated reasoning for why it won't (§8) is factually wrong. This must be folded in before implementation. Everything else is Minor/Nit.

---

## Correctness of the design (verified)

- **Root cause accurate (§1).** Grep for `showAdmin|setShowAdmin|AppView|setView|\bview\b` across `web/` returns hits ONLY in `web/src/types.ts:77` and `web/src/App.tsx` (lines 2, 14, 19, 72, 73, 78, 79, 86, 103, 105). No context, no localStorage, no URL/hash, no persisted value, no prop drilling of these two. The four children read neither:
  - `AdminPanel` (`AdminPanel.tsx:6`) takes no props.
  - `CalendarView` takes only `lists` (`CalendarView.tsx:7-9`).
  - `ItemListView` takes `listId/lists/user/items/onItemsChange` (`ItemListView.tsx:7-13`).
  - `ListSidebar` takes `lists/selectedListId/user/onSelect/onListsChange` (`ListSidebar.tsx:7-13`).
  The §6 "no missed consumer" claim is confirmed. No incomplete-fix risk here.
- **Design is total (§2).** All five transitions (List tab, Calendar tab, Admin button, sidebar select, initial) map to exactly one render branch. The render `admin? : calendar? : ItemListView` has no `activeView` value without a branch → no whitescreen.
- **Tab highlight desync structurally gone.** All three tab classes and the render now derive from the single `activeView`, so "List tab active while Admin renders" cannot recur.
- **Role-gate preserved (§4 safety note).** Render keeps `activeView === "admin" && user.role === "admin"`; a member with a stale `activeView==="admin"` falls through (role check false → calendar false → `ItemListView`), never AdminPanel, never blank. The Admin button stays wrapped in `user.role === "admin" && (...)` (`App.tsx:83`), so a member never sees the control. Confirmed.
- **Initial-state parity (§7).** `activeView` initial `"list"` reproduces today's default (`view="list"` + `showAdmin=false` → `ItemListView`). No load-behavior change except the fix.
- **Scope locked.** No server/API/schema/auth/reminder/push edits. `AppView` is web-only (worker has its own types); adding `"admin"` to the union is backward-compatible and touches no worker code.
- **Intentional behavior addition is correct, not a regression.** §5.4 makes selecting a list also set `activeView="list"`, so from Calendar/Admin a sidebar click now lands on the list. This is exactly the bug's stated expected behavior (`docs/bugs/list-selection-view-state.md:22-23`). Good.

---

## Findings

### Major

**M1 — `App.test.tsx` will THROW on render in jsdom; the plan's §8 justification is wrong.**

`App` renders `ListSidebar` (`App.tsx:93`), which renders `NotificationSetup` (`ListSidebar.tsx:144`). `NotificationSetup`'s function body calls `isStandalone()` on every render (`NotificationSetup.tsx:37`), and `isStandalone()` calls `window.matchMedia("(display-mode: standalone)")` **unguarded** (`NotificationSetup.tsx:22-27`). jsdom (v29, per `package.json:34`) does **not** implement `window.matchMedia`, and the shared setup file `tests/setup/jsdom.setup.ts` does **not** polyfill it (it only wires jest-dom matchers + RTL cleanup). Rendering `<App/>` therefore throws `TypeError: window.matchMedia is not a function` before any assertion runs — DC1–DC4 all error out, so the plan's automated gate cannot execute at all.

The plan's §8 note (line 141) is doubly incorrect:
- It claims `NotificationSetup` "early-returns `null` in jsdom." It does not — the `!("PushManager" in window)` branch returns a `<p>Push not supported…</p>` element (`NotificationSetup.tsx:41-43`), not `null`.
- More importantly, execution never reaches that branch: the `matchMedia` call at line 37/24 throws first.

Why the existing `ItemEditor.test.tsx` never hit this: it renders `ItemEditor` in isolation, which does not mount `NotificationSetup`. `App` mounts it transitively, so this is new surface.

Note `InstallBanner` (`App.tsx:60`) is safe: its `isStandalone()` is only reached after `isIos()` is true (`InstallBanner.tsx:22`), and jsdom's userAgent is not iOS, so short-circuit skips `matchMedia`. The crash is specifically via `NotificationSetup`.

Required change: the plan must specify a fix, e.g. add a `window.matchMedia` stub to `tests/setup/jsdom.setup.ts` (preferred — one place, benefits future App-level tests) or stub it / `vi.mock("./components/NotificationSetup")` inside `App.test.tsx`. And the false NotificationSetup reasoning in §8 must be removed/corrected.

### Minor

**m2 — Scope statement vs. the M1 fix.** §5 and §3 say "`web/src/` only." The `matchMedia` polyfill lands in `tests/setup/jsdom.setup.ts` (outside `web/src/`). This is legitimate test-infra, but the plan should acknowledge the extra touched file so the Coder/QA don't flag it as unexpected creep.

**m3 — Async mount not called out.** `App` renders `"Loading Family Scheduler…"` until `getMe()` resolves (`App.tsx:38, 42-46`). The test must `await` the loading state to clear (e.g. `findBy*`/`waitFor`) before clicking Admin, or DC1 queries a not-yet-mounted tree and flakes. The referenced `ItemEditor.test.tsx` pattern uses `waitFor`, so this is achievable, but §8 should state it explicitly since App (unlike ItemEditor) gates its whole UI behind an async fetch.

**m4 — §8 factual error (independent of M1).** Even setting the throw aside, "early-returns `null`" is wrong; correct it to reflect the actual `<p>Push not supported…</p>` return, or better, just delete the claim once `matchMedia` is stubbed.

### Nit

**n5 — Stale framing of the deferred item.** §10 still asks "Open question for the operator: in scope for this ticket, or a separate follow-up?" The owner has already decided this is a separate follow-up. The plan does not implement it (correct), so this is not a defect — just restate it as decided-deferred rather than open.

**n6 — Optional extra guard.** A DC covering "from Calendar, click a sidebar list → List view renders" would lock in the §5.4 behavior addition. Optional; DC1 already covers the Admin path.

---

## Verification cross-checks

- Investigation alignment: the plan's root cause matches `docs/bugs/list-selection-view-state-investigation.md` exactly (waterfall priority of `showAdmin` at `App.tsx:103`, never reset). Fix addresses the root cause (removes the dual source of truth), not just the symptom.
- apiClient names the test mocks are real: `getMe` (`apiClient.ts:59`), `getItems` (`:96`), `getOccurrences` (`:100`), `adminGetUsers` (`:178`). AdminPanel heading `"Admin — User Roster"` confirmed (`AdminPanel.tsx:52`).
- DC1 genuinely fails pre-fix: pre-fix, sidebar `onSelect={setSelectedListId}` leaves `showAdmin===true`, so AdminPanel stays and the "gone" assertion fails; post-fix `onSelect` sets `activeView="list"`. Real regression guard — provided M1 is fixed so App can mount.
- No breaking changes to worker code, schema, or other tests; `AppView` is imported only by `App.tsx`.

---

## Required changes (fold in before implementation)

1. Fix the jsdom `window.matchMedia` crash so `App.test.tsx` can mount: add a `matchMedia` stub to `tests/setup/jsdom.setup.ts` (or mock `NotificationSetup` in the test). Remove the incorrect "NotificationSetup early-returns null in jsdom" reasoning in §8 (M1, m4).
2. Acknowledge in scope/§ that the test-infra `matchMedia` fix touches `tests/setup/jsdom.setup.ts`, outside `web/src/` (m2).
3. State explicitly that the test must await the async `getMe` loading state before interacting (m3).

(Nits n5/n6 are optional and need not block.)

APPROVE WITH CHANGES

---

## Re-review (Pass 2)

**Scope of this pass:** Verify ONLY the M1 resolution folded into the amended plan. The Option B design was fully approved in Pass 1 and is not re-litigated. I re-read the amended plan against `web/src/components/NotificationSetup.tsx`, `tests/setup/jsdom.setup.ts`, `web/src/App.tsx`, and `web/src/components/ItemEditor.test.tsx`.

### 1. matchMedia stub is sufficient — CONFIRMED

Traced the render path with the §8.0 stub in place:

- `NotificationSetup.isStandalone()` (`NotificationSetup.tsx:22-27`) reads `window.matchMedia("(display-mode: standalone)").matches`. Stub returns `matches:false`; jsdom `window.navigator.standalone` is `undefined`, so `isStandalone()` returns `false` — no throw.
- Guard at `:37` — `!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)` evaluates `true && false` (jsdom UA is not iOS) → does NOT early-return `null`.
- Falls to `:41` — `!("PushManager" in window)` is `true` in jsdom → returns `<p>Push not supported…</p>`. Component renders harmlessly.
- `useState` init at `:30-31` is guarded by `typeof Notification !== "undefined"` → defaults to `"default"`, no throw. So no `Notification`/`PushManager` mocks are required, exactly as the plan states.

Stub shape (`matches:false, media, onchange, addEventListener, removeEventListener, addListener, removeListener, dispatchEvent`) fully satisfies the single `.matches` access on this path; the extra listener members are harmless future-proofing.

**Does not break existing tests — CONFIRMED.** The stub is gated behind `if (typeof window.matchMedia !== "function")`, and `ItemEditor.test.tsx` renders `ItemEditor` in isolation, which never touches `matchMedia`. Registering a global `matchMedia` in the shared `jsdom.setup.ts` is inert for tests that don't call it. Safe.

### 2. False "early-returns null" claim removed/corrected — CONFIRMED

§8.1 ("Why the test now mounts") explicitly retracts the prior claim, states the truth (the `PushManager` branch returns a `<p>` at `NotificationSetup.tsx:41-43`, not `null`, and execution never reaches it because unguarded `matchMedia` at `:37`/`:24` throws first), and attributes the successful render to the stub. §12 amendment log records the correction. Accurate against the code.

### 3. Scope note is honest — CONFIRMED

Top-of-file scope line (`:5`), the §5 scope note (`:53`), and checklist step 9 (`:204`) all now acknowledge the diff touches `tests/setup/jsdom.setup.ts` outside `web/src/`, while correctly asserting no app/server/schema/auth/reminder/push change. The plan no longer claims the whole diff is confined to `web/src/`.

### 4. Await-loading note is correct and testable — CONFIRMED

`App.tsx` returns `Loading Family Scheduler…` at `:46` while `loading` is `true`, flipped to `false` in the `loadMe()` `finally` (`:37-39`) after `getMe()` resolves — so the whole interactive tree is gated behind the async fetch. §8.1's async-mount note correctly instructs mocking `getMe`/lists and awaiting a post-load element (`screen.findBy...`) before clicking Admin/List/Calendar or a sidebar list, modeled on `ItemEditor.test.tsx`'s `waitFor`/`await` usage. The DC1 sequence will run against the loaded tree, not the placeholder. Matches the real mount lifecycle.

### 5. DC1 is still a genuine pre-fix-failing guard — CONFIRMED

On current code, the Admin button toggles `showAdmin` to `true` (`App.tsx:86`) and `onSelect={setSelectedListId}` (`:97`) updates only `selectedListId`, leaving `showAdmin` true. The render waterfall (`:103`) keeps `AdminPanel` on top, so `"Admin — User Roster"` stays present and DC1's "gone" assertion FAILS pre-fix. Post-fix, `onSelect` sets `activeView="list"` and the assertion PASSES. Real regression guard, now actually reachable because the stub lets `<App/>` mount.

### Design integrity and scope creep

Spot-checked the approved Option B sections against Pass 1: `activeView` enum (§5.1), handlers (§5.3-5.4), render conditional with `&& user.role === "admin"` (§5.5), role-gating safety (§4), and initial-state parity (§7) are byte-unchanged. The only additions are the M1 test-harness items (§8.0 stub, §8.1 corrections, §5 scope note, checklist step 9, §12 log). No new scope creep; the sole non-`web/src/` file touched is the shared jsdom setup, which is exactly the M1 fix.

### Verdict rationale

All three Pass 1 required changes are folded in correctly. M1 is resolved: the harness will genuinely render, the false reasoning is corrected, scope is honest, the await-loading guidance matches App's lifecycle, and DC1 remains a real pre-fix-failing regression guard. No blocking issues remain.

APPROVE

---

## Re-review (Pass 3)

**Scope of this pass:** Verify ONLY the M2 amendment material — the second jsdom blocker (`localStorage`) and the owner's scope expansion: §8.0b shared `localStorage` stub, §5.6 `InstallBanner` guard, §8.2 guard test, §13 browser-API audit, and §8.3 T4 hardening. The Option B design and the M1 `matchMedia` stub were APPROVED in Pass 2 and are only spot-checked for byte-stability, not re-litigated. I re-read the amended plan against `web/src/components/InstallBanner.tsx`, `web/src/components/NotificationSetup.tsx`, `web/src/main.tsx`, `web/src/App.tsx`, `tests/setup/jsdom.setup.ts`, and `tests/unit/dev-auth-shim.test.ts`, and ran my own independent grep of `web/src/` for the risky-API surface.

### Spot-check: approved material unchanged — CONFIRMED

- Option B is already applied in the working tree exactly as §5.1–5.5 specify: `activeView` state (`App.tsx:14`), `showAdmin` deleted, all three tab classes/handlers (`App.tsx:71-88`), `onSelect={(id) => { setSelectedListId(id); setActiveView("list"); }}` (`App.tsx:96`), and the render conditional with `&& user.role === "admin"` (`App.tsx:102-114`). Matches the approved design.
- The M1 `matchMedia` stub is present and byte-identical to §8.0 (`tests/setup/jsdom.setup.ts:15-29`), still gated behind `typeof window.matchMedia !== "function"`.

### 1. localStorage stub sufficiency & safety — CONFIRMED

- **Shape covers the real calls.** `InstallBanner` uses only `getItem` (`InstallBanner.tsx:21`) and `setItem` (`:53`); the §8.0b stub provides `getItem/setItem/removeItem/clear/key/length` (Map-backed, `length` as a getter matching the `Storage` contract). Superset of what is needed; the `: Storage` annotation keeps `tsc` honest.
- **Gate is safe, not just plausible.** The Coder-observed error signature quoted in §8.0b — `TypeError: Cannot read properties of undefined (reading 'getItem')` — proves `window.localStorage` evaluates to the *value* `undefined` (then `.getItem` fails), NOT a throwing accessor. So the gate `typeof window.localStorage === "undefined"` returns `"undefined"` cleanly and does not itself throw at setup-module load. (If some future environment instead exposed `localStorage` via an origin-restricted *throwing* getter, the bare `typeof window.localStorage` in the gate would throw and take down every jsdom test — but that is not this environment, and the shipped M1 gate reads `window` the same way without issue. See Nit p3 for cheap insurance.)
- **Won't clobber a real localStorage.** Gated on undefined, so any environment already providing a working `localStorage` is left untouched; `InstallBanner` then exercises real jsdom storage. Consistent with the M1 gating pattern.
- **Per-test override genuinely works.** Installed via `Object.defineProperty(window, "localStorage", { value, configurable:true, writable:true })`. `configurable:true` lets §8.2's `vi.stubGlobal("localStorage", <throwing>)` replace it and `vi.unstubAllGlobals()` restore it. (`vi.stubGlobal` shadows the property on `globalThis`/`window`, which works regardless; the `configurable:true` is what guarantees clean install + restore.)
- **Actually unblocks `<App/>` mount.** Cross-checked against the audit + my own grep (item 4 below): with both stubs, the only remaining on-mount `localStorage` access (`InstallBanner:21`) returns `null`, `isIos()` is `false` in jsdom, so `setShow` is not called and the banner renders `null`. Nothing else on the mount path throws. Mount succeeds.

### 2. InstallBanner guard correctness — CONFIRMED

- `safeGetItem`/`safeSetItem` (§5.6) feature-detect (`typeof localStorage === "undefined"`, safe on a bare undeclared identifier — no ReferenceError) then `try/catch`. Neither helper can itself throw: a throwing `getItem`/`setItem` is caught; an undefined global short-circuits before access.
- **Degradation is correct.** Read failure → `null` → treated as "not dismissed" (banner may reappear, acceptable). Write failure → swallowed, and critically `setShow(false)` at `:53-54` still runs after `safeSetItem`, so Dismiss always hides the banner for the session even when persistence fails.
- **Normal behavior unchanged.** When storage works both helpers are transparent pass-throughs — same dismissed-persistence as today. The banner's iOS/standalone show logic (`:22`) is untouched.
- **Addresses the cited real-browser cases.** Safari Private Browsing (historically threw on access/quota-0 writes), storage disabled, and `QuotaExceededError` on write all land in the `catch`. Localized to `InstallBanner.tsx`; no shared util introduced. Brings `localStorage` in line with the file's already-guarded `navigator` (`:5`) and `window` (`:11`).

### 3. Guard test is a genuine guard — CONFIRMED

- **Fails without the guard.** §8.2 case 1 stubs `localStorage.getItem` to throw. UNguarded `InstallBanner:21` calls `localStorage.getItem` directly inside the mount `useEffect`; RTL flushes effects within `act()`, so the throw propagates out of `render()` with no error boundary above it → the test's "does not throw" assertion FAILS pre-guard. With `safeGetItem`, the throw is caught → returns `null` → `isIos()` false → returns `null` harmlessly → PASSES. Genuine discriminator.
- **Mechanism is viable.** The throwing stub is an object, so `typeof localStorage !== "undefined"` and the code reaches `getItem` (which throws) — exactly the path under test. `vi.stubGlobal` install/restore is enabled by §8.0b's `configurable:true`.
- **Case 2 hedge is sound.** Forcing the banner visible needs an iOS UA via `Object.defineProperty(window.navigator, "userAgent", …)` (a prototype getter; instance-shadowing + restore is the standard, workable approach). The plan correctly flags this as potentially brittle and offers a direct `safeSetItem`-swallows-throw unit-call fallback, keeping case 1 as the mandatory load-bearing assertion. Reliable overall.

### 4. Audit completeness & accuracy — CONFIRMED (independent grep)

I grepped `web/src/` for `matchMedia|localStorage|sessionStorage|navigator|serviceWorker|Notification|PushManager|indexedDB|IntersectionObserver|ResizeObserver|BroadcastChannel|caches|history|location|crypto|atob|btoa`. Every hit is accounted for in the §13 table, and I found nothing the audit missed:
- `InstallBanner.tsx`: `navigator` (`:5-6`, guarded), `matchMedia` (`:12`, reached only after `isIos()` true → never in jsdom), `localStorage.getItem` (`:21`, the sole on-mount thrower — fixed), `localStorage.setItem` (`:53`, handler-only — fixed for free).
- `NotificationSetup.tsx`: `matchMedia` (`:24` via `:37`, stubbed — safe), `Notification.permission` (`:31`, `typeof`-guarded), `navigator.userAgent` (`:37`, on mount but `navigator` exists in jsdom — no throw), `"PushManager" in window`/`"serviceWorker" in navigator` (`:41`, `in` checks never throw), `serviceWorker.ready`/`pushManager.subscribe`/`Notification.requestPermission` (`:48,50,75`, handler-only), `atob`/`btoa` (`:9,19`, helper-called, global in Node/jsdom).
- `main.tsx`: `"serviceWorker" in navigator` (`:7`, `in` check) and `navigator.serviceWorker.register` inside a `window load` listener (`:9`) — both off the component-test render path (tests import `App`, never `main.tsx`); the `load` event never fires under RTL render.
- No `sessionStorage`, `indexedDB`, `IntersectionObserver`, `ResizeObserver`, `BroadcastChannel`, `caches`, `history`, `crypto`, or `window.location` usages in `web/src/`.

The headline — "only `localStorage` blocked the mount; everything else is guarded/handler-only/mocked/off-path" — holds. No missed on-mount thrower.

### 5. T4 hardening correctness — CONFIRMED

- The current T4 (`dev-auth-shim.test.ts:168-182`) builds `mergedEnv = { ...env, OWNER_EMAIL }` and asserts `DEV_AUTH_IDENTITY` is `undefined` against the AMBIENT env — the exact contamination risk §8.3 describes. The proposed `delete (mergedEnv as {DEV_AUTH_IDENTITY?:string}).DEV_AUTH_IDENTITY;` force-unsets the key on the shallow `{...env}` own-enumerable copy, so the "unset" precondition holds regardless of `.dev.vars`/ambient state, and the shared `cloudflare:test` `env` is not mutated (delete on the copy only). This makes T4 deterministic.
- **Faithful to the extraEnv pattern.** T1–T3 SET the toggle via `makeRequest`'s `extraEnv` merge (`:90`); T4 builds its own `mergedEnv` inline and FORCE-DELETES — the correct mirror for proving "unset → 401" since it fetches through the real `testApp` (real `requireAuth`).
- **No shipped code touched, safety intact.** No change to `verifyAccessJwt`, `requireAuth`, or `isLocalDevContext`. The existing `toBeUndefined()` guard is kept (now guaranteed by the delete) and the `expect(res.status).toBe(401)` + `UNAUTHENTICATED` assertions are unchanged — still proves loopback + unset → full verification → 401. The plan explicitly instructs the Coder NOT to edit `.dev.vars` (owner removes the stray line separately). Correct and test-only.

### 6. Scope bookkeeping — CONFIRMED

The top-of-file Scope line (`:5`), §3 non-goals, §5 scope note (`:54`), §8.1 "why it mounts," DC5 (`:275`), the §9 checklist (steps 9–14), and the §12 M2 amendment log all include `InstallBanner.tsx`, the second `localStorage` stub, `InstallBanner.test.tsx`, and the T4 hardening — while consistently asserting NO server/API/schema/auth-logic change. Option B (§5.1–5.5) and the M1 `matchMedia` stub are unchanged.

### Findings (Pass 3)

No Majors. The likeliest Majors the brief flagged were checked and are absent: (a) no on-mount thrower missed by the audit; (b) the stub's `configurable:true` genuinely enables per-test override; (c) the T4 change genuinely force-unsets.

- **Nit p1 (§8.2 coupling note precision).** §8.0b/§8.2 phrase the override as depending on "`configurable:true` from §8.0b." Strictly, that guarantee only applies when the stub actually installs (i.e., `localStorage` was undefined). If a future environment already provides `localStorage`, the stub is skipped and §8.2 relies on `vi.stubGlobal` shadowing jsdom's own `localStorage` (which works regardless). Cosmetic; the test passes either way. No action required.
- **Nit p2 (T4 cast style).** The proposed T4 uses `as { DEV_AUTH_IDENTITY?: string }` whereas the existing line uses `as unknown as { … }`. Harmless stylistic drift; the Coder may keep the existing double-cast for consistency. Also note `delete` on `{...env}` assumes `DEV_AUTH_IDENTITY`, if present, is an own-enumerable property of the `cloudflare:test` `env` (true for `.dev.vars`-injected vars) — correct for this harness.
- **Nit p3 (defensive gate hardening, optional).** Both `if (typeof window.localStorage === "undefined")` and the existing `matchMedia` gate assume reading the property never throws. That holds here (the observed error proves an undefined *value*, not a throwing accessor). If the team wants belt-and-suspenders against a future origin-restricted jsdom, wrapping the localStorage gate in a `try/catch` is cheap insurance since a throw at setup-load would break ALL jsdom suites. Optional; not a blocker.

### Verdict rationale (Pass 3)

The M2 material is sound and complete. The `localStorage` stub is well-shaped, safely gated (verified against the actual observed error signature), and genuinely overridable per-test; the `InstallBanner` guard is correct, localized, non-behavior-changing on the happy path, and can't itself throw; the guard test is a real pre-guard-failing discriminator with a sensible fallback; my independent grep confirms the §13 audit missed no on-mount thrower and the "only localStorage blocked the mount" headline holds; and the T4 hardening deterministically force-unsets without touching shipped auth code or weakening the 401 safety assertion. Scope bookkeeping is honest, and the approved Option B design + M1 stub are unchanged. The three Nits are optional polish, not blockers.

APPROVE
