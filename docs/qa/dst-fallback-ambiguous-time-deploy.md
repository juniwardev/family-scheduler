# dst-fallback-ambiguous-time — Deploy Note

**Commit:** `4090208` (main, clean tree)
**Target:** PRODUCTION, Worker `family-scheduler` (https://family-scheduler.juniwar-dev.workers.dev), D1 `family-scheduler`
**Deploy timestamp:** 2026-11-13 20:17:47Z (12:17:47 PST) — `wrangler deploy` ran 20:17:43Z–20:17:50Z
**New version ID:** `b1d25501-bea3-4808-8f44-d46a78b13bcf`
**Previous version ID:** `26191de7-abf7-4e98-8665-2e6ed8bb377d` (deployed 2026-09-22)
**Method:** `npx wrangler deploy` (no migrations; no repair SQL run)
**Currently live (superseded the above):** `b1251484-3c07-437a-80c6-ead2804fd3c8`, an owner redeploy of
the same code at 2026-11-13 21:29:24Z (13:29 PST). See "Redeploy" below.

## Gate results (on HEAD 4090208)

- `npm run typecheck`: clean
- `npm run lint`: 0 errors, 2 known warnings
- `NODE_EXTRA_CA_CERTS= npm test`: 41 files, 418 tests passed
- `npm run build`: OK
- QA: PASS (`docs/qa/dst-fallback-ambiguous-time-report.md`); owner approval present (`docs/qa/dst-fallback-ambiguous-time.approved`)

## Migration state

`npx wrangler d1 migrations list family-scheduler --remote`: "No migrations to apply". This change has no migrations.

## Backup

`/Users/juniorwarner/Backups/family-scheduler/backup-4090208-20261113-121713.sql` (90195 bytes; outside the repo)

## Pre-deploy read-only checks (plan §4.8), aggregates only

| Query | Result | Expected |
|---|---|---|
| Q-0 | 1793523600000, 1793527200000, 1825578000000, 1825581600000 | match |
| Q-0b (E2) | m=11 w=0 d=01 h=09 | match |
| Q-0b (E5.start) | m=11 w=0 d=07 h=09 | match |
| Q-A | America/Los_Angeles: 1 (only zone) | LA only |
| Q-B' | 0 | 0 |
| Q-C' | 0 | 0 |
| Q-I (informational) | no rows | none |

**Decision-table row: 6 (no repair).** R-1/R-2 not run. Q-B was not needed (no non-LA zone).

## Dry-run bindings (`wrangler deploy --dry-run`)

D1 `DB` (family-scheduler), R2 `ATTACHMENTS` (family-scheduler-attachments), `ASSETS`, and vars ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL, VAPID_PUBLIC_KEY, VAPID_SUBJECT, EMAIL_FROM, APP_URL. No top-level setting (e.g. `preview_urls`) appeared as a var. Real deploy registered crons `*/5 * * * *` and `0 14 * * *`. 10 asset files uploaded (479.81 KiB).

## Post-deploy verification

- `npx wrangler deployments list`: newest deployment is `b1d25501-...` at 100%, created 2026-11-13T20:17:47Z.
- `GET /`: 302 to `https://jr-quantum.cloudflareaccess.com/cdn-cgi/access/login/...` (Access challenge, edge serving).
- `GET /api/me`: 302 to the same Cloudflare Access login (no separate health endpoint exists).

## Tail observations (`wrangler tail`, started 20:17:54Z, no exceptions or errors in the log)

- Tick 12:20:22 PST (20:20Z), `*/5`: Ok. `materialize inserted=24 send={"sent":0,"failed":0,"transient":0}`
- Tick 12:25:22 PST (20:25Z), `*/5`: Ok. `materialize inserted=24 send={"sent":0,"failed":0,"transient":0}`
- The tail's 700 s timeout ended about 20:29:34Z, before the 12:30 tick, so only two ticks were observed.
- Zero `sent` on both ticks is expected: no recurring occurrence was within the send window.
- `inserted=24` appears on both ticks; this was not compared with the prior version's behaviour.
- Email addresses that appear in the tail header lines were redacted and not recorded here.

## Redeploy by the owner (2026-11-13 21:29:24Z, 13:29 PST)

The owner ran `npm run build && npx wrangler deploy` from `main` at `fc3b944`. That commit only adds
this note on top of `4090208` (`git diff --stat 4090208 fc3b944 -- src web wrangler.toml
package.json` is empty), so the Worker code is identical to `b1d25501`.

- **New version ID:** `b1251484-3c07-437a-80c6-ead2804fd3c8`, now at 100% (`wrangler deployments list`).
- **Assets:** wrangler reported "No updated asset files to upload", so the built PWA is unchanged.
  Total upload 479.81 KiB, startup 6 ms.
- **Bindings:** the same set as the dry run above: D1 `DB`, R2 `ATTACHMENTS`, `ASSETS`, and the same
  seven vars.
- **Triggers:** re-registered `*/5 * * * *` and `0 14 * * *`.
- **Not re-run for this redeploy:** the gates, the §4.8 checks and the tail, because the code had not
  changed since they ran about 70 minutes earlier.
- **Build warning:** `MODULE_TYPELESS_PACKAGE_JSON` for `postcss.config.js`. It is pre-existing and
  harmless. Adding `"type": "module"` to fix it would change how every `.js` file in the project loads,
  so it was deliberately left alone.

## Rollback

- **To undo the DST fix:** `npx wrangler rollback 26191de7-abf7-4e98-8665-2e6ed8bb377d`, the
  pre-fix version.
- `b1d25501` is the same code as the live `b1251484`, so rolling back to it changes nothing.

Code-only rollback; no schema change was made, so the DB needs no action.
