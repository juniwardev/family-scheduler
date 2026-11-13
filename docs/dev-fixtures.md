# Local QA fixtures & environment

This project is a **Cloudflare Workers + D1 + React PWA behind Cloudflare Access** — NOT a Shopify storefront. There is no password gate, no product URLs, and no Shopify fixtures. The equivalent "fixtures" mechanism for local QA is the **dev-auth shim** described below. If a QA process expects a `docs/dev-fixtures.md`, this is it — proceed with browser testing using the shim.

## Running the app locally for QA

1. Ensure the gitignored `.dev.vars` sets a dev identity:
   - `DEV_AUTH_IDENTITY="owner"` → the app assumes `OWNER_EMAIL` (admin role; Admin tab/roster available).
   - `DEV_AUTH_IDENTITY="someone@example.com"` → assumes that exact email (member role; use for non-owner / sharing / 403 tests).
2. `npm run dev` — builds the PWA then runs `wrangler dev` (serves the Worker API + PWA + emulated D1 **and R2**) on `http://localhost:8787`.
3. Confirm the shim is active: look for the `[dev-auth] shim active as <email>` log line. From that point every `/api/*` call is authorized as that identity with **no Cloudflare Access JWT needed**.

The shim is loopback-gated and fail-closed (only works on `localhost`/`127.0.0.1`/`[::1]`), so it is inert in production. See project memory `no-local-dev-auth-shim.md`.

## Test data

- Local D1 is seeded by whatever you create; migrations are applied locally via `npx wrangler d1 migrations apply family-scheduler --local` (run this first if the app errors on a missing table/column).
- QA typically creates its own fixtures through the UI or API during a session: create a list, create items (event/task, with/without reminders, all-day, recurring), upload attachments (R2 is emulated locally), etc.
- To exercise a second identity (sharing, private-list 403), restart `wrangler dev` with a different `DEV_AUTH_IDENTITY`, or insert rows directly into local D1.

## Switching appearance / viewport for visual QA

- **Dark mode** follows `prefers-color-scheme` (no in-app toggle). Emulate it via the browser devtools (Chromium: Rendering → "Emulate CSS media feature prefers-color-scheme").
- **Responsive breakpoint** is ~768px: below it the app shows mobile bottom-tabs + top bar; above it, the desktop sidebar. Resize the viewport (e.g. 390px mobile, 1200px desktop) to exercise both.

## Automated e2e suite (Playwright) uses a DIFFERENT path than manual QA

`npm run test:e2e` (see root `CLAUDE.md`) does **not** use the dev-auth shim and does **not**
seed real rows through the real API. It intercepts every `/api/*` request in the browser
(`page.route()`) with typed mock payloads (`e2e/fixtures/api-mocks.ts`); nothing reaches the
Worker or D1. It owns its own `wrangler dev` state directory (`.wrangler/e2e-state` — `rm -rf`
it to reset; nothing should ever need this, since no migration or seeding runs under it).

**Manual QA (this file) is unaffected and still uses the real backend** — the shim, real D1,
real seeded rows via the UI/API — because that is what a QA pass over Worker/D1 behavior needs.
A green `npm run test:e2e` run says nothing about the Worker; only this manual path does. See
`docs/plans/playwright-bootstrap.md` §5.2 for the full reasoning.

## Not applicable here

- No Shopify theme, storefront password, product/collection fixtures, or `shopify theme dev`. Ignore any Shopify-specific fixture steps — the dev-auth shim above is the project's fixtures equivalent.
