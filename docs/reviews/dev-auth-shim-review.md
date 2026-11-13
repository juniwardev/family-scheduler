# Plan Review: Local-only dev auth shim

Plan reviewed: `docs/plans/dev-auth-shim.md`
Kickoff / requirements: `docs/dev-auth-shim-kickoff.md`
Reviewer stance: adversarial security review. Primary question — is the local-only gate **un-forgeable and fail-closed** in production?

## Summary verdict up front

The **security property is sound**: the gate as specified is fail-closed and, more importantly, has **two independent always-true-in-production vetoes** (Layer B edge `cf`, Layer C non-loopback host), so a production bypass would require the simultaneous conjunction of an operator misconfiguration *and* two independent runtime impossibilities. I could not construct a realistic production activation path. On the security axis this is not a REJECT.

However, the plan asserts its **keystone (Layer B, `request.cf` absent under `wrangler dev`) as established fact ("confirmed against Cloudflare docs")** without version-specific evidence, and that assumption is **very likely wrong under the repo's `wrangler ^4.0.0` local runtime**, where Miniflare/workerd populates `request.cf` (including `colo`) with a placeholder. If so, Layer B vetoes *locally*, the shim never activates, and done-conditions 1 and 4 (the entire point of the feature) fail. That is a fail-closed failure (safe, not a security hole) but it ships a dead feature. Combined with a file-clobber instruction, this blocks a clean APPROVE.

---

## The crux: is `request.cf.colo` genuinely absent under `wrangler dev` and present in prod?

### Direction 1 — present in production (the security-critical direction): CONFIRMED sound

- Every real `/api/*` request on the deployed Worker arrives through the Cloudflare edge and carries a populated `request.cf`. `requireAuth` is only reachable via real inbound HTTP: `src/worker/index.ts:28` mounts it on `/api/*`; the cron path uses the separate `scheduled` handler (`src/worker/index.ts:66-83`, no `Request`, never touches `requireAuth`); the SPA/asset fallback (`src/worker/index.ts:58`) serves non-`/api` paths. `wrangler.toml` declares **no service bindings, no Durable Objects, no `[[queues]]`**, so there is no Worker-to-Worker or DO request path to `/api/*` that could arrive without `cf`. `preview_urls = false` and the only preview script is `wrangler dev --local`.
- Even in the hypothetical that `cf` were ever malformed/absent on a deployed request, **Layer C independently vetoes 100% of deployed traffic**: on `family-scheduler.juniwar-dev.workers.dev` the `request.url` hostname is the workers.dev domain, never a loopback literal, and Cloudflare routes by that hostname — an attacker cannot make `new URL(request.url).hostname` equal `localhost` while still being routed to this Worker. So the two prod-vetoes are genuinely independent (they do not share a failure mode), satisfying the defense-in-depth claim in §3.1.
- Layer A independence check (kickoff item 3): if an operator wrongly runs `wrangler secret put DEV_AUTH_IDENTITY` on the deployed Worker, Layer B **and** Layer C each still veto 100% of real requests. Confirmed.

Fail-closed boolean walk (§3.3): the only `return true` requires sentinel present **AND** (`cf`/`colo` not a real string) **AND** loopback host — all affirmative proofs. There is no swallowed-exception fail-open: reading `request.cf` is a plain property access (undefined if absent, never throws), and `.colo` is only dereferenced after `cf` is confirmed a truthy object. The `new URL(...)` parse is wrapped in `try/catch { return false }`. Evaluation order is correct and conservative. **No fail-open path found.**

### Direction 2 — absent under local `wrangler dev` (the functional direction): UNVERIFIED and likely FALSE — Major

This is the load-bearing weakness. The plan states (line 37): "Under default local `wrangler dev` this object is absent/placeholder (confirmed against Cloudflare docs)." The repo pins `wrangler ^4.0.0` (`package.json:40`), whose local dev runs on workerd/Miniflare. Miniflare's default behavior is to **attach a `cf` object to incoming requests**, sourced from a cached/fetched `cf.json` or a built-in fallback — and that fallback historically includes a real-looking `colo` (e.g. `"DFW"`). If that holds here, then under `npm run dev`:

- `request.cf.colo` is a string → Layer B `return false` → shim vetoed → `requireAuth` falls through to `verifyAccessJwt` → `401 "Missing Access JWT"` → **the app is still undrivable locally**, which is the exact gap this plan exists to close.

Note the self-undermining detail: test **T3** (line 173) fabricates the "edge" context with `colo: "DFW"` — the *same* value Miniflare's local fallback commonly uses. Presence-of-`colo` therefore cannot, by value, distinguish local from edge; the design leans entirely on local `cf` being *absent*, which is precisely the unverified claim.

Severity: this is fail-**closed** (safe) so it is **not** a security defect, but it likely ships a **non-functional feature** (done-conditions 1 and 4 fail). The plan presents the assumption as settled fact rather than a verify-before-build risk. It must be empirically checked against this repo's wrangler version *before* coding, and the design adjusted if `cf` is populated locally.

### Is there a stronger/simpler signal? (kickoff item 4) — Layer C is the better keystone

The plan mis-ranks its own layers. **Layer C (loopback host) is reliable in BOTH directions**: `wrangler dev` serves on `localhost`/`127.0.0.1` (positive locally), and the deployed Worker is never on a loopback host (veto in prod, non-spoofable as argued above). **Layer B (`cf`) is reliable only in the prod direction and fragile in the local direction.** So Layer C, not Layer B, is the sounder keystone. The security guarantee already holds on Layer A ∧ Layer C alone; Layer B is redundant *security* depth that introduces *functional* fragility. Recommended resolution: keep A ∧ C as the functional gate, and either (i) drop Layer B, or (ii) retain B only if verification shows `cf` is truly absent locally. The plan's §6 open-question section evaluates single-vs-split var but does **not** honestly evaluate this "which signal is primary" tradeoff — that gap should be closed.

---

## Downstream parity and locked-list compliance — PASS

- Shim branch (§3.4) calls the identical `upsertUser(c.env.DB, devIdentity, c.env.OWNER_EMAIL, Date.now())` (`src/worker/auth.ts:187-192`), re-checks the D14 gate `if (!user.active) return 403 DEACTIVATED` (matches `:198-203`), then `c.set("user", user)` / `next()` (matches `:205-206`). A deactivated shim user is still blocked — parity preserved. Good, and T2 exercises it.
- `verifyAccessJwt` internals (`:72-149`), `requireAdmin` (`:214-225`), and the D14 gate are untouched. Insertion point (top of the `createMiddleware` callback, before the `const token` read at `:171`) is correct.
- Selector safety: `DEV_AUTH_IDENTITY` is read as a *value* only in `resolveDevIdentity` (§3.3 line 69) after `isLocalDevContext` has returned true; in production the gate returns `null` before the value is ever consumed as a selector. Confirmed unreachable in prod. Good.

## Testability / observability — mostly PASS, with gaps

- T1, T2, T4, T5 are runnable in the `@cloudflare/vitest-pool-workers` harness. Confirmed the existing tests call `app.fetch(new Request(...), env)` directly (`tests/unit/auth-deactivated.test.ts:115`, `tests/unit/routing.test.ts:107`) with a JS-constructed `Request`, which has **no `cf` property**, so Layer B never accidentally fires in the harness and T1/T2 happy-paths resolve. T4 relies on Layer C (non-loopback host) and T5 on Layer A — both work through `app.fetch`.
- **T3 is the only coverage of the Layer B keystone, and it is a pure-function test**, because the harness cannot attach `cf` to a fabricated `Request` (the plan acknowledges this in §6). This is an acceptable constraint workaround, but it means the **end-to-end `cf`-veto through `requireAuth` is never proven**, and T3 would still pass if the wiring in `requireAuth` were later broken (T3 tests the helper in isolation). The kickoff explicitly suggested an injectable seam to make the safety property testable end-to-end; the plan declines without discussion. Regression coverage overall is adequate (removing the `cf` check fails T3; removing the host check fails T4; defaulting-open fails T5), but note the seam gap.
- **No observability on activation.** When the shim fires there is no log line. A one-time `console.warn("[dev-auth] shim active as <email>")` would both aid local debugging and act as a screaming alarm if it ever emitted from a deployed log. Recommend adding it.

