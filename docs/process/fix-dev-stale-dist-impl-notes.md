# Implementation notes: `fix-dev-stale-dist`

Plan: `docs/plans/fix-dev-stale-dist.md` (Amended 2026-07-01, Pass-2 APPROVE —
`docs/reviews/fix-dev-stale-dist-review.md`)
Branch: `feat/fix-dev-stale-dist`
Base commit before this work: `14e9ae6` (feat(auth): local-only dev auth shim (loopback-gated) (#3))

## Step 0 decision gate — result and evidence

**Step 0 PASSED → Approach B implemented.**

Procedure run exactly per plan §4:

1. `npm run build` (fresh) → `dist/index.html` referenced `assets/main-z2zSkifS.js`. Started
   `npx wrangler dev --port 8788` in the background. Confirmed baseline: `curl` of `/` served
   `index.html` referencing `main-z2zSkifS.js`, and `GET /assets/main-z2zSkifS.js` → `200`.
2. Made a visible one-line change to `web/src/App.tsx` (temporary probe string in the loading
   text), then `npm run build` again **without restarting wrangler**. This produced a new
   content hash: `assets/main-BqH-Qi8k.js`, and rewrote `index.html` to reference it.
3. **Without restarting wrangler**, re-fetched `/`:
   - Served `index.html` now referenced the **NEW** hash `main-BqH-Qi8k.js`.
   - `GET /assets/main-BqH-Qi8k.js` → **200**, and its body contained the probe string
     (confirmed via `curl | grep -c`).
   - `GET /assets/main-z2zSkifS.js` (the OLD hash) → **404** (file removed by the rebuild;
     wrangler correctly reflects the current `./dist` directory, not a stale boot-time
     manifest).

This is the unambiguous PASS outcome per plan §4/M1 (new hash served 200, not a stale-serve
or 404). Wrangler dev re-reads `./dist` on each request rather than snapshotting it at boot,
so a concurrent watch build (Approach B) gives edit-while-running freshness. Cleaned up:
killed the background `wrangler dev`, reverted the probe edit (confirmed `git diff` clean on
`App.tsx` afterward).

## Approach B implementation (exact diff)

`package.json` — targeted edit, only the `scripts` block's `dev` line changed (added, did not
replace, `dev:web`/`dev:worker`) plus one devDependency added:

```diff
   "scripts": {
-    "dev": "wrangler dev",
+    "dev": "vite build && concurrently -k -n web,worker -c cyan,magenta \"npm:dev:web\" \"npm:dev:worker\"",
+    "dev:web": "vite build --watch --emptyOutDir false",
+    "dev:worker": "wrangler dev",
     "build": "vite build",
     "typecheck": "tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json",
     ...
   },
   "devDependencies": {
     ...
     "@vitejs/plugin-react": "^4.3.4",
+    "concurrently": "^9.2.3",
     "eslint": "^9.16.0",
     ...
   },
```

- `concurrently` installed via `npm install --save-dev concurrently@^9.1.0`; npm resolved
  `^9.2.3` (satisfies the plan's pinned `^9.1.0` range) — landed alphabetically in
  `devDependencies`, matching plan §6c. `package-lock.json` updated accordingly (committed).
- All other scripts (`build`, `typecheck`, `lint`, `test`, `test:watch`, `test:e2e`,
  `migrate:local`, `preview`) are byte-for-byte unchanged.
- No `wrangler.toml` or `vite.config.ts` changes. `vite.config.ts`'s dead `server.proxy`
  (lines 25-28) was left untouched per plan §n3 (parked follow-up, out of scope).
- No `CLAUDE.md` change — the REQUIRED note in plan §7b is only for the Approach A fallback,
  which was not taken.

## Bring-up verification (plan §6b / §6d, done-conditions 3-5 for Approach B)

**m3 — `--emptyOutDir false` honored (verified empirically, not just by source-trace):**
Removed `dist`, ran `npm run build` once, then manually dropped an unrelated sentinel file
(`dist/sentinel-marker.txt`) into `dist`. Started `npm run dev:web` (`vite build --watch
--emptyOutDir false`) standalone. After its first (watch-mode) build completed, the sentinel
file was still present in `dist` — confirming the watch's initial build does NOT wipe the
directory. The flag is honored; no fallback to the "self-healing via wrangler re-serve" case
was needed. (Consistent with the Pass-2 reviewer's independent source-level trace of
`vite@6.4.3`'s cac/mri argument parser.)

**m4 — `concurrently -k` teardown resilience (verified):** With `npm run dev:web` still
running (from the m3 check), introduced a transient JSX/TS syntax error into
`web/src/App.tsx` (an unparseable token appended after a JSX expression). The watch process
printed an esbuild "Transform failed" error and **stayed alive** (confirmed the same PID was
still running via `ps`). Fixed the error (reverted to valid syntax) and confirmed the next
save triggered a successful rebuild that flowed through normally. Vite/Rollup watch mode does
not exit on a rebuild error, so `-k` was kept as specified in §6a — no need to drop it for a
resilient variant.

**Full `npm run dev` end-to-end (done-conditions 3 and 4):**
- Started `npm run dev` fresh (after `rm -rf dist`). Log showed the leading one-shot
  `vite build`, then `concurrently` launching `dev:web` (watch, first build) and `dev:worker`
  (`wrangler dev`, ready on `http://localhost:8787`).
- Confirmed `curl http://localhost:8787/` served `index.html` referencing the current build's
  hash (`main-z2zSkifS.js`), `200` — no manual pre-build needed by the developer beyond
  running `npm run dev` itself.
- **Edit-while-running (the core payoff):** with `npm run dev` still running, edited
  `web/src/App.tsx` (added a visible probe string to the loading text). The `dev:web` watch
  rebuilt automatically (`build started...` / `✓ 1 modules transformed` / new hash
  `main-Cz93ncFb.js` in the log), and `wrangler dev` logged `⎔ Reloading local server... /
  Local server updated and ready`. Without any manual build or wrangler restart:
  `curl http://localhost:8787/` now served `index.html` referencing the NEW hash, and
  `GET /assets/main-Cz93ncFb.js` (200) contained the probe string. This directly confirms
  the papercut is fixed: `npm run dev` reflects `web/src` edits live.
- Reverted the probe edit, then stopped `npm run dev` (killed `concurrently`, `vite build
  --watch`, and `wrangler dev` processes) — no dev servers left running.

**Side effect observed (not a defect, noting for completeness):** because
`--emptyOutDir false` disables the watch's directory-emptying, OLD content-hashed asset files
(e.g. the pre-edit `main-z2zSkifS.js`) are NOT deleted from `dist` when a new hash is emitted
— they simply accumulate alongside the current ones for the life of the `dev` session. This
does not affect correctness (wrangler serves whichever `index.html` + hashed files are
current) and has no effect on `npm run build`, which still does a clean `emptyOutDir: true`
build. Not in scope to change per the plan; noting only.

## Common verification (done-conditions 1-2)

- `npm run build` (after `rm -rf dist`): unchanged behavior, produces the same asset layout
  and (for unchanged source) the identical content hashes (`main-z2zSkifS.js`,
  `main-D_58wn89.css`, `sw.js`, `manifest-BgyhbI1m.webmanifest`) as before this change —
  confirms the `build` script and deploy output path are untouched.
- `npm run typecheck`: clean, no errors (both `tsconfig.worker.json` and `tsconfig.web.json`).
- `npm test`: **1 pre-existing failure, unrelated to this change** — see "Out-of-scope
  observations" below. 59/60 tests pass; the failing test fails identically on the unmodified
  base commit (verified via `git stash` / `git stash pop` around the `package.json` edit),
  confirming this change does not affect test outcomes.
- `npm run lint`: pre-existing failure (`ESLint couldn't find an eslint.config.(js|mjs|cjs)
  file` — no flat-config file in the repo), unrelated to this change and not listed in the
  plan's done-conditions. Not investigated further (out of scope for this plan).

## How a developer runs it now

```
npm run dev
```

- Builds `dist` once, then starts `vite build --watch` (`dev:web`) + `wrangler dev`
  (`dev:worker`) concurrently via `concurrently -k`.
- Open the localhost URL wrangler prints (e.g. `http://localhost:8787`).
- Edit any file under `web/src` → the watch rebuilds `dist` automatically → wrangler
  re-serves the current build on the next request. No manual `npm run build`, no restart.
- Ctrl-C stops both processes (`-k` kills the sibling process on exit).

`npm run build` (unchanged) still produces the deployable `dist` for `wrangler deploy`
(manual/CI) exactly as before.

## Deviations from the plan

None. Step 0 selected Approach B; Approach B was implemented exactly per plan §6a/§6c, with
the §6b (m3) and §6d (m4) bring-up verifications both passing without needing either named
fallback (the "self-healing" m3 fallback, or the "drop `-k`" m4 fallback).

## Out-of-scope observations

- **Pre-existing test failure** (not introduced by this change, not fixed per guardrails):
  `tests/unit/dev-auth-shim.test.ts` → `DC2 ... T4: loopback host + DEV_AUTH_IDENTITY unset ->
  full verification -> 401` fails with `expected 'owner' to be undefined`. This appears to be
  caused by `DEV_AUTH_IDENTITY="owner"` being set in the repo's `.dev.vars` file, which the
  `@cloudflare/vitest-pool-workers` test harness may be picking up as ambient env when running
  this specific test's environment merge. Verified via `git stash` that this failure is
  present identically on the base commit (`14e9ae6`) before any of this fix's changes — it is
  unrelated to the `fix-dev-stale-dist` plan and out of scope to fix here.
- **Pre-existing lint gap:** `npm run lint` fails with "ESLint couldn't find an
  eslint.config.(js|mjs|cjs) file" (no flat-config present under ESLint v9). Confirmed
  unrelated to this change; not in the plan's done-conditions.
