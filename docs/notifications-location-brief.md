# Architect Brief: Richer notifications + smart location

Branch: `feat/notifications-and-location` (cut off `main`). This is the second scheduled item after the `feat/fix-item-save` bug. Produce a written plan under `docs/plans/`, then it goes through plan-review → Coder → QA. It touches the notification delivery path, which was just fixed and verified working, so the plan and QA must treat "delivery still works after the content change" as a first-class done-condition, not an afterthought.

## Inputs to read first

- `docs/family-scheduler-build-spec.md` and the design plan (data model, item types, notification channels).
- `src/worker/channels/email.ts` and `src/worker/channels/push.ts` (current notification content, and the push crypto that was just fixed, do not regress it).
- The reminder engine (`materialize` / `send`) for what data is available at send time.
- The item schema (`items` table: title, type, location, notes, start_at, timezone, etc.).

## Why this exists

Current notifications are unusable to a human. The email subject is `"Reminder: item due"` and the body is `"You have a reminder for item ID: <uuid>"`. This feature makes notifications actually informative and actionable, and makes the location field smart about addresses and meeting links, both in-app and in notifications.

## Scope: two related parts

### Part A: Notification content (email + push)

Make both channels type-aware and detail-rich:

- **Subject (email):** include the item type and name. Examples: `Event reminder: Alex football practice`, `Task due: Permission slip`. Derive the type label from the item `type` (event / task). Design the exact label mapping.
- **Body (email):** item name, human-readable date/time rendered in the **item's stored `timezone`** (the schema already stores per-item timezone; use it, do not hardcode account zone or emit epoch), location rendered per Part B, notes, and a **deep link that opens the specific item**.
- **Push:** the same information, compressed. Notification title conveys type + name; body carries the key details (time, location). Tapping the notification opens the specific item.
- **Never** include the raw UUID in user-facing content.

**Deep link:** define the scheme (e.g. `${APP_URL}/?item=<id>`). This requires a **frontend addition**: on load, read the `item` query param and open that item's detail view. Both the email link and the push `notificationclick` handler (`sw.js`) use the same deep link. Specify the frontend change and the service-worker change in the plan.

### Part B: Smart location handling

Location remains a **free-text field** (must still accept plain strings like "Home" or "Alex's school"). The app auto-detects how to render it, with a user toggle to override a wrong guess:

- **Plain text** (default when neither URL nor address-like): displayed as-is, not linkable. "Home" must stay plain text with no toggle interaction required.
- **Address:** renders as a link that opens the device's default maps app (Apple Maps on iOS, Google Maps elsewhere, choose a URL form that resolves correctly per platform).
- **Meeting link** (Zoom / Teams / Google Meet URL): renders as "Tap to join," opening the native app if installed else the browser (the meeting URLs' own schemes handle that; the app just needs to link to the URL).

**Single source of truth:** the detection + rendering logic must live in one place and be consumed by both the in-app item detail view and the notification content (Part A), so a meeting link is tappable in the email/push as well as in the app. Design the detection heuristics (what counts as a URL vs address vs plain text) and the override mechanism (how the toggle's choice is stored, likely a small field on the item, or derived-with-override, architect decides).

## Open decisions for the architect to resolve (with rationale)

1. **Type-label mapping** for subjects/titles (event → "Event reminder", task → "Task due", etc.). Define it.
2. **Deep-link format** and how the frontend + service worker consume it.
3. **Location classification storage:** is the address/meeting-link/plain distinction auto-detected at render time every time, or stored on the item (with the toggle setting a stored value)? Auto-detect-with-override is the desired UX; decide the cleanest implementation. If it needs a schema field, that's an additive migration, call it out explicitly for owner awareness (the schema is otherwise stable).
4. **Maps URL form** per platform (a single URL that resolves to the right maps app on iOS vs Android/desktop, vs branching on user agent).
5. **Notification length limits:** push payloads have practical size limits; decide how much detail goes in push vs a "tap to open" for the rest.

## Locked / do not touch

- The push crypto (VAPID JWK import + aes128gcm HKDF) just fixed in `push.ts`. Enrich the *content* of the push, but do not alter the signing/encryption path, and re-verify delivery still works.
- The reminder engine: `materialize`, the dispatch ledger, the UNIQUE de-dup, the purge-on-mutation logic, the send classification. Read from it; do not change its control flow.
- Auth, Access verification, and the core data model (except a possible additive location-classification field if decision 3 requires it, which needs explicit owner sign-off).

## Tests / done conditions

1. Unit tests for the notification content builders (type-aware subject, human-readable localized time in the item's timezone, location rendering per type, deep link present, no UUID).
2. Unit tests for the location detection logic (plain "Home" stays plain; a Zoom/Teams/Meet URL classifies as meeting link; an address-like string classifies as address; the override works).
3. Frontend test that the `?item=<id>` deep link opens the correct item.
4. **Live-deploy re-test (the load-bearing one):** deploy, create an event with a near-future reminder, `wrangler tail` at the cron tick, and confirm: no push crypto error, both channels send, the **email** arrives with the new type-aware subject and full details, the **push** arrives and tapping it opens the item, the deep link in the email opens the item, and a meeting-link location is tappable while a plain "Home" is not. Push delivery and email delivery must both still be confirmed working (this feature must not have regressed the just-fixed notification path).

## Process

Architect plan → plan-review → Coder → QA. Commit at the boundary. If decision 3 requires a schema field, flag it for owner sign-off before the Coder runs (additive migration, same pattern as the earlier `item_occurrence_state` / `active` columns). QA does not sign off without the live-device re-test in done-condition 4.
