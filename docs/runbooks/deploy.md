# Runbook: Deploying to production (Cloudflare Workers + D1)

Production: `https://family-scheduler.juniwar-dev.workers.dev` (Worker `family-scheduler`, D1 `family-scheduler`, id `448567eb-6fdf-42ca-b1df-e9886e4cf80c`). The Worker serves both the API (`fetch`) and the PWA (Static Assets from `./dist`), plus the cron handlers (`scheduled`).

This runbook exists because a deploy can involve **schema migrations against a database that holds real family data**. The core safety rule is below; follow it every time.

---

## The one rule: migrate remote **before** deploying code

`wrangler deploy` does **not** run D1 migrations (there is no auto-migrate hook in `package.json` or `wrangler.toml` — `migrations_dir` only tells wrangler where they live). Migrations are always a separate, explicit step. Order matters:

- **Writes never tolerate a missing column.** `INSERT`/`UPDATE` statements name the new columns explicitly. If the new code is live before the column exists, the first create/edit/preference write **errors** with "no such column".
- **Reads USUALLY tolerate a missing column — but do not rely on it.** A read that only `SELECT *`s and maps tolerantly will survive (the column comes back absent → treated as `NULL`). **A read that puts the new column in a `WHERE`, `ORDER BY`, or index hint will not**: it errors outright, so the failure is a hard outage of every surface that read, not a graceful degradation.

So: **apply migrations to remote first, then deploy the Worker.** Never the reverse.

> **This is not a theoretical caveat — `0007_item_archived` broke it.** `archived_at` is filtered in SQL, so an unmigrated remote takes the list, calendar and digest down *together*. Worse, the failure is near-invisible from the client: `no such column: archived_at` appears **only in the `wrangler dev`/`wrangler tail` Worker console**, never the browser, because no `app.onError` is registered. The browser receives a bare 500 *alongside* the normal empty-list placeholder — so on a phone it reads as "my data is gone", not as a failed deploy. If you see an empty list with **no** error banner after a deploy, check step 2 before anything else.
>
> **Before every deploy, ask which of the two read shapes the new column has** — do not assume the tolerant one. `grep` the migration's column name across `src/` and check whether any hit sits in a `WHERE`.

---

## Pre-deploy gates (must all be true)

1. Feature branch is merged to `main` (or you are deploying `main`) and the working tree is clean.
2. QA verdict is PASS and the approval marker exists: `docs/qa/<slug>.approved`. **DevOps/deploy does not run without it** (project workflow rule).
3. `npm run typecheck` clean and `npm test` green on the commit being deployed.
4. You know exactly which migrations are unapplied on remote (see "Check migration state" below).

---

## Procedure

### 0. Confirm what will change on remote

```bash
# What migrations has remote already applied vs. what's pending?
npx wrangler d1 migrations list family-scheduler --remote
```

Only files newer than the last-applied migration will run. `wrangler d1 migrations apply` is incremental — it records applied migrations in the `d1_migrations` table and will **not** re-run older ones or re-initialize existing data.

### 1. Back up remote D1 (insurance — always do this)

```bash
npx wrangler d1 export family-scheduler --remote --output backup-$(git rev-parse --short HEAD).sql
```

Keep the file until the deploy is verified healthy. This is pure belt-and-suspenders; additive migrations (below) do not rewrite existing rows, but a backup costs nothing.

### 2. Apply migrations to REMOTE

```bash
npx wrangler d1 migrations apply family-scheduler --remote
```

Review the printed plan before confirming. For **additive** migrations (`ALTER TABLE ... ADD COLUMN ... <nullable>`), existing rows are untouched — they simply get `NULL` in the new column. No backfill, no data mutation.

> If a migration is **not** purely additive (drops/renames a column, adds a `NOT NULL` column without a default, rewrites data), STOP and treat it as a special-case deploy: it needs its own migration-safety review and likely a maintenance window. This runbook's guarantees only cover additive-nullable changes.

### 3. Deploy the Worker (code + PWA assets)

```bash
npm run build      # vite build → ./dist (the PWA the Worker serves)
npx wrangler deploy  # deploys fetch + scheduled handlers and the built assets
```

### 4. Post-deploy verification

- Load the app, confirm login (Cloudflare Access) and that **existing lists/items still render** exactly as before.
- Create one item, edit one item, delete one throwaway item — confirms the write paths work against the migrated schema.
- Watch a cron tick for the reminder engine:
  ```bash
  npx wrangler tail --format=pretty
  ```
  Confirm the `*/5` send loop runs without errors (no "no such column", no push crypto error, dispatches classify as `sent`).
- If this deploy changed notifications, verify one real email/push at a live tick (see the feature's QA done-conditions).

---

## Rollback

- **Code:** `npx wrangler rollback` (or re-`npx wrangler deploy` the previous commit's build). Because migrations are additive/nullable, the previous code version keeps working against the new schema — the extra columns are simply ignored by older `SELECT *` reads. So a **code-only rollback is safe without touching the DB.**
- **Schema:** additive columns do not need to be rolled back (older code ignores them). Only reach for the step-2 backup if a non-additive migration went wrong.

---

## Pending migrations as of the `feat/item-archive` deploy (2026-09-21)

| Migration | Statement | Effect on existing rows |
|-----------|-----------|--------------------------|
| `0007_item_archived` | `ALTER TABLE items ADD COLUMN archived_at INTEGER` | `NULL` = live / not archived (all existing items) |

Additive and nullable, so no backfill and no data mutation — but see the callout under "The one
rule": this is the **first** migration in this repo whose column is read in a `WHERE`
(`src/worker/db.ts:602`), so deploying code before applying it is an outage, not a degradation.

Confirm what remote actually has with step 0 rather than trusting this table; it records intent at
the time of writing, and `migrations list` records fact.

### Previously (`feat/notifications-and-location`, applied)

| Migration | Statement | Effect on existing rows |
|-----------|-----------|--------------------------|
| `0004_item_location_kind` | `ALTER TABLE items ADD COLUMN location_kind TEXT` | `NULL` = auto-detect location type |
| `0005_user_maps_provider` | `ALTER TABLE users ADD COLUMN maps_provider TEXT` | `NULL` = default provider (Apple Maps) |
