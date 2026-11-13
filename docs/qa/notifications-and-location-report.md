# QA Report: `feat/notifications-and-location`

Plan: `docs/plans/notifications-and-location.md`
Review: `docs/reviews/notifications-and-location-review.md` (round 1 APPROVE-WITH-CHANGES, round 2 APPROVE)
Impl notes: `docs/plans/notifications-and-location-impl-notes.md`
Branch tested: `feat/notifications-and-location` (uncommitted working tree)

## Overall verdict: PASS

No blocking defects found. All done-conditions A–F are verified either live in a real browser, live via a real cron tick against the local dev D1/Worker, or by direct inspection of the actual builder output using real item data. One live-device caveat (iPhone push receipt) is explicitly out of scope per the plan's §8 and is recorded as DEFERRED, not a failure. Two minor nits are noted below (non-blocking).

---

## Done-condition table (A–F)

| # | Condition | Result | Evidence |
|---|-----------|--------|----------|
| A | Type-aware subject/title, never raw UUID, human-readable time in item's stored timezone, location per-type, notes, deep link, push size-capped | **PASS** | Live cron-tick send (see "Live send" below) + direct invocation of `buildEmailContent`/`buildPushContent` against real item data. Event → `"Event reminder: QA Deep Link Test Event"`; task → `"Task due: QA Zoom Meeting Task"`. Time rendered as `"Sat, Jul 11, 2026, 6:07 PM EDT"` for an item stored in `America/New_York` (machine/other items were `America/Los_Angeles` — confirms per-item zone, not account-fixed). No UUID in any subject/title/body/push text (only in the non-visible `item_id` field and the deep-link URL, as designed). Push payload for the address item: `{"title":"Event reminder: QA Deep Link Test Event","body":"Sat, Jul 11, 2026, 6:07 PM EDT · 123 Main St, Springfield", "url":"...?item=...","item_id":"..."}` — well under `PUSH_MAX_BYTES=3000`. `escapeHtml` / byte-cap degradation logic verified by code read + `tests/unit/notification-content.test.ts` (19 tests, all green). |
| B | Smart location: plain stays plain, address → maps link, meeting URL → "Tap to join", override beats auto-detect, editing location resets override to NULL | **PASS** | Live-built content for 3 real items: `"Home"` → plain text, no link. `"123 Main St, Springfield"` → `<a href="https://maps.apple.com/?q=...">123 Main St, Springfield</a>`. `"https://zoom.us/j/1234567890"` → `<a href="https://zoom.us/j/1234567890">Tap to join</a>` (push body: `"... · Tap to join"`, not the raw URL). Browser-verified override reset: selected "Meeting link" override in `ItemEditor`, then edited the location text field — override select snapped back to "Auto" automatically (screenshot not needed; snapshot confirmed `option "Auto" [selected]` post-edit). List-row render (`ItemListView`) confirmed UNCHANGED — inert middot text for all 3 items, no in-app links (matches Ruling 1 scope). |
| C | Maps-provider `<select>` persists via `PATCH /api/me`; valid apple/google accepted; junk/null/missing → 400 VALIDATION; identity from JWT; default unset = Apple; URL host matches provider | **PASS** | Live: selected "Google Maps" in the browser → network panel showed `PATCH /api/me` → 200; reloaded page → select showed "Google Maps" persisted (not just optimistic). Live curl: `{"maps_provider":"waze"}` → 400 VALIDATION; `{}` → 400; `{"maps_provider":null}` → 400; `{"maps_provider":"apple","email":"attacker@evil.com"}` → 200, write went to `juniwar.dev@gmail.com` (the shim/JWT identity), confirmed via subsequent `GET /api/me` — the attacker-supplied email was ignored, never used as the write target. Fresh user reads `maps_provider:"apple"` (default-unset case, confirmed via `GET /api/me` immediately after creating the test list/user). `buildMapsUrl` host: apple → `maps.apple.com`, google → `maps.google.com` (both providers exercised against the same real address string, confirmed by direct invocation and by `tests/unit/location.test.ts`). |
| D | `?item=<id>` deep link opens the correct item's editor; NEW-1 remount regression guard; SW notificationclick fallback | **PASS** | Live browser: navigated to `http://localhost:8788/?item=<real-id>` → `ItemEditor` opened once with the correct item's title/location/notes/timezone/location-kind pre-populated (single `GET /api/items/:id` point-read, confirmed via network panel — no N-list fan-out). **NEW-1 regression, explicitly re-verified in the browser (not just the unit test):** closed the editor (Cancel) → clicked Calendar → clicked List → editor did NOT reopen; list rendered normally. This confirms `App.tsx` owns the one-shot (clears `initialOpenItem` to `null` on first consumption) rather than relying on a component-local `useRef`, which would NOT have survived the `ItemListView` remount. Deep link to a nonexistent id → "That item is no longer available." banner shown, list still renders normally behind it, no forced-open editor, no crash. SW `notificationclick` fallback verified by code inspection (`web/sw.ts:36-49`): absolute `data.url` primary, relative `"/?item="+encodeURIComponent(item_id)` fallback — could not trigger a real notification click locally (no registered push subscription in this environment; see push caveat below). |
| E | `GET /api/items/:id` authz: owner→200 w/ reminders, non-owner-private→403, missing→404 | **PASS** | Live curl against the running dev server (not just unit tests): owner reading own item → `200` with `reminders: []` populated in the shape expected. Missing id → `404 NOT_FOUND`. Non-owner-private case driven live by inserting a second user + private list + item directly into the local D1 (`someoneelse@example.com`, `qa-private-list-1`, `qa-private-item-1`) and reading it as the shimmed `juniwar.dev@gmail.com` (admin role) → `403 FORBIDDEN` — confirms admin role does NOT bypass `canReadList`, matching `getItems`'s existing semantics exactly. Test rows cleaned up after. Also covered by `tests/unit/items-get-by-id.test.ts` (4/4 green): owner-private-200, non-owner-private-403, missing-404, shared-list-member-200. |
| F | Regression / do-no-harm: `push.ts` zero-diff, existing CRUD/editor/view-switching intact, full `npm test` green | **PASS** | `git diff --stat src/worker/channels/push.ts` → empty output, exit 0 (confirmed independently, not just trusting the impl notes). `npm run typecheck` → clean. `npm test` → **124/124 passed**, 16 test files, 0 failures (includes `push-encrypt.test.ts` and `push-vapid.test.ts` unchanged/green — crypto regression guard intact). Live-browser regression pass: item CRUD via the sidebar/list view worked (create/patch/delete all used during test-data setup/teardown, all 2xx/204), `ItemEditor` save/cancel gating unaffected, view switching (List/Calendar/Admin) works and does not corrupt `activeView` single-source-of-truth state even with the deep-link addition. |

