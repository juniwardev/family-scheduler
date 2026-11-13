# Architect Kickoff: Local-only dev auth shim

Branch: `feat/dev-auth-shim` (off `main`). Produce a written plan under `docs/plans/`, then plan-review → Coder → QA. This modifies `src/worker/auth.ts`, a locked, security-critical file, so it goes through the full loop and plan-review's primary job is to confirm the local-only gating is airtight. This is small in code but high in stakes: a dev auth bypass that can activate in production is a total authentication bypass.

## Why this exists

The app currently cannot be run or manually tested locally, because `auth.ts` enforces full Cloudflare Access JWT verification with no development bypass. Access only exists in front of the deployed Worker, so `wrangler dev` on localhost has no Access layer and every request fails with "Missing Access JWT." The design plan's Phase 1.2 referenced "a dev token shim" that was never implemented. This gap blocks all local manual QA and will bite every frontend change (the next feature, notifications + location, is frontend-heavy and needs local testing).

## Goal

In local development only, the Worker accepts a simulated authenticated identity so the app can be exercised end-to-end without a real Access token. In every deployed environment, authentication is unchanged: real Access JWT verification, no bypass, no exceptions.

## The non-negotiable requirement (the whole point of the review)

The shim MUST be impossible to activate against the deployed Worker. Design the gate so it keys off something that is definitionally true only under `wrangler dev` / local execution, NOT off a plain environment variable or request header that an attacker (or a misconfiguration) could set in production. The plan must state exactly what signal distinguishes local from deployed, and argue why that signal cannot be forged or accidentally enabled in production.

Anti-patterns to explicitly reject in the plan:
- A `DEV_MODE`/`BYPASS_AUTH` env var that could be set on the deployed Worker.
- Trusting a request header (e.g. `X-Dev-User`) that a client could send to production.
- Any gate that depends on the *absence* of a value (fails open).

The gate should fail closed: if there is any doubt about whether the context is local, it does full Access verification.

## Behavior

- **Local dev:** the shim supplies a test identity. It should default to `OWNER_EMAIL` (so admin paths are exercisable), and ideally allow choosing a different test email so non-owner/member and deactivated-user flows can be tested locally too. Decide the mechanism (a local-only var read only when the local gate is already satisfied is acceptable, since it can't be reached in production).
- **Deployed:** `verifyAccessJwt` runs exactly as today. No code path reachable in production may skip it.
- The shim feeds the same downstream `user` object the real path produces (via `upsertUser`), so routes, `requireAuth`, and `requireAdmin` behave identically whether the identity came from a real JWT or the shim.

## Inputs to read

- `src/worker/auth.ts` (the verification path, `requireAuth`, `requireAdmin`).
- `env.ts` and `wrangler.toml` (how vars/secrets are surfaced, and what distinguishes local from deployed).
- The design plan's Phase 1.2 note about the dev shim.

## Locked / do not touch

- `verifyAccessJwt` itself (issuer/aud/signature checks) stays exactly as-is; the shim decides *whether* to call it, it does not weaken it.
- `requireAdmin`, the admin self-deactivation guard, the D14 deactivation gate, and the rest of the auth authorization logic are unchanged.
- No other feature code. This is auth-entry only.

## Tests / done conditions

1. **Local:** with `wrangler dev`, an unauthenticated request is treated as the configured test identity; the app loads and can be driven; `/api/me` returns the test user; admin paths work when the identity is `OWNER_EMAIL`.
2. **Production-safety (the load-bearing test):** a test proving that when the local gate is not satisfied (i.e. the deployed/production context), the shim is inert and full Access JWT verification runs, a request without a valid JWT is rejected exactly as today. This test must fail if someone later loosens the gate.
3. Existing auth tests still pass unchanged (the real verification path is untouched).
4. Manual confirmation the app is now drivable locally (this is the whole point, once merged, verify you can actually click through the app on localhost as the test user).

## Process

Architect plan → plan-review (focus: is the local-only gate un-forgeable and fail-closed?) → Coder → QA. QA's sign-off MUST explicitly include confirmation that the shim does nothing against a simulated deployed context (done-condition 2). Own branch, PR back to `main`. Do not deploy anything that changes production auth behavior; by design, nothing here should change production behavior at all.