## Existing auth tests — PASS

`auth-deactivated.test.ts` uses its own `testAuth` middleware (`:33-50`) and never invokes `requireAuth`/`verifyAccessJwt`; `routing.test.ts` stubs a fake user (`:37-40`) and also never invokes `requireAuth`. Neither exercises the real JWT path, so the shim cannot affect them. The plan's done-condition-3 claim is correct.

## Other findings

- **`.dev.vars.example` already exists** (`RESEND_API_KEY`, `VAPID_PRIVATE_KEY`) — the §4 table calls it "New" and step 4 says "Create". A `Write` per the plan's §5 content would **clobber the existing developer-onboarding template** and drop the two documented secrets. Instruction must be changed to **append** the `DEV_AUTH_IDENTITY` block, not replace the file. (Minor blast radius, but it destroys committed content, so must be corrected.)
- **Email normalization inconsistency (Minor):** the real path lowercases the email inside `verifyAccessJwt` (`src/worker/auth.ts:142`). `resolveDevIdentity` lowercases the explicit-email branch (`sel.toLowerCase()`) but returns `env.OWNER_EMAIL` verbatim in the default branch. `OWNER_EMAIL` is already lowercase in `wrangler.toml:21`, so this is currently harmless, but for true parity the shim should lowercase both branches.
- **TypeScript `cf` access (Nit):** ensure `request.cf` / `cf.colo` typechecks cleanly given the `Request` type in use (`c.req.raw`). With `@cloudflare/workers-types` this should be fine, but the helper signature `(env, request: Request)` plus the T3 cast `as unknown as Request` suggests the Coder should confirm `tsc --noEmit` passes without an unguarded property error.
- **Provenance-doc accuracy (Nit):** the plan cites "confirmed against Cloudflare docs" for the `cf`-absence claim but links only a generic doc page; given the wrangler-4 caveat above, replace with a version-specific empirical confirmation in the plan.

---

## Required changes (fold in before implementation)

1. **Empirically verify Layer B's local behavior against this repo's `wrangler ^4.0.0`.** Run `wrangler dev` and log `request.cf` on an `/api` request. If `request.cf.colo` is populated locally (likely), the plan's keystone claim is false and the shim will be inert locally (done-conditions 1 & 4 fail). Update §3.1/§6 with the observed result, not a generic doc citation.
2. **If `cf` is populated locally, restructure the gate so the *functional* path does not depend on `cf`-absence.** Elevate Layer C (loopback host) to the primary bidirectional signal (A ∧ C), and either drop Layer B or retain it only as a prod-only veto that cannot block local activation. Add the "which layer is primary, and why" tradeoff to the plan explicitly.
3. **Fix the `.dev.vars.example` instruction:** the file already exists with `RESEND_API_KEY`/`VAPID_PRIVATE_KEY`. Change §4/§5/step-4 from "create/new" to "append the `DEV_AUTH_IDENTITY` block," and correct the §4 table's "New" label.
4. **Add activation observability:** emit a one-time `console.warn` (or equivalent) when the shim resolves an identity, so accidental production activation would be loud in logs.
5. **Lowercase the `OWNER_EMAIL` branch** of `resolveDevIdentity` for full parity with the real path (`auth.ts:142`).
6. **(Recommended, not blocking) Add an injectable `cf` seam** so the Layer B veto can be proven end-to-end through `requireAuth`, or explicitly document in the plan why T3-as-pure-unit is accepted as the sole keystone coverage.

The security design (fail-closed, two independent prod vetoes) is approved; the blocking issues are the unverified/likely-broken local-functionality assumption and the file-clobber instruction, both of which are mechanical to fix.

APPROVE WITH CHANGES

---

## Re-review (Pass 2)