---

## Live send verification (the load-bearing gate per plan §8)

Ran a genuine local cron tick against the running `wrangler dev` instance (not merely unit tests):

1. Created a real item (`QA Deep Link Test Event`, type=event, location=`123 Main St, Springfield`, notes=`QA test notes`, timezone=`America/New_York`) via `POST /api/items`.
2. Added a reminder (`offset_minutes: 0`, both channels) via `PUT /api/items/:id/reminders`.
3. Set `start_at` ~30s in the future (materialize's occurrence-expansion window is `[now, now+LOOKAHEAD_DAYS]` — a `start_at` in the past is never materialized; this is pre-existing engine behavior, not a regression, and cost some trial-and-error to work around locally).
4. Triggered `curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"` — **note:** the manual-trigger endpoint requires the `?cron=` query param matching the pattern the Worker branches on (`event.cron === "*/5 * * * *"`); triggering without it is a silent no-op (no dispatch rows, no log line). This is a genuine local-testing gotcha worth documenting for future QA/Coder runs — not a bug in the feature.
5. First tick: `materialize inserted=2` (one email + one push dispatch row, both `pending`).
6. Waited until `fire_at` passed; second tick: `send={"sent":2,"failed":0,"transient":0}`.
7. Confirmed final dispatch-row status in D1: both rows `status: "sent"`.
8. Reconstructed the exact content the builders produced for this real item/occurrence by invoking `buildEmailContent`/`buildPushContent` directly with the same data (see Part A evidence above) — this is the actual enriched content that was passed into `sendEmail`/`sendPush` at that tick.

**Push caveat (expected, matches plan §8):** no push subscription exists in this local environment (no browser has completed the push-enable flow against this dev instance), so the push branch's `sent` classification for this specific tick is the pre-existing **zero-subscription no-op** convention (`send.ts:94-98`), not proof that `sendPush`'s encrypt+fetch path executed. This does NOT mean the crypto path is unverified — see next section.

**Push crypto verified as untouched + still green:** `git diff --stat src/worker/channels/push.ts` is empty, and `tests/unit/push-encrypt.test.ts` + `tests/unit/push-vapid.test.ts` (the crypto regression guards) both pass unchanged. Per the plan's own framing (§8, item 3), this — combined with the observed `sent`/no-error classification and zero code changes to `push.ts` — satisfies "push encryption/dispatch does not error" for this feature's scope. A live push-crypto-with-a-real-endpoint exercise would require an actual browser-registered subscription (a fake endpoint would fail at the network fetch, not meaningfully exercise or falsify the crypto), which was not available in this environment — consistent with the plan's acknowledgment that no known-good push target (desktop Chrome / Android install) exists here either.

**Email:** `.dev.vars` contains a live `RESEND_API_KEY`. The dispatch row's `status: "sent"` for the email channel reflects `result.ok === true` from the real `fetch` to `https://api.resend.com/emails` (not a no-op convention — email has no "zero targets" skip path), so this is a genuine live send. I did not have inbox access to visually confirm receipt, but the enriched content (subject, HTML, escaping, deep link, location link) is proven correct via direct builder invocation with the identical item/occurrence data used in the actual send.

---

## Defects found

None blocking. Two minor observations, not defects in the implementation:

1. **(Nit, environment/tooling)** The local manual scheduled-trigger endpoint (`/cdn-cgi/handler/scheduled`) silently no-ops without a `?cron=` query param matching one of the two branches in `handleScheduled` (`src/worker/index.ts:73,78`). Not a code defect (pre-existing wrangler/miniflare behavior + the Worker's own branch-by-cron-string design), but worth noting in a future dev-fixtures or CLAUDE.md doc so QA/Coder don't waste time on a silent no-op. Severity: informational only.
2. **(Nit)** `sendDailyDigest` still renders `d.toUTCString()` (UTC, not item timezone) — this is explicitly called out in the plan as m6/non-goal and pre-existing, not a regression of this feature. Confirmed untouched in the diff. No action needed; recording per the plan's own instruction that QA should not flag it as new.

---

## Console errors and warnings

Captured via Playwright across the full session (deep link open → close → view-switch → reopen-guard check → maps-provider change → reload → 404-notice check):

- `[ERROR] Failed to load resource: 404 @ /favicon.ico` — pre-existing, unrelated to this feature.
- `[ERROR] Failed to load resource: 404 @ /api/items/00000000-0000-0000-0000-000000000000` — this is the **expected** response for my intentional "missing item deep link" test; the app correctly caught the `ApiError` and rendered the "no longer available" notice rather than throwing.
- `[WARNING] <meta name="apple-mobile-web-app-capable"> is deprecated...` — pre-existing PWA manifest warning, unrelated to this feature.

No unexpected console errors or unhandled promise rejections observed during any part of the notifications/location/deep-link flow.

## Network failures and slow responses

All requests observed during testing returned expected status codes (200/201/204/400/403/404) with sub-10ms local latency (`wrangler dev` logs show 3-6ms per request). No timeouts, no 5xx, no slow responses.

## Accessibility observations

- The new "Location type" `<select>` in `ItemEditor` and the "Maps app for addresses" `<select>` in `NotificationSetup` both exposed correctly as `combobox` roles with associated visible text labels in the accessibility snapshot ("Location type:", "Maps app for addresses") — no unlabeled controls introduced.
- The deep-link "That item is no longer available." notice renders as plain text in a `generic` container (reusing the existing `.error-banner` class per `App.tsx`) — functionally accessible (visible, in document flow, announced as part of normal page content) though not using an ARIA live region; this matches the pre-existing pattern used for the deactivated-account and generic error banners elsewhere in the app, so it is consistent with existing conventions rather than a new regression.
- No new keyboard traps observed; Tab order through the edited `ItemEditor` form (location input → location-kind select → notes) is sequential and logical.

## Performance notes

Not in scope for this feature (no UI redesign, no new heavy rendering). No Performance-trace was run; nothing in the diff suggests a performance-sensitive change (pure content-string builders, one additional point-read route, two additive nullable columns).

## Screenshots

- `docs/qa/screenshots/notifications-and-location-list-view.png` — full-page screenshot of the List view after the deep-link remount regression check, showing all three test items (address/meeting/plain location) rendered as inert middot-separated text per Ruling 1, plus the "Maps app for addresses" select in the sidebar.

---

## Environment notes

- Ran via `npm run dev` (`wrangler dev` + `vite build --watch`, per `CLAUDE.md`), dev server on `http://localhost:8788` (note: not 8787 as the impl notes' "commands to run locally" section states — `wrangler dev`'s actual bound port in this session was 8788; worth a doc correction but not a feature defect).
- Dev-auth shim active as `juniwar.dev@gmail.com` (`DEV_AUTH_IDENTITY="owner"` in `.dev.vars`), confirmed via the `[dev-auth] shim active as juniwar.dev@gmail.com` log line and `GET /api/me` returning `role: "admin"`.
- Migrations `0004_item_location_kind` and `0005_user_maps_provider` were already applied locally (`wrangler d1 migrations list --local` reported "No migrations to apply" before I started).
- `docs/dev-fixtures.md` does not exist in this project (this is a Cloudflare Worker + D1 PWA, not a Shopify storefront — there is no storefront password gate). Per this task's project-specific environment notes (dev-auth shim via `.dev.vars`), I proceeded with the documented local harness instead of blocking on the generic Shopify-fixtures template; all dynamic/browser tests were run successfully against the real local dev server, so the verdict is a genuine `PASS`, not `DYNAMIC TESTS BLOCKED`.
- Test data (3 items + one throwaway private-list/user/item trio for the 403 check) was created directly against the local dev D1 via the running API and `wrangler d1 execute --local`, and fully cleaned up (deleted) at the end of the session.
- Browser tool used: **Playwright MCP** for all navigation, form interaction, snapshots, and console/network checks (per the tool-preference guidance — no Chrome DevTools-specific surface, like Performance traces or deep network timing, was needed for this feature). Chrome DevTools MCP was not used in this session.
- `npm run lint` could not run (pre-existing ESLint v9 flat-config gap, documented in `docs/backlog.md` and the impl notes) — `npm run typecheck` + `npm test` used as the gate instead, per project convention.

## Explicit DEFERRED vs VERIFIED statement

- **VERIFIED (this session, live):** email content correctness (subject/time/location/notes/deep-link/escaping) via a real cron tick + direct builder reconstruction against real item data; email delivery attempt via a live `RESEND_API_KEY` (dispatch marked `sent`, not `failed`/`transient`); `GET /api/items/:id` authz (owner/missing/non-owner-private) live against the running server; maps-provider preference persistence end-to-end in the browser (`PATCH /api/me` → reload → reflected); location override + edit-resets-override live in the browser; deep-link open + the NEW-1 remount-does-not-reopen regression live in the browser; deep-link 403/404 notice live in the browser; `push.ts` zero-diff independently confirmed; full `npm test` 124/124 and `npm run typecheck` clean.
- **DEFERRED (pre-existing, explicitly out of scope per plan §8 and `docs/backlog.md`):** live on-device push receipt on the owner's iPhone. Push has never been confirmed working on that device and enablement does not persist across logins — a known, pre-existing blocker tracked separately in `docs/backlog.md`, NOT a regression introduced by this feature. This feature does not touch the push subscription/crypto path (confirmed via the zero-diff check), so it cannot have regressed that pre-existing gap.
- **DEFERRED (environment limitation, not a feature gap):** exercising `sendPush`'s actual encrypt+fetch path against a real, currently-subscribed push endpoint (desktop Chrome or Android) — no such subscription exists in this local dev environment. Confirmed instead via the untouched-diff + green crypto unit tests, which is the same standard of evidence the plan itself prescribes when no known-good push target is available.

---

## Biggest risk / summary

Biggest residual risk: **none feature-specific.** The single item worth flagging forward is environmental/documentation only — the local manual cron-trigger endpoint requires an exact `?cron=` query match or it silently no-ops, which cost setup time during this QA pass and could do the same for the next person exercising a live send locally. Everything else — content correctness, location classification/override, maps-provider preference + authz, the deep-link mechanic including the NEW-1 remount guard, `GET /api/items/:id` authz, and the push-crypto zero-diff — is genuinely verified, live, in this session.

---

## Re-QA — daily-digest timezone fix (round 2)

**Scope of this section:** a single, narrow post-QA fix to `sendDailyDigest` (`src/worker/reminders/send.ts`) that was NOT part of the diff covered by the original PASS above. This does not re-run the A-F matrix; it re-verifies only the digest-timezone change, per the owner's request.

### Verdict: PASS

### What changed (confirmed by code read)

- `src/worker/reminders/send.ts`: `DigestEntry` gained `timezone: string` and `all_day: boolean`, populated at both entry sites — the non-recurring `start_at`-in-window branch and the expanded-occurrence (`expandOccurrences`) loop — both read directly from `item.timezone` / `item.all_day` (confirmed these fields genuinely exist on the `Item` type in `src/worker/types.ts:50,52`, not fabricated).
- A new pure, exported `composeDigestBody(entries: DigestEntry[]): { html, text }` was extracted from what was previously inline composition inside `sendDailyDigest`. `sendDailyDigest` now calls it directly. This makes the timezone rendering unit-testable without a live D1/Resend round trip, as intended.
- Rendering goes through `formatOccurrenceTime(start_at, timezone, all_day)` from `src/shared/itemLabels.ts`, the same helper already used by the per-item `content.ts` builders (confirmed by read: `typeLabel`/`formatOccurrenceTime`/`formatInZone`, with a three-tier fallback chain — item timezone → schema-default `America/Los_Angeles` → explicit-`"UTC"`-suffixed UTC → ISO string as the absolute last resort — never a raw epoch).
- Confirmed the old `Date#toUTCString()` path is fully gone: `grep -rn "toUTCString" src/ tests/` returns only a comment inside `digest-content.test.ts` describing the prior (now-fixed) behavior — zero live call sites remain.
- The plain-text digest branch previously had NO time component at all; it now calls `formatOccurrenceTime` too, so text and HTML are now consistent with each other and with the item's stored zone.

### Test run

`npm test` — **129/129 tests passed, 17 test files, 0 failures.** `tests/unit/digest-content.test.ts` specifically: **5/5 passed** (65ms). Full run also re-confirmed `push-encrypt.test.ts` (1/1) and `push-vapid.test.ts` (3/3) green, and every other previously-passing suite (`notification-content.test.ts` 19/19, `location.test.ts` 25/25, `items-get-by-id.test.ts` 4/4, `me-maps-provider.test.ts` 7/7, `db.test.ts` 14/14, `routing.test.ts` 6/6, `items-validation.test.ts` 10/10, `recurrence.test.ts` 6/6, `dev-auth-shim.test.ts` 11/11, `auth-deactivated.test.ts` 6/6, plus the 4 web/jsdom suites: `InstallBanner.test.tsx` 2, `ItemEditor.test.tsx` 3, `App.deeplink.test.tsx` 3, `App.test.tsx` 4) still passed unchanged.

`npm run typecheck` — **clean**, no output/errors from either `tsc --noEmit -p tsconfig.worker.json` or `tsc --noEmit -p tsconfig.web.json`.

### Assessment of `digest-content.test.ts` rigor: adequate, no gaps

Read the full file (`tests/unit/digest-content.test.ts`, 5 tests). It genuinely proves the fix, not just that the function runs:

1. **Non-UTC rendering for a timed occurrence** — asserts `"2:30 PM"` and `"EDT"` appear in both `html` and `text` for an `America/New_York` item at a fixed instant (`2026-07-15T18:30:00Z`), AND explicitly asserts the old UTC forms (`"18:30"`, `"GMT"`, `"UTC"`) do **not** appear. This is the strongest possible assertion shape for this fix — it doesn't just check the new behavior is present, it checks the old bug's signature is absent, so a regression back to `toUTCString()` would fail loudly on the negative assertions even if someone forgot to check for the positive string.
2. **Same instant, two zones, different output** — NY renders `"2:30 PM" / "EDT"`, LA renders `"11:30 AM" / "PDT"` for the identical epoch, and asserts `ny !== la`. This is the single most important test for "per-item timezone, not account-fixed" and it's done correctly with a real UTC-anchored instant rather than a local-clock-dependent `new Date()`.
3. **All-day renders date-only** — asserts the date string is present, no time-of-day (`"2:30 PM"` absent), and no `timeZoneName` suffix (`"EDT"` absent). Correctly exercises the `allDay` branch of `formatInZone`.
4. **Title/list-name presence** — sanity check that the extraction didn't drop content, in both `html` and `text`.
5. **Empty-window fallback** — asserts the "No items scheduled..." string in both `html` and `text` for `composeDigestBody([])`.

No weak or missing assertions identified. One very minor nit-of-a-nit (not a gap, just an observation): none of the five tests directly exercises the fallback-to-UTC-with-suffix branch (invalid/empty timezone string) inside `formatOccurrenceTime` itself — but that fallback chain is already covered by `formatOccurrenceTime`'s own existing unit coverage from the earlier notifications-and-location PASS (`notification-content.test.ts`/`location.test.ts` exercise the shared helper via the per-item builders), so it is not a hole introduced by this fix; `composeDigestBody` is a thin pass-through to the same already-verified helper.

### Regression guard

- `git diff --stat src/worker/channels/push.ts` — **empty output**, confirmed independently in this round-2 session. Push crypto/encrypt path untouched.
- `sendDue` (the per-item send path, both email and push branches) — read in full; unchanged by this round-2 fix. Its use of `buildEmailContent`/`buildPushContent`/`resolveMapsProvider` reflects the already-QA'd feature diff from the original PASS, not a new edit in this round. The digest fix is isolated to the `DigestEntry` interface, the new `composeDigestBody` extraction, and `sendDailyDigest`'s call site — no lines inside `sendDue` changed as part of this specific follow-up.

### Known, already-backlogged gap (not a new finding, not a blocker)

`composeDigestBody` interpolates `title` and `listName` into the HTML unescaped (`<strong>${e.title}</strong>`, `${e.listName}`). This is a **pre-existing** gap — the per-item builders in `content.ts` escape user text via `escapeHtml`, but the digest path never has. It is already recorded on the `docs/backlog-attachments-push` branch and was intentionally left out of this timezone-only fix to keep the change narrow. Confirmed present in the code by direct read; not re-flagged here as a new defect, per the scoping instructions for this round.

### Conclusion

The digest-timezone fix does exactly what it claims: entries now carry `timezone`/`all_day` from the source item, rendering goes through the same shared, already-hardened `formatOccurrenceTime` helper used elsewhere in the codebase, the old always-UTC `toUTCString()` call site is completely gone, the new test suite proves both "not UTC" and "correct per-zone value" with strong negative + differential assertions, the full suite remains green at 129/129 (up from the prior 124/124, net +5 for the new digest test file), typecheck is clean, and the push-crypto path is independently reconfirmed untouched.
