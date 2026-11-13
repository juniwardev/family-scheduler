# Family Scheduler

A private family calendar and reminder PWA — shared lists of events and tasks, with email and web-push reminders — running entirely on Cloudflare's edge. Built for one household; gated behind Cloudflare Access.

**Live:** https://family-scheduler.juniwar-dev.workers.dev (private — behind Access)

## Features

- **Lists** — shared or private lists of items, each an **event** or **task**.
- **Reminders** — per-item reminders delivered by **email** (Resend) and **web push** (hand-rolled VAPID + aes128gcm). A daily digest of today+tomorrow is also sent.
- **Recurrence** — repeating items via RRULE (`rrule` + `luxon`), expanded per-occurrence.
- **Smart location** — a free-text location is auto-classified as plain text, a map link (Apple/Google Maps, per-user preference), or a "tap to join" meeting link, rendered in-app and in notifications.
- **Attachments** — upload images/PDF/docs to an item (stored in Cloudflare R2).
- **Deep links** — notifications link straight to the item (`/?item=<id>`).
- **PWA** — installable, offline-capable shell, works on the iPhone home screen (required for iOS web push).
- **Clean & calm UI** — Tailwind + shadcn/ui, light/dark following the system appearance, mobile bottom-tabs / desktop sidebar.
- **Admin** — user roster + activate/deactivate, owner auto-promoted.

## Tech stack

- **Runtime:** Cloudflare Workers (single deploy: `fetch` API + `scheduled` cron handlers), serving the PWA via Static Assets.
- **Data:** Cloudflare D1 (SQLite) for records; Cloudflare R2 for attachment blobs.
- **API:** [Hono](https://hono.dev) router; `Result<T>` for explicit error handling; authorization enforced in the DB layer.
- **Auth:** Cloudflare Access (Zero Trust) — identity comes from the verified Access JWT. A loopback-gated dev-auth shim allows local work without a JWT.
- **Frontend:** React + Vite + TypeScript, Tailwind CSS + shadcn/ui (vendored into `web/src/components/ui/`), `lucide-react` icons.
- **Tests:** Vitest — a Worker project (`@cloudflare/vitest-pool-workers` / miniflare, with emulated D1 + R2) and a web project (jsdom + Testing Library); Playwright for E2E.

## Getting started

### Prerequisites
- Node.js (LTS) and npm
- A Cloudflare account (for deploy; local dev is fully offline via miniflare)

### Install
```bash
npm install
```

### Apply migrations locally
```bash
npx wrangler d1 migrations apply family-scheduler --local
```

### Run locally
Local auth uses the **dev-auth shim** (see [`docs/dev-fixtures.md`](docs/dev-fixtures.md)). Create a gitignored `.dev.vars`:
```
DEV_AUTH_IDENTITY="owner"   # assumes OWNER_EMAIL (admin). An @-email assumes that member identity.
```
Then:
```bash
npm run dev     # builds the PWA + runs wrangler dev at http://localhost:8787
```
Look for `[dev-auth] shim active as <email>` in the logs. The shim only works on a loopback host and is inert in production.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build PWA + run Worker (API + PWA + cron) locally |
| `npm run build` | Vite build → `./dist` |
| `npm run typecheck` | `tsc --noEmit` for worker + web |
| `npm run lint` | ESLint over `src/` and `web/src/` |
| `npm test` | Vitest (worker + web projects) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:e2e` | Playwright E2E |
| `npm run migrate:local` | Apply D1 migrations to the local DB |

## Project structure

```
src/worker/        Worker: Hono routes, db.ts (authz), reminder engine, channels (email/push), auth
src/shared/        Framework-agnostic helpers shared by worker + web (location, labels, deep links)
web/src/           React PWA (components, apiClient, index.css, main)
migrations/        D1 schema migrations (0001…0006)
tests/             Vitest setup + worker unit/integration tests
docs/              Plans, reviews, QA reports, backlog, runbooks
wrangler.toml      Worker config: D1 + R2 bindings, cron triggers, Access vars
```

## Conventions

- All timestamps are **EpochMs** (number, UTC); display conversion happens on the client in the item's stored timezone.
- IDs are server-generated `crypto.randomUUID()`; the client never supplies IDs.
- `email` identity always comes from the verified Cloudflare Access JWT — never from a request body.
- The DB layer (`db.ts`) enforces authorization; routes are thin handlers.
- See [`CLAUDE.md`](CLAUDE.md) for the full conventions and the multi-agent development workflow used in this repo.

## Deployment

Deploys are **manual** (no CI). The one rule: **apply migrations to remote D1 *before* deploying code** — see [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md).

```bash
wrangler d1 migrations apply family-scheduler --remote   # if there are pending migrations
npm run build && wrangler deploy
```

R2 must be enabled on the account with a `family-scheduler-attachments` bucket for the attachments feature.

## Roadmap

See [`docs/backlog.md`](docs/backlog.md). Next up: calendar-item click-to-open, custom weekly repeat (RRULE `BYDAY`), a dependency-update sweep, and lint follow-ups.
