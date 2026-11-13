# Plan Review: `feat/notifications-and-location`

Reviewer: Plan-Reviewer (adversarial pass, read-only on code and plan).
Plan under review: `docs/plans/notifications-and-location.md`
Authoritative spec: `docs/notifications-location-brief.md`
Date: 2026-07-11

---

## Overall verdict: APPROVE-WITH-CHANGES

The plan is unusually strong on the highest-risk surface (push crypto). Every locked-crypto claim I checked is accurate, the `send.ts` line ranges are correct, the schema-backed `timezone` field genuinely exists and is `NOT NULL DEFAULT`, and the migration numbering is right. Parts A/B are well-decomposed into pure shared modules, and the QA-without-iPhone protocol is sound.

However, the plan is materially underspecified on the **frontend deep-link "open the item" mechanic**, and it repeatedly assumes an item **"detail view"** that does not exist in this codebase (items only open into an *edit form*). These are not blockers to the design but they are gaps the Coder would have to guess through, and guessing risks colliding with the recent `activeView` single-source-of-truth refactor. There is also one factual over-claim about "notes/full location surfaced after tap-to-open" that the current UI cannot satisfy. Fold in the changes below before the Coder starts.

---

## Findings by severity

### Blocker
None. No locked-zone violation, no crypto risk, no data-model overreach beyond the single additive column (which is explicitly owner-gated).

### Major

**M1 — There is no "item detail view"; deep link can only open the ItemEditor.**
The brief and plan both say the deep link "opens the specific item['s] detail view" (brief line 27; plan §1 Goals, §5.3). In the actual code, `ItemListView.tsx` has no read-only detail view — an item opens into the **edit form** via `setEditingItem(item)` (`web/src/components/ItemListView.tsx:120`, rendered at `:73-90`). Consequences the plan does not address:
- The "tap to open surfaces notes + full tappable location" promise (plan Decision 5, §"Everything else") is **false as written**: `ItemEditor` is a form, not a rich detail render. A meeting link opened via deep link will land the user in an edit form where the location is an `<input>`, not a "Tap to join" affordance — unless `LocationDisplay` is also placed somewhere the deep-linked user sees it.
- **Fix:** State explicitly that "open the item" = open `ItemEditor` for that item (the only detail affordance today), and EITHER (a) scope the plan honestly to "deep link opens the item's editor" and drop the "full tappable location after tap-to-open" claim, OR (b) add a minimal read-only detail render (out of scope for a no-redesign feature — prefer (a)). Reference `ItemListView.tsx:73-90, :120`.

**M2 — `initialOpenItemId` wiring across the App→ItemListView boundary is hand-waved and races the list load.**
`ItemListView` loads its own items via an effect keyed on `listId` (`ItemListView.tsx:21-29`); `App.tsx` never fetches items itself (`loadMe` returns only `{ user, lists }`, confirmed `apiClient.ts:59`). The plan's §5.3 flow is: App iterates `getItems(listId)` across visible lists to *find* the item, sets `selectedListId` + `activeView="list"`, then passes the id down. But then `ItemListView` will **re-fetch** the same list's items (double fetch), and the auto-open must wait for that second fetch to resolve. The plan says only "add an `initialOpenItemId` prop … so the deep-link boot can auto-open" — it does not specify the effect that reconciles `initialOpenItemId` against the async-loaded `items`, nor the double-fetch.
- **Fix:** Specify concretely: (1) `ItemListView` gets `initialOpenItemId?: string`; (2) an effect that, once `items` are loaded and contain a matching id, calls `setEditingItem(match)` exactly once (guard against re-opening after the user closes it — e.g. clear the intent after first use, or lift `editingItem` to a one-shot). (3) Decide whether App-level iteration hands the found `Item` object down (avoiding the re-fetch) or only the id (accepting the re-fetch). Reference `ItemListView.tsx:15-29, :73`.

**M3 — Deep-link resolution does N sequential `getItems` calls with no bound or ordering guarantee.**
§5.3 resolves the item by iterating every visible list and calling `getItems(listId)` until found. For a family with several lists this is a burst of sequential authenticated fetches on every cold boot that has `?item=` — and if the item is in the last list, all are made. It also runs on *every* deep-link open, competing with the normal first-list load `ItemListView` already fires.
- **Fix:** Either (a) accept it but cap/short-circuit and document the cost, or (b) reconsider the flagged `GET /api/items/:id` endpoint (§6 open question 2). A single authorized point-read is cleaner, avoids the double-fetch of M2, and is a tiny additive route mirroring existing `db.ts` authorization. I do not *impose* the endpoint, but the plan's default ("no endpoint, iterate") trades a 15-line route for a fan-out of N list reads plus a redundant re-fetch — the tradeoff should be re-decided, not defaulted. Reference `send.ts` already imports `getVisibleLists`/`getItems` server-side as precedent for a trusted read.

