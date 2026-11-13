# Family Scheduler: Build Spec

A private family task and scheduling PWA with email and web push reminders, built entirely on the Cloudflare free tier. This document is written to be executed by AI coding agents (architecture, plan-review, coding, QA, DevOps) against a fresh GitHub repo.

---

## 1. Goal

One shared place for the family to create and view schedules: school events, assignments, orchestra and practice schedules, concert dates, work events, and family events. Items support a name, date (event date or due date), location, and notes. Reminders fire via email and web push. Access is restricted to a pre-approved list of email addresses. Users have private lists and shared family lists that everyone can view and edit.

Decisions locked:

- Auth: Cloudflare Access (email one-time code or Google sign-in), gated by an allowlist. No passwords to build or store.
- Notifications: email + web push only. No SMS (the free carrier gateways are discontinued; revisit a paid SMS API like Twilio later if needed).
- Recurrence: true repeating events (RRULE based).
- Devices: iPhone, Mac, Windows. All receive push; iPhones require a one-time Add to Home Screen step.
- Reminders: multiple per item, each with a configurable offset (days, hours, or minutes before).
- Email provider: Resend (swap to Amazon SES later by replacing one module).

---

## 2. Stack

| Concern | Choice | Free tier headroom for a family |
|---|---|---|
| Frontend | React + Vite (TypeScript), client-rendered SPA / PWA | n/a (static build) |
| Hosting (static PWA) | Cloudflare Workers Static Assets | Effectively unlimited |
| API + scheduler | Cloudflare Workers (one Worker, fetch + scheduled handlers) | 100K requests/day |
| Database | Cloudflare D1 (SQLite) | 5 GB, 5M reads/day, 100K writes/day |
| Reminder trigger | Workers Cron Triggers | Included |
| Auth | Cloudflare Access (Zero Trust) | Covers a family with room to spare |
| Email | Resend | 3,000/month, 100/day, one verified domain |
| Push | Web Push (VAPID), no third party | Free |

Recommended shape: a single Worker that serves the built PWA via Static Assets and handles `/api/*`, plus a `scheduled` handler for the reminder engine. One deploy, one Access application in front of it. (Cloudflare Pages + a separate Functions Worker is a valid alternative, but the single-Worker approach is simpler for agents to build and deploy.)

Sending email needs a verified domain. The app URL is system-generated, but Resend still needs a domain you control to send from. Reuse one you already own (for example a subdomain like `mail.jr-quantum.com`) and verify SPF/DKIM in Resend. This is separate from the app's URL.

---

## 3. Repo structure

```
family-scheduler/
  wrangler.toml
  package.json
  tsconfig.json
  migrations/
    0001_init.sql
  scripts/
    seed-users.ts            # optional: pre-create users with display names
  src/
    worker/
      index.ts               # router + fetch handler + scheduled handler
      auth.ts                # Cloudflare Access JWT verification
      db.ts                  # D1 query helpers
      recurrence.ts          # RRULE occurrence expansion
      reminders/
        materialize.ts       # expand occurrences into pending dispatch rows
        send.ts              # send due dispatch rows (email + push)
      channels/
        email.ts             # Resend (single integration point)
        push.ts              # Web Push via WebCrypto
      routes/
        lists.ts
        items.ts
        reminders.ts
        subscriptions.ts
        me.ts
  web/
    index.html
    manifest.webmanifest
    sw.js                    # service worker: push + notificationclick
    src/                     # React + Vite (TypeScript)
    public/icons/            # PWA icons (192, 512, maskable)
  dist/                      # build output served by Static Assets
```

Frontend is React + Vite (TypeScript), a client-rendered single-page PWA that builds to static files served by the same Worker via Static Assets. No Next.js or other SSR meta-framework: the app is private and auth-gated behind Cloudflare Access, so there is no SEO or server-rendering need, and a plain Vite build keeps the custom service worker (web push) and standalone PWA behavior first-class. Use Hono or itty-router for the Worker routing, and the npm `rrule` package for recurrence (it runs in Workers).