Scope: re-review of the **amended** plan after the owner's single-signal redesign. Pass-1 raised six required changes; the amendment reworks the gate from a two-layer (`cf` ∧ host ∧ sentinel) design to a **single load-bearing signal — the loopback request hostname** — with the sentinel explicitly demoted to a non-security toggle. This pass focuses, per owner directive, on the one question that matters: **can the loopback-host gate ever be true on a deployed request, and does it fail closed?** I re-read the amended `docs/plans/dev-auth-shim.md`, `src/worker/auth.ts`, `src/worker/index.ts`, `wrangler.toml`, `.dev.vars.example`, and the two harness tests.

### Disposition of the Pass-1 required changes

- **#1 / #2 (the load-bearing `cf`-absence assumption):** RESOLVED by removal. `request.cf` / `cf.colo` is dropped entirely from the gate (§3.4 helpers, §3.6 flow, §8 log). The fragile local-direction signal no longer exists, so the "ships a dead feature" Major is moot. Confirmed no residue below.
- **#3 (`.dev.vars.example` clobber):** RESOLVED. §4 table, §5, and step 5 now all say **APPEND, do NOT overwrite**, and explicitly name the two existing secrets to preserve.
- **#4 (activation observability):** RESOLVED. §3.5 / step 3 add the one-time `console.warn("[dev-auth] shim active as <email>")` inside the gated branch, framed as a passive prod tripwire.
- **#5 (lowercase both branches):** RESOLVED. §3.4 `resolveDevIdentity` returns `email.toLowerCase()` on a single exit covering both the explicit-email and `OWNER_EMAIL` branches.
- **#6 (injectable seam for end-to-end safety test):** RESOLVED. `isLocalDevContext(request)` is now a pure boolean seam exercised both end-to-end (T3/T4) and in isolation (T5).

### THE SINGLE FOCUS #1 — can `new URL(request.url).hostname` be loopback on a deployed request?

**Finding: No. I could not construct any realistic deployed request whose `request.url` hostname is a loopback literal while still reaching this Worker. PASS.**

- **How `request.url` is derived for a Worker.** The URL authority (`hostname`) is the effective request host — the same host Cloudflare uses to *route* the request to a Worker. A Worker is dispatched only when the request's hostname matches a configured workers.dev subdomain / custom domain / route. `wrangler.toml` here declares **no `routes`**, no wildcard, no `[[services]]`, no Durable Objects, no `[[queues]]` (grep confirmed only `preview_urls = false` for route/preview keys). The deployed authority is `family-scheduler.juniwar-dev.workers.dev` (`APP_URL`, `wrangler.toml:25`). A request whose host is `localhost` matches no route for this Worker and is never dispatched to it; therefore the host observed inside a deployed invocation is always the deployed hostname.
- **Spoofed `Host: localhost` on the production domain.** To reach this Worker the request must match its route by hostname. If the attacker sets `Host: localhost`, the edge has no route/SNI mapping that dispatches `localhost` to this Worker, so it is not invoked. If instead the SNI is the workers.dev domain but the Host/`:authority` is `localhost`, Cloudflare's SNI/Host-mismatch handling rejects or normalizes at the edge rather than dispatching to the Worker with a loopback authority. Either way there is no path that both routes to this Worker **and** presents `new URL(request.url).hostname === "localhost"`. Client headers do not drive routing to a value that contradicts the dispatched hostname.
- **`X-Forwarded-Host` / absolute-form target / proxied requests:** none of these are read by the gate (`isLocalDevContext` reads only `new URL(request.url).hostname`), and none change the routed authority that `request.url` reflects. No bypass.
- **workers.dev / custom domain / version-preview URLs:** all are real public hostnames, never loopback → gate `false` → shim inert. `preview_urls = false` (`wrangler.toml:26`) disables version-preview URLs anyway.
- **Cloudflare Access / Tunnel / Spectrum:** Access sits in front and forwards to origin preserving the real Host (it does not rewrite to loopback); no `cloudflared`/Tunnel or Spectrum config exists in `wrangler.toml`. None can present a loopback authority to the Worker.
- **`wrangler dev --remote`:** this is a developer-gated edge preview reachable only through the developer's authenticated wrangler session (not a public URL, and `preview_urls = false`), so even in the edge case where the local proxy forwards `Host: localhost` and the shim activates, it is not a public production bypass and `DEV_AUTH_IDENTITY` is a local `.dev.vars` toggle the operator controls. Not a security concern. (See Minor 2 — the plan's *stated reason* for `--remote` safety is slightly inaccurate, but the conclusion holds.)