**M4 — SW `notificationclick` receives an absolute URL; the plan's "reconstruct `/?item=`" fallback mixes absolute and relative.**
Current SW navigates to `data.url` which will be the full `${APP_URL}/?item=<id>` (absolute). The plan's hardening (Decision 2, consumer 3) reconstructs `"/?item=" + encodeURIComponent(item_id)` — a **relative** path — as the fallback. That is fine for `navigate`/`openWindow` (resolved against SW scope), but the plan should confirm the primary path stays absolute and the fallback relative, and that `client.navigate(absoluteUrl)` to a different-origin-looking-but-same-origin URL still focuses rather than opening blank. Also note: the SW already stores `item_id` in `data` (`web/sw.ts:25`), so the fallback is feasible — but the plan cites `sw.ts:33-59` / `:36-37`; the actual click handler is `:33-59` and the url read is `:36-37`, which is correct. Minor accuracy is fine; the absolute-vs-relative coherence is the real gap.
- **Fix:** Specify that the fallback yields a relative `"/?item="+id`, that `data.url` (absolute) remains primary, and add a one-line note that the existing `navigate`-then-`focus` loop already handles the deep link with zero crypto/push-receive change. Reference `web/sw.ts:36-49`.

### Minor

**m1 — `LocationDisplay` must fit an inline `·`-separated flow, not a block.**
Line 183 is `{item.location && <> · {item.location}</>}` — location renders inline after a middot inside a muted `<div>` (`ItemListView.tsx:181-184`). The plan describes `LocationDisplay` generically as "plain text / a maps `<a>` / a 'Tap to join' `<a>`." The Coder must keep it inline (a `<span>`/anchor, not a block) or the list row layout breaks. State this.

**m2 — D3 override semantics are coherent, but the render-precedence and "clear override on location edit" case is unstated.**
`resolveLocationKind(location, override) = override ?? classifyLocation(location).kind` is coherent and stored-override-beats-auto is the right precedence. But: if a user sets override=`meeting` then later edits `location` from a Zoom URL to "Home", the stored `meeting` override now mislabels "Home" as a joinable meeting (with no href, since `classifyLocation("Home")` yields none — so `resolveLocationKind` returns kind `meeting` but there is no URL to join). Decide: does editing `location` reset `location_kind` to `null`? Recommend yes (reset on location change) or at minimum have the builder guard "meeting kind with no derivable href → fall back to plain." Reference plan Decision 3, §"Effective kind".

**m3 — `href` provenance when override forces a kind that the raw string can't support.**
Related to m2: `classifyLocation` computes `href` from the raw string. If override says `address` but the string is a bare "Home", `buildMapsUrl("Home")` yields `maps.google.com/?q=Home` — a maps search for the literal word "Home". That is arguably acceptable (user explicitly asked for a map), but the plan should state that override=`address` always produces a maps href from the raw text (search query semantics), and override=`meeting` requires a URL in the text or degrades to plain. Make the href-derivation-under-override rule explicit for the Coder.

**m4 — Decision 4 (single `maps.google.com/?q=`) is defensible but leaves a known iPhone UX wrinkle; keep it flagged, don't silently accept.**
The owner's primary device is an iPhone. `https://maps.google.com/?q=` does open Apple Maps when Google Maps isn't installed, so the done-condition ("opens a maps app to the address") is met. Punting Apple-Maps-first is the right *default* for cross-platform correctness (Apple Maps links degrade badly on Android/desktop). This is correctly flagged as open question 3 — keep it as an explicit owner confirmation, not a silent choice. No change required beyond ensuring the owner actually signs off on Q3 alongside the Q1 migration gate.