---

## 4. Data model (D1 / SQLite)

All timestamps are epoch milliseconds (UTC). Display in the user's local timezone on the client. `migrations/0001_init.sql`:

```sql
CREATE TABLE users (
  email        TEXT PRIMARY KEY,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
  created_at   INTEGER NOT NULL
);

CREATE TABLE lists (
  id          TEXT PRIMARY KEY,                  -- uuid
  name        TEXT NOT NULL,
  color       TEXT,
  owner_email TEXT NOT NULL REFERENCES users(email),
  visibility  TEXT NOT NULL DEFAULT 'private',   -- 'private' | 'shared'
  created_at  INTEGER NOT NULL
);

CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                    -- 'event' | 'task'
  title        TEXT NOT NULL,
  location     TEXT,
  notes        TEXT,
  start_at     INTEGER NOT NULL,                 -- event start, or task due datetime
  end_at       INTEGER,                          -- optional (events)
  all_day      INTEGER NOT NULL DEFAULT 0,
  rrule        TEXT,                             -- optional RFC 5545 RRULE, e.g. 'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260630T000000Z'
  timezone     TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  completed_at INTEGER,                          -- tasks (per-occurrence completion handled in app logic)
  created_by   TEXT NOT NULL REFERENCES users(email),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE item_reminders (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,               -- minutes before the occurrence (days/hours/minutes all reduce to minutes)
  channel_email  INTEGER NOT NULL DEFAULT 1,
  channel_push   INTEGER NOT NULL DEFAULT 1
);

-- Idempotent ledger: one row per (reminder, occurrence, channel, recipient)
CREATE TABLE reminder_dispatch (
  id               TEXT PRIMARY KEY,
  item_id          TEXT NOT NULL,
  item_reminder_id TEXT NOT NULL,
  occurrence_at    INTEGER NOT NULL,
  fire_at          INTEGER NOT NULL,             -- occurrence_at - offset
  channel          TEXT NOT NULL,                -- 'email' | 'push'
  recipient_email  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  sent_at          INTEGER,
  UNIQUE (item_reminder_id, occurrence_at, channel, recipient_email)
);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES users(email),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_items_list ON items(list_id);
CREATE INDEX idx_dispatch_due ON reminder_dispatch(status, fire_at);
CREATE INDEX idx_sub_user ON push_subscriptions(user_email);
```

Reminder audience rule (implement in `materialize.ts`): a private list's item reminders go to the list owner; a shared list's item reminders go to every active user. One dispatch row is created per recipient per channel.

---

## 5. API (Worker, all under `/api`, all behind Access)

Auth: every request carries Cloudflare Access identity. Resolve the email once per request in `auth.ts`, upsert the `users` row on first sight, and attach it to the request context.

```
GET    /api/me                      -> current user + their lists (owned + shared)
PUT    /api/me                      -> update display_name

GET    /api/lists                   -> lists visible to user (own private + all shared)
POST   /api/lists                   -> create list {name, color, visibility}
PATCH  /api/lists/:id               -> rename / recolor / change visibility (owner only for private)
DELETE /api/lists/:id               -> delete list (owner only)

GET    /api/lists/:id/items         -> items in a list (+ optional ?from&to to expand occurrences)
POST   /api/items                   -> create item {list_id, type, title, location, notes, start_at, end_at, all_day, rrule, reminders:[...]}
PATCH  /api/items/:id               -> edit item (any member for shared lists)
DELETE /api/items/:id               -> delete item
POST   /api/items/:id/complete      -> mark task complete (optionally per-occurrence)

PUT    /api/items/:id/reminders     -> replace the reminder set for an item

POST   /api/subscriptions           -> register a web push subscription {endpoint, p256dh, auth}
DELETE /api/subscriptions/:endpoint -> unregister
GET    /api/vapid-public-key        -> returns VAPID public key for the client to subscribe
```

Authorization rules: shared lists are readable and writable by all active users; private lists and their items are restricted to the owner. Enforce this in `db.ts` on every read and write, not just in the UI.