Because Cloudflare dispatches by hostname and `request.url` reflects that dispatched hostname, the single gate is genuinely un-forgeable in production.

### THE SINGLE FOCUS #2 — fail-closed correctness at `auth.ts:170`

**Finding: Fails closed on every branch; the sentinel-demotion claim holds. PASS.**

Walking §3.4/§3.5 against the real insertion point (top of the `createMiddleware` callback at `src/worker/auth.ts:169-170`, before the `const token = c.req.header(...)` at `:171`):

- `isLocalDevContext` wraps `new URL(request.url)` in `try { … } catch { return false }` — the only throw source yields `false` → full verification. No swallowed-exception fail-open.
- `resolveDevIdentity` checks `if (!isLocalDevContext(request)) return null` **first**, before reading `env.DEV_AUTH_IDENTITY`. Non-loopback host → `null` → fall through to the unchanged `verifyAccessJwt` block (`:171-207`).
- Sentinel unset/empty on a loopback host → `if (!sel) return null` → full verification (T4 proves this).
- Activation requires an affirmative loopback host **AND** a non-empty sentinel — no absence-based default-open.
- **Sentinel demotion verified:** even if `DEV_AUTH_IDENTITY` were pushed as a deployed secret, the host gate returns `false` on the deployed hostname *before the sentinel is ever read*, so the shim stays inert. The sentinel cannot re-open the gate. This matches the design intent.
- `resolveDevIdentity` returns a non-empty lowercased email or `null`; `if (devIdentity)` is a correct truthiness test (no empty-string ambiguity because `!sel` already screened empties and both email sources are non-empty). Downstream `upsertUser` → D14 `!user.active` 403 → `c.set("user")` → `next()` are byte-identical to the real path (`:187-206`).

Minor robustness note (not fail-open, not security): in the `OWNER_EMAIL` branch, `email.toLowerCase()` would throw if `OWNER_EMAIL` were ever undefined — but that path is reachable only locally after the gate passes, and `OWNER_EMAIL` is always set (`wrangler.toml:21`). No production impact.

### THE SINGLE FOCUS #3 — no `cf` residue

**Finding: `cf` is fully removed from the gate logic, not just the prose. PASS.** §3.4 helpers reference only `request.url` hostname and `env.DEV_AUTH_IDENTITY`; §3.6 flow has no `cf` node; the amended T3 (§7.1) uses a deployed-style host URL with no fabricated `colo:"DFW"` (the Pass-1 self-undermining detail is gone). `cf`/`colo` now appear only in §3.1/§8 prose explaining *why* the signal was dropped. Nothing in the condition depends on `cf`.

### Secondary confirmations

- **Downstream parity & D14:** PASS. Shim substitutes identity **source** only; `upsertUser`, the D14 active-gate, `requireAdmin`, and OWNER promotion are unchanged. A deactivated `DEV_AUTH_IDENTITY` user is still 403'd (T2 exercises exactly this).
- **Email lowercase parity:** PASS. Confirmed the real path lowercases at `src/worker/auth.ts:142` (`return { ok: true, value: { email: email.toLowerCase() } }`). `resolveDevIdentity` matches on both the explicit-email and `OWNER_EMAIL` branches via a single `email.toLowerCase()` exit.
- **`.dev.vars.example` append:** PASS. Confirmed the file currently holds only `RESEND_API_KEY` and `VAPID_PRIVATE_KEY` (lines 4-5); the plan appends the `DEV_AUTH_IDENTITY` block and preserves both. Coder should implement via an append/Edit, not a `Write` that recreates the file.
- **Locked list / schema:** PASS. `verifyAccessJwt`, `requireAdmin`, the D14 gate, and the self-deactivation guard are untouched; no schema/migration change; existing `auth-deactivated.test.ts` and `routing.test.ts` use their own stub middleware and never reach the real `requireAuth` path, so they stay green.