**m5 — Push byte budget: `PUSH_MAX_BYTES = 3000` is safe but the degradation order should also cap `body` time string.**
The record ceiling is 4096 (`push.ts:225` `recordSize = 4096`), and aes128gcm adds salt(16)+rs(4)+idlen(1)+serverPubKey(65)+GCM tag(16) ≈ 102 bytes of framing over the plaintext, plus the `0x02` delimiter. A 3000-byte JSON budget is comfortably safe. Degradation order (drop location → truncate title) is reasonable, but a pathological IANA zone abbreviation is bounded, so the localized time line is effectively fixed-size — fine. Just confirm the cap is measured on the **serialized JSON string bytes** (UTF-8), not JS string length, since titles may contain multibyte chars. State "byte length via `TextEncoder`, not `.length`."

**m6 — Email `sendDailyDigest` is untouched but shares the "epoch → human time" problem.**
`sendDailyDigest` (`send.ts:203-222`) renders `d.toUTCString()` — not the item timezone, and not the new `formatOccurrenceTime`. The plan correctly scopes it out (non-goal), but since the new `formatOccurrenceTime` shared helper will exist, note as a follow-up that the digest still emits UTC. Not a blocker; avoid scope creep. Just record it so QA doesn't flag the digest as a regression when it was already UTC.

### Nit

**n1 — `getItemById` no-email-arg rationale is sound; make the comment cite P2-N1 explicitly.**
The plan's justification (dispatch already authorized at materialize; cron is trusted context; mirrors `getListById` at `db.ts:1081`) is correct — `getListById` indeed takes no email (confirmed `db.ts:1081-1090`). Ask the Coder to reference P2-N1 (purge-before-cascade) in the WHY comment so the "null is rare" claim is traceable.

**n2 — Null-item handling counts as `summary.sent++`.**
Plan §3.2 marks the deleted-item dispatch `sent` (no-op) and the checklist says `summary.sent++`. This mirrors the zero-subscription convention (`send.ts:68-73`) and is defensible, but it slightly inflates the "sent" metric with rows that sent nothing. Acceptable; just confirm QA's `wrangler tail` interpretation accounts for it (a `sent` with no actual email/push).

**n3 — `mapItem` is at `db.ts:59`, not cited.**
Plan references `mapItem` and the "existing private `mapItem`" — it exists at `db.ts:59` and is currently module-private. `getItemById` can use it directly (same module). Fine, just confirming the claim holds.

**n4 — HTML-escaping call-out is correct and important.**
Plan §7 edge cases correctly identifies that titles/notes/location are now user text interpolated into email HTML (previously only a UUID). The `escapeHtml` requirement in `content.ts` is the right call and is genuinely a light-security item. Keep it; ensure the test asserts an injected `<script>` / `"` in title/notes is escaped in the `html` output.

---

## Verification of the plan's load-bearing claims (all checked against source)

- **push.ts zero-edit claim — TRUE.** The enumerated locked ranges are accurate: b64url helpers `:32-56`, `signVapidJwt` `:62-107` (JWK-from-raw import), `encryptPayload` `:119-222` (single-`0x00` info strings at `:163`,`:189`,`:198`; `0x02` delimiter at `:209`), `buildPushBody` `:224-231`, `sendPush` fetch+classification `:241-291`. `PushPayload` already carries `title/body/url/item_id` (`:14-19`). Enriching only the payload object passed into `sendPush` needs zero edits to this file. Claim holds.
- **`send.ts:46-48` email / `:75-80` push — TRUE.** Exact lines match. The `summary` shape `{sent,failed,transient}` matches the plan's counting.
- **Item `timezone` exists and is populated — TRUE.** `Item.timezone: string` (`types.ts:49`), schema `timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'` (`migrations/0001_init.sql:29`). The §3.4 fallback chain is purely defensive, as the plan states.
- **`occurrence_at` on dispatch row — TRUE.** `ReminderDispatch.occurrence_at` (`types.ts:72`); using it over `item.start_at` for recurring items is correct.
- **`getListById` precedent, no email arg — TRUE** (`db.ts:1081-1090`). `getItemById` does not yet exist (correctly "add").
- **Migration numbering — TRUE.** Only `0001/0002/0003` exist; `0004` is next.
- **SW already consumes `data.url` and stores `item_id` — TRUE** (`web/sw.ts:25, :36-37`).
- **`activeView` single-source-of-truth — TRUE** (`App.tsx:14`, set via `:72/:78/:84/:96`). The deep-link plan sets `activeView="list"` which is compatible with this model; no conflict *provided* M2's one-shot open is handled so it doesn't fight later user navigation.

No locked-zone violation found. The one additive column is owner-gated with a clean derive-only fallback.

---

## Punch-list — required before Coder starts