---

## 6. Cloudflare Access setup

1. In Zero Trust, create a self-hosted Access application covering the app's hostname (the `*.workers.dev` URL, or a route you map).
2. Add a policy: Action = Allow, Include = Emails, and list the family's email addresses. This is the allowlist; only these addresses can authenticate.
3. Configure the login methods you want (One-time PIN by email and/or Google).
4. Note the application **AUD** tag and your team domain (`https://<team>.cloudflareaccess.com`).
5. In the Worker, verify the `Cf-Access-Jwt-Assertion` header on every `/api` request against the team's public keys at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checking the `aud` claim equals your app's AUD. The verified `email` claim is the user identity. Do not trust `Cf-Access-Authenticated-User-Email` alone without verifying the JWT.

The `scheduled` (cron) handler runs internally and does not pass through Access; it just needs the D1 binding and secrets.

---

## 7. Web Push

1. Generate a VAPID key pair once. Store the public key as a var and the private key as a secret.
2. Client: register `sw.js`, request notification permission on a user gesture, call `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <vapidPublicKey> })`, and POST the subscription to `/api/subscriptions`.
3. Worker: send pushes from the cron handler using a WebCrypto based Web Push implementation (the Node `web-push` package depends on Node crypto; use a Workers-compatible library such as a `webcrypto-web-push` package, or enable `nodejs_compat`). Sign the VAPID JWT, encrypt the payload (aes128gcm), and POST to each subscription `endpoint`. On a `404` or `410` response, delete that subscription row.
4. `sw.js` handles the `push` event (show a notification) and `notificationclick` (focus or open the app at the relevant item).

iOS specifics (important): web push on iPhone only works when the site is installed to the Home Screen as a PWA and opened in standalone mode; it does not work from a Safari tab. Requires iOS 16.4 or later. So:
- Ship a valid `manifest.webmanifest` with `"display": "standalone"`, name, and icons.
- Detect iOS + not-standalone and show a one-time banner: "Tap Share, then Add to Home Screen, then open the app from your Home Screen to enable reminders."
- Only request notification permission after the PWA is opened in standalone mode.
- Mac (Safari/Chrome), Windows (Chrome/Edge/Firefox), and Android get push directly without the install step.

---

## 8. Email (Resend)

- Verify a sending domain you own in Resend (SPF + DKIM). Set `EMAIL_FROM` to something like `Family Scheduler <reminders@mail.jr-quantum.com>`.
- `channels/email.ts` exposes one function `sendEmail({ to, subject, html, text })` that POSTs to `https://api.resend.com/emails` with the `RESEND_API_KEY`. Keeping this as the only email integration point makes a later swap to Amazon SES a single-file change.
- Email content: per-item reminders, plus an optional once-daily digest (see phase 7) summarizing today's and tomorrow's items for each user. The digest is often what actually replaces a person texting everyone.

---

## 9. Reminder engine (cron `scheduled` handler)

Run every 5 minutes. Two clean phases, both idempotent:

**Phase A: materialize.** For each active item that has reminders, expand its occurrences across a rolling window `[now, now + LOOKAHEAD_DAYS]` (start with 60 days) using the `rrule` library (for non-recurring items, the single occurrence is `start_at`). For each occurrence and each `item_reminder`, compute `fire_at = occurrence_at - offset_minutes`. For each recipient (per the audience rule) and each enabled channel, INSERT a `reminder_dispatch` row with `status='pending'`. The `UNIQUE` constraint makes re-runs a no-op, so duplicates are impossible.

**Phase B: send.** Select `reminder_dispatch` where `status='pending'` AND `fire_at <= now` AND `fire_at > now - GRACE_MINUTES` (start with 30, so a missed run still catches up without re-sending ancient reminders). Send each via its channel, then mark `sent` (with `sent_at`) or `failed`. Push failures with `404`/`410` also delete the dead subscription.