### DC2 load-bearing safety test — runnable and regression-catching, with ONE clarification needed

The harness mechanics are genuinely sound: `request.url` equals the exact string passed to `new Request(url, …)` (confirmed against `tests/unit/auth-deactivated.test.ts:115` and `tests/unit/routing.test.ts:107`), so the test fully controls the hostname, and `env` is merged per-request so `DEV_AUTH_IDENTITY` is set/omitted at will. T3 (deployed host + sentinel present → 401) and T4 (loopback host + sentinel unset → 401) both short-circuit at the "Missing Access JWT" 401 (`:172-177`) before any JWKS fetch, so they are deterministic without a real Access deployment. Regression value is real: loosening the gate to sentinel-only makes T3 flip to 200; defaulting-open makes T4 flip to 200; T5 pins the seam including the parse-exception → `false` case; and the "loopback-but-sentinel-unset → full verification" case is explicitly covered by T4.

**However (Minor 1, and the reason this is APPROVE WITH CHANGES rather than APPROVE):** step 7 tells the Coder to build the new test "harness pattern from `tests/unit/auth-deactivated.test.ts`," but that file mounts a **`testAuth` stub middleware**, not the real `requireAuth`. The whole point of DC2 is that T3/T4 run **end-to-end through the real `requireAuth`** exported from `src/worker/auth.ts`; if the Coder copies the stub pattern, the load-bearing safety test would silently prove nothing (it would exercise a stub, not the shipped gate). The plan's intent is stated ("end-to-end through `requireAuth`") but the concrete instruction points at a stub-based file. Given the stakes (a total auth bypass), this must be made explicit: the new test must import and mount the real `requireAuth`, borrowing only the `cloudflare:test` env / `applyMigrations` / `app.fetch` mechanics — not the `testAuth` stub.

### Remaining findings (all Minor/Nit — none REJECT-level)

- **Minor 1 — DC2 test must mount the REAL `requireAuth`.** As above: step 7 references a stub-based harness; without an explicit instruction to use `requireAuth` from `src/worker/auth.ts`, T3/T4 could be neutered into stub tests that never touch the gate. Make this explicit in step 7 / §7.1.
- **Minor 2 — `--remote` safety rationale is slightly inaccurate.** §6 claims `wrangler dev --remote` is safe because it "is served on the remote/edge hostname, not a loopback literal." Depending on how the `--remote` proxy forwards `Host`, the edge Worker may actually see `localhost`. The *correct* reason it is not a concern is that `--remote` is a developer-authenticated, non-public preview (no public URL; `preview_urls = false`) with an operator-controlled local `DEV_AUTH_IDENTITY` — not that the hostname is necessarily non-loopback. Fix the stated reason so the safety argument rests on the true property.
- **Nit 3 — SNI/Host-mismatch completeness.** §3.1's forge-resistance argument would be stronger if it named the SNI-vs-`Host`/`:authority` mismatch case explicitly and noted that Cloudflare rejects/normalizes misdirected requests at the edge rather than dispatching a loopback authority to the Worker. The conclusion is unchanged; this just closes the most sophisticated attacker angle in prose.
- **Nit 4 — `T4` env hygiene.** §7.1 T4 requires `DEV_AUTH_IDENTITY` to be genuinely absent from the merged `env`. Since it is (correctly) not in `wrangler.toml [vars]`, the base `cloudflare:test` `env` will not define it, but the test should assert/ensure it is unset rather than assume, so the "toggle-off" path is unambiguously exercised.

### Verdict rationale

All three gating criteria are established: (1) the loopback-host gate cannot be true on a deployed request — Cloudflare dispatches by hostname and `request.url` reflects that dispatched hostname; (2) the logic fails closed on every branch and the sentinel cannot re-open the gate even as a deployed secret; (3) the DC2 safety tests are genuinely runnable and regression-catching **as designed**. The single reason I am not returning a clean APPROVE is Minor 1: the concrete test-authoring instruction points at a stub-based harness, and given the stakes the plan must state unambiguously that the load-bearing tests mount the real `requireAuth`. That, plus the two accuracy fixes (Minor 2, Nit 3) and the env-hygiene nit, are mechanical and non-structural. Fold them in and this is ready to implement.