1. **(M1)** Correct the "detail view" language throughout: deep link opens the item's **`ItemEditor`** (the only detail affordance in this codebase). Drop or rescope the "notes + full tappable location surfaced after tap-to-open" claim, since `ItemEditor` is a form, not a rich detail render.
2. **(M2)** Specify the `initialOpenItemId` mechanic concretely: the reconciling effect in `ItemListView`, the one-shot open guard (so it doesn't reopen after the user closes it), and whether the found `Item` is passed down (avoiding a redundant re-fetch) or re-fetched.
3. **(M3)** Re-decide the deep-link resolution strategy: either accept the N-list `getItems` fan-out with an explicit bound/short-circuit and document the redundant fetch, or adopt the flagged `GET /api/items/:id` point-read (recommended — it also resolves M2's double-fetch).
4. **(M4)** Make the SW fallback absolute-vs-relative coherent: `data.url` (absolute) primary, reconstructed `"/?item="+id` (relative) fallback; confirm no crypto/push-receive change.
5. **(m2/m3)** State the override edge rules: whether editing `location` resets `location_kind` to `null`, and how `href` is derived when an override forces a kind the raw string can't support (address→maps search query; meeting-with-no-URL→degrade to plain).
6. **(m5)** Specify the push byte cap is measured on UTF-8 serialized bytes via `TextEncoder`, not string `.length`.

APPROVE-WITH-CHANGES

---

## Re-review (round 2)

Reviewer: Plan-Reviewer (focused re-review of the AMENDED plan).
Date: 2026-07-11
Scope: verify the 6-item punch-list is resolved, and adversarially inspect the three new surfaces the owner rulings introduced (`GET /api/items/:id`, migration `0005_user_maps_provider`, the maps-provider user preference).

### Punch-list resolution table

| # | Item | Status | Evidence in amended plan / code |
|---|------|--------|---------------------------------|
| M1 | "Detail view" language corrected; drop "full tappable location after tap-to-open" | **PASS** | §1 Goals, §1 "Explicit scope note (Ruling 1 / M1)", §2 non-goals, Decision 5 all rescope "open the item" = open `ItemEditor`; `LocationDisplay` explicitly dropped; smart-location render scoped to notification content only. Matches code: `ItemListView.tsx:120` `setEditingItem`, `:73-90` renders `ItemEditor`, `:181-184` inert `{item.location}`. Claim verified accurate. |
| M2 | Concrete `initialOpen*` mechanic + one-shot guard + no double-fetch | **PARTIAL** | §5.3 now specifies passing the fetched `Item` down as `initialOpenItem`, a `useRef` one-shot guard, and no re-fetch of the item (list-load effect at `:21-29` still fires for the list, which is expected). Mechanic is feasible and correctly avoids the item double-fetch. BUT the one-shot ref is component-local and does not survive an `ItemListView` remount on view switch → reopen-loop gap (see NEW-1 below). |
| M3 | Re-decide N-list fan-out vs point-read | **PASS** | Adopted `GET /api/items/:id` + `getItemForUser` (Ruling 2). Fan-out eliminated; boot handler point-reads once and passes the `Item` down. §3.2, §5, Decision 2, §6. |
| M4 | SW fallback absolute-primary / relative-fallback coherence | **PASS** | Decision 2 consumer 3: `data.url` absolute primary; relative `"/?item="+encodeURIComponent(item_id)` fallback from `data.item_id` (present in `sw.ts:25`); one-line `?? fallback`; zero crypto/push-receive change; no shared-module import into the SW bundle. Matches `sw.ts:36-49`. |
| m2/m3 | Override edge rules explicit | **PASS** | Decision 3 "Override edge rules": editing `location` resets `location_kind` → `NULL` (wired in the editor `setField("location", …)` handler); override-address → `buildMapsUrl(raw, provider)` search semantics; override-meeting with no parseable URL → degrade to plain. Correct layer confirmed feasible: `ItemEditor.tsx:156` is the single `onChange` for location. |
| m5 | Push byte cap via `TextEncoder`, not `.length` | **PASS** | Decision 5 / m5: `new TextEncoder().encode(JSON.stringify(payload)).byteLength`, `PUSH_MAX_BYTES = 3000`, degradation order (drop location → truncate title), unit test with multibyte fixture. |

**Result: 6/6 addressed (5 PASS, 1 PARTIAL).** The PARTIAL (M2) is not a design failure — the fetched-`Item` pass-down and no-double-fetch parts are fully resolved; only the remount reopen-loop edge is unhandled, surfaced below as NEW-1 (Minor).

### New findings from the added surface

**NEW-1 (Minor) — one-shot ref does not survive an `ItemListView` remount; deep-linked editor can reopen.**
`App.tsx:102-114` renders `ItemListView` inside a ternary (`activeView === "admin" ? … : activeView === "calendar" ? … : <ItemListView/>`). Switching to Calendar/Admin and back **unmounts and remounts** `ItemListView`, resetting `openedRef.current` to `false`. Because `App` still holds `initialOpenItem` as truthy state, the remounted `ItemListView` will re-run its one-shot effect and **reopen the deep-linked editor** — after the user already closed it and navigated away. The plan's stated guarantee ("closing the editor does NOT reopen it") holds only within a single mount lifetime.
- **Fix (small):** own the one-shot in `App` instead of (or in addition to) the child ref — e.g. after passing `initialOpenItem` into the first render, clear it (`setInitialOpenItem(null)`) once consumed, OR gate it behind a boot-only ref in `App`. The plan explicitly rejected an upward callback "to avoid a race," but a plain `setInitialOpenItem(null)` on first consume (or a boot flag in `App`) is race-free and remount-safe. Call this out for the Coder; the `App.deeplink.test.tsx` should add a "switch view and back does not reopen" assertion.

**NEW-2 (Minor) — `GET /api/items/:id` route placement vs the existing `/api/items` router; no collision, but the plan doesn't note it.**
`index.ts:38` mounts `itemsRouter` at `/api` (so its paths are `/items`, `/items/:id`), and `index.ts:41` separately mounts `remindersRouter` at `/api/items` (only `PUT /:id/reminders` → `PUT /api/items/:id/reminders`, confirmed `reminders.ts:12`). A new `GET /api/items/:id` in `itemsRouter` does **not** collide (distinct method + path shape; Hono routes per-method). This is fine, but the plan says only "add to `routes/items.ts`" without noting the two-router mounting; a careless Coder could add it to the wrong router. Minor — worth a one-line pointer to `itemsRouter` (mounted at `/api`, path `/items/:id`).

**NEW-3 (Nit, resolved on inspection) — `getItemForUser` authz genuinely mirrors `getItems`.**
Verified `getItems` (`db.ts:497-511`): `canReadList` first; on deny, an existence probe (`SELECT id FROM lists`) distinguishes FORBIDDEN (list exists) vs NOT_FOUND (absent). `canReadList` (`db.ts:452-465`): shared → readable by anyone; private → owner-only. The plan's `getItemForUser` (§3.2) resolves the item row, then runs `canReadList(item.list_id)`, returning NOT_FOUND if no item, FORBIDDEN if exists-not-readable, else item+reminders. This is the correct shape and leaks no more than `getItems` already does. One subtlety to hand the Coder: `getItems` probes **list** existence, whereas the item point-read must probe **item** existence first (a valid, readable list can still lack the item). The plan's ordering ("first fetch the item row; then `canReadList` on its `list_id`") is correct — NOT_FOUND is decided by item absence, not list absence. No non-owner path to a private item exists. PASS.

**NEW-4 (Nit) — migration `0005_user_maps_provider` is safe and coherent; default/fallback are consistent.**
Additive nullable `users.maps_provider TEXT` (`NULL | 'apple' | 'google'`), no backfill — mirrors the approved `users.active` (0003) pattern. `resolveMapsProvider(null) → 'apple'` (Decision 6) makes the default-when-unset **Apple**, and the declined-migration fallback is also a fixed **Apple** constant — coherent, no contradiction. `GET /api/me` auto-picks up the new column because it returns `c.get("user")`, which is `upsertUser → mapUser(SELECT * FROM users)` (`auth.ts:266`, `db.ts:148-154`); adding `maps_provider` to `User`/`UserRow`/`mapUser` flows it through with no me-route change. Verified. PASS.

**NEW-5 (Minor) — `PATCH /api/me` enum validation + JWT-identity: correct in intent, but the existing mutation is `PUT` and only handles `display_name`.**
`routes/me.ts` today exposes `GET /` and `PUT /` (`display_name` only) — there is **no** existing prefs mutation to "extend." The plan (Decision 6, §5.2) says "reuse the existing user-preferences update path if one exists; otherwise add a minimal `PATCH /api/me`." Confirmed none exists, so the Coder adds one. Two things to nail down explicitly:
  - **Enum rejection:** the plan says "validates the enum (`400 VALIDATION` on unknown)" — good, and it must reject anything not in `{'apple','google'}` (including `null`/missing/`""`/arrays). State the allowed-set check explicitly so junk like `{maps_provider:"waze"}` → 400, mirroring `me.ts:26-43`'s `display_name` validation style.
  - **Identity from JWT (project HARD RULE):** the write target must be `c.get("user").email` (from the verified Access JWT via `auth.ts:266`), never a body-supplied email. The plan states this correctly ("email from JWT, not body"). Confirmed feasible — the existing `PUT` already does exactly this (`me.ts:45` `updateDisplayName(c.env.DB, user.email, name)`). Keep the same pattern. No new auth surface. PASS on intent; Coder must implement the explicit allowed-set guard.

**NEW-6 (Nit) — maps-provider "whose preference at send time" is resolved, but the WHY is thin.**
The genuine semantic question (owner vs recipient for a shared list) IS answered consistently in the plan: Decision 6 (line 280) and §5.2 (line 316) both say **recipient**'s `maps_provider`. The dispatch row carries `recipient_email` (`types.ts:75`), so the data is available per-dispatch without extra joins. Recipient-preference is the correct choice — the recipient is the person who taps the link and opens *their* maps app — and it means each member of a shared list gets their own provider rendered in their own notification. The plan does not spell out this rationale; add one sentence ("recipient, not item owner, because the recipient is who taps") so the Coder doesn't 'optimize' it to the owner's preference by folding it into the item read. Not blocking.

### Adversarial spot-checks that PASSED (no action)

- **push.ts zero-edit still holds:** the new surface (route, migration, preference, content builders) touches `reminders/send.ts`, `db.ts`, `routes/items.ts`, `routes/me.ts`, `types.ts`, and web files — none inside `channels/push.ts`. The content change is still only the payload object passed into `sendPush`. Zero-edit assertion intact.
- **`channels/send.ts` is a phantom path:** the re-review brief referenced `src/worker/channels/send.ts:46-48`; the real send path is `src/worker/reminders/send.ts` (`channels/` holds `push.ts`/`email.ts` only). The plan itself correctly cites `reminders/send.ts` throughout — no correction needed.
- **`me` route is `PUT` today, mounted at `/api/me` (`index.ts:33`):** adding a sibling `PATCH` is clean; no method/path collision.
- **ItemEditor location reset layer:** `ItemEditor.tsx:156` `onChange={(e) => setField("location", …)}` is the single wire point for the m2 edit-resets-override rule — client-side reset + server enum revalidation is the right split. Feasible.
- **Deep-link boot vs `activeView`:** setting `activeView="list"` once at boot is exactly how a user click sets it (`App.tsx:72/96`); no flash of the wrong view since `loading` gates the first paint (`App.tsx:45`) and the deep-link resolution runs in/after `loadMe`. The only residual risk is NEW-1 (remount reopen), not a first-paint flash.

### Round-2 verdict

The six punch-list items are all addressed (5 PASS, 1 PARTIAL where only a remount edge remains), and the three new surfaces are sound: `getItemForUser` authz genuinely mirrors `getItems` with no private-item leak, both migrations are additive/nullable/owner-gated with coherent defaults, and the recipient-preference semantics are the right call. The remaining items (NEW-1 reopen-loop, NEW-5 explicit enum guard) are Minor and can be folded in by the Coder against the concrete pointers above; they do not require another architect round.

Required before Coder starts (fold into the plan or hand to the Coder as binding notes):
1. **(NEW-1)** Make the deep-link one-shot survive an `ItemListView` remount: clear `initialOpenItem` in `App` on first consume (or gate on a boot-only ref in `App`), and add a "switch view and back does not reopen" assertion to `App.deeplink.test.tsx`.
2. **(NEW-5)** State the `PATCH /api/me` allowed-set guard explicitly (`maps_provider ∈ {'apple','google'}`, else `400 VALIDATION`; reject null/missing/junk), and confirm the write targets `c.get("user").email` (JWT), never the body — mirroring `me.ts:45`.
3. **(NEW-2 / NEW-6, minor polish)** Note that `GET /api/items/:id` belongs in `itemsRouter` (mounted at `/api`), distinct from the `remindersRouter` at `/api/items`; and add one sentence justifying recipient (not owner) maps-provider at send time.

APPROVE