Keep `LOOKAHEAD_DAYS` and `GRACE_MINUTES` as config constants. This design tolerates clock gaps, retries safely, and never double-sends.

`wrangler.toml` cron:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

---

## 10. Configuration

`wrangler.toml` (sketch):

```toml
name = "family-scheduler"
main = "src/worker/index.ts"
compatibility_date = "2026-06-01"
compatibility_flags = ["nodejs_compat"]   # only if your push lib needs it

[assets]
directory = "./dist"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "family-scheduler"
database_id = "<filled after d1 create>"

[triggers]
crons = ["*/5 * * * *"]

[vars]
ACCESS_TEAM_DOMAIN = "https://<team>.cloudflareaccess.com"
ACCESS_AUD = "<access-app-aud-tag>"
VAPID_PUBLIC_KEY = "<public>"
VAPID_SUBJECT = "mailto:you@example.com"
EMAIL_FROM = "Family Scheduler <reminders@mail.jr-quantum.com>"
APP_URL = "https://family-scheduler.<subdomain>.workers.dev"
```

Secrets (via `wrangler secret put`): `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`.

---

## 11. Deploy steps

1. `npm create` the project, add `wrangler`.
2. `npx wrangler d1 create family-scheduler`, paste the `database_id` into `wrangler.toml`.
3. `npx wrangler d1 migrations apply family-scheduler` (and `--local` for dev).
4. Generate VAPID keys; set `VAPID_PUBLIC_KEY` var and `VAPID_PRIVATE_KEY` secret.
5. Verify a sending domain in Resend; set `RESEND_API_KEY` secret and `EMAIL_FROM` var.
6. Build the PWA into `./dist`.
7. `npx wrangler deploy`.
8. In Zero Trust, create the Access application over the deployed hostname and add the allowlist policy; copy the AUD into `wrangler.toml` and redeploy.
9. On each phone, open the app, sign in through Access, and (on iPhone) Add to Home Screen, then enable notifications.

---

## 12. Suggested build order

Phased so the work maps cleanly onto a multi-agent pipeline, with a git commit and a smoke test at each phase boundary:

1. Scaffold, `wrangler.toml`, D1 schema + migrations, `db.ts`. Verify migrations apply locally.
2. API Worker CRUD for lists, items, and reminders, with Access JWT verification and the private/shared authorization rules. Test with a forged-then-real Access token in dev.
3. PWA frontend (React + Vite, TypeScript): auth-aware shell, list and item CRUD UI, the reminder configuration control (days/hours/minutes), and both a list view and a month calendar view.
4. Web Push: VAPID, service worker, subscribe flow, the iOS Add-to-Home-Screen banner, and the subscriptions API. Verify a manual push reaches an iPhone PWA, an Android browser, and a desktop browser.
5. Email via Resend: the single `sendEmail` module and a test send.
6. Recurrence + reminder engine: `recurrence.ts`, `materialize.ts`, `send.ts`, the cron trigger. Verify a recurring item produces correct, de-duplicated, on-time reminders across a simulated multi-day window.
7. Polish: once-daily digest email, sharing toggles, completion handling for recurring tasks, and an end-to-end pass (Playwright is a good fit for the auth + reminder flows).

---

## 13. Notes and gotchas

- Verify the Access JWT; do not trust the email header alone.
- The `UNIQUE` constraint on `reminder_dispatch` is what guarantees no double-sends. Do not remove it.
- iPhone push silently does nothing until the PWA is installed to the Home Screen. Build the install nudge early so testing on iPhones is not confusing.
- Resend needs a verified domain you own; this is unrelated to the app's system-generated URL.
- Store all times as UTC epoch ms; convert for display using each item's `timezone`. Recurrence math around daylight saving is the most likely source of subtle bugs, so test occurrences that cross a DST boundary.
- Free SMS via carrier email gateways is gone, so do not add it. If real SMS becomes necessary, add a third channel module (`channels/sms.ts`) backed by a paid API and a new `channel='sms'` dispatch value; the engine already supports multiple channels.