Required changes (fold in before implementation):

1. **Make DC2 mount the real `requireAuth`.** Amend step 7 / §7.1 to state that `tests/unit/dev-auth-shim.test.ts` imports and mounts the real `requireAuth` from `src/worker/auth.ts` (reusing only the `cloudflare:test` env / `applyMigrations` / `app.fetch` mechanics), and must NOT copy the `testAuth` stub from `auth-deactivated.test.ts`.
2. **Correct the `--remote` safety rationale** in §6 to rest on "developer-authenticated, non-public preview + operator-controlled local toggle" rather than on the hostname necessarily being non-loopback.
3. **(Nit) Strengthen §3.1** by naming the SNI/`Host`-mismatch case and Cloudflare's misdirected-request handling, and **ensure T4 asserts `DEV_AUTH_IDENTITY` is unset** rather than assuming it.

APPROVE WITH CHANGES

---

## Re-review (Pass 3)

Scope: final verification pass on the **amended** `docs/plans/dev-auth-shim.md`. Per the Pass-2 verdict, the architect was to fold in exactly three items — the Major (real `requireAuth` in the DC2 safety test), the `--remote` rationale (Minor 2), and the §3.1 SNI nit + T4 sentinel-unset assertion (Nit 3/4). I re-read the amended plan, `src/worker/auth.ts`, and `tests/unit/auth-deactivated.test.ts`, and confirmed the gate design itself was not disturbed by the edit. I did NOT re-litigate the gate design (approved in Pass 2).

### Resolution of the three Pass-2 items

