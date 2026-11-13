# QA Report: `fix-dev-stale-dist`

Branch: `feat/fix-dev-stale-dist` (base: `main` @ `14e9ae6`, HEAD @ `7993760`)
Plan: `docs/plans/fix-dev-stale-dist.md` (Amended 2026-07-01, Pass-2 APPROVE)
Impl notes: `docs/process/fix-dev-stale-dist-impl-notes.md` (Step 0 PASSED → Approach B)
Review: `docs/reviews/fix-dev-stale-dist-review.md` (Pass-1 APPROVE WITH CHANGES → Pass-2 APPROVE)

This is a dev-tooling-only fix (no application/Worker code, no browser-facing feature). Per
the task brief, verification was done via `npm run build`/`typecheck`/`test` plus a live
`npm run dev` bring-up exercised with `curl` (equivalent to the "verify via curl" fallback the
brief explicitly allows). `docs/dev-fixtures.md` was not needed for this slug since there is no
storefront/product-page feature to exercise — the "server" under test is the local `wrangler
dev` + `vite build --watch` pipeline itself, not a Shopify storefront.

## Summary verdict

**PASS** — see final line.

## 1. Scope check — `git diff main --stat`

```
docs/plans/fix-dev-stale-dist.md              | 346 ++++++++++++++++++++++++++
docs/process/fix-dev-stale-dist-impl-notes.md | 163 ++++++++++++
docs/reviews/fix-dev-stale-dist-review.md     | 239 ++++++++++++++++++
package-lock.json                             | 213 +++++++++++++++-
package.json                                  |   5 +-
5 files changed, 964 insertions(+), 2 deletions(-)
```

Only `package.json`, `package-lock.json`, and docs changed. No `wrangler.toml`, no
`vite.config.ts`, no app/Worker code. Confirmed by direct read of both files (unchanged
from base): `wrangler.toml:5-7` still `[assets] directory = "./dist"`; `vite.config.ts` still
`root: "web"`, `outDir: "../dist"`, `emptyOutDir: true` on the `build` config (unaffected —
the CLI override is only on the `dev:web` script invocation, not the config file). No scope
violation.

`package.json` scripts as landed (`package.json:6-8`):
```
"dev": "vite build && concurrently -k -n web,worker -c cyan,magenta \"npm:dev:web\" \"npm:dev:worker\"",
"dev:web": "vite build --watch --emptyOutDir false",
"dev:worker": "wrangler dev",
```
Matches plan §6a exactly. `concurrently@^9.2.3` added to `devDependencies` (satisfies plan's
pinned `^9.1.0` range), alphabetized correctly (`package.json:35`, between
`@vitejs/plugin-react` and `eslint`).

## 2. `npm run build`

```
> vite build
vite v6.4.3 building for production...
✓ 38 modules transformed.
../dist/assets/manifest-BgyhbI1m.webmanifest    0.60 kB
../dist/index.html                              0.80 kB
../dist/assets/main-D_58wn89.css                1.72 kB
../dist/sw.js                                   0.85 kB
../dist/assets/main-z2zSkifS.js               171.27 kB
✓ built in 257ms
```
Unchanged behavior; `build` script text is byte-identical to base (`vite build`). Produces the
deployable `dist` exactly as before. Hash `main-z2zSkifS.js` matches the hash cited in the
impl notes for unmodified source, corroborating no accidental source drift.

## 3. `npm run typecheck`

```
> tsc --noEmit -p tsconfig.worker.json && tsc --noEmit -p tsconfig.web.json
```
No output, exit clean. Both worker and web configs pass.

## 4. `npm test`

```
Test Files  1 failed | 8 passed (9)
     Tests  1 failed | 59 passed (60)
```
Single failure: `tests/unit/dev-auth-shim.test.ts > ... > T4: loopback host + DEV_AUTH_IDENTITY
unset -> full verification -> 401` → `AssertionError: expected 'owner' to be undefined`.

