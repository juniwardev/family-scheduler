# item-view-mode — Deploy Note

**Deploy timestamp:** 2026-08-22 06:49:46 UTC
**Target:** Production — Cloudflare Worker `family-scheduler` (`https://family-scheduler.juniwar-dev.workers.dev`), D1 database `family-scheduler` (id `448567eb-6fdf-42ca-b1df-e9886e4cf80c`)
**Commit deployed:** `b8f023a` (main, PR #18 squash-merge: "feat(item-view-mode): open items in a shared view-mode modal from list and calendar")
**Operator:** Junior Warner (juniwar.dev@gmail.com)
**Method:** `npx wrangler deploy` (per `docs/runbooks/deploy.md`)
**Wrangler version ID:** `da696583-7872-41c8-97df-b5ff1471287a`
**Backup:** `backup-b8f023a.sql` (repo root, 36,466 bytes / 183 lines) — remote D1 export taken before deploy, **not committed to git** (no matching `.gitignore` entry; left uncommitted per deploy constraints — flagging here rather than adding it to git history)

## Pre-deploy gates confirmed

- `docs/qa/item-view-mode.approved` present.
- QA verdict: **PASS** (`docs/qa/item-view-mode-report.md`, re-QA section — all a11y/regression checks pass, 0 console errors, 0 failed network requests).
- Working tree clean on `main` at `b8f023a` (verified via `git status`).
- `npm run typecheck` and `npm test` (246/246) already re-run clean on this commit by the operator prior to handoff.
- `wrangler whoami` authenticated as `juniwar.dev@gmail.com` via OAuth.

## Migrations

**None applied.** `wrangler d1 migrations list family-scheduler --remote` (run by operator prior to handoff) reported "No migrations to apply!" — this feature introduces no schema changes, so the runbook's migrate-before-deploy step has nothing to do. No `wrangler d1 migrations apply` command was run.

## Push outcome

```
🌀 Building list of assets...
✨ Read 10 files from the assets directory /Users/juniorwarner/Projects/React/family-scheduler-pwa/dist
🌀 Starting asset upload...
🌀 Found 3 new or modified static assets to upload. Proceeding with upload...
+ /index.html
+ /assets/main-C1Z8nsGx.css
+ /assets/main-Cby029Uv.js
Uploaded 1 of 3 assets
Uploaded 2 of 3 assets
Uploaded 3 of 3 assets
✨ Success! Uploaded 3 files (5 already uploaded) (1.26 sec)

Total Upload: 475.60 KiB / gzip: 102.52 KiB
Worker Startup Time: 2 ms

Uploaded family-scheduler (5.49 sec)
Deployed family-scheduler triggers (1.10 sec)
  https://family-scheduler.juniwar-dev.workers.dev
  schedule: */5 * * * *
  schedule: 0 14 * * *
Current Version ID: da696583-7872-41c8-97df-b5ff1471287a
```

## Files pushed

- `dist/index.html` — updated (new build hash references)
- `dist/assets/main-C1Z8nsGx.css` — updated bundle (includes item-view-mode styling)
- `dist/assets/main-Cby029Uv.js` — updated bundle (includes shared view-mode modal, stacked row actions)
- 5 other static assets (icons, manifest, service worker) already up to date — not re-uploaded
- Worker script (`fetch` + `scheduled` handlers) redeployed with same bindings (D1, R2 attachments, Access env vars) as prior version

## Verification

- **Storefront/app response:** `curl -sI https://family-scheduler.juniwar-dev.workers.dev` → `HTTP/2 302`, `location:` header pointing to `https://jr-quantum.cloudflareaccess.com/cdn-cgi/access/login/family-scheduler.juniwar-dev.workers.dev?...&redirect_url=%2F`, `server: cloudflare`, `www-authenticate: Cloudflare-Access resource_metadata=...`. This is the expected, healthy Cloudflare Access challenge response for an unauthenticated request — it confirms the Worker is up and Access is correctly gating it. No 500/502/503 observed.
- **Authenticated visual check:** not performed by this DevOps run (unauthenticated curl only, per task scope). Operator should confirm login + existing items render + create/edit/delete one throwaway item per the runbook's step-4 guidance, and watch one `*/5` cron tick via `wrangler tail --format=pretty` for the reminder engine, before considering this deploy fully closed out.

## Rollback procedure

Per `docs/runbooks/deploy.md`: this deploy introduced no schema migrations, so rollback is code-only and safe without touching the DB.

```
wrangler rollback
```

or re-deploy the previous commit's build. The remote D1 backup (`backup-b8f023a.sql`) is retained as belt-and-suspenders insurance per the runbook, though it was not needed for a schema rollback on this deploy since no migrations were applied.
