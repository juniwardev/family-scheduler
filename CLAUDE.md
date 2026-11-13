# Family Scheduler PWA — Project CLAUDE.md

## Commands

### Install
```
npm install
```

### Lint & typecheck
```
npm run typecheck      # tsc --noEmit for worker code
npm run lint           # eslint src/ web/src/
```

### Unit tests (Vitest)
```
npm test               # runs all vitest unit/integration tests
npm run test:watch     # watch mode
```

### E2E tests (Playwright)
```
npm run test:e2e       # playwright test
```
- **Prerequisite (one-time):** `npx playwright install chromium` — browsers are not installed by
  `npm install`. Add `webkit` too if you intend to run `E2E_WEBKIT=1` (see below).
- Runs 3 spec files (`e2e/*.spec.ts`) against a real, freshly-built `dist` served by a real
  `wrangler dev` on a dedicated port (**8788**, not the interactive dev port 8787) with its own
  D1 persist directory (`.wrangler/e2e-state`). Every invocation rebuilds `dist` first
  (`reuseExistingServer: false`) — this is deliberate, not a bug: a stale `dist` has already
  caused a false "bug still present" QA result once (`docs/plans/fix-dev-stale-dist.md`).
- **No auth prerequisite and no `.dev.vars` step.** The suite intercepts all `/api/*` traffic in
  the browser (`page.route()`); nothing reaches the Worker, so the dev-auth shim is never
  exercised. This means a green e2e run says nothing about the Worker/D1 — manual QA (which
  still uses the shim and seeds real rows, see `docs/dev-fixtures.md`) is the path that does.
- **Stop `npm run dev` before running this.** Both serve the same shared `./dist`
  (`wrangler.toml`), and the e2e build (`emptyOutDir: true`) will empty it out from under a live
  dev session (and the dev watcher can rebuild it mid-suite). The harness detects a listener on
  port 8787 and aborts *before* building, with an explanatory message — it is a port proxy, not
  a `dist` check, so an unrelated service on 8787 or a dev server on a non-default port can
  produce a false positive/negative.
- **Recovery:** a genuinely wedged `wrangler dev`/`workerd` process holding port 8788 —
  `pkill -f workerd`, same as the existing local-QA recovery step. Reset the e2e D1 state with
  `rm -rf .wrangler/e2e-state` (nothing should ever need this; no migration or seeding runs
  under this harness).
- `E2E_WEBKIT=1 npm run test:e2e` — also runs the WebKit project (excluded from the default run;
  a WebKit pass does **not** license "works on iPhone" and a WebKit failure may be a Playwright
  artifact — see `docs/plans/playwright-bootstrap.md` §3.5).
- `E2E_REUSE=1 npm run test:e2e` — **debug-only.** Skips the leading `npm run build` and reuses
  whatever server is already listening. Serves **whatever `dist` is already built and requires
  that one exist** — on a fresh clone with no `dist/` every spec fails confusingly. Only valid
  when iterating on spec code, never when validating an app change.
- **Gate placement:** `test:e2e` is in neither the Coder's per-change loop nor the pre-PR gate
  (`typecheck && lint && test && build`) — it needs a build, a server, and a browser, and would
  add a flake surface to gates that must stay fast. It **is mandatory for QA** on any branch
  touching `web/src/**` (skip it on worker-only branches, and say so in the QA report). See
  `docs/plans/playwright-bootstrap.md` §6 for the full reasoning, including which of its
  anti-rot measures are real mechanisms (ride on `lint`/`typecheck`) versus norms.

### Dev server
```
npm run dev            # wrangler dev (serves both Worker API and PWA via Static Assets)
```

### Build
```
npm run build          # vite build (outputs to ./dist)
```

### Migrations (local)
```
npx wrangler d1 migrations apply family-scheduler --local
```

## Conventions

- All timestamps are EpochMs (number, UTC). Display conversion happens on the client.
- IDs are `crypto.randomUUID()` in the Worker. The client never supplies IDs.
- `Result<T>` pattern for explicit error handling in Worker modules.
- `email` identity always comes from the verified Cloudflare Access JWT — never from request body.
- The DB layer (`db.ts`) enforces authorization. Routes are thin Hono handlers.
- Cleanup pending dispatch rows BEFORE FK cascade deletes (P2-N1 — HARD REQUIREMENT).