**Confirmed pre-existing, not caused by this branch** — independently verified (not just taking
the impl notes' word for it):
- `.dev.vars:5` has `DEV_AUTH_IDENTITY="owner"` committed locally (gitignored, not part of this
  diff), which is the documented leak source T4 asserts against.
- Checked out `main`'s `package.json`/`package-lock.json` on top of this branch's working tree
  (`git checkout main -- package.json package-lock.json`) and re-ran
  `npx vitest run tests/unit/dev-auth-shim.test.ts` directly against the base commit's
  scripts/deps: **identical failure**, same assertion, same message, 10 passed / 1 failed.
  Restored via `git checkout HEAD -- package.json package-lock.json`; `git status`/`git diff`
  confirmed clean afterward.
- This branch's diff touches only `package.json`/`package-lock.json`/docs — no test file, no
  worker auth code — so there is no mechanism by which this change could affect T4's outcome.

Every other test (59/59 excluding T4) passes. Per the task brief's explicit caveat, this single
failure does NOT fail the verdict.

`npm run lint` also fails (`ESLint couldn't find an eslint.config.(js|mjs|cjs) file`) — this is
outside the plan's done-conditions and not a dev-server behavior; confirmed pre-existing by
running the same command against `main`'s checked-out `package.json` (identical failure) and
restoring cleanly afterward. Not scored against the verdict, per plan §9/§10 (lint is not a
listed done-condition) and per the impl notes' own out-of-scope note.

## 5. Core payoff — dev serves CURRENT source, edit-while-running reflects (Approach B)

Ran `rm -rf dist && npm run dev` backgrounded (PID 39767), logs captured to
`/tmp/dev-stale-fix-qa.log`.

**Startup (fresh dist):**
- Log showed the leading one-shot `vite build` (`main-z2zSkifS.js`), then `concurrently`
  launching `dev:web` (watch build, same hash) and `dev:worker` (`wrangler dev`, ready on
  `http://localhost:8787`).
- `curl -s http://localhost:8787/ | grep -o 'assets/main-[^"]*\.js'` → `assets/main-z2zSkifS.js`
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/assets/main-z2zSkifS.js` → `200`

Confirms localhost serves the CURRENT build at start, matching source, no staleness.

**Edit-while-running (the load-bearing done-condition):** With `npm run dev` still running (no
restart), edited `web/src/App.tsx:46` to insert a visible probe string
(`QA-PROBE-STRING-DEV-STALE-DIST-FIX`) into the loading text.
- Log (within ~3s) showed `dev:web` auto-rebuild: `build started...` → `✓ 1 modules
  transformed` → new hash `main-BG8k9DkU.js` emitted → `wrangler` logged `⎔ Reloading local
  server...` / `⎔ Local server updated and ready`.
- `curl -s http://localhost:8787/ | grep -o 'assets/main-[^"]*\.js'` → `assets/main-BG8k9DkU.js`
  (the NEW hash, no restart).
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/assets/main-BG8k9DkU.js` → `200`
- `curl -s http://localhost:8787/assets/main-BG8k9DkU.js | grep -c
  "QA-PROBE-STRING-DEV-STALE-DIST-FIX"` → `1` (probe string present in the served bundle).
- Old bundle `assets/main-z2zSkifS.js` still returned `200` (not deleted) — matches the
  documented m3 side effect of `--emptyOutDir false` (old hashed files accumulate for the
  session's life; not a defect, does not affect correctness of what's served).

This is unambiguous confirmation the papercut is fixed: **no manual `npm run build`, no
`wrangler` restart, and the live edit was reflected.** This is exactly the behavior that would
FAIL on the old bare-`wrangler dev` script (per the plan's Step 0 finding).

**Loop resilience (m4, "don't rabbit-hole" — light check performed):** Injected a transient
unparseable token (`const brokenSyntaxProbe = <<<;`) into `App.tsx`. Log showed `dev:web`
printing an esbuild "Transform failed... Unexpected \"<<\"" error and the process stayed alive
(`ps -p <pid>` confirmed `npm run dev` PID still running after the error). Reverted the syntax
error; next save triggered a clean rebuild back to the original `main-z2zSkifS.js` hash, and
`curl` confirmed it was served. `-k` did not tear down the session on a rebuild error, matching
plan §6d / impl notes' finding.

**Cleanup:** Reverted the probe string edit (`git diff`/`git status` clean, confirmed via
`grep` that `App.tsx` no longer contains the probe text and matches original). Killed all
backgrounded processes (`concurrently`, `vite build --watch`, `wrangler dev`) explicitly by PID;
confirmed via `ps aux` no matching processes remained and `lsof -i :8787` showed the port free.
`dist/` left in place (build artifact, gitignored, not part of `git status`).

## Issues found

None. No MCP browser tooling was needed for this dev-tooling-only fix (no user-facing UI
surface to exercise); verification was done via direct process/log inspection and `curl`, per
the task brief's explicit fallback allowance ("You can verify the edit-reflection via curl...
if driving a full browser is flaky").

## Console errors and warnings

Not applicable — no browser session was driven (dev-tooling fix, verified via curl per brief).
`wrangler dev`'s own startup log showed one expected, unrelated warning: "Scheduled Workers are
not automatically triggered during local development" (cron trigger caveat, pre-existing
Wrangler behavior, unrelated to this fix).

## Network failures and slow responses

All `curl` checks against `http://localhost:8787/` and the hashed asset paths returned `200`
with sub-3-second rebuild latency (watch build completed in ~130-260ms per the Vite log
timings; end-to-end edit-to-served-200 was observed within the ~3s sleep window used for
polling, not a hard-measured latency floor).

## Accessibility observations

Not applicable — no UI/browser surface changed by this fix.

## Performance notes

Initial `vite build` (`web` root, 38 modules) completes in ~250ms; the incremental watch
rebuild after a one-line string edit also completed in ~130-260ms in the trials above. No
performance concerns for local dev iteration speed.

## Screenshots

None captured — no browser UI involved; the load-bearing evidence is process log + curl output,
quoted verbatim above.

## Bug-fix verification fields (not applicable)

This slug is a dev-tooling fix, not a `fix-<bug>` slug backed by `docs/bugs/`, so the
"reproduced before/after" bug-fix protocol does not apply. The plan's own Step 0 (documented in
the impl notes) already served as the empirical repro-then-fix gate: Step 0 demonstrated the
OLD bare-`wrangler dev` script would still serve fresh content correctly (Step 0 PASSED,
selecting Approach B) — the actual defect being fixed was the ABSENCE of any build step in the
old `dev` script (`wrangler dev` alone, no `vite build`), which this QA pass's fresh `rm -rf
dist && npm run dev` startup check (section 5) implicitly re-confirms is now closed (a
`dist`-less checkout now builds automatically instead of erroring/serving nothing).

## Done-conditions checklist (plan §10, Approach B branch)

1. `npm run build` unchanged — CONFIRMED (section 2).
2. `npm test` / `npm run typecheck` unaffected by this change — CONFIRMED (typecheck clean;
   test has the one documented pre-existing T4 failure, independently verified identical on
   `main`).
3. `npm run dev` with no manual build reflects current `web/src` at start — CONFIRMED (section 5).
4. Edit-while-running reflects with no manual build/restart — CONFIRMED (section 5, the core
   payoff).
5. Loop resilience (m4) — CONFIRMED (section 5).

All Approach B done-conditions met. Scope clean. No regressions found.

PASS
