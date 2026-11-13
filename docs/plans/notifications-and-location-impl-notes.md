# Implementation notes: `feat/notifications-and-location`

Plan: `docs/plans/notifications-and-location.md`
Review: `docs/reviews/notifications-and-location-review.md` (round 1 APPROVE-WITH-CHANGES, round 2 APPROVE)
Branch: `feat/notifications-and-location` (based on `main` at commit `0398c93`, which already contained the approved plan + review docs). Working tree left uncommitted for review per instructions.

## Summary

Implemented Parts A (rich notification content) and B (smart location classification) exactly
as specified in the plan, including both round-2 required fixes (NEW-1 deep-link one-shot
ownership, NEW-5 `PATCH /api/me` enum guard). Both owner-approved migrations were created and
applied locally. `src/worker/channels/push.ts` has zero diff (confirmed below).

## Files changed, grouped by layer

### Migrations (new)
- `migrations/0004_item_location_kind.sql` — additive nullable `items.location_kind TEXT`.
- `migrations/0005_user_maps_provider.sql` — additive nullable `users.maps_provider TEXT`.
- Both applied locally via `npx wrangler d1 migrations apply family-scheduler --local` (confirmed `✅` for both; `wrangler d1 migrations list --local` now reports "No migrations to apply").

### Shared, framework-agnostic modules (new) — `src/shared/`
- `src/shared/itemLabels.ts` — `typeLabel()`, `formatOccurrenceTime()` (Intl-based, timezone fallback chain: item tz → schema default `America/Los_Angeles` → UTC with explicit suffix → ISO string as a last resort). No luxon dependency (kept Worker/web-portable).
- `src/shared/location.ts` — `classifyLocation()`, `resolveLocationKind()`, `resolveLocationRender()` (the override-edge-rule resolver used by the content builders), `buildMapsUrl()`, `resolveMapsProvider()`, `LocationKind`/`MapsProvider` types.
- `src/shared/deepLink.ts` — `buildItemDeepLink()`, `parseItemDeepLink()`.