- **[Major — Pass-2 #1] Real `requireAuth` in the safety test — RESOLVED, unambiguously closed.** The plan now nails this shut in three coordinated places:
  - §4 table (`docs/plans/dev-auth-shim.md:146`): the new test file "Mounts the **real** `requireAuth` from `src/worker/auth.ts` — NOT the `testAuth` stub."
  - Step 7 (`:190`): opens with "**CRITICAL — the load-bearing safety tests must exercise the REAL gate, not a stub.**" It scopes reuse to "**only the harness mechanics**" (the `cloudflare:test` `env`, `applyMigrations`, and the `app.fetch(...)` pattern), names the exact stub to avoid (`auth-deactivated.test.ts:33-50`, mounted at `:54`), states the consequence in plain terms ("If T3/T4/T5 were run against the stub they would prove **nothing**... a silent, load-bearing hole"), and prescribes the correct wiring: "**imports the real `requireAuth` from `src/worker/auth.ts`** and mounts it exactly as the production app wires it — `app.use(\"/api/*\", requireAuth)` (mirroring `src/worker/index.ts`)."
  - §7.1 header (`:196`) and the DC2 banner (`:202`) repeat the constraint ("These MUST mount the real `requireAuth`; against the `testAuth` stub they would pass vacuously and prove nothing").

  There is no longer any door left open to a stub-based safety test — the three cross-referencing statements make a stub copy an explicit, called-out error rather than a plausible default. **The determinism claim is sound against the real code.** With no `Cf-Access-Jwt-Assertion` header, `requireAuth` reads the token at `src/worker/auth.ts:171` and returns the 401 at `:172-177` **before** the `verifyAccessJwt(token, ...)` call at `:179` — and `verifyAccessJwt` is the only path to `getAccessKeys` (`:116` → `:20-33`, the JWKS fetch). So:
    - **T3** (deployed host `https://family-scheduler.juniwar-dev.workers.dev/api/me`, sentinel present, no JWT): `resolveDevIdentity` → `isLocalDevContext` false on the non-loopback host → `null` → falls through to `:171` → no token → `401 "Missing Access JWT"`, no network. This genuinely exercises the loopback gate falling through to real verification with the sentinel set — the worst case — and flips to `200` if the gate is loosened to sentinel-only. Load-bearing as intended.
    - **T4** (loopback host, sentinel unset, no JWT): `isLocalDevContext` true but `!sel` → `null` → same fall-through → `401`, no network. Deterministic.
  Neither test needs a live Access deployment or JWKS shaping. Confirmed.

- **[Minor — Pass-2 #2] `--remote` rationale — RESOLVED.** §6 (`:174`) now explicitly disclaims the old reasoning ("**not** because the hostname is necessarily non-loopback — depending on how the `--remote` proxy forwards `Host`/`:authority`, the edge Worker could in principle observe `localhost`") and rests the safety argument on the true properties: a developer-authenticated, non-public preview context (`preview_urls = false`, reachable only through the developer's own wrangler session) plus the operator-controlled local `DEV_AUTH_IDENTITY` toggle, and — critically — affirms that "the production-safety property for the DEPLOYED public Worker is entirely unaffected" (real public traffic → deployed hostname → host gate `false` → shim inert). Wording is now correct.

- **[Nit — Pass-2 #3] §3.1 SNI/Host-mismatch + T4 unset assertion — RESOLVED (both).** §3.1 (`:44`) now names the case explicitly ("the SNI/`Host`(`:authority`) mismatch case: an edge request whose `Host`/`:authority` does not match the Worker's routed authority... is **rejected or normalized at the edge**, not dispatched to the Worker with a loopback authority"). §7.1 T4 (`:204`) now requires the test to "**explicitly assert/ensure `DEV_AUTH_IDENTITY` is unset** in the merged `env` (do not merely assume the base `cloudflare:test` env omits it)." Both closed.

### Regression guard — the approved gate design is UNCHANGED by this edit

Spot-checked the amendment did not accidentally alter the Pass-2-approved design:
- **§3.1** (`:31-47`): loopback request hostname remains the sole load-bearing signal; allow-set is still exactly `{"localhost","127.0.0.1","[::1]"}`. The added SNI prose is explanatory only — the condition is untouched.
- **§3.4** (`:73-91`): `isLocalDevContext` still wraps `new URL(request.url)` in `try { … } catch { return false }` (fail closed); `resolveDevIdentity` still checks `if (!isLocalDevContext(request)) return null` **first**, before reading `env.DEV_AUTH_IDENTITY` (host-before-sentinel order preserved).
- **§3.6** flow (`:122-134`): the security gate `G` (host) precedes the non-security toggle `T` (sentinel); no `cf` node. `cf`/`colo` appear only in §3.1/§6/§8 prose explaining the *removal* — nothing in the condition references them. Sentinel remains demoted/non-load-bearing (§3.2, `:58` — "cannot re-open the gate").
- **Locked list intact** (§2, `:23-24`): `verifyAccessJwt` internals, `requireAdmin`, the D14 active gate, and the self-deactivation guard are untouched; no schema/migration change (§5, `:153`).
- **DC1/DC3/DC4 present and coherent** (§7.1, `:198-214`): DC1 = T1/T2 (both through real `requireAuth`); DC3 = existing `auth-deactivated.test.ts` / `routing.test.ts` stay green (they use their own stub middleware and never reach the real `requireAuth`, so the shim cannot affect them — matches `auth-deactivated.test.ts:33-50`); DC4 = manual local drive. The **D14-still-applies** check survives: T2 (`:200`) deactivates the shimmed non-owner and re-requests expecting `403 DEACTIVATED`, proving the shim substitutes identity **source** only, and §3.5 (`:107`) re-checks `if (!user.active) return 403` on the identical downstream path (`upsertUser` → D14 gate → `c.set` → `next`, matching `auth.ts:187-206`).

### Verdict rationale

All three Pass-2 items are resolved: the Major is closed unambiguously and across three mutually-reinforcing locations, with a determinism claim that checks out against the real short-circuit at `src/worker/auth.ts:172-177`; the `--remote` rationale now rests on the true property; and both the §3.1 SNI prose and the T4 unset assertion are present. The approved single-signal, fail-closed gate design is unchanged by the amendment, and the locked list, downstream parity, and DC1/DC3/DC4 (with the D14 check) remain intact. No new issues introduced. This is ready to implement as-is.

APPROVE