### Worker
- `src/worker/reminders/content.ts` (new) — `buildEmailContent()`, `buildPushContent()`, `escapeHtml()`, `PUSH_MAX_BYTES` (3000, enforced via `TextEncoder().encode(...).byteLength`, with a two-step degrade: drop location summary, then halve title length).
- `src/worker/reminders/send.ts` — content-only edit. Added `getItemByIdUnchecked` + recipient `getUser` lookup before building content; on `item === null` (deleted between materialize and send) marks the dispatch `sent` no-op and `continue`s, exactly per plan §3.2. Dispatch selection, `markDispatch` calls, classification branches, counting, and `sendDailyDigest` are untouched.
- `src/worker/db.ts` — added `getItemForUser()` (authorized point-read mirroring `getItems`'s authz: item-existence-first, then `canReadList`), `getItemByIdUnchecked()` (engine, no-authz, mirrors `getListById`), `updateMapsProvider()`. Extended `mapUser`/`mapItem`/`createItem` INSERT/`updateItem` UPDATE for the two new columns.
- `src/worker/routes/items.ts` — new `GET /api/items/:id` route on `itemsRouter` (mounted at `/api`, so path is `/api/items/:id` — verified no collision with `remindersRouter`'s `/api/items/:id/reminders`, mounted separately in `index.ts`). Added `location_kind` enum validation (`validateLocationKind`/`isLocationKind`) wired into POST and PATCH.
- `src/worker/routes/me.ts` — new `PATCH /` handler for `maps_provider` (NEW-5): rejects anything outside `{'apple','google'}` including `null`/missing/non-string with `400 VALIDATION`; write target is always `c.get("user").email` (JWT identity), body is never trusted for identity.
- `src/worker/types.ts` — added `location_kind` to `Item`/`ItemRow`/`CreateItemInput` (flows into `UpdateItemInput` via the existing `Partial<Omit<...>>` derivation); added `maps_provider` to `User`/`UserRow`.

### Web
- `web/src/App.tsx` — deep-link resolution: parses `?item=` via `parseItemDeepLink`, point-reads via `getItem()`, sets `selectedListId`/`activeView="list"`/`initialOpenItem` on success, or a dismissible `deepLinkNotice` on 403/404. **NEW-1 fix**: `initialOpenItem` is owned by `App`, cleared to `null` via `onInitialOpenItemConsumed` the first time `ItemListView` reports consuming it — this survives an `ItemListView` remount (Calendar/Admin round-trip), unlike a component-local `useRef` guard. Also wires `onUserChange` down to `ListSidebar` for the maps-provider select's optimistic user update.
- `web/src/components/ItemListView.tsx` — added `initialOpenItem`/`onInitialOpenItemConsumed` props; a `useEffect` opens the editor and immediately reports consumption (no local ref — ownership lives in `App`, per NEW-1).
- `web/src/components/ItemEditor.tsx` — added `location_kind` to the draft state; location `<input>` `onChange` now also resets `location_kind` to `null` (override edge rule — editing location clears a stale override); added the "Auto/Plain/Address/Meeting" `<select>`, shown only when location is non-empty; `updateItem` PATCH call now includes `location_kind`.
- `web/src/components/NotificationSetup.tsx` — added optional `user`/`onUserChange` props; renders a "Maps app for addresses" `<select>` (Apple default / Google) wired to the new `updateMapsProvider()` API call. Kept independent of the push-enable/subscription branches (renders in all of them, including the iOS-non-standalone early return) — the preference is not push-support-gated.
- `web/src/components/ListSidebar.tsx` — threads `onUserChange` through to `NotificationSetup`.
- `web/src/apiClient.ts` — added `getItem(id)`, `updateMapsProvider(provider)`; extended `ItemUpdatePatch` with `location_kind`.
- `web/src/types.ts` — added `location_kind` to `Item`/`ItemDraft`; added `maps_provider` to `User`.
- `web/sw.ts` — hardened `notificationclick`: `data.url` (absolute) stays primary; added a relative `"/?item="+encodeURIComponent(item_id)` fallback reconstructed from `data.item_id` if `url` is absent. No change to the push-receive path.

### Tests (new)
- `tests/unit/location.test.ts` — 25 tests: classification (plain/meeting/address/generic-URL), override precedence + edge rules (address-override-on-non-address, meeting-override-with-no-URL degrades to plain), `buildMapsUrl` both providers, `resolveMapsProvider`.
- `tests/unit/notification-content.test.ts` — 19 tests: type-aware subject, localized time in `America/New_York` (non-default zone), occurrence_at-not-start_at, location rendering per kind/provider, deep link presence, no-raw-UUID, HTML escaping of injected `<script>`/quotes, push byte cap via `TextEncoder` (including a multibyte-emoji fixture proving byte length > string length).
- `tests/unit/items-get-by-id.test.ts` — 4 tests: owner-private-200, non-owner-private-403, missing-404, shared-list-member-200.
- `tests/unit/me-maps-provider.test.ts` — 7 tests: apple/google accepted, missing/null/junk/non-string rejected with 400, and a test proving a body-supplied `email` field is ignored (identity is JWT-only).
- `web/src/App.deeplink.test.tsx` — 3 tests: deep link opens the editor via a single `getItem` point-read; 403/404 shows a notice with no editor forced open; **NEW-1 regression guard** — close the deep-linked editor, switch to Calendar, switch back to List, assert the editor does NOT reopen.

### Tests (edited — pre-existing fixtures updated for the new required fields)
- `tests/unit/db.test.ts` — its local `applyMigrations` fixture now also ALTERs in `items.location_kind` and `users.maps_provider` (same try/catch idempotent pattern already used for migration 0003).
- `tests/unit/items-validation.test.ts` — inline schema fixture extended with the two new columns; `FAKE_USER` literal extended with `maps_provider: null`.
- `tests/unit/routing.test.ts` — `FAKE_USER` literal extended with `maps_provider: null`.
- `web/src/App.test.tsx` — `ADMIN_USER`/`MEMBER_USER` literals extended with `maps_provider: null`.
- `web/src/components/ItemEditor.test.tsx` — `EXISTING_ITEM` literal extended with `location_kind: null`.

These five edits were required purely because `User`/`Item` gained new required fields; no test *behavior* was changed.

## Commands to run the feature locally

```
npm install
npx wrangler d1 migrations apply family-scheduler --local   # already applied in this session
npm run dev                                                   # wrangler dev, serves Worker API + PWA
```

Exercise the deep link locally: open `http://localhost:8787/?item=<an-existing-item-id>` — the
app should point-read the item and open its editor once; navigating to Calendar and back to
List must not reopen it. Exercise the maps-provider preference in the sidebar's notification
setup area (select persists via `PATCH /api/me`). Live email verification requires a cron tick
with `RESEND_API_KEY`/`EMAIL_FROM` configured (per plan §8 — QA's protocol, not exercised here).

## Deviations from the plan

None substantive. Two implementation choices made where the plan explicitly left room for the
Coder to decide (both called out in the plan text itself):

1. **Recipient's maps-provider read in `send.ts`** — implemented as a plain `getUser(db, row.recipient_email)` call (already existed in `db.ts`) rather than adding a dedicated `getUserMapsProvider` helper, since `getUser` already returns the full mapped `User` (including `maps_provider`) in one query with no extra join. The plan explicitly said "Coder picks whichever avoids an extra query; note whichever is used" (§Decision 6) — this is that note.
2. **Maps-provider UI threading** — `NotificationSetup` did not previously receive a `user` prop; threaded `user`/`onUserChange` through `ListSidebar` (which already receives `user`) down to `NotificationSetup`, and wired `onUserChange` back up to `App`'s `setUser`. This is additive prop-threading only, no restructuring of existing components, and keeps the maps-provider select fully independent of the push-enable/subscription logic (renders in every branch of `NotificationSetup`, including the iOS-non-standalone early return) per the plan's "do not touch the push-enable logic" constraint.

Nothing in the plan turned out infeasible; no blocker file was needed at
`docs/plans/notifications-and-location-coder-questions.md`.

## Out-of-scope observations (pre-existing, not touched)

- `tsconfig.sw.json` (a separate, narrower tsconfig for `web/sw.ts`, not wired into `npm run typecheck`) fails to compile against the current `web/sw.ts` on `main` itself (missing `ServiceWorkerGlobalScope`/`WorkerGlobalScope` overloads — likely needs a `webworker` lib addition or `skipLibCheck`-adjacent fix). Verified via `git stash` that this pre-dates this feature branch's changes and is not part of the real `npm run typecheck` gate. Not fixed here — separate backlog item.
- `npm run lint` cannot run at all (ESLint v9 requires `eslint.config.js`; the repo only has the v8-style invocation in `package.json`). Documented in the plan and project backlog as a known gap; per the Coder instructions this was not touched. `npm run typecheck` was used as the gate instead, per instructions.
- `sendDailyDigest` (`send.ts`) still renders `d.toUTCString()` (UTC, not item timezone) — the plan explicitly scoped this out (m6, non-goal) since `formatOccurrenceTime` didn't exist before this feature. Left untouched, as directed.

## Verification performed

- `git diff --stat src/worker/channels/push.ts` → **empty output, exit code 0** — zero changes confirmed.
- `npm run typecheck` → clean (`tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json`), no errors.
- `npm run lint` → fails immediately with the pre-existing ESLint v9 flat-config gap (`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`) — could not run; typecheck + tests used as the gate per instructions.
- `npm test` → **124 passed / 124 total**, 16 test files, 0 failures. Baseline was 66/66; net +58 new tests across 5 new test files (`location.test.ts` 25, `notification-content.test.ts` 19, `items-get-by-id.test.ts` 4, `me-maps-provider.test.ts` 7, `App.deeplink.test.tsx` 3) plus edits to 5 pre-existing fixture files (no behavior change, just added required fields to literals).
- `npx wrangler d1 migrations apply family-scheduler --local` → both `0004_item_location_kind.sql` and `0005_user_maps_provider.sql` applied successfully (`✅`); `wrangler d1 migrations list --local` now reports no pending migrations.
- `npm run build` (vite) → succeeds, confirms the new `src/shared/*` cross-bundle imports resolve correctly for the web bundle despite living outside `web/src/`.
- Crypto regression guard: `tests/unit/push-encrypt.test.ts` and `tests/unit/push-vapid.test.ts` both still pass unchanged, confirming no regression to the untouched push crypto path.

---

## Post-QA addendum — daily-digest timezone fix (2026-07-11)

QA (PASS) surfaced a **pre-existing** nit: `sendDailyDigest` rendered occurrence times with `Date#toUTCString` (always UTC), inconsistent with the per-item reminder builders this feature added (which render in the item's stored timezone). The owner elected to fix it now rather than backlog it. This is OUTSIDE the originally-approved/QA'd plan scope (plan m6 marked it a non-goal), folded in as a small, isolated, test-covered change:

- `DigestEntry` now carries `timezone` + `all_day`, populated at both entry sites (non-recurring + expanded-occurrence).
- Extracted a pure, exported `composeDigestBody(entries)` (html + text) from the inline loop composition, so the rendering is directly unit-testable without a live D1/Resend round-trip.
- Each occurrence renders via the shared `formatOccurrenceTime(start_at, timezone, all_day)` — same graceful-degradation (labelled-UTC fallback, never a raw epoch) as the per-item builders. The plain-text digest, which previously omitted the time entirely, now includes it too.
- New `tests/unit/digest-content.test.ts` (5 tests): NY-local render, NY-vs-LA divergence for one instant, all-day date-only, title/list present, empty-window fallback. Suite: 124 → **129/129**.
- `push.ts` remains zero-diff; `npm run typecheck` clean.

**Known follow-up left OUT (kept the change narrow):** the digest interpolates `title`/`listName` into HTML **unescaped** (the per-item builders escape via `content.ts`). Same class of gap as the escaping the content builders fixed. Flagged in a code comment on `composeDigestBody` and a backlog candidate.
